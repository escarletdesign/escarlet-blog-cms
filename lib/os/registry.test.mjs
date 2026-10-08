import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CapabilityManifestError,
  CapabilityRegistry,
  CapabilityRegistryError,
  createDefaultCapabilityRegistry,
  listCapabilities,
  normalizeCapabilityManifest
} from './index.mjs'

function manifest(overrides = {}) {
  return {
    id: 'test.asset.inspect',
    version: '1.0.0',
    kind: 'primitive',
    title: 'Inspeccionar asset',
    description: 'Devuelve metadatos seguros de un asset.',
    permissions: ['asset:read'],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    ...overrides
  }
}

test('normaliza y congela un manifest semántico', () => {
  const normalized = normalizeCapabilityManifest(manifest({ tags: ['asset'], metadata: { owner: 'os' } }))
  assert.equal(normalized.contractVersion, 'production.v1')
  assert.equal(normalized.id, 'test.asset.inspect')
  assert.equal(normalized.handler, null)
  assert.deepEqual(normalized.tags, ['asset'])
  assert.equal(Object.isFrozen(normalized), true)
  assert.equal(Object.isFrozen(normalized.inputSchema), true)
  assert.throws(() => { normalized.title = 'otro' }, TypeError)
})

test('rechaza IDs, schemas y recipes incompletas', () => {
  assert.throws(() => normalizeCapabilityManifest(manifest({ id: 'asset-inspect' })), (error) => {
    assert.ok(error instanceof CapabilityManifestError)
    assert.equal(error.code, 'CAPABILITY_MANIFEST_ID_INVALID')
    return true
  })
  assert.throws(() => normalizeCapabilityManifest(manifest({ inputSchema: {} })), /inputSchema\.type es obligatorio/)
  assert.throws(() => normalizeCapabilityManifest(manifest({ kind: 'recipe' })), (error) => {
    assert.equal(error.code, 'CAPABILITY_MANIFEST_DEPENDENCIES_REQUIRED')
    return true
  })
})

test('el registro filtra por permisos y no expone capabilities internas', () => {
  const registry = new CapabilityRegistry([
    manifest(),
    manifest({ id: 'test.asset.write', permissions: ['asset:write'] }),
    manifest({ id: 'test.internal.inspect', visibility: 'internal', permissions: [] }),
    manifest({ id: 'test.deprecated.inspect', deprecated: true, permissions: [] })
  ])
  assert.deepEqual(registry.search({ permissions: ['asset:read'] }).map(({ id }) => id), ['test.asset.inspect'])
  assert.equal(registry.get('test.asset.write', { permissions: ['asset:read'] }), null)
  assert.equal(registry.get('test.internal.inspect', { permissions: [] }), null)
  assert.equal(registry.get('test.internal.inspect', { permissions: [], includeInternal: true }).id, 'test.internal.inspect')
  assert.equal(registry.get('test.deprecated.inspect', { permissions: [] }), null)
  assert.equal(registry.get('test.deprecated.inspect', { permissions: [], includeDeprecated: true }).id, 'test.deprecated.inspect')
  assert.equal(registry.get('test.asset.write', { permissions: ['*'] }).id, 'test.asset.write')
})

test('mantiene versiones y selecciona la más reciente compatible', () => {
  const registry = new CapabilityRegistry([
    manifest({ version: '1.0.0', permissions: [] }),
    manifest({ version: '1.2.0', permissions: [] }),
    manifest({ version: '1.1.0', permissions: [] })
  ])
  assert.equal(registry.size, 3)
  assert.equal(registry.get('test.asset.inspect', { permissions: [] }).version, '1.2.0')
  assert.deepEqual(registry.list({ permissions: [], includeVersions: true }).map(({ version }) => version), ['1.2.0', '1.1.0', '1.0.0'])
  assert.equal(registry.get('test.asset.inspect', { version: '1.0.0', permissions: [] }).version, '1.0.0')
})

test('search filtra por propósito, tags, kind y límite', () => {
  const registry = new CapabilityRegistry([
    manifest({ id: 'test.motion.compose', title: 'Componer Reel', description: 'Crea motion graphics', tags: ['motion', 'reel'], permissions: [] }),
    manifest({ id: 'test.image.compose', title: 'Componer imagen', description: 'Crea una imagen', tags: ['image'], permissions: [] }),
    manifest({ id: 'test.motion.inspect', title: 'Inspeccionar motion', description: 'Lee un vídeo', tags: ['motion'], permissions: [] })
  ])
  assert.deepEqual(registry.search({ query: 'reel', permissions: [] }).map(({ id }) => id), ['test.motion.compose'])
  assert.deepEqual(registry.search({ tags: ['motion'], kind: 'primitive', permissions: [], limit: 1 }).map(({ id }) => id), ['test.motion.compose'])
})

test('registerMany es atómico frente a duplicados', () => {
  const registry = new CapabilityRegistry([manifest({ permissions: [] })])
  assert.throws(() => registry.registerMany([
    manifest({ id: 'test.new.one', permissions: [] }),
    manifest({ id: 'test.asset.inspect', permissions: [] })
  ]), (error) => {
    assert.ok(error instanceof CapabilityRegistryError)
    assert.equal(error.code, 'CAPABILITY_ALREADY_REGISTERED')
    return true
  })
  assert.equal(registry.get('test.new.one', { permissions: [] }), null)
})

test('el catálogo base incluye composición de vídeo y publicación por canal y proveedor', () => {
  const registry = createDefaultCapabilityRegistry()
  const permissions = ['brand:read', 'asset:read', 'asset:write', 'copy:validate', 'production:motion', 'publication:read']
  const reel = registry.get('recipe.food-to-reel', { permissions })
  assert.equal(reel.kind, 'recipe')
  assert.equal(reel.handler, 'recipes/food-to-reel')
  assert.deepEqual(reel.dependencies, ['brand.context.get', 'copy.validate', 'production.motion.compose'])
  const product = registry.get('recipe.product-to-social', { permissions })
  assert.equal(product.handler, 'recipes/product-to-social')
  assert.deepEqual(product.dependencies, ['brand.context.get', 'production.image.product.transform', 'copy.validate', 'publication.destination.list'])
  const destinations = registry.get('publication.destination.list', { permissions })
  assert.deepEqual(destinations.metadata.channels, ['instagram_reel', 'instagram_story', 'linkedin', 'wordpress'])
  assert.deepEqual(destinations.metadata.providers, ['buffer', 'postiz', 'planable', 'metricool', 'wordpress'])
})

test('las funciones de catálogo filtran sin exponer manifests sin permiso', () => {
  assert.deepEqual(listCapabilities().map(({ id }) => id), [])
  const visible = listCapabilities({ permissions: ['publication:read'] })
  assert.ok(visible.some(({ id }) => id === 'publication.destination.list'))
  assert.equal(visible.some(({ id }) => id === 'publication.publish'), false)
})
