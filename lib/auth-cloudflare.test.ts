import { errors } from 'jose'
import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'

import { toAuthErrorLogFields } from './auth-cloudflare'

describe('toAuthErrorLogFields', () => {
  const emailMarker = 'claims-marker@unit-test.invalid'

  it.each([
    {
      error: new errors.JWTClaimValidationFailed(
        'unexpected audience',
        { email: emailMarker },
        'aud',
        'mismatch'
      ),
      expected: {
        name: 'JWTClaimValidationFailed',
        code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
        claim: 'aud',
        reason: 'mismatch',
      },
    },
    {
      error: new errors.JWTExpired(
        'expired token',
        { email: emailMarker },
        'exp',
        'check_failed'
      ),
      expected: {
        name: 'JWTExpired',
        code: 'ERR_JWT_EXPIRED',
        claim: 'exp',
        reason: 'check_failed',
      },
    },
  ])('excludes both payloads from $expected.name', ({ error, expected }) => {
    const fields = toAuthErrorLogFields(error)

    expect(fields).toStrictEqual(expected)
    expect(inspect(fields, { depth: null })).not.toContain(emailMarker)
    expect(fields).not.toBe(error)
    expect(fields).not.toBe(error.cause)
    expect(Object.getPrototypeOf(fields)).toBe(Object.prototype)
  })

  it('keeps only name and code for signature verification failures', () => {
    expect(
      toAuthErrorLogFields(new errors.JWSSignatureVerificationFailed())
    ).toStrictEqual({
      name: 'JWSSignatureVerificationFailed',
      code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    })
  })

  it('keeps the code from a fetch failure cause without the cause itself', () => {
    const cause = Object.assign(new Error('DNS lookup failed'), {
      code: 'ENOTFOUND',
    })
    const error = new TypeError('fetch failed', { cause })

    expect(toAuthErrorLogFields(error)).toStrictEqual({
      name: 'TypeError',
      causeCode: 'ENOTFOUND',
    })
  })

  it.each(['failure', null, undefined, 1, true, Symbol('failure')])(
    'returns an empty object for non-object input %#',
    (error) => {
      expect(toAuthErrorLogFields(error)).toStrictEqual({})
    }
  )

  it('copies only allowed string fields from non-jose objects', () => {
    const error = {
      name: 'CustomError',
      code: 'ERR_CUSTOM',
      claim: 'aud',
      reason: 'custom',
      causeCode: 'ignored',
      message: 'excluded',
      stack: 'excluded',
      payload: { email: emailMarker },
      cause: { code: 'ENOTFOUND', payload: { email: emailMarker } },
      extra: 'excluded',
    }
    const fields = toAuthErrorLogFields(error)

    expect(fields).toStrictEqual({
      name: 'CustomError',
      code: 'ERR_CUSTOM',
      claim: 'aud',
      reason: 'custom',
      causeCode: 'ENOTFOUND',
    })
    expect(inspect(fields, { depth: null })).not.toContain(emailMarker)
    expect(fields).not.toBe(error)
    expect(fields).not.toBe(error.cause)
    expect(toAuthErrorLogFields(error)).not.toBe(fields)
    expect(Object.getPrototypeOf(fields)).toBe(Object.prototype)
  })

  it('excludes non-string values in allowed fields', () => {
    expect(
      toAuthErrorLogFields({
        name: null,
        code: 1,
        claim: {},
        reason: false,
        cause: { code: undefined },
      })
    ).toStrictEqual({})
  })

  it.each([null, undefined, 'cause', 1, {}, { code: 1 }])(
    'excludes causes without an object containing a string code %#',
    (cause) => {
      expect(toAuthErrorLogFields({ cause })).toStrictEqual({})
    }
  )
})
