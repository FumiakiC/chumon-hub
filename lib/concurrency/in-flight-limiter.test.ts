import { describe, expect, it, vi } from 'vitest'

import {
  createInFlightLimiter,
  resolveInFlightLimit,
  withInFlight,
} from './in-flight-limiter'

describe('createInFlightLimiter', () => {
  it('rejects excess acquisitions without changing active and reuses released slots', () => {
    const limiter = createInFlightLimiter(2)
    expect(limiter.tryAcquire()).toBe(true)
    expect(limiter.tryAcquire()).toBe(true)
    expect(limiter.active).toBe(2)
    expect(limiter.tryAcquire()).toBe(false)
    expect(limiter.active).toBe(2)
    limiter.release()
    expect(limiter.tryAcquire()).toBe(true)
    expect(limiter.active).toBe(2)
  })

  it.each([0, -1])(
    'treats limit %s as unlimited and clamps excess releases',
    (limit) => {
      const limiter = createInFlightLimiter(limit)
      limiter.release()
      expect(limiter.active).toBe(0)
      for (let index = 0; index < 100; index += 1) {
        expect(limiter.tryAcquire()).toBe(true)
      }
      expect(limiter.active).toBe(100)
      for (let index = 0; index < 102; index += 1) limiter.release()
      expect(limiter.active).toBe(0)
    }
  )
})

describe('resolveInFlightLimit', () => {
  it.each([undefined, '', ' ', '-1', '1.5', 'abc', '2jobs', 'NaN', 'Infinity'])(
    'uses the fallback for %s',
    (raw) => {
      expect(resolveInFlightLimit(raw, 2)).toBe(2)
    }
  )

  it.each([
    ['0', 0],
    ['3', 3],
    [' 4 ', 4],
  ])('parses %s', (raw, expected) => {
    expect(resolveInFlightLimit(String(raw), 2)).toBe(expected)
  })
})

describe('withInFlight', () => {
  it.each([200, 400, 500])(
    'releases after returning a result with status %s',
    async (status) => {
      const limiter = createInFlightLimiter(1)
      const result = { status }
      const onLimitExceeded = vi.fn(() => ({ status: 429 }))
      await expect(
        withInFlight(limiter, {
          onLimitExceeded,
          onAcquired: async () => {
            expect(limiter.active).toBe(1)
            return result
          },
        })
      ).resolves.toBe(result)
      expect(limiter.active).toBe(0)
      expect(onLimitExceeded).not.toHaveBeenCalled()
    }
  )

  it.each(['throw', 'reject'])(
    'releases and propagates an acquired handler %s',
    async (mode) => {
      const limiter = createInFlightLimiter(1)
      const error = new Error('Acquired handler failed')
      await expect(
        withInFlight(limiter, {
          onLimitExceeded: () => 'limited',
          onAcquired: () => {
            if (mode === 'throw') throw error
            return Promise.reject(error)
          },
        })
      ).rejects.toBe(error)
      expect(limiter.active).toBe(0)
    }
  )

  it('keeps a pending slot on rejection and reacquires after completion', async () => {
    const limiter = createInFlightLimiter(1)
    const deferred = Promise.withResolvers<string>()
    const first = withInFlight(limiter, {
      onLimitExceeded: () => 'limited',
      onAcquired: () => deferred.promise,
    })
    const onAcquired = vi.fn(async () => 'next')
    expect(limiter.active).toBe(1)
    await expect(
      withInFlight(limiter, {
        onLimitExceeded: async () => 'limited',
        onAcquired,
      })
    ).resolves.toBe('limited')
    expect(onAcquired).not.toHaveBeenCalled()
    expect(limiter.active).toBe(1)
    deferred.resolve('done')
    await expect(first).resolves.toBe('done')
    expect(limiter.active).toBe(0)
    await expect(
      withInFlight(limiter, {
        onLimitExceeded: () => 'limited',
        onAcquired,
      })
    ).resolves.toBe('next')
    expect(onAcquired).toHaveBeenCalledOnce()
    expect(limiter.active).toBe(0)
  })

  it.each(['throw', 'reject'])(
    'does not release when the limit handler fails with %s',
    async (mode) => {
      const limiter = createInFlightLimiter(1)
      limiter.tryAcquire()
      const error = new Error('Limit handler failed')
      const onAcquired = vi.fn(async () => 'unexpected')
      await expect(
        withInFlight(limiter, {
          onLimitExceeded: () => {
            if (mode === 'throw') throw error
            return Promise.reject(error)
          },
          onAcquired,
        })
      ).rejects.toBe(error)
      expect(limiter.active).toBe(1)
      expect(onAcquired).not.toHaveBeenCalled()
      limiter.release()
      expect(limiter.tryAcquire()).toBe(true)
    }
  )
})
