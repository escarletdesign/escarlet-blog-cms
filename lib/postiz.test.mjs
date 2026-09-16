import test from 'node:test'
import assert from 'node:assert/strict'
import { listPostizIntegrations, postizPostId, postizProviderForChannel, postizStatus, schedulePostizPost, testPostizConnection } from './postiz.mjs'

test('Postiz connection test uses the configured API base and integration', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    return { ok: true, json: async () => [{ id: 'integration-1', name: 'Escarlet Instagram', identifier: 'instagram' }] }
  }
  const result = await testPostizConnection({ apiToken: 'pos_test', apiBaseUrl: 'https://postiz.example.com/api', integrationId: 'integration-1', fetchImpl })
  assert.equal(result.ok, true)
  assert.equal(result.identifier, 'instagram')
  assert.equal(calls[0].url, 'https://postiz.example.com/api/public/v1/integrations')
  assert.equal(calls[0].init.headers.Authorization, 'pos_test')
})

test('Postiz scheduler sends integration, provider settings and ISO date', async () => {
  let call
  const fetchImpl = async (url, init) => {
    call = { url: String(url), init }
    return { ok: true, json: async () => [{ postId: 'post-1', integration: 'integration-1' }] }
  }
  const result = await schedulePostizPost({ apiToken: 'pos_test', integrationId: 'integration-1', publicationDate: '2026-09-16T10:00:00Z', channel: 'instagram', text: 'Hola', media: [{ mediaId: 'media-1', url: 'https://cdn.example/image.jpg' }], idempotencyKey: 'postiz:test-1', fetchImpl })
  assert.equal(result[0].postId, 'post-1')
  assert.equal(call.url, 'https://api.postiz.com/public/v1/posts')
  assert.equal(call.init.headers.Authorization, 'pos_test')
  assert.equal(call.init.headers['Idempotency-Key'], 'postiz:test-1')
  const payload = JSON.parse(call.init.body)
  assert.equal(payload.type, 'schedule')
  assert.equal(payload.date, '2026-09-16T10:00:00.000Z')
  assert.equal(payload.posts[0].integration.id, 'integration-1')
  assert.equal(payload.posts[0].settings.__type, 'instagram')
  assert.equal(payload.posts[0].settings.post_type, 'post')
  assert.deepEqual(payload.posts[0].value[0].image, [{ id: 'media-1', path: 'https://cdn.example/image.jpg' }])
})

test('Postiz scheduler supplies YouTube-required defaults and allows overrides', async () => {
  let payload
  const fetchImpl = async (_url, init) => {
    payload = JSON.parse(init.body)
    return { ok: true, json: async () => [{ postId: 'post-youtube' }] }
  }
  await schedulePostizPost({ apiToken: 'pos_test', integrationId: 'integration-yt', publicationDate: '2026-09-16T10:00:00Z', channel: 'video', text: 'Título del vídeo\nCuerpo', providerSettings: { type: 'unlisted' }, fetchImpl })
  assert.equal(payload.posts[0].settings.__type, 'youtube')
  assert.equal(payload.posts[0].settings.title, 'Título del vídeo')
  assert.equal(payload.posts[0].settings.type, 'unlisted')
  assert.equal(payload.posts[0].settings.selfDeclaredMadeForKids, 'no')
})

test('Postiz scheduler supplies WordPress draft metadata for the blog channel', async () => {
  let payload
  const fetchImpl = async (_url, init) => {
    payload = JSON.parse(init.body)
    return { ok: true, json: async () => [{ postId: 'post-wordpress' }] }
  }
  await schedulePostizPost({ apiToken: 'pos_test', integrationId: 'integration-wp', publicationDate: '2026-09-16T10:00:00Z', channel: 'blog', text: 'Artículo principal\nContenido', fetchImpl })
  assert.equal(payload.posts[0].settings.__type, 'wordpress')
  assert.equal(payload.posts[0].settings.title, 'Artículo principal')
  assert.equal(payload.posts[0].settings.type, 'post')
  assert.equal(payload.posts[0].settings.status, 'publish')
})

test('Postiz scheduler normalizes public media through upload-from-url', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/upload-from-url')) return { ok: true, json: async () => ({ id: 'media-1', path: 'https://uploads.postiz.com/media-1.jpg' }) }
    return { ok: true, json: async () => [{ postId: 'post-1' }] }
  }
  await schedulePostizPost({ apiToken: 'pos_test', integrationId: 'integration-1', publicationDate: '2026-09-16T10:00:00Z', channel: 'instagram', text: 'Hola', media: [{ url: 'https://cdn.example/image.jpg' }], fetchImpl })
  assert.equal(calls[0].url, 'https://api.postiz.com/public/v1/upload-from-url')
  assert.deepEqual(JSON.parse(calls[0].init.body), { url: 'https://cdn.example/image.jpg' })
  assert.equal(calls[1].url, 'https://api.postiz.com/public/v1/posts')
  assert.deepEqual(JSON.parse(calls[1].init.body).posts[0].value[0].image, [{ id: 'media-1', path: 'https://uploads.postiz.com/media-1.jpg' }])
})

test('Postiz helpers normalize channel ids, response ids and states', async () => {
  assert.equal(postizProviderForChannel('video'), 'youtube')
  assert.equal(postizProviderForChannel('x'), 'x')
  assert.equal(postizPostId([{ postId: 'post-1' }]), 'post-1')
  assert.equal(postizStatus({ state: 'PUBLISHED' }), 'published')
  assert.equal(postizStatus({ posts: [{ state: 'QUEUE' }] }), 'syncing')
})

test('Postiz integration listing accepts wrapped responses', async () => {
  const integrations = await listPostizIntegrations({ apiToken: 'pos_test', fetchImpl: async () => ({ ok: true, json: async () => ({ integrations: [{ id: 'one' }] }) }) })
  assert.deepEqual(integrations, [{ id: 'one' }])
})
