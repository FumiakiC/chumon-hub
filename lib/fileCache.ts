// Simple in-memory cache for file data
// Note: This is reset on server restart. For production, consider Redis or similar.

interface CachedFile {
  fileBase64: string
  mimeType: string
  timestamp: number
  approxBytes: number
}

const cache = new Map<string, CachedFile>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024 // 50MB per file
const MAX_TOTAL_CACHE_BYTES = 100 * 1024 * 1024 // 100MB total cap

let totalCachedBytes = 0

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

export function cacheFile(fileId: string, fileBase64: string, mimeType: string): void {
  const approxBytes = estimateBase64Bytes(fileBase64)

  if (approxBytes > MAX_SINGLE_FILE_BYTES) {
    throw new Error(`File too large for cache: ${approxBytes} bytes > ${MAX_SINGLE_FILE_BYTES}`)
  }

  // Evict oldest entries until we have room
  ensureCacheHasRoom(approxBytes)

  cache.set(fileId, {
    fileBase64,
    mimeType,
    timestamp: Date.now(),
    approxBytes,
  })
  totalCachedBytes += approxBytes
}

export function getCachedFile(fileId: string): { fileBase64: string; mimeType: string } | null {
  const cached = cache.get(fileId)
  
  if (!cached) {
    return null
  }
  
  // Check if expired
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    evict(fileId, cached)
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
      evict(key, value)
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

function estimateBase64Bytes(b64: string): number {
  // Base64 expands by ~4/3; strip padding and compute
  const len = b64.length
  const padding = (b64.endsWith('==') ? 2 : (b64.endsWith('=') ? 1 : 0))
  return Math.floor((len * 3) / 4) - padding
}

function ensureCacheHasRoom(incomingBytes: number): void {
  // Evict oldest until total + incoming <= cap
  if (totalCachedBytes + incomingBytes <= MAX_TOTAL_CACHE_BYTES) return

  const entries = Array.from(cache.entries())
  entries.sort((a, b) => a[1].timestamp - b[1].timestamp) // oldest first
  for (const [key, value] of entries) {
    evict(key, value)
    if (totalCachedBytes + incomingBytes <= MAX_TOTAL_CACHE_BYTES) break
  }
}

function evict(key: string, value: CachedFile): void {
  if (cache.delete(key)) {
    totalCachedBytes = Math.max(0, totalCachedBytes - (value.approxBytes || 0))
  }
}

export function getCacheStats() {
  return {
    items: cache.size,
    totalBytes: totalCachedBytes,
    ttlMs: CACHE_TTL,
    maxSingleFileBytes: MAX_SINGLE_FILE_BYTES,
    maxTotalBytes: MAX_TOTAL_CACHE_BYTES,
  }
}
