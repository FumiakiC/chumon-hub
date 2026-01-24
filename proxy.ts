import { NextResponse, type NextRequest } from "next/server"
import { verifyCloudflareAccess } from "@/lib/auth-cloudflare"

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname

  // Skip auth check for the forbidden page itself to avoid loops
  if (path === "/forbidden" || path.startsWith("/forbidden/")) {
    return NextResponse.next()
  }

  const isAuthorized = await verifyCloudflareAccess(request)

  if (isAuthorized) {
    return NextResponse.next()
  }

  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.rewrite(new URL("/forbidden", request.url))
}

export const config = {
  matcher: ["/official-order/:path*", "/api/:path*"],
}
