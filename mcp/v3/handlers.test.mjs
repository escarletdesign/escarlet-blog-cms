import test from 'node:test'
import assert from 'node:assert/strict'
import { createMcpServerV3 } from './index.mjs'

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
