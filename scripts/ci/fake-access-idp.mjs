import { readFile } from 'node:fs/promises'
import { createServer } from 'node:https'

async function main() {
  const [key, cert, jwks] = await Promise.all([
    readFile(process.env.ACCESS_IDP_KEY_FILE),
    readFile(process.env.ACCESS_IDP_CERT_FILE),
    readFile(process.env.ACCESS_IDP_JWKS_FILE),
  ])
  const parsed = JSON.parse(jwks.toString('utf8'))
  if (!Array.isArray(parsed.keys) || parsed.keys.length === 0) {
    throw new Error('Missing JWKS keys')
  }

  const server = createServer({ key, cert }, (request, response) => {
    if (request.method === 'GET' && request.url === '/cdn-cgi/access/certs') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(jwks)
      return
    }
    response.writeHead(404, { 'Content-Type': 'text/plain' })
    response.end('Not found')
  })

  server.on('error', () => {
    console.error('Fake Access IdP server failed')
    process.exitCode = 1
  })
  server.listen(443, '0.0.0.0', () => {
    console.log('Fake Access IdP listening on HTTPS port 443')
  })
  process.on('SIGTERM', () => server.close())
}

main().catch(() => {
  console.error('Fake Access IdP startup failed')
  process.exitCode = 1
})
