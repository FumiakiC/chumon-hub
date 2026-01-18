import crypto from 'crypto'

const DEFAULT_SECRET = 'dev-default-secret'

function getSecret(): string {
  return process.env.API_SECRET || DEFAULT_SECRET
}

export function signFileId(fileId: string): string {
  const hmac = crypto.createHmac('sha256', getSecret())
  hmac.update(fileId)
  const signature = hmac.digest('hex')
  return `${fileId}.${signature}`
}

export function verifyFileId(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [fileId, signature] = parts
  if (!fileId || !signature) return null

  const hmac = crypto.createHmac('sha256', getSecret())
  hmac.update(fileId)
  const expected = hmac.digest('hex')

  const expectedBuf = Buffer.from(expected, 'hex')
  const sigBuf = Buffer.from(signature, 'hex')
  if (expectedBuf.length !== sigBuf.length) return null

  const isValid = crypto.timingSafeEqual(expectedBuf, sigBuf)
  return isValid ? fileId : null
}
