import test from 'node:test'
import assert from 'node:assert/strict'
import { createMcpV3Handler } from './http-handler.mjs'

const headers = {
  'content-type': 'application/json',
  accept: 'application/json',
  'MCP-Protocol-Version': '2026-07-28',
  'Mcp-Method': 'tools/list',
  'Mcp-Name': 'tools/list'
}

function request(method, id = 1, params = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': { name: 'v3-test-client', version: '1.0.0' }
      }
    }
  }
}

test('el handler MCP v3 publica capabilities namespaced y resources', async () => {
  const response = await createMcpV3Handler({ registry: {} }).fetch(new Request('https://cms.escarlet.design/mcp/v3', {
    method: 'POST',
    headers,
    body: JSON.stringify(request('tools/list'))
  }), { authInfo: { role: 'agent', workspaceId: 'workspace-1' } })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.ok(body.result.tools.some((tool) => tool.name === 'brand.context.get'))
  assert.equal(body.result.tools.some((tool) => /^(?:blog|social|content|video|brand)_/.test(tool.name)), false)
  assert.ok(body.result._meta['io.modelcontextprotocol/serverInfo'])
  assert.equal(body.result._meta['io.modelcontextprotocol/serverInfo'].name, 'escarlet-os')
})

test('el handler MCP v3 rechaza tráfico legacy', async () => {
  const response = await createMcpV3Handler({ registry: {} }).fetch(new Request('https://cms.escarlet.design/mcp/v3', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(request('initialize'))
  }), { authInfo: { role: 'agent' } })
  assert.ok(response.status >= 400)
  const body = await response.json()
  assert.ok(body.error)
})

test('el handler HTTP conserva el auth del servidor y no eleva authInfo a admin', async () => {
  const response = await createMcpV3Handler({ registry: {}, auth: { role: 'viewer' } }).fetch(new Request('https://cms.escarlet.design/mcp/v3', {
    method: 'POST',
    headers,
    body: JSON.stringify(request('tools/list'))
  }), { authInfo: { role: 'admin' } })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.result.tools.some((tool) => tool.name === 'production.motion.compose'), false)
  assert.equal(body.result.tools.some((tool) => tool.name === 'publication.route'), false)
})
