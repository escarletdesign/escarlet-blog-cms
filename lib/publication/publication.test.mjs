import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getPublicationStatus,
  listPublicationDestinations,
  preparePublication,
  publishPublication,
  routePublication,
  schedulePublication,
  validatePublicationCompatibility
} from './index.mjs'

test('destination.list distingue canal y proveedor', () => {
  const result = listPublicationDestinations({ channel: 'instagram_reel' })
  assert.ok(result.destinations.some((entry) => entry.channelId === 'instagram_reel' && entry.providerId === 'buffer'))
  assert.ok(result.destinations.some((entry) => entry.channelId === 'instagram_reel' && entry.providerId === 'postiz'))
  assert.ok(result.destinations.every((entry) => entry.channelId === 'instagram_reel'))
  assert.equal(result.destinations[0].approval.required, true)
})

test('destination.list filtra conexiones inactivas y proveedor', () => {
  const result = listPublicationDestinations({
    provider: 'buffer',
    connections: [
      { provider: 'buffer', channel: 'instagram_reel', enabled: true },
      { provider: 'buffer', channel: 'instagram_post', enabled: false }
    ]
  })
  assert.deepEqual(result.destinations.map((entry) => entry.id), ['instagram_reel:buffer'])
})

test('destination.list acepta conexiones agregadas del proveedor', () => {
  const result = listPublicationDestinations({
    channel: 'instagram_reel',
    connections: [{ provider: 'buffer', channel: 'buffer', status: 'connected' }]
  })
  assert.deepEqual(result.destinations.map((entry) => entry.id), ['instagram_reel:buffer'])
})

test('destination.list reconoce la conexión web de Coolify para el blog', () => {
  const result = listPublicationDestinations({
    channel: 'wordpress_post',
    connections: [{ provider: 'web', channel: 'blog', status: 'connected' }]
  })
  assert.deepEqual(result.destinations.map((entry) => entry.id), ['wordpress_post:web'])
})

test('destination.list descarta canales incompatibles con el asset', () => {
  const result = listPublicationDestinations({
    channel: 'instagram_reel',
    assets: [{ assetId: 'image-1', mimeType: 'image/jpeg' }]
  })
  assert.deepEqual(result.destinations, [])
})

test('valida incompatibilidad entre canal y proveedor', () => {
  const result = validatePublicationCompatibility({ channel: 'wordpress_post', provider: 'buffer' })
  assert.equal(result.compatible, false)
  assert.equal(result.errors[0].code, 'publication_destination_incompatible')
})

test('valida assets y límites del canal sin ejecutar proveedores', () => {
  const result = validatePublicationCompatibility({
    channel: 'instagram_reel',
    provider: 'buffer',
    assets: [{ assetId: 'image-1', mimeType: 'image/jpeg' }]
  })
  assert.equal(result.compatible, false)
  assert.equal(result.errors[0].code, 'asset_kind_incompatible')
})

test('route devuelve selección cuando faltan proveedor y hay varias opciones', () => {
  const result = routePublication({ channel: 'instagram_reel', assets: [{ assetId: 'reel-1', mimeType: 'video/mp4' }] })
  assert.equal(result.state, 'provider_selection_required')
  assert.ok(result.candidates.length > 1)
})

test('prepare construye un bundle referenciado y conserva metadatos de aprobación', () => {
  const result = preparePublication({
    workspaceId: 'workspace-1',
    channel: 'instagram_reel',
    provider: 'buffer',
    text: 'Un reel de prueba',
    assets: [{ assetId: 'reel-1', mimeType: 'video/mp4', sha256: 'hash-1' }]
  })
  assert.equal(result.state, 'ready_for_review')
  assert.deepEqual(result.bundle.assets, [{ assetId: 'reel-1', kind: 'video', mimeType: 'video/mp4', sha256: 'hash-1' }])
  assert.equal(result.effects.providerExecution, false)
  assert.equal(result.approval.status, 'pending')
})

test('schedule y publish exigen aprobación y respetan permisos explícitos', () => {
  const common = {
    channel: 'linkedin_post',
    provider: 'metricool',
    assets: [{ assetId: 'image-1', mimeType: 'image/jpeg' }],
    approval: { status: 'approved', approvedBy: 'user-1', approvedAt: '2026-10-08T10:00:00Z' }
  }
  assert.throws(
    () => publishPublication({ ...common, permissions: ['publication:prepare'] }),
    (error) => error.code === 'publication_permission_missing' && error.status === 403
  )
  assert.throws(
    () => publishPublication({ ...common, approval: { status: 'pending' }, permissions: ['publication:publish'] }),
    (error) => error.code === 'publication_approval_required' && error.status === 409
  )
  const result = schedulePublication({
    ...common,
    permissions: ['publication:schedule'],
    publicationDate: '2099-01-01T10:00:00Z'
  })
  assert.equal(result.state, 'schedule_requested')
  assert.equal(result.operation, 'publication.schedule')
  assert.equal(result.effects.mutatesProvider, false)
})

test('status normaliza estados de proveedor sin consultar al proveedor', () => {
  const result = getPublicationStatus({ providerStatus: 'sent', publicationId: 'pub-1' })
  assert.equal(result.status, 'published')
  assert.equal(result.terminal, true)
  assert.equal(result.publicationId, 'pub-1')
})
