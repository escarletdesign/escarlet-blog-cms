import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mcpToolResult, summarizeMcpPayload, toIsoDeep, toMcpPublic } from './mcp-public-json.mjs'

test('las fechas salen como ISO y el contrato público usa camelCase', () => {
  const created = new Date('2026-10-06T18:15:49.855Z')
  const encoded = toMcpPublic({
    batch_id: 'batch-1',
    workspace_id: 'workspace-escarlet',
    site_id: 'site-1',
    created_at: created,
    updated_at: created,
    publication_date: created,
    planTitle: 'Campaña',
    total_items: 1,
    totalItems: 4,
    ready_count: 2,
    body: { social_pack: { created_at: created } },
    items: [{ batch_id: 'batch-1', created_at: {} }]
  })
  assert.equal(encoded.batchId, 'batch-1')
  assert.equal(encoded.batch_id, undefined)
  assert.equal(encoded.workspaceId, 'workspace-escarlet')
  assert.equal(encoded.siteId, 'site-1')
  assert.equal(encoded.createdAt, '2026-10-06T18:15:49.855Z')
  assert.equal(encoded.updatedAt, '2026-10-06T18:15:49.855Z')
  assert.equal(encoded.publicationDate, '2026-10-06T18:15:49.855Z')
  assert.equal(encoded.planTitle, 'Campaña')
  assert.equal(encoded.totalItems, 4)
  assert.equal(encoded.readyCount, 2)
  assert.equal(encoded.body.social_pack.created_at, '2026-10-06T18:15:49.855Z')
  assert.deepEqual(encoded.items[0], { batchId: 'batch-1', createdAt: {} })
  assert.equal(toIsoDeep(created), '2026-10-06T18:15:49.855Z')
})

test('la respuesta MCP no serializa otra vez el objeto completo en content', () => {
  const huge = { items: [{ id: '1', body: { html: 'x'.repeat(2000) } }] }
  const result = mcpToolResult(huge, { name: 'escarlet-cms-v2', version: '3.6.0', contract: 'v2', canonicalUrl: 'https://cms.escarlet.design/mcp' })
  assert.equal(result.content[0].text, '1 items encontrados.')
  assert.equal(result.content[0].text.includes('xxxx'), false)
  assert.equal(result.structuredContent.items[0].body.html.length, 2000)
  assert.equal(summarizeMcpPayload({ workspaces: [{ sites: [{}, {}] }, { sites: [{}] }] }), '2 workspaces, 3 marcas.')
})
