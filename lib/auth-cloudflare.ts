import { type NextRequest } from "next/server"
import { createRemoteJWKSet, jwtVerify } from "jose"

const TEAM_DOMAIN = "fumifumic88"
const AUDIENCE = "b12fcac3b93f67b7cdf66aabe1c6ac8b6738a46b9d545196b3794be17d376534"
const ISSUER = `https://${TEAM_DOMAIN}.cloudflareaccess.com`
const JWKS_URL = `${ISSUER}/cdn-cgi/access/certs`

const jwks = createRemoteJWKSet(new URL(JWKS_URL))

export async function verifyCloudflareAccess(request: NextRequest): Promise<boolean> {
  if (process.env.NODE_ENV === "development") {
    console.log("[auth] Skipping Cloudflare Access verification in development")
    return true
  }

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
