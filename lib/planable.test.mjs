import test from 'node:test'
import assert from 'node:assert/strict'
import { planableStatus, schedulePlanablePost, testPlanableConnection } from './planable.mjs'

test('Planable connection test validates token and configured workspace', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    return { ok: true, json: async () => ({ data: [{ id: 'workspace-1', name: 'Escarlet' }] }) }
  }
  const result = await testPlanableConnection({ apiToken: 'pln_test', workspaceId: 'workspace-1', fetchImpl })
  assert.equal(result.ok, true)
  assert.equal(result.workspaceName, 'Escarlet')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.headers.Authorization, 'Bearer pln_test')
})

test('Planable scheduler sends workspace, page, ISO date and public media', async () => {
  let call
  const fetchImpl = async (url, init) => {
    call = { url: String(url), init }
    return { ok: true, json: async () => ({ posts: [{ id: 'post-1', status: 'DRAFT' }] }) }
  }
  const result = await schedulePlanablePost({ apiToken: 'pln_test', workspaceId: 'workspace-1', pageId: 'page-1', publicationDate: '2026-09-16T10:00:00Z', text: 'Hola', media: [{ url: 'https://cdn.example/image.jpg' }, { url: 'http://localhost/private.png' }], idempotencyKey: 'planable:test-1', fetchImpl })
  assert.equal(result.posts[0].id, 'post-1')
  assert.equal(call.url, 'https://api.planable.io/api/v1/posts')
  assert.equal(call.init.headers.Authorization, 'Bearer pln_test')
  assert.equal(call.init.headers['Idempotency-Key'], 'planable:test-1')
  const payload = JSON.parse(call.init.body)
  assert.deepEqual(payload.pageId, 'page-1')
  assert.equal(payload.workspaceId, 'workspace-1')
  assert.equal(payload.scheduledAt, '2026-09-16T10:00:00.000Z')
  assert.deepEqual(payload.media, ['https://cdn.example/image.jpg'])
})

test('Planable status normalizes nested API responses', () => {
  assert.equal(planableStatus({ data: { status: 'PUBLISHED' } }), 'published')
  assert.equal(planableStatus({ posts: [{ status: 'DRAFT' }] }), 'draft')
})
