import { describe, expect, it } from 'vitest'

import { tooManyRequestsResponse, validationErrorResponse } from './errors'

describe('tooManyRequestsResponse', () => {
  it.each([
    [NaN, '1'],
    [0, '1'],
    [-1, '1'],
    [2.5, '3'],
    [Infinity, '1'],
    [-Infinity, '1'],
  ] as const)('normalizes Retry-After %s to %s', (seconds, expected) => {
    const response = tooManyRequestsResponse(seconds)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe(expected)
  })

  it.each([3, 7])(
    'returns the 429 contract with Retry-After %s',
    async (seconds) => {
      const response = tooManyRequestsResponse(seconds)
      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBe(String(seconds))
      const body = await response.json()
      expect(body).toEqual({
        error: 'Too many concurrent requests.',
        code: 'ERR_TOO_MANY_REQUESTS',
      })
      const validationBody = await validationErrorResponse(400).json()
      expect(Object.keys(body).sort()).toEqual(
        Object.keys(validationBody).sort()
      )
    }
  )
})
