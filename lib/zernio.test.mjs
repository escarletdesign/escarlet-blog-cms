import test from 'node:test'
import assert from 'node:assert/strict'
import { listZernioAccounts, scheduleZernioPost, testZernioConnection, zernioPlatformForChannel, zernioStatus } from './zernio.mjs'

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

test('Zernio normaliza los canales y crea un Short con la forma oficial', async () => {
  assert.equal(zernioPlatformForChannel('youtube_short'), 'youtube')
  assert.equal(zernioPlatformForChannel('tiktok_video'), 'tiktok')
  assert.equal(zernioPlatformForChannel('video'), 'instagram')
  let request
  const result = await scheduleZernioPost({
    apiToken: 'sk_test',
    accountId: 'account-1',
    channel: 'tiktok_video',
    publicationDate: '2099-01-01T12:00:00.000Z',
    text: 'Video de prueba',
    media: [{ url: 'https://cdn.example.test/video.mp4', mimeType: 'video/mp4' }],
    idempotencyKey: 'run-1',
    fetchImpl: async (url, options) => {
      request = { url, options }
      return response({ post: { _id: 'post-1', status: 'scheduled' } }, 201)
    }
  })
  assert.equal(result.post._id, 'post-1')
  const body = JSON.parse(request.options.body)
  assert.equal(body.platforms[0].platform, 'tiktok')
  assert.equal(body.scheduledFor, '2099-01-01T12:00:00.000Z')
  assert.equal(body.tiktokSettings.content_preview_confirmed, true)
  assert.equal(request.options.headers['Idempotency-Key'], 'run-1')
})

test('Zernio lista cuentas y valida accountId', async () => {
  const fetchImpl = async () => response({ accounts: [{ _id: 'account-1', platform: 'youtube', username: 'demo' }] })
  assert.equal((await listZernioAccounts({ apiToken: 'sk_test', fetchImpl })).length, 1)
  const result = await testZernioConnection({ apiToken: 'sk_test', accountId: 'account-1', platform: 'youtube_short', fetchImpl })
  assert.deepEqual({ ok: result.ok, platform: result.platform, username: result.username }, { ok: true, platform: 'youtube', username: 'demo' })
})

test('Zernio normaliza estados parciales y fallidos', () => {
  assert.equal(zernioStatus({ post: { status: 'partial' } }), 'scheduled')
  assert.equal(zernioStatus({ post: { status: 'failed' } }), 'failed')
})
