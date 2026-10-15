import { createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { applyCors } from '../../lib/cors.mjs'
import { loadOsRegistry } from './catalog.mjs'
import { createMcpServerV3 } from './server.mjs'

export function sendMcpV3Cors(res, req = res._request) {
  applyCors(res, req, { credentials: false })
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-Id')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'MCP-Protocol-Version')
}

export function createMcpV3Handler({ registry, auth: defaultAuth } = {}) {
  const registryPromise = registry === undefined ? loadOsRegistry() : Promise.resolve(registry)
  return createMcpHandler(
    async ({ authInfo }) => createMcpServerV3(defaultAuth || authInfo || { role: 'viewer' }, { registry: await registryPromise }),
    {
      // Transport compatibility only. The v3 server still rejects legacy tool
      // aliases and exposes the namespaced catalog exclusively.
      legacy: 'stateless',
      responseMode: 'json',
      onerror: (error) => console.error('[mcp/v3] request failed', error)
    }
  )
}

export function createMcpV3NodeHandler(options = {}) {
  return toNodeHandler(createMcpV3Handler(options), {
    onerror: (error) => console.error('[mcp/v3] node adapter failed', error)
  })
}

export async function handleMcpV3Http(req, res, parsedBody, auth = { role: 'admin' }, options = {}) {
  sendMcpV3Cors(res, req)
  req.auth = auth
  await createMcpV3NodeHandler({ ...options, auth })(req, res, parsedBody)
}
