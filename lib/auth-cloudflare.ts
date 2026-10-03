import { type NextRequest } from 'next/server'

import { createRemoteJWKSet, jwtVerify } from 'jose'

import { logger } from '@/lib/logger'

export type AuthErrorLogFields = {
  name?: string
  code?: string
  claim?: string
  reason?: string
  causeCode?: string
}

export function toAuthErrorLogFields(error: unknown): AuthErrorLogFields {
  const fields: AuthErrorLogFields = {}
  if (typeof error !== 'object' || error === null) {
    return fields
  }

  if ('name' in error && typeof error.name === 'string') {
    fields.name = error.name
  }
  if ('code' in error && typeof error.code === 'string') {
    fields.code = error.code
  }
  if ('claim' in error && typeof error.claim === 'string') {
    fields.claim = error.claim
  }
  if ('reason' in error && typeof error.reason === 'string') {
    fields.reason = error.reason
  }
  if (
    'cause' in error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'code' in error.cause &&
    typeof error.cause.code === 'string'
  ) {
    fields.causeCode = error.cause.code
  }
  return fields
}

// JWKS リゾルバを JWKS URL（issuer ごとに1つ）単位でモジュールスコープにメモ化する。
// createRemoteJWKSet が返す関数は取得済み JWKS を内部キャッシュし、
// cooldownDuration / cacheMaxAge の範囲で再取得を抑制する（jose 公式仕様）。
// リクエスト毎に生成するとこのキャッシュが毎回捨てられるため、同じ URL なら再利用する。
const remoteJWKSetCache = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>()

function getRemoteJWKSet(
  jwksUrl: string
): ReturnType<typeof createRemoteJWKSet> {
  const cachedJWKSet = remoteJWKSetCache.get(jwksUrl)
  if (cachedJWKSet) {
    return cachedJWKSet
  }

  const jwks = createRemoteJWKSet(new URL(jwksUrl))
  remoteJWKSetCache.set(jwksUrl, jwks)
  return jwks
}

export async function verifyCloudflareAccess(
  request: NextRequest
): Promise<boolean> {
  if (process.env.NODE_ENV === 'development') {
    logger.debug(
      '[auth] Skipping Cloudflare Access verification in development'
    )
    return true
  }

  const TEAM_DOMAIN = process.env.CLOUDFLARE_TEAM_DOMAIN
  const AUDIENCE = process.env.CLOUDFLARE_AUDIENCE

  if (!TEAM_DOMAIN || !AUDIENCE) {
    logger.error(
      '[auth] Missing required environment variables: CLOUDFLARE_TEAM_DOMAIN or CLOUDFLARE_AUDIENCE'
    )
    return false
  }

  const ISSUER = `https://${TEAM_DOMAIN}.cloudflareaccess.com`
  const JWKS_URL = `${ISSUER}/cdn-cgi/access/certs`
  const jwks = getRemoteJWKSet(JWKS_URL)

  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token) {
    logger.warn('[auth] Missing Cloudflare Access JWT header')
    return false
  }

  try {
    await jwtVerify(token, jwks, {
      issuer: ISSUER,
      audience: AUDIENCE,
    })
    return true
  } catch (error) {
    logger.error(
      '[auth] Cloudflare Access verification failed',
      toAuthErrorLogFields(error)
    )
    return false
  }
}
