/**
 * Thin console wrapper used to centralize application logging.
 * Debug and info logs are suppressed in production.
 */
export const logger = {
  debug: (...data: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(...data)
    }
  },
  info: (...data: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.info(...data)
    }
  },
  warn: (...data: unknown[]) => {
    console.warn(...data)
  },
  error: (...data: unknown[]) => {
    console.error(...data)
  },
}
