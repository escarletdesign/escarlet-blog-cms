import test from 'node:test'
import assert from 'node:assert/strict'
import { encryptSecret, decryptSecret } from './secret-crypto.mjs'
import { metricoolProviderForChannel, scheduleMetricoolPost, normalizeMetricoolMedia } from './metricool.mjs'

test('Metricool credentials are encrypted and never returned as plaintext', () => {
  const env = { CMS_SECRET_KEY: 'x'.repeat(32) }
  const encrypted = encryptSecret('token-123', { env })
  assert.match(encrypted, /^enc:v1:/)
  assert.equal(decryptSecret(encrypted, { env }), 'token-123')
  assert.equal(decryptSecret(encrypted, { env: { CMS_SECRET_KEY: 'y'.repeat(32) } }), '')
})

test('Metricool scheduler sends provider, timezone, IDs and mediaId payload', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).includes('/normalize/image/url')) return { ok: true, json: async () => ({ mediaId: 'm-1' }) }
    return { ok: true, json: async () => ({ id: 'p-1' }) }
  }
  const result = await scheduleMetricoolPost({ userToken: 'secret', userId: 'u-1', blogId: 'b-1', publicationDate: '2026-09-16T10:00:00Z', timezone: 'Europe/Madrid', text: 'hola', channel: 'instagram', media: [{ url: 'https://cdn.example/image.jpg' }], idempotencyKey: 'metricool:test-1', fetchImpl })
  assert.equal(result.id, 'p-1')
  assert.equal(calls.length, 2)
  const scheduler = calls[1]
  assert.match(scheduler.url, /userId=u-1/)
  assert.match(scheduler.url, /blogId=b-1/)
  assert.equal(scheduler.init.headers['X-Mc-Auth'], 'secret')
  assert.equal(scheduler.init.headers['Idempotency-Key'], 'metricool:test-1')
  const payload = JSON.parse(scheduler.init.body)
  assert.deepEqual(payload.providers, ['instagram'])
  assert.equal(payload.publicationDate.timezone, 'Europe/Madrid')
  assert.deepEqual(payload.media, [{ mediaId: 'm-1' }])
})

test('Metricool rejects local media URLs and maps X to twitter', async () => {
  assert.equal(metricoolProviderForChannel('x'), 'twitter')
  await assert.rejects(() => normalizeMetricoolMedia('http://localhost/image.jpg', { userToken: 'x', userId: 'u', blogId: 'b', fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), /URL pública/)
})
