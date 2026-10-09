import test from 'node:test'
import assert from 'node:assert/strict'
import { mediaDeleteBlockers, mediaStorageArtifacts, normalizeMediaDeleteRequest, normalizeMediaUpdateRequest, isTemporaryMediaMetadata } from './media-admin.mjs'

test('el borrado canónico exige scope, rol fuerte y confirmación explícita', () => {
  assert.throws(() => normalizeMediaDeleteRequest({ workspaceId: 'w', siteId: 's', role: 'editor', assetIds: ['a'], confirm: true }), (error) => error.code === 'media_delete_forbidden')
  assert.throws(() => normalizeMediaDeleteRequest({ workspaceId: 'w', siteId: 's', role: 'admin', assetIds: ['a'] }), (error) => error.code === 'media_delete_confirmation_required')
  const request = normalizeMediaDeleteRequest({ workspaceId: 'w', siteId: 's', role: 'admin', assetIds: ['a', 'a'], confirm: true })
  assert.deepEqual(request.assetIds, ['a'])
})

test('sólo se consideran temporales los metadatos explícitos', () => {
  assert.equal(isTemporaryMediaMetadata({ lifecycle: 'temporary' }), true)
  assert.equal(isTemporaryMediaMetadata({ temporary: true }), true)
  assert.equal(isTemporaryMediaMetadata({ kind: 'reference' }), false)
})

test('la edición canónica por lote exige campos, alcance y un rol editorial', () => {
  assert.throws(() => normalizeMediaUpdateRequest({ workspaceId: 'w', siteId: 's', role: 'viewer', assetIds: ['a'], alt: 'x' }), (error) => error.code === 'media_update_forbidden')
  assert.throws(() => normalizeMediaUpdateRequest({ workspaceId: 'w', siteId: 's', role: 'editor', assetIds: ['a'] }), (error) => error.code === 'media_changes_required')
  const request = normalizeMediaUpdateRequest({ workspaceId: 'w', siteId: 's', role: 'editor', assetIds: ['a', 'a'], alt: '  Texto alternativo  ' })
  assert.deepEqual(request.assetIds, ['a'])
  assert.deepEqual(request.changes, { alt: 'Texto alternativo' })
})

test('el preflight protege referencias de contenido, vídeo, marca y recibos', () => {
  assert.deepEqual(mediaDeleteBlockers({ storageKey: 'media/site/tmp.png', contentLinked: true }), ['content_linked'])
  assert.deepEqual(mediaDeleteBlockers({ storageKey: 'media/site/tmp.png', videoLinked: true }), ['video_job_linked'])
  assert.deepEqual(mediaDeleteBlockers({ storageKey: 'media/site/reference/logo.png' }), ['brand_asset_linked'])
  assert.deepEqual(mediaDeleteBlockers({ storageKey: 'media/site/tmp.png', receiptLinked: true }), ['generation_receipt_linked'])
})

test('las rutas de storage no pueden escapar del directorio de media', () => {
  assert.equal(mediaStorageArtifacts({ storageKey: 'media/site/../secret.png' }).length, 0)
  assert.equal(mediaStorageArtifacts({ storageKey: 'media/site/asset.png', metadata: { thumbPath: '/media/site/asset_thumb.webp' } }).length, 2)
})
