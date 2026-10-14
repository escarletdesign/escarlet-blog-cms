import test from 'node:test'
import assert from 'node:assert/strict'
import { createMcpServerV3 } from './index.mjs'
import { invokeBuiltinCapability } from './handlers.mjs'

async function call(server, name, arguments_ = {}) {
  return server._requestHandlers.get('tools/call')({
    method: 'tools/call',
    params: { name, arguments: arguments_ }
  }, { mcpReq: { requestState: () => undefined } })
}

test('Brand Kernel devuelve un contexto autorizado y sin archivos privados', async () => {
  const server = await createMcpServerV3({ role: 'admin', site: 'escarlet' })
  const result = await call(server, 'brand.context.get', { site: 'escarlet' })
  assert.equal(result.isError, false)
  assert.equal(result.structuredContent.site, 'escarlet')
  assert.equal(Object.hasOwn(result.structuredContent, 'files'), false)
})

test('brand.references.resolve conserva hash y procedencia de cada referencia', async () => {
  const server = await createMcpServerV3({ role: 'admin', site: 'escarlet' })
  const result = await call(server, 'brand.references.resolve', { site: 'escarlet', purpose: 'blog cover' })
  assert.equal(result.isError, false)
  assert.ok(result.structuredContent.resolvedReferences.length > 0)
  assert.ok(result.structuredContent.resolvedReferences.every((reference) => /^[a-f0-9]{64}$/i.test(reference.sha256)))
})

test('el agente puede enrutar sin ejecutar proveedores y el viewer no puede hacerlo', async () => {
  const agent = await createMcpServerV3({ role: 'agent', site: 'escarlet' })
  const routed = await call(agent, 'publication.route', { channel: 'instagram_reel', provider: 'postiz', assetIds: ['reel-1'] })
  assert.equal(routed.isError, false)
  assert.equal(routed.structuredContent.state, 'routed')
  assert.equal(routed.structuredContent.effects.providerExecution, false)

  const prepared = await call(agent, 'publication.prepare', { channel: 'instagram_reel', provider: 'postiz', assetIds: ['reel-1'], text: 'Reel listo para revisión' })
  assert.equal(prepared.isError, false)
  assert.equal(prepared.structuredContent.state, 'ready_for_review')
  assert.equal(prepared.structuredContent.effects.providerExecution, false)

  const viewer = await createMcpServerV3({ role: 'viewer', site: 'escarlet' })
  const denied = await call(viewer, 'publication.route', { channel: 'instagram_reel', provider: 'postiz', assetIds: ['reel-1'] })
  assert.equal(denied.isError, true)
  assert.equal(denied.structuredContent.error.code, 'capability_permission_missing')
})

test('product transform exige un asset fuente antes de preparar el proveedor', async () => {
  const server = await createMcpServerV3({ role: 'admin', site: 'escarlet' })
  const result = await call(server, 'production.image.product.transform', { site: 'escarlet', formatProfile: 'instagram_story' })
  assert.equal(result.isError, true)
  assert.equal(result.structuredContent.error.code, 'product_source_required')
})

test('asset.upload no permite guardar un asset publicable sin preparación', async () => {
  const server = await createMcpServerV3({ role: 'admin', site: 'escarlet' })
  const result = await call(server, 'asset.upload', {
    site: 'escarlet',
    filename: 'slide.png',
    contentBase64: 'iVBORw0KGgo=',
    kind: 'social',
    textRendered: true,
    templateId: 'editorial',
    renderedBy: 'chatgpt-image-generation',
    textContent: { headline: 'Titular', body: 'Cuerpo' }
  })
  assert.equal(result.isError, true)
  assert.equal(result.structuredContent.error.code, 'brand_preparation_required')
})

test('asset.delete mantiene la eliminación canónica restringida a owner y admin', async () => {
  const agent = await createMcpServerV3({ role: 'agent', workspaceId: 'workspace-1', siteId: 'site-1' })
  const result = await call(agent, 'asset.delete', { workspaceId: 'workspace-1', siteId: 'site-1', assetIds: ['asset-1'], confirm: true })
  assert.equal(result.isError, true)
  assert.equal(result.structuredContent.error.code, 'media_delete_forbidden')
})

test('content.campaign.publish encola cada pieza aprobada del blog', async () => {
  const scheduled = []
  const result = await invokeBuiltinCapability('content.campaign.publish', {
    site: 'escarlet',
    campaignId: 'campaign-1',
    channels: ['blog']
  }, {
    auth: { role: 'editor', site: 'escarlet', userId: 'user-1' },
    runtime: {
      resolveWorkspaceContext: async () => ({ workspaceId: 'workspace-1', sites: [{ id: 'site-1', handle: 'escarlet' }] }),
      getContentBatch: async () => ({ id: 'campaign-1', items: [{ id: 'item-1', variants: [{ channel: 'blog', status: 'approved' }] }, { id: 'item-2', variants: [{ channel: 'blog', status: 'approved' }] }] }),
      scheduleContentBatch: async (input) => { scheduled.push(input); return { batchId: input.batchId, items: [{ itemId: 'item-1' }, { itemId: 'item-2' }] } }
    }
  })
  assert.equal(result.status, 'scheduled')
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].publishNow, true)
  assert.equal(scheduled[0].channels[0], 'blog')
})

test('publication.publish enlaza Coolify con la variante blog real', async () => {
  let scheduled = null
  const result = await invokeBuiltinCapability('publication.publish', {
    site: 'escarlet',
    channel: 'wordpress_post',
    provider: 'web',
    contentItemId: 'item-1',
    approval: { status: 'approved' },
    connections: [{ provider: 'web', channel: 'blog', status: 'connected' }]
  }, {
    auth: { role: 'editor', site: 'escarlet', userId: 'user-1' },
    runtime: {
      resolveWorkspaceContext: async () => ({ workspaceId: 'workspace-1', sites: [{ id: 'site-1', handle: 'escarlet' }] }),
      scheduleContentItem: async (input) => { scheduled = input; return { itemId: input.itemId, status: 'scheduled' } }
    }
  })
  assert.equal(result.status, 'publish_requested')
  assert.equal(result.execution.status, 'scheduled')
  assert.equal(scheduled.itemId, 'item-1')
  assert.equal(scheduled.channels[0], 'blog')
})

test('las capacidades de auditoría resuelven el scope, listan Posts y no escriben durante el dry run', async () => {
  let writes = 0
  const runtime = {
    resolveWorkspaceContext: async () => ({ workspaceId: 'workspace-1', workspaceName: 'Workspace', workspaceRole: 'owner', sites: [{ id: 'site-1', handle: 'escarlet', name: 'Escarlet', role: 'owner' }] }),
    listContentItems: async () => [{ id: 'post-1', site_id: 'site-1', batch_id: 'batch-1', topic: 'Tema', status: 'draft', metadata: { contentTitle: 'Post de prueba' }, variants: [{ id: 'variant-1', channel: 'instagram_reel', status: 'draft', body: {}, media: [] }] }],
    listCanonicalMedia: async () => ({ assets: [{ id: 'asset-unused', sha256: 'hash-unused', metadata: {}, deletable: true, deleteBlockers: [] }] }),
    archiveContentItem: async () => { writes += 1; return { itemId: 'post-1', archived: true, archivedAt: 'now' } }
  }
  const server = await createMcpServerV3({ role: 'agent', userId: 'user-1' }, { runtime })
  const context = await call(server, 'workspace.context.get')
  assert.equal(context.isError, false)
  assert.equal(context.structuredContent.workspace.id, 'workspace-1')
  const listed = await call(server, 'content.post.list')
  assert.equal(listed.isError, false)
  assert.equal(listed.structuredContent.posts[0].id, 'post-1')
  const inventory = await call(server, 'content.audit.inventory')
  assert.equal(inventory.isError, false)
  assert.deepEqual(inventory.structuredContent.diagnostics.trulyUnusedAssets, ['asset-unused'])
  const plan = await call(server, 'content.audit.repair.plan')
  assert.equal(plan.isError, false)
  assert.equal(plan.structuredContent.writePerformed, false)
  assert.equal(writes, 0)
})

test('la auditoría recorre todas las páginas de Posts y assets sin repetir elementos', async () => {
  const posts = Array.from({ length: 501 }, (_, index) => ({
    id: `post-${index}`,
    site_id: 'site-1',
    batch_id: null,
    topic: `Tema ${index}`,
    status: 'draft',
    metadata: { contentTitle: `Post ${index}` },
    variants: []
  }))
  const assets = Array.from({ length: 101 }, (_, index) => ({ id: `asset-${index}`, metadata: {}, deleteBlockers: [] }))
  const page = (rows, { limit, offset }) => rows.slice(offset, offset + limit)
  const server = await createMcpServerV3({ role: 'agent', userId: 'user-1' }, {
    runtime: {
      resolveWorkspaceContext: async () => ({ workspaceId: 'workspace-1', sites: [{ id: 'site-1', handle: 'escarlet', role: 'editor' }] }),
      listContentItems: async ({ limit, offset }) => page(posts, { limit, offset }),
      listCanonicalMedia: async ({ limit, offset }) => ({ assets: page(assets, { limit, offset }) })
    }
  })
  const postIds = []
  for (let cursor = '0'; ; ) {
    const result = await call(server, 'content.audit.inventory', { site: 'escarlet', limit: 100, cursor, assetCursor: '0' })
    assert.equal(result.isError, false)
    postIds.push(...result.structuredContent.posts.map((post) => post.id))
    const next = result.structuredContent.pageInfo.nextCursor
    if (!next) break
    cursor = next
  }
  const assetIds = []
  for (let assetCursor = '0'; ; ) {
    const result = await call(server, 'content.audit.inventory', { site: 'escarlet', limit: 100, cursor: '0', assetCursor })
    assert.equal(result.isError, false)
    assetIds.push(...result.structuredContent.assets.map((asset) => asset.id))
    const next = result.structuredContent.assetPageInfo.nextCursor
    if (!next) break
    assetCursor = next
  }
  assert.equal(new Set(postIds).size, posts.length)
  assert.equal(new Set(assetIds).size, assets.length)
})

test('content.post.archive exige confirmación explícita y devuelve la operación autorizada', async () => {
  const calls = []
  const server = await createMcpServerV3({ role: 'agent', userId: 'user-1' }, {
    runtime: {
      resolveWorkspaceContext: async () => ({ workspaceId: 'workspace-1', sites: [{ id: 'site-1', handle: 'escarlet', role: 'editor' }] }),
      archiveContentItem: async (input) => { calls.push(input); return { itemId: input.itemId, archived: input.archived, archivedAt: 'now' } }
    }
  })
  const missing = await call(server, 'content.post.archive', { site: 'escarlet', postId: 'post-1' })
  assert.equal(missing.structuredContent.error.code, 'post_archive_confirmation_required')
  const archived = await call(server, 'content.post.archive', { site: 'escarlet', postId: 'post-1', confirm: true, idempotencyKey: 'archive-1' })
  assert.equal(archived.isError, false)
  assert.equal(archived.structuredContent.archived, true)
  assert.equal(calls[0].idempotencyKey, 'archive-1')
})

test('asset.list reutiliza la marca activa sin exigir IDs internos', async () => {
  const server = await createMcpServerV3({ role: 'viewer', site: 'escarlet' }, {
    runtime: {
      resolveWorkspaceContext: async () => ({ workspaceId: 'workspace-1', sites: [{ id: 'site-1', handle: 'escarlet', role: 'viewer' }] }),
      listCanonicalMedia: async (scope) => ({ assets: [{ id: 'asset-1', siteId: scope.siteId }], count: 1 })
    }
  })
  const result = await call(server, 'asset.list', { site: 'escarlet' })
  assert.equal(result.isError, false)
  assert.equal(result.structuredContent.assets[0].siteId, 'site-1')
})

test('repair.plan agrupa assets huérfanos por procedencia y solo propone crear Inbox', async () => {
  const server = await createMcpServerV3({ role: 'agent', userId: 'user-1' }, {
    runtime: {
      resolveWorkspaceContext: async () => ({ workspaceId: 'workspace-1', sites: [{ id: 'site-1', handle: 'escarlet', role: 'editor' }] }),
      listContentItems: async () => [],
      listCanonicalMedia: async () => ({ assets: [
        { id: 'asset-2', metadata: { generationRunId: 'run-1', channel: 'instagram', assetIndex: 1 }, deleteBlockers: [] },
        { id: 'asset-1', metadata: { generationRunId: 'run-1', channel: 'instagram', assetIndex: 0 }, deleteBlockers: [] }
      ]})
    }
  })
  const result = await call(server, 'content.audit.repair.plan')
  assert.equal(result.isError, false)
  assert.equal(result.structuredContent.writePerformed, false)
  assert.deepEqual(result.structuredContent.proposals[0].assetIds, ['asset-1', 'asset-2'])
  assert.equal(result.structuredContent.proposals[0].action, 'create_post_inbox')
})
