import crypto from 'crypto'

let cachedSecret: string | null = null
let cachedEncryptionKey: Buffer | null = null

const TOKEN_TTL = 5 * 60 * 1000 // 5 minutes

// File token data structure
export interface FileTokenData {
  fileUri: string
  name: string
  mimeType: string
  timestamp: number
}

// Lazy evaluation: resolve secret at runtime to avoid build-time failures
function getSecret(): string {
  if (cachedSecret) return cachedSecret

  const apiSecret = process.env.API_SECRET

  if (!apiSecret) {
    console.error('🚨 FATAL: API_SECRET is not set in environment variables.')
    throw new Error('API_SECRET is not set in environment variables')
  }

  cachedSecret = apiSecret
  return cachedSecret
}

// Derive 32-byte encryption key from secret
function getEncryptionKey(): Buffer {
  if (cachedEncryptionKey) return cachedEncryptionKey

  const secret = getSecret()
  // Use SHA-256 to derive a 32-byte key from the secret
  cachedEncryptionKey = crypto.createHash('sha256').update(secret).digest()

  return cachedEncryptionKey
}

// Encrypt file token with AES-256-GCM
export function encryptFileToken(data: FileTokenData): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(12) // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  // Serialize data to JSON
  const plaintext = JSON.stringify(data)

  // Encrypt
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  // Get auth tag
  const authTag = cipher.getAuthTag()

  // Format: IV.AuthTag.EncryptedData (all hex-encoded)
  return `${iv.toString('hex')}.${authTag.toString('hex')}.${encrypted}`
}

// Decrypt file token with AES-256-GCM
export function decryptFileToken(token: string): FileTokenData | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [ivHex, authTagHex, encryptedHex] = parts

    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const encrypted = Buffer.from(encryptedHex, 'hex')

    // Validate lengths
    if (iv.length !== 12) return null // 96-bit IV
    if (authTag.length !== 16) return null // 128-bit auth tag

    const key = getEncryptionKey()
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    // Use Buffer.concat to safely handle multi-byte characters at boundaries
    const plaintext = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]).toString('utf8')

    const data: FileTokenData = JSON.parse(plaintext)

    // Validate timestamp - check if token is within TTL
    if (Date.now() - data.timestamp > TOKEN_TTL) {
      return null // Token expired
    }

    return data
  } catch (error) {
    console.error('Failed to decrypt file token:', error)
    return null
  }
}
