import { describe, expect, it } from 'vitest'

import { createTaskQueue } from './task-queue'

describe('createTaskQueue', () => {
  it('runs 100 tasks in FIFO order within the concurrency limit', async () => {
    const queue = createTaskQueue(2)
    const gates = Array.from({ length: 100 }, () =>
      Promise.withResolvers<number>()
    )
    const starts = Array.from({ length: 100 }, () =>
      Promise.withResolvers<void>()
    )
    const order: number[] = []
    let running = 0
    let maximum = 0
    const results = gates.map((gate, index) =>
      queue.push(async () => {
        running += 1
        maximum = Math.max(maximum, running)
        order.push(index)
        starts[index].resolve()
        try {
          return await gate.promise
        } finally {
          running -= 1
        }
      })
    )

    expect(queue.active).toBe(2)
    expect(queue.pending).toBe(98)
    for (let index = 0; index < gates.length; index += 1) {
      await starts[index].promise
      expect(queue.active).toBeLessThanOrEqual(2)
      gates[index].resolve(index)
      await expect(results[index]).resolves.toBe(index)
    }
    await expect(Promise.all(results)).resolves.toEqual(
      Array.from({ length: 100 }, (_, index) => index)
    )
    expect(order).toEqual(Array.from({ length: 100 }, (_, index) => index))
    expect(maximum).toBe(2)
    expect(queue.active).toBe(0)
    expect(queue.pending).toBe(0)
  })

  it('starts the next task while a slow earlier task is still pending', async () => {
    const queue = createTaskQueue(2)
    const slow = Promise.withResolvers<string>()
    const fast = Promise.withResolvers<string>()
    const nextStarted = Promise.withResolvers<void>()
    const first = queue.push(() => slow.promise)
    const second = queue.push(() => fast.promise)
    const third = queue.push(async () => {
      nextStarted.resolve()
      return 'third'
    })
    fast.resolve('second')
    await expect(second).resolves.toBe('second')
    await nextStarted.promise
    await expect(third).resolves.toBe('third')
    expect(queue.active).toBe(1)
    expect(queue.pending).toBe(0)
    slow.resolve('first')
    await expect(first).resolves.toBe('first')
    expect(queue.active).toBe(0)
  })

  it.each(['throw', 'reject'])(
    'propagates %s and completes subsequent tasks',
    async (mode) => {
      const queue = createTaskQueue(1)
      const firstGate = Promise.withResolvers<number>()
      const error = new Error('Task failed')
      const first = queue.push(() => firstGate.promise)
      const failed = queue.push<number>(() => {
        if (mode === 'throw') throw error
        return Promise.reject(error)
      })
      const rejected = expect(failed).rejects.toBe(error)
      const last = queue.push(async () => 3)
      firstGate.resolve(1)
      await expect(first).resolves.toBe(1)
      await rejected
      await expect(last).resolves.toBe(3)
      expect(queue.active).toBe(0)
      expect(queue.pending).toBe(0)
    }
  )

  it.each([0, -2, 0.5])(
    'uses one worker for concurrency %s',
    async (concurrency) => {
      const queue = createTaskQueue(concurrency)
      const gate = Promise.withResolvers<void>()
      const first = queue.push(() => gate.promise)
      const second = queue.push(async () => 'second')
      expect(queue.active).toBe(1)
      expect(queue.pending).toBe(1)
      gate.resolve()
      await first
      await expect(second).resolves.toBe('second')
      expect(queue.active).toBe(0)
      expect(queue.pending).toBe(0)
    }
  )
})
