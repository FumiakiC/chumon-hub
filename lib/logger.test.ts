import { ApiError } from '@google/genai'
import { inspect } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfigError } from './errors'
import { type ErrorLogFields, logger, toErrorLogFields } from './logger'

const marker = 'private-marker@unit-test.invalid'

function parseInvalidJson(): unknown {
  try {
    JSON.parse(`${marker} is not JSON`)
  } catch (error) {
    return error
  }
  throw new Error('Expected JSON.parse to throw')
}

function assertLoggerTypes(value: unknown) {
  // @ts-expect-error unknown is not structured log fields
  logger.error('x', value)
  // @ts-expect-error Error objects must be converted to log fields
  logger.error('x', new Error())
  // @ts-expect-error strings are not structured log fields
  logger.error('x', 'str')
  // @ts-expect-error the message must be a string
  logger.error(value)
}
void assertLoggerTypes

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('toErrorLogFields', () => {
  it.each([
    {
      error: new ApiError({ message: marker, status: 404 }),
      expected: { name: 'ApiError', status: 404 },
    },
    {
      error: parseInvalidJson(),
      expected: { name: 'SyntaxError' },
    },
    {
      error: new TypeError('fetch failed', {
        cause: Object.assign(new Error(marker), { code: 'ECONNRESET' }),
      }),
      expected: { name: 'TypeError', causeCode: 'ECONNRESET' },
    },
    {
      error: new ConfigError(marker),
      expected: { name: 'ConfigError', code: 'ERR_SYS_CONFIG' },
    },
    { error: marker, expected: { name: 'string' } },
    { error: undefined, expected: { name: 'undefined' } },
    {
      error: { status: 999, code: `INVALID ${marker}`, message: marker },
      expected: { name: 'object' },
    },
    {
      error: { status: 999, code: `invalid_${marker}`, stack: marker },
      expected: { name: 'object' },
    },
    {
      error: Object.assign(new Error(marker), {
        name: `leaked name /files/${marker}`,
      }),
      expected: { name: 'UnknownError' },
    },
  ])(
    'excludes private data from $expected.name (%#)',
    ({ error, expected }) => {
      const fields = toErrorLogFields(error)
      expect(fields).toStrictEqual(expected)
      expect(inspect(fields, { depth: null })).not.toContain(marker)
      expect(fields).not.toBe(error)
      expect(fields).not.toBe(toErrorLogFields(error))
      expect(Object.getPrototypeOf(fields)).toBe(Object.prototype)
    }
  )

  it.each([null, 1, true, Symbol(marker), BigInt(1), () => marker])(
    'uses typeof for non-Error values (%#)',
    (error) => {
      expect(toErrorLogFields(error)).toStrictEqual({ name: typeof error })
    }
  )

  it.each([100, 599])('accepts HTTP status boundary %s', (status) => {
    expect(toErrorLogFields({ status })).toStrictEqual({
      name: 'object',
      status,
    })
  })

  it.each([99, 600, 404.5, NaN, Infinity, -Infinity, '404', null])(
    'omits invalid HTTP status %s',
    (status) => {
      expect(toErrorLogFields({ status })).toStrictEqual({ name: 'object' })
    }
  )

  it.each(['A', '_', '$', 'Error_123$', 'A'.repeat(64)])(
    'accepts valid Error name %s',
    (name) => {
      expect(toErrorLogFields(Object.assign(new Error(), { name }))).toEqual({
        name,
      })
    }
  )

  it.each(['', '1Error', 'Bad Name', 'Bad/Name', 'A'.repeat(65), 123, null])(
    'replaces invalid Error name %s',
    (name) => {
      expect(toErrorLogFields(Object.assign(new Error(), { name }))).toEqual({
        name: 'UnknownError',
      })
    }
  )

  it.each(['A', 'ERR_SYS_CONFIG', 'ECONNRESET', 'A'.repeat(64)])(
    'accepts valid code and causeCode %s',
    (code) => {
      expect(toErrorLogFields({ code, cause: { code } })).toStrictEqual({
        name: 'object',
        code,
        causeCode: code,
      })
    }
  )

  it.each(['', 'lowercase', 'BAD CODE', '_ERR', '1ERR', 'A'.repeat(65), 1])(
    'omits invalid code and causeCode %s',
    (code) => {
      expect(toErrorLogFields({ code, cause: { code } })).toStrictEqual({
        name: 'object',
      })
    }
  )

  it.each([null, undefined, 'ECONNRESET', 1, () => 'ECONNRESET'])(
    'omits causeCode for non-object causes (%#)',
    (cause) => {
      expect(toErrorLogFields({ cause })).toStrictEqual({ name: 'object' })
    }
  )

  it('only reads allowed properties once and does not mutate the input', () => {
    const reads: PropertyKey[] = []
    const causeReads: PropertyKey[] = []
    const cause = new Proxy(Object.freeze({ code: 'ECONNRESET' }), {
      get(target, key) {
        causeReads.push(key)
        return Reflect.get(target, key)
      },
    })
    const error = new Proxy(
      Object.freeze(
        Object.assign(new Error(marker), {
          status: 503,
          code: 'ERR_TEST',
          cause,
          extra: marker,
        })
      ),
      {
        get(target, key) {
          reads.push(key)
          return Reflect.get(target, key)
        },
      }
    )
    const fields = toErrorLogFields(error)
    expect(fields).toStrictEqual({
      name: 'Error',
      status: 503,
      code: 'ERR_TEST',
      causeCode: 'ECONNRESET',
    })
    expect(reads).toEqual(['name', 'status', 'code', 'cause'])
    expect(causeReads).toEqual(['code'])
    expect(inspect(fields, { depth: null })).not.toContain(marker)
  })

  it.each<{
    key: string
    expected: ErrorLogFields
  }>([
    {
      key: 'name',
      expected: {
        name: 'UnknownError',
        status: 503,
        code: 'ERR_TEST',
        causeCode: 'ECONNRESET',
      },
    },
    {
      key: 'status',
      expected: { name: 'Error', code: 'ERR_TEST', causeCode: 'ECONNRESET' },
    },
    {
      key: 'code',
      expected: { name: 'Error', status: 503, causeCode: 'ECONNRESET' },
    },
    {
      key: 'cause',
      expected: { name: 'Error', status: 503, code: 'ERR_TEST' },
    },
  ])('isolates a throwing $key getter', ({ key, expected }) => {
    const error = Object.assign(new Error(marker), {
      status: 503,
      code: 'ERR_TEST',
      cause: { code: 'ECONNRESET' },
    })
    Object.defineProperty(error, key, {
      get() {
        throw new Error(marker)
      },
    })
    const fields = toErrorLogFields(error)
    expect(fields).toStrictEqual(expected)
    expect(inspect(fields, { depth: null })).not.toContain(marker)
  })

  it('omits causeCode when reading it throws', () => {
    const error = new TypeError(marker, {
      cause: {
        get code() {
          throw new Error(marker)
        },
      },
    })
    const fields = toErrorLogFields(error)
    expect(fields).toStrictEqual({ name: 'TypeError' })
    expect(inspect(fields, { depth: null })).not.toContain(marker)
  })

  it('isolates Proxy property-read failures', () => {
    const error = new Proxy(
      {},
      {
        get() {
          throw new Error(marker)
        },
      }
    )
    expect(toErrorLogFields(error)).toStrictEqual({ name: 'object' })
  })

  it('preserves readable fields when Error classification throws', () => {
    const error = new Proxy(
      { status: 503, code: 'ERR_TEST' },
      {
        getPrototypeOf() {
          throw new Error(marker)
        },
      }
    )
    const fields = toErrorLogFields(error)
    expect(fields).toStrictEqual({
      name: 'UnknownError',
      status: 503,
      code: 'ERR_TEST',
    })
    expect(inspect(fields, { depth: null })).not.toContain(marker)
  })

  it('does not throw for a revoked Proxy', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    const fields = toErrorLogFields(proxy)
    expect(fields).toStrictEqual({ name: 'UnknownError' })
    expect(Object.getPrototypeOf(fields)).toBe(Object.prototype)
  })
})

describe('logger', () => {
  it.each(['warn', 'error', 'info'] as const)(
    'forwards exactly one or two arguments to console.%s',
    (method) => {
      vi.stubEnv('NODE_ENV', 'test')
      const spy = vi.spyOn(console, method).mockImplementation(() => {})
      const fields = toErrorLogFields(new Error(marker))
      logger[method]('fixed message')
      logger[method]('fixed message', fields)
      logger[method]('fixed message', undefined)
      expect(spy.mock.calls).toEqual([
        ['fixed message'],
        ['fixed message', fields],
        ['fixed message'],
      ])
      expect(spy.mock.calls[1][1]).toBe(fields)
      expect(inspect(spy.mock.calls, { depth: null })).not.toContain(marker)
    }
  )

  it('suppresses info/debug but retains warn/error in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.info('info')
    logger.debug('debug')
    logger.warn('warn')
    logger.error('error')
    expect(info).not.toHaveBeenCalled()
    expect(debug).not.toHaveBeenCalled()
    expect(warn.mock.calls).toEqual([['warn']])
    expect(error.mock.calls).toEqual([['error']])
  })

  it('preserves debug variadic arguments outside production', () => {
    vi.stubEnv('NODE_ENV', 'test')
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const data = { count: 2 }
    logger.debug('debug', data, undefined)
    expect(spy.mock.calls).toEqual([['debug', data, undefined]])
  })
})
