import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer } from './create-mcp-server.mjs'

export function sendMcpCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-Id'
  )
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')
}

export async function handleMcpHttp(req, res, parsedBody, auth = { role: 'admin' }) {
  sendMcpCors(res)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  const mcpServer = createMcpServer(auth)
  await mcpServer.connect(transport)
  await transport.handleRequest(req, res, parsedBody)
}
