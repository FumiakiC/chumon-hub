import crypto from 'crypto'

const DEFAULT_SECRET = 'dev-default-secret-change-in-production'

// Lazy evaluation: check environment variables at runtime, not at build time
let cachedSecret: string | null = null

function getSecret(): string {
  // Return cached secret if already initialized
  if (cachedSecret) {
    return cachedSecret
  }

  const apiSecret = process.env.API_SECRET
  const isProduction = process.env.NODE_ENV === 'production'

  // If API_SECRET is set, cache and return it
  if (apiSecret) {
    cachedSecret = apiSecret
    return cachedSecret
  }

  // In production, API_SECRET is mandatory (fail at runtime, not build time)
  if (isProduction) {
    throw new Error('Production security check failed: API_SECRET is missing')
  }

  // In development, warn and use default value
  console.warn('⚠️  API_SECRET is not set. Using development default value.')
  cachedSecret = DEFAULT_SECRET
  return cachedSecret
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
