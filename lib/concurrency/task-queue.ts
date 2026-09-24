export interface TaskQueue {
  push<T>(task: () => Promise<T>): Promise<T>
  readonly active: number
  readonly pending: number
}

export function createTaskQueue(concurrency: number): TaskQueue {
  const limit = Number.isFinite(concurrency)
    ? Math.max(1, Math.floor(concurrency))
    : 1
  const waiting: Array<() => void> = []
  let active = 0

  function drain() {
    while (active < limit && waiting.length > 0) {
      const start = waiting.shift()
      if (!start) return
      active += 1
      start()
    }
  }

  return {
    push<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push(() => {
          const run = async () => {
            try {
              resolve(await Promise.resolve().then(task))
            } catch (error) {
              reject(error)
            } finally {
              active -= 1
              drain()
            }
          }
          void run()
        })
        drain()
      })
    },
    get active() {
      return active
    },
    get pending() {
      return waiting.length
    },
  }
}
