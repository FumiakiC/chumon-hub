import { type NextRequest } from "next/server"
import { createRemoteJWKSet, jwtVerify } from "jose"

export async function verifyCloudflareAccess(request: NextRequest): Promise<boolean> {
  if (process.env.NODE_ENV === "development") {
    console.log("[auth] Skipping Cloudflare Access verification in development")
    return true
  }

  const TEAM_DOMAIN = process.env.CLOUDFLARE_TEAM_DOMAIN
  const AUDIENCE = process.env.CLOUDFLARE_AUDIENCE

  if (!TEAM_DOMAIN || !AUDIENCE) {
    console.error("[auth] Missing required environment variables: CLOUDFLARE_TEAM_DOMAIN or CLOUDFLARE_AUDIENCE")
    return false
  }

  const ISSUER = `https://${TEAM_DOMAIN}.cloudflareaccess.com`
  const JWKS_URL = `${ISSUER}/cdn-cgi/access/certs`
  const jwks = createRemoteJWKSet(new URL(JWKS_URL))

  const token = request.headers.get("Cf-Access-Jwt-Assertion")
  if (!token) {
    console.warn("[auth] Missing Cf-Access-Jwt-Assertion header")
    return false
  }

  try {
    await jwtVerify(token, jwks, {
      issuer: ISSUER,
      audience: AUDIENCE,
    })
    return true
  } catch (error) {
    console.error("[auth] Cloudflare Access verification failed", error)
    return false
  }
}
