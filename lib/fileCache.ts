// Simple in-memory cache for file data
// Note: This is reset on server restart. For production, consider Redis or similar.

interface CachedFile {
  fileBase64: string
  mimeType: string
  timestamp: number
}

const cache = new Map<string, CachedFile>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function generateFileId(): string {
  return `file_${Date.now()}_${Math.random().toString(36).substring(7)}`
}

export function cacheFile(fileId: string, fileBase64: string, mimeType: string): void {
  cache.set(fileId, {
    fileBase64,
    mimeType,
    timestamp: Date.now(),
  })
  
  // Clean up expired entries
  cleanupExpiredCache()
}

export function getCachedFile(fileId: string): { fileBase64: string; mimeType: string } | null {
  const cached = cache.get(fileId)
  
  if (!cached) {
    return null
  }
  
  // Check if expired
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    cache.delete(fileId)
    return null
  }
  
  return {
    fileBase64: cached.fileBase64,
    mimeType: cached.mimeType,
  }
}

function cleanupExpiredCache(): void {
  const now = Date.now()
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      cache.delete(key)
    }
  }
}
