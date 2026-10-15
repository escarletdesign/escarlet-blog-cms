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
  for (const name of ['production.motion.status.get', 'production.motion.retry', 'production.motion.cancel', 'content.post.list', 'content.post.archive', 'content.audit.inventory']) assert.ok(body.result.tools.some((tool) => tool.name === name), name)
  assert.equal(body.result.tools.some((tool) => /^(?:blog|social|content|video|brand)_/.test(tool.name)), false)
  assert.ok(body.result._meta['io.modelcontextprotocol/serverInfo'])
  assert.equal(body.result._meta['io.modelcontextprotocol/serverInfo'].name, 'escarlet-os')
})

test('el handler MCP v3 acepta el handshake 2025 y lista el mismo catálogo namespaced', async () => {
  const handler = createMcpV3Handler({ registry: {} })
  const response = await handler.fetch(new Request('https://cms.escarlet.design/mcp/v3', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'hermes', version: '1.0.0' }
      }
    })
  }), { authInfo: { role: 'agent' } })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /text\/event-stream|application\/json/)

  const listed = await handler.fetch(new Request('https://cms.escarlet.design/mcp/v3', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  }), { authInfo: { role: 'agent' } })
  assert.equal(listed.status, 200)
  const body = await listed.text()
  assert.match(body, /capability\.guide/)
  assert.doesNotMatch(body, /brand_get_context/)
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

test('un agente nuevo puede pedir la guía mediante el transporte MCP real', async () => {
  const response = await createMcpV3Handler({ registry: {}, auth: { role: 'agent', site: 'escarlet' } }).fetch(new Request('https://cms.escarlet.design/mcp/v3', {
    method: 'POST',
    headers: { ...headers, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'capability.guide' },
    body: JSON.stringify(request('tools/call', 2, { name: 'capability.guide', arguments: {} }))
  }), { authInfo: { role: 'viewer' } })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.result.isError, false)
  assert.ok(body.result.structuredContent.firstSteps.some((step) => step.includes('recipe.list')))
  assert.ok(body.result.structuredContent.examples.some((example) => example.execute?.arguments?.formatProfile === 'instagram_story'))
})
