import { describe, expect, it } from 'vitest'

import { computeRetryDelayMs } from './retry'

describe('computeRetryDelayMs', () => {
  it.each([1, 2, 3])(
    'uses integer Retry-After seconds for attempt %s',
    (attempt) => {
      expect(
        computeRetryDelayMs({
          attempt,
          retryAfterHeader: '3',
          random: () => 0.5,
        })
      ).toBe(3000)
    }
  )

  it.each([
    null,
    '',
    ' ',
    'invalid',
    'Wed, 21 Oct 2015 07:28:00 GMT',
    '0',
    '-1',
    '1.5',
    '3seconds',
    'Infinity',
  ])('uses exponential fallback for header %s', (retryAfterHeader) => {
    for (const [attempt, expected] of [
      [1, 2000],
      [2, 4000],
      [3, 8000],
    ]) {
      expect(
        computeRetryDelayMs({ attempt, retryAfterHeader, random: () => 0.5 })
      ).toBe(expected)
    }
  })

  it.each([
    [0, 0.8],
    [0.5, 1],
    [1, 1.2],
  ])('applies deterministic jitter for random %s', (random, factor) => {
    expect(
      computeRetryDelayMs({
        attempt: 1,
        retryAfterHeader: '3',
        random: () => random,
      })
    ).toBeCloseTo(3000 * factor)
    expect(
      computeRetryDelayMs({
        attempt: 2,
        retryAfterHeader: null,
        random: () => random,
      })
    ).toBeCloseTo(4000 * factor)
  })

  it.each([0, 0.5, 1])(
    'caps the final delay at 10000ms with random %s',
    (random) => {
      expect(
        computeRetryDelayMs({
          attempt: 5,
          retryAfterHeader: null,
          random: () => random,
        })
      ).toBe(10000)
      expect(
        computeRetryDelayMs({
          attempt: 1,
          retryAfterHeader: '30',
          random: () => random,
        })
      ).toBe(10000)
    }
  )

  it('applies the cap after jitter', () => {
    expect(
      computeRetryDelayMs({
        attempt: 1,
        retryAfterHeader: '12',
        random: () => 0,
      })
    ).toBe(9600)
    expect(
      computeRetryDelayMs({
        attempt: 1,
        retryAfterHeader: '9',
        random: () => 1,
      })
    ).toBe(10000)
  })
})
