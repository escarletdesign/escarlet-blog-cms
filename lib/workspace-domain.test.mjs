import test from 'node:test'
import assert from 'node:assert/strict'
import { assertActiveContentChannels, assertContentMediaAttachable, bufferPublishChannels, contentArchiveMetadata, contentStatusFromVariantStatuses, contentTitleFromBrief, resolveBufferChannelId, visibleMemberRole } from './workspace-domain.mjs'

test('Buffer admite Instagram, Story, LinkedIn, X y vídeo, pero rechaza el Blog', () => {
  assert.deepEqual(bufferPublishChannels(['instagram', 'instagram_story', 'linkedin', 'x', 'video']), ['instagram', 'instagram_story', 'linkedin', 'x', 'video'])
  assert.throws(() => bufferPublishChannels(['blog']), (error) => error.code === 'BLOG_WEBHOOK_REQUIRED')
  assert.throws(() => bufferPublishChannels(['blog', 'instagram']), (error) => error.code === 'BLOG_WEBHOOK_REQUIRED')
  assert.throws(() => bufferPublishChannels(['substack']), (error) => error.code === 'SUBSTACK_PUBLISHING_SUSPENDED')
})

test('separa el título breve del brief editorial', () => {
  assert.equal(contentTitleFromBrief('La IA acelera la producción, pero el criterio se convierte en el nuevo cuello de botella. Idea central: revisar UX y producto.'), 'La IA acelera la producción, pero el criterio se convierte en el nuevo cuello de botella')
  assert.equal(contentTitleFromBrief(''), 'Nueva publicación')
})

test('resuelve los canales agregados de Buffer y reutiliza Instagram para Stories', () => {
  const config = { channelIds: { instagram: 'ig-1', linkedin: 'li-1', x: 'x-1' } }
  assert.equal(resolveBufferChannelId(config, 'instagram'), 'ig-1')
  assert.equal(resolveBufferChannelId(config, 'instagram_story'), 'ig-1')
  assert.equal(resolveBufferChannelId(config, 'linkedin'), 'li-1')
  assert.equal(resolveBufferChannelId(config, 'video'), 'ig-1')
  assert.equal(resolveBufferChannelId({}, 'x', 'legacy-x'), 'legacy-x')
})

test('omitir un canal conserva el estado útil de los demás', () => {
  assert.equal(contentStatusFromVariantStatuses(['published', 'canceled']), 'published')
  assert.equal(contentStatusFromVariantStatuses(['approved', 'canceled']), 'approved')
  assert.equal(contentStatusFromVariantStatuses(['action_required', 'published']), 'action_required')
  assert.equal(contentStatusFromVariantStatuses(['canceled']), 'canceled')
})

test('el rol visible de un miembro es el de la marca, no el visor del workspace', () => {
  const member = { role: 'viewer', brands: [{ id: 'a', handle: 'escarlet', role: 'editor' }, { id: 'b', handle: 'bespoke', role: 'viewer' }] }
  assert.equal(visibleMemberRole(member, { siteHandle: 'escarlet' }), 'editor')
  assert.equal(visibleMemberRole(member, { siteHandle: 'bespoke' }), 'viewer')
  assert.equal(visibleMemberRole({ role: 'admin', brands: [{ role: 'viewer' }] }), 'admin')
  assert.equal(visibleMemberRole({ role: 'viewer', brands: [{ role: 'author' }, { role: 'editor' }] }), 'editor')
})

test('archivar conserva el contenido y restaurar solo quita la marca de archivo', () => {
  const archived = contentArchiveMetadata({ contentTitle: 'Pieza', archivedBy: 'old-user' }, { archived: true, userId: 'new-user', at: '2026-10-10T10:00:00.000Z' })
  assert.deepEqual(archived, { contentTitle: 'Pieza', archivedBy: 'new-user', archivedAt: '2026-10-10T10:00:00.000Z' })
  assert.deepEqual(contentArchiveMetadata(archived, { archived: false }), { contentTitle: 'Pieza' })
})

test('las cargas manuales se pueden asociar sin saltarse el bloqueo de referencias', () => {
  assert.doesNotThrow(() => assertContentMediaAttachable({ kind: 'social', manualUpload: true }, ['x']))
  assert.throws(() => assertContentMediaAttachable({ kind: 'social' }, ['x']), (error) => error.code === 'BRAND_PREPARATION_REQUIRED')
  assert.throws(() => assertContentMediaAttachable({ kind: 'reference', manualUpload: true }, ['x']), (error) => error.code === 'REFERENCE_NOT_ATTACHABLE')
})

test('los canales de contenido deben estar activos antes de mutar un Post', async () => {
  const client = { query: async () => ({ rows: [{ channel: 'blog' }] }) }
  assert.deepEqual(await assertActiveContentChannels(client, 'site-1', ['blog']), ['blog'])
  await assert.rejects(
    () => assertActiveContentChannels(client, 'site-1', ['instagram', 'x']),
    (error) => error.code === 'channel_disabled' && error.extra.channels.join(',') === 'instagram,x'
  )
})
