import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { createMcpServer } from './create-mcp-server.mjs'

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
        ...(params._meta || {}),
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0.0' }
      }
    }
  }
}

function handler() {
  return createMcpHandler(
    ({ authInfo }) => createMcpServer(authInfo || { role: 'admin', site: 'escarlet' }),
    { legacy: 'reject', responseMode: 'json' }
  )
}

test('el handler moderno publica el contrato MCP único', async () => {
  const response = await handler().fetch(new Request('https://cms.escarlet.design/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(request('tools/list'))
  }), { authInfo: { role: 'admin', site: 'escarlet' } })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.ok(body.result.tools.some((tool) => tool.name === 'content_upload_media'))
  assert.equal(body.result.tools.some((tool) => tool.name === 'brand_complete_image_generation'), false)
  assert.equal(body.result._meta['io.modelcontextprotocol/serverInfo'].version, '3.7.0')
})

test('el handler moderno acepta tools/call con envelope por request', async () => {
  const callHeaders = { ...headers, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'brand_get_context' }
  const response = await handler().fetch(new Request('https://cms.escarlet.design/mcp', {
    method: 'POST',
    headers: callHeaders,
    body: JSON.stringify(request('tools/call', 2, { name: 'brand_get_context', arguments: { site: 'escarlet' } }))
  }), { authInfo: { role: 'admin', site: 'escarlet' } })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.error, undefined)
  assert.ok(body.result)
})

test('el endpoint moderno rechaza initialize legacy', async () => {
  const response = await handler().fetch(new Request('https://cms.escarlet.design/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'initialize', params: {} })
  }), { authInfo: { role: 'admin', site: 'escarlet' } })
  assert.ok(response.status >= 400)
  const body = await response.json()
  assert.ok(body.error)
})
