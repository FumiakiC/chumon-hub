// Simple in-memory cache for Google AI File Manager references
// Note: This is reset on server restart. For production, consider Redis or similar.

interface CachedFile {
  fileUri: string // Google AI File Manager URI
  name: string // File identifier (files/xxx)
  mimeType: string
  timestamp: number
}

const cache = new Map<string, CachedFile>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Use globalThis to ensure singleton across module instances in serverless/runtime
type GlobalCacheControls = {
  maintenanceStarted: boolean
  intervalHandle: ReturnType<typeof setInterval> | null
}

const GLOBAL_KEY = '__v0_file_cache_controls__'
const globalControls: GlobalCacheControls = (globalThis as any)[GLOBAL_KEY] ?? {
  maintenanceStarted: false,
  intervalHandle: null,
}
const anyGlobal = globalThis as any
anyGlobal[GLOBAL_KEY] = globalControls

export function generateFileId(): string {
  return `file_${crypto.randomUUID()}`
}

export function cacheFile(
  fileId: string,
  fileUri: string,
  name: string,
  mimeType: string
): void {
  // Evict oldest entries if we have too many (simple limit)
  if (cache.size >= 100) {
    let oldestKey: string | null = null
    let oldestTimestamp = Infinity
    for (const [key, value] of cache.entries()) {
      if (value.timestamp < oldestTimestamp) {
        oldestTimestamp = value.timestamp
        oldestKey = key
      }
    }
    if (oldestKey) {
      cache.delete(oldestKey)
    }
  }

  cache.set(fileId, {
    fileUri,
    name,
    mimeType,
    timestamp: Date.now(),
  })
}

export function getCachedFile(fileId: string): { fileUri: string; name: string; mimeType: string } | null {
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
    fileUri: cached.fileUri,
    name: cached.name,
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

export function startFileCacheMaintenance(intervalMs = 60 * 1000): void {
  if (globalControls.maintenanceStarted) return
  globalControls.maintenanceStarted = true
  globalControls.intervalHandle = setInterval(() => {
    try {
      cleanupExpiredCache()
    } catch (error) {
      console.error('Error during cache cleanup:', error)
    }
  }, intervalMs)
}

export function stopFileCacheMaintenance(): void {
  if (globalControls.intervalHandle) {
    clearInterval(globalControls.intervalHandle)
    globalControls.intervalHandle = null
  }
  globalControls.maintenanceStarted = false
}

export function getCacheStats() {
  return {
    items: cache.size,
    ttlMs: CACHE_TTL,
  }
}
