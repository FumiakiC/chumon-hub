// CI 専用のクロップスモークで、本番では使わない.
// 偽 Access IdP を使い、本番と同じ JWT 検証と Turbopack バンドル経由のクロップを検査する.
// TLS 検証は無効化せず、信頼の追加は NODE_EXTRA_CA_CERTS の使い捨て CA だけとする.
// トークン・鍵・PEM などの秘密値をログに出さない.
import {
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const sensitiveValues = new Set()

class SmokeCheckError extends Error {
  constructor(
    name,
    expected,
    result = { status: 'none', body: '' },
    cause = 'unknown'
  ) {
    super(name)
    this.expected = expected
    this.result = result
    this.cause = cause
  }
}

function getErrorCause(error) {
  return (
    [error?.cause?.code, error?.code, error?.name].find(
      (value) => typeof value === 'string' && value.length > 0
    ) ?? 'unknown'
  )
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new SmokeCheckError('configuration', `${name} must be set`)
  }
  return value
}

function check(condition, name, expected, result) {
  if (!condition) throw new SmokeCheckError(name, expected, result)
}

function redact(body) {
  let text = body
  for (const value of sensitiveValues) {
    text = text.replaceAll(value, '[redacted]')
  }
  return text
    .replace(
      /-----BEGIN [^-]+-----[\s\S]*?(?:-----END [^-]+-----|$)/g,
      '[redacted PEM]'
    )
    .replace(/\beyJ[\w-]*\.[\w-]+\.[\w-]+/g, '[redacted JWT]')
    .slice(0, 300)
}

async function prepare() {
  const directory = requireEnv('CROP_SMOKE_MATERIAL_DIR')
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  })
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: randomUUID(),
    alg: 'RS256',
    use: 'sig',
  }
  await writeFile(
    join(directory, 'private.pem'),
    privateKey.export({ format: 'pem', type: 'pkcs8' }),
    { mode: 0o600, flag: 'wx' }
  )
  await writeFile(
    join(directory, 'jwks.json'),
    JSON.stringify({ keys: [jwk] }),
    { mode: 0o644, flag: 'wx' }
  )
  console.log('Prepared disposable RS256 signing key and JWKS')
}

function createPdf() {
  const width = 595.28
  const height = 841.89
  const commands = ['BT', '/F1 10 Tf']
  for (let vertical = 1; vertical < height; vertical += 10) {
    for (let horizontal = 0; horizontal < width; horizontal += 8) {
      commands.push(`1 0 0 1 ${horizontal} ${vertical} Tm (H) Tj`)
    }
  }
  commands.push('ET')
  const content = commands.join('\n') + '\n'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ]
  const parts = ['%PDF-1.4\n']
  const offsets = [0]
  let length = Buffer.byteLength(parts[0])
  for (const [index, object] of objects.entries()) {
    offsets.push(length)
    const part = `${index + 1} 0 obj\n${object}\nendobj\n`
    parts.push(part)
    length += Buffer.byteLength(part)
  }
  parts.push(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`
  )
  return Buffer.from(parts.join(''), 'ascii')
}

function createToken(privateKey, kid, issuer, audience) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })
  ).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      iss: issuer,
      aud: audience,
      iat: issuedAt,
      exp: issuedAt + 300,
    })
  ).toString('base64url')
  const input = `${header}.${payload}`
  const signature = sign('RSA-SHA256', Buffer.from(input), privateKey)
  const token = `${input}.${signature.toString('base64url')}`
  sensitiveValues.add(token)
  return token
}

async function request(name, expected, url, options, timeout) {
  const result = { status: 'none', body: '' }
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeout),
    })
    result.status = response.status
    result.body = await response.text()
  } catch (error) {
    throw new SmokeCheckError(name, expected, result, getErrorCause(error))
  }
  return result
}

function parseJson(name, expected, result) {
  try {
    return JSON.parse(result.body)
  } catch {
    throw new SmokeCheckError(name, expected, result)
  }
}

async function postPdf(name, expectedStatus, appUrl, pdf, token) {
  const form = new FormData()
  form.append(
    'file',
    new Blob([pdf], { type: 'application/pdf' }),
    'crop-smoke.pdf'
  )
  const result = await request(
    name,
    `HTTP ${expectedStatus}`,
    `${appUrl}/api/crop-title-block`,
    {
      method: 'POST',
      body: form,
      headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
    },
    expectedStatus === 200 ? 60_000 : 15_000
  )
  check(
    result.status === expectedStatus,
    name,
    `HTTP ${expectedStatus}`,
    result
  )
  console.log(`${name}: HTTP ${result.status}`)
  return result
}

async function checkPixels(png, result) {
  try {
    const requireFromApp = createRequire('/app/package.json')
    const { createCanvas, loadImage } = requireFromApp('@napi-rs/canvas')
    const image = await loadImage(png)
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    let darkPixels = 0
    for (let offset = 0; offset < data.length; offset += 4) {
      if (
        data[offset + 3] === 255 &&
        data[offset] < 128 &&
        data[offset + 1] < 128 &&
        data[offset + 2] < 128
      ) {
        darkPixels += 1
      }
    }
    check(darkPixels > 0, 'pixels', 'at least one opaque dark pixel', result)
    console.log(`pixels: PNG decoded, dark pixels=${darkPixels}`)
  } catch (error) {
    if (error instanceof SmokeCheckError) throw error
    throw new SmokeCheckError(
      'pixels',
      'canvas must decode the PNG',
      result,
      getErrorCause(error)
    )
  }
}

async function run() {
  const team = requireEnv('CLOUDFLARE_TEAM_DOMAIN')
  const audience = requireEnv('CLOUDFLARE_AUDIENCE')
  const directory = requireEnv('CROP_SMOKE_MATERIAL_DIR')
  const appUrl = requireEnv('CROP_SMOKE_APP_URL')
  const issuer = `https://${team}.cloudflareaccess.com`
  const localJwks = JSON.parse(
    await readFile(join(directory, 'jwks.json'), 'utf8')
  )
  const publishedKey = localJwks.keys[0]
  const jwksResult = await request(
    'IdP 側の問題: JWKS preflight',
    'trusted TLS, HTTP 200, and the prepared JWKS kid',
    `${issuer}/cdn-cgi/access/certs`,
    {},
    15_000
  )
  check(
    jwksResult.status === 200,
    'IdP 側の問題: JWKS preflight',
    'HTTP 200',
    jwksResult
  )
  const remoteJwks = parseJson(
    'IdP 側の問題: JWKS preflight',
    'JSON JWKS',
    jwksResult
  )
  check(
    Array.isArray(remoteJwks?.keys) &&
      remoteJwks.keys.some(
        (key) =>
          key?.kid === publishedKey.kid &&
          key.alg === 'RS256' &&
          key.use === 'sig' &&
          key.kty === 'RSA' &&
          key.n === publishedKey.n &&
          key.e === publishedKey.e
      ),
    'IdP 側の問題: JWKS preflight',
    'JWKS containing the prepared RS256 public key and kid',
    jwksResult
  )
  console.log('JWKS preflight: trusted TLS, HTTP 200, matching kid')

  const pdf = createPdf()
  console.log('PDF: one portrait A4 page with non-embedded Helvetica text only')
  const privatePem = await readFile(join(directory, 'private.pem'), 'utf8')
  sensitiveValues.add(privatePem)
  const privateKey = createPrivateKey(privatePem)
  const otherKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  }).privateKey

  await postPdf('missing-header', 401, appUrl, pdf)
  await postPdf(
    'unpublished-key',
    401,
    appUrl,
    pdf,
    createToken(otherKey, publishedKey.kid, issuer, audience)
  )
  await postPdf(
    'wrong-audience',
    401,
    appUrl,
    pdf,
    createToken(privateKey, publishedKey.kid, issuer, `${audience}-wrong`)
  )
  const result = await postPdf(
    'valid-token',
    200,
    appUrl,
    pdf,
    createToken(privateKey, publishedKey.kid, issuer, audience)
  )
  const response = parseJson('PNG response', 'JSON response', result)
  check(
    Array.isArray(response?.croppedFiles) && response.croppedFiles.length === 1,
    'PNG response',
    'exactly one croppedFiles entry',
    result
  )
  const cropped = response.croppedFiles[0]
  const prefix = 'data:image/png;base64,'
  check(
    cropped?.mimeType === 'image/png' &&
      typeof cropped.base64 === 'string' &&
      cropped.base64.startsWith(prefix),
    'PNG response',
    'image/png MIME and PNG base64 data URI',
    result
  )
  const png = Buffer.from(cropped.base64.slice(prefix.length), 'base64')
  check(
    png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    'PNG signature',
    '89504e470d0a1a0a',
    result
  )
  console.log('PNG response: one image/png data URI, PNG signature OK')
  await checkPixels(png, result)
}

async function main() {
  const command = process.argv[2]
  if (command === 'prepare') return prepare()
  if (command === 'run') return run()
  throw new SmokeCheckError('command', 'prepare or run')
}

main().catch((error) => {
  const failure =
    error instanceof SmokeCheckError
      ? error
      : new SmokeCheckError(
          'smoke setup',
          'readable valid smoke materials',
          undefined,
          getErrorCause(error)
        )
  console.error(
    `FAIL ${failure.message}: expected=${failure.expected}; status=${failure.result.status}; body=${JSON.stringify(redact(failure.result.body))}; cause=${failure.cause}`
  )
  process.exitCode = 1
})
