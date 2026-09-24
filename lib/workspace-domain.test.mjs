import test from 'node:test'
import assert from 'node:assert/strict'
import { bufferPublishChannels, contentTitleFromBrief, resolveBufferChannelId } from './workspace-domain.mjs'

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
