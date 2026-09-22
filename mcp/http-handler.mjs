import { createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpServer } from './create-mcp-server.mjs'

export function sendMcpCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-Id'
  )
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'MCP-Protocol-Version')
}

const modernHandler = createMcpHandler(
  ({ authInfo }) => createMcpServer(authInfo || { role: 'admin' }),
  {
    legacy: 'reject',
    responseMode: 'json',
    onerror: (error) => console.error('[mcp] request failed', error)
  }
)

const nodeHandler = toNodeHandler(modernHandler, {
  onerror: (error) => console.error('[mcp] node adapter failed', error)
})

export async function handleMcpHttp(req, res, parsedBody, auth = { role: 'admin' }) {
  sendMcpCors(res)
  req.auth = auth
  await nodeHandler(req, res, parsedBody)
}
