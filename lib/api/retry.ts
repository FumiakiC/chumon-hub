export function computeRetryDelayMs(options: {
  /** 1-based retry attempt. */
  attempt: number
  retryAfterHeader: string | null
  /** Defaults to Math.random; injectable for deterministic tests. */
  random?: () => number
}): number {
  const { attempt, retryAfterHeader, random = Math.random } = options
  const seconds = Number(retryAfterHeader)
  const validHeader =
    retryAfterHeader !== null &&
    /^\d+$/.test(retryAfterHeader.trim()) &&
    Number.isSafeInteger(seconds) &&
    seconds > 0
  const baseMs = validHeader ? seconds * 1000 : 2000 * 2 ** (attempt - 1)
  return Math.min(10000, baseMs * (0.8 + 0.4 * random()))
}
