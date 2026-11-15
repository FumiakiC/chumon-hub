import { createInFlightLimiter, withInFlight } from './in-flight-limiter'
import { createTaskQueue } from './task-queue'

export function createSerializedInFlight(limit: number) {
  const limiter = createInFlightLimiter(limit)
  const queue = createTaskQueue(1)

  return function runSerialized<T>(handlers: {
    onLimitExceeded: () => T | Promise<T>
    onAcquired: () => Promise<T>
  }): Promise<T> {
    return withInFlight(limiter, {
      onLimitExceeded: handlers.onLimitExceeded,
      onAcquired: () => queue.push(handlers.onAcquired),
    })
  }
}
