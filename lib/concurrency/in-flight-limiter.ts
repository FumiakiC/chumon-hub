export interface InFlightLimiter {
  tryAcquire(): boolean
  release(): void
  readonly active: number
}

export function createInFlightLimiter(limit: number): InFlightLimiter {
  let active = 0

  return {
    tryAcquire() {
      if (limit > 0 && active >= limit) return false
      active += 1
      return true
    },
    release() {
      active = Math.max(0, active - 1)
    },
    get active() {
      return active
    },
  }
}

export function resolveInFlightLimit(
  raw: string | undefined,
  fallback: number
): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback
  const limit = Number(raw)
  return Number.isSafeInteger(limit) ? limit : fallback
}

export async function withInFlight<T>(
  limiter: InFlightLimiter,
  handlers: {
    onLimitExceeded: () => T | Promise<T>
    onAcquired: () => Promise<T>
  }
): Promise<T> {
  if (!limiter.tryAcquire()) return handlers.onLimitExceeded()

  try {
    return await handlers.onAcquired()
  } finally {
    limiter.release()
  }
}
