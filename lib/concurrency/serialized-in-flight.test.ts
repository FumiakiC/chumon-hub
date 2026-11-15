import { describe, expect, it, vi } from 'vitest'

import { createSerializedInFlight } from './serialized-in-flight'

describe('createSerializedInFlight', () => {
  it('waits for all awaits in the first handler before starting the second', async () => {
    const run = createSerializedInFlight(2)
    const firstGate = Promise.withResolvers<void>()
    const secondGate = Promise.withResolvers<void>()
    const firstStarted = Promise.withResolvers<void>()
    const betweenAwaits = Promise.withResolvers<void>()
    const secondStarted = Promise.withResolvers<void>()
    const order: string[] = []

    const first = run({
      onLimitExceeded: () => 'limited',
      onAcquired: async () => {
        order.push('first-start')
        firstStarted.resolve()
        await firstGate.promise
        order.push('first-between-awaits')
        betweenAwaits.resolve()
        await secondGate.promise
        order.push('first-end')
        return 'first'
      },
    })
    const second = run({
      onLimitExceeded: () => 'limited',
      onAcquired: async () => {
        order.push('second-start')
        secondStarted.resolve()
        return 'second'
      },
    })

    await firstStarted.promise
    expect(order).toEqual(['first-start'])
    firstGate.resolve()
    await betweenAwaits.promise
    expect(order).toEqual(['first-start', 'first-between-awaits'])

    secondGate.resolve()
    await expect(first).resolves.toBe('first')
    await secondStarted.promise
    expect(order).toEqual([
      'first-start',
      'first-between-awaits',
      'first-end',
      'second-start',
    ])
    await expect(second).resolves.toBe('second')
  })

  it('rejects an excess call without invoking its acquired handler', async () => {
    const run = createSerializedInFlight(2)
    const firstGate = Promise.withResolvers<void>()
    const secondGate = Promise.withResolvers<void>()
    const onAcquired = vi.fn(async () => 'unexpected')
    const first = run({
      onLimitExceeded: () => 'limited',
      onAcquired: () => firstGate.promise.then(() => 'first'),
    })
    const second = run({
      onLimitExceeded: () => 'limited',
      onAcquired: () => secondGate.promise.then(() => 'second'),
    })
    const third = run({
      onLimitExceeded: () => 'limited',
      onAcquired,
    })

    await expect(third).resolves.toBe('limited')
    expect(onAcquired).not.toHaveBeenCalled()
    firstGate.resolve()
    await expect(first).resolves.toBe('first')
    secondGate.resolve()
    await expect(second).resolves.toBe('second')
  })

  it('propagates a handler rejection, starts the next call, and releases both slots', async () => {
    const run = createSerializedInFlight(2)
    const firstGate = Promise.withResolvers<void>()
    const secondGate = Promise.withResolvers<void>()
    const error = new Error('handler failed')
    const secondStarted = Promise.withResolvers<void>()
    const first = run({
      onLimitExceeded: () => 'limited',
      onAcquired: async () => {
        await firstGate.promise
        throw error
      },
    })
    const firstRejection = expect(first).rejects.toBe(error)
    const second = run({
      onLimitExceeded: () => 'limited',
      onAcquired: async () => {
        secondStarted.resolve()
        await secondGate.promise
        return 'second'
      },
    })

    firstGate.resolve()
    await firstRejection
    await secondStarted.promise
    secondGate.resolve()
    await expect(second).resolves.toBe('second')

    const thirdGate = Promise.withResolvers<void>()
    const fourthGate = Promise.withResolvers<void>()
    const third = run({
      onLimitExceeded: () => 'limited',
      onAcquired: () => thirdGate.promise.then(() => 'third'),
    })
    const fourth = run({
      onLimitExceeded: () => 'limited',
      onAcquired: () => fourthGate.promise.then(() => 'fourth'),
    })
    const fifth = run({
      onLimitExceeded: () => 'limited',
      onAcquired: async () => 'unexpected',
    })

    await expect(fifth).resolves.toBe('limited')
    thirdGate.resolve()
    await expect(third).resolves.toBe('third')
    fourthGate.resolve()
    await expect(fourth).resolves.toBe('fourth')
  })

  it('preserves admission capacity when a call is rejected', async () => {
    const run = createSerializedInFlight(2)
    const firstGate = Promise.withResolvers<void>()
    const secondGate = Promise.withResolvers<void>()
    const nextGate = Promise.withResolvers<void>()
    const secondStarted = Promise.withResolvers<void>()

    const first = run({
      onLimitExceeded: () => 'limited',
      onAcquired: () => firstGate.promise.then(() => 'first'),
    })
    const second = run({
      onLimitExceeded: () => 'limited',
      onAcquired: async () => {
        secondStarted.resolve()
        await secondGate.promise
        return 'second'
      },
    })
    await expect(
      run({
        onLimitExceeded: () => 'limited',
        onAcquired: async () => 'unexpected',
      })
    ).resolves.toBe('limited')

    firstGate.resolve()
    await expect(first).resolves.toBe('first')
    await secondStarted.promise
    const next = run({
      onLimitExceeded: () => 'limited',
      onAcquired: () => nextGate.promise.then(() => 'next'),
    })
    await expect(
      run({
        onLimitExceeded: () => 'limited',
        onAcquired: async () => 'unexpected',
      })
    ).resolves.toBe('limited')

    secondGate.resolve()
    await expect(second).resolves.toBe('second')
    nextGate.resolve()
    await expect(next).resolves.toBe('next')
  })

  it('admits one running call and two waiting calls at limit three in FIFO order', async () => {
    const run = createSerializedInFlight(3)
    const gates = Array.from({ length: 3 }, () => Promise.withResolvers<void>())
    const started = Array.from({ length: 3 }, () =>
      Promise.withResolvers<void>()
    )
    const order: number[] = []
    const results = gates.map((gate, index) =>
      run({
        onLimitExceeded: () => -1,
        onAcquired: async () => {
          order.push(index)
          started[index].resolve()
          await gate.promise
          return index
        },
      })
    )

    await started[0].promise
    expect(order).toEqual([0])
    await expect(
      run({
        onLimitExceeded: () => -1,
        onAcquired: async () => 3,
      })
    ).resolves.toBe(-1)

    for (let index = 0; index < gates.length; index += 1) {
      gates[index].resolve()
      await started[index + 1]?.promise
      expect(order).toEqual(
        Array.from(
          { length: Math.min(index + 2, gates.length) },
          (_, item) => item
        )
      )
      await expect(results[index]).resolves.toBe(index)
    }

    await expect(Promise.all(results)).resolves.toEqual([0, 1, 2])
    expect(order).toEqual([0, 1, 2])
  })

  it('admits ten unlimited calls but runs them one at a time in FIFO order', async () => {
    const run = createSerializedInFlight(0)
    const gates = Array.from({ length: 10 }, () =>
      Promise.withResolvers<void>()
    )
    const started = Array.from({ length: 10 }, () =>
      Promise.withResolvers<void>()
    )
    const order: number[] = []
    let active = 0
    let maximumActive = 0
    const results = gates.map((gate, index) =>
      run({
        onLimitExceeded: () => -1,
        onAcquired: async () => {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          order.push(index)
          started[index].resolve()
          try {
            await gate.promise
            return index
          } finally {
            active -= 1
          }
        },
      })
    )

    for (let index = 0; index < gates.length; index += 1) {
      await started[index].promise
      expect(active).toBe(1)
      expect(maximumActive).toBe(1)
      expect(order).toEqual(
        Array.from({ length: index + 1 }, (_, item) => item)
      )
      gates[index].resolve()
      await expect(results[index]).resolves.toBe(index)
    }

    await expect(Promise.all(results)).resolves.toEqual(
      Array.from({ length: 10 }, (_, index) => index)
    )
    expect(active).toBe(0)
    expect(maximumActive).toBe(1)
    expect(order).toEqual(Array.from({ length: 10 }, (_, index) => index))
  })
})
