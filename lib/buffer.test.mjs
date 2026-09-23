import test from 'node:test'
import assert from 'node:assert/strict'
import { bufferPostId, bufferStatus, listBufferChannels, listBufferOrganizations, scheduleBufferPost, syncBufferPost, testBufferConnection, updateBufferPostDueAt } from './buffer.mjs'

test('Buffer lists organizations and channels with Bearer authentication', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init, payload: JSON.parse(init.body) })
    if (calls.length === 1) return { ok: true, json: async () => ({ data: { account: { organizations: [{ id: 'org-1', name: 'Escarlet' }] } } }) }
    return { ok: true, json: async () => ({ data: { channels: [{ id: 'channel-1', displayName: 'Escarlet Instagram', service: 'instagram' }] } }) }
  }
  assert.deepEqual(await listBufferOrganizations({ apiToken: 'buf_test', fetchImpl }), [{ id: 'org-1', name: 'Escarlet' }])
  assert.deepEqual(await listBufferChannels({ apiToken: 'buf_test', organizationId: 'org-1', fetchImpl }), [{ id: 'channel-1', displayName: 'Escarlet Instagram', service: 'instagram' }])
  assert.equal(calls[0].url, 'https://api.buffer.com')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer buf_test')
  assert.equal(calls[1].payload.variables.organizationId, 'org-1')
})

test('Buffer schedules an exact UTC post and sends public image assets', async () => {
  let payload
  const fetchImpl = async (_url, init) => {
    payload = JSON.parse(init.body)
    return { ok: true, json: async () => ({ data: { createPost: { post: { id: 'post-1', status: 'scheduled' } } } }) }
  }
  const result = await scheduleBufferPost({ apiToken: 'buf_test', organizationId: 'org-1', channelId: 'channel-1', publicationDate: '2026-09-16T10:00:00Z', text: 'Hola', media: [{ url: 'https://cdn.example/image.jpg' }], idempotencyKey: 'buffer:test-1', fetchImpl, service: 'instagram' })
  assert.equal(result.post.id, 'post-1')
  assert.equal(payload.variables.input.channelId, 'channel-1')
  assert.deepEqual(payload.variables.input.metadata, { instagram: { type: 'post', shouldShareToFeed: true } })
  assert.equal(payload.variables.input.needsApproval, false)
  assert.equal(payload.variables.input.mode, 'customScheduled')
  assert.equal(payload.variables.input.dueAt, '2026-09-16T10:00:00.000Z')
  assert.deepEqual(payload.variables.input.assets, [{ image: { url: 'https://cdn.example/image.jpg' } }])
})

test('Buffer sends Instagram carousels as posts with multiple assets', async () => {
  let payload
  const fetchImpl = async (_url, init) => {
    payload = JSON.parse(init.body)
    return { ok: true, json: async () => ({ data: { createPost: { post: { id: 'post-carousel', status: 'scheduled' } } } }) }
  }
  await scheduleBufferPost({
    apiToken: 'buf_test',
    channelId: 'channel-1',
    publicationDate: '2026-09-16T10:00:00Z',
    text: 'Carrusel',
    media: [{ url: 'https://cdn.example/one.jpg' }, { url: 'https://cdn.example/two.jpg' }],
    fetchImpl,
    service: 'instagram'
  })
  assert.deepEqual(payload.variables.input.metadata, { instagram: { type: 'post', shouldShareToFeed: true } })
  assert.equal(payload.variables.input.assets.length, 2)
})

test('Buffer typed mutation errors are not treated as successful syncs', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ data: { createPost: { message: 'Límite de publicaciones alcanzado.' } } }) })
  await assert.rejects(
    () => scheduleBufferPost({ apiToken: 'buf_test', channelId: 'channel-1', text: 'Hola', fetchImpl }),
    (error) => error.code === 'buffer_mutation_error' && /Límite/.test(error.message)
  )
})

test('Buffer prepares Instagram Stories as notification posts with the article link reminder', async () => {
  let payload
  const fetchImpl = async (_url, init) => {
    payload = JSON.parse(init.body)
    return { ok: true, json: async () => ({ data: { createPost: { post: { id: 'story-1', status: 'scheduled' } } } }) }
  }
  await scheduleBufferPost({
    apiToken: 'buf_test',
    channelId: 'channel-1',
    publicationDate: '2026-09-16T10:00:00Z',
    text: 'Mira el artículo completo',
    media: [{ url: 'https://cdn.example/story.jpg' }],
    linkUrl: 'https://escarlet.design/blog/criterio',
    idempotencyKey: 'buffer:story-1',
    fetchImpl,
    service: 'instagram_story'
  })
  assert.equal(payload.variables.input.schedulingType, 'notification')
  assert.deepEqual(payload.variables.input.metadata, {
    instagram: {
      type: 'story',
      shouldShareToFeed: false,
      stickerFields: { other: 'Añade el sticker de enlace en Instagram: https://escarlet.design/blog/criterio' }
    }
  })
})

test('Buffer moves an accepted post by id without sending assets again', async () => {
  let payload
  const dueAt = new Date(Date.now() + 5 * 60_000).toISOString()
  const fetchImpl = async (_url, init) => {
    payload = JSON.parse(init.body)
    return { ok: true, json: async () => ({ data: { updatePost: { post: { id: 'post-1', status: 'scheduled', dueAt } } } }) }
  }
  const result = await updateBufferPostDueAt({ apiToken: 'buf_test', providerPostId: 'post-1', publicationDate: dueAt, idempotencyKey: 'buffer-move:1', fetchImpl })
  assert.equal(result.post.id, 'post-1')
  assert.equal(payload.variables.input.id, 'post-1')
  assert.equal(payload.variables.input.mode, 'customScheduled')
  assert.equal(payload.variables.input.dueAt, new Date(dueAt).toISOString())
  assert.equal('assets' in payload.variables.input, false)
  assert.equal(bufferPostId(result), 'post-1')
  assert.equal(bufferStatus(result), 'scheduled')
  await assert.rejects(
    () => updateBufferPostDueAt({ apiToken: 'buf_test', providerPostId: 'post-1', publicationDate: '2020-01-01T00:00:00.000Z', fetchImpl }),
    (error) => error.code === 'publication_date_invalid'
  )
})

test('Buffer sync reads a post by id and normalizes statuses', async () => {
  const response = await syncBufferPost({ apiToken: 'buf_test', providerPostId: 'post-1', fetchImpl: async (_url, init) => {
    const payload = JSON.parse(init.body)
    assert.equal(payload.variables.postId, 'post-1')
    return { ok: true, json: async () => ({ data: { post: { id: 'post-1', status: 'sent' } } }) }
  } })
  assert.equal(response.status, 'sent')
  assert.equal(bufferPostId({ createPost: { post: { id: 'post-1' } } }), 'post-1')
  assert.equal(bufferStatus(response), 'published')
  assert.equal(bufferStatus({ status: 'scheduled' }), 'scheduled')
  assert.equal(bufferStatus({ status: 'error' }), 'failed')
})

test('Buffer connection test validates the selected organization and channel', async () => {
  const fetchImpl = async (_url, init) => {
    const payload = JSON.parse(init.body)
    if (payload.query.includes('BufferOrganizations')) return { ok: true, json: async () => ({ data: { account: { organizations: [{ id: 'org-1', name: 'Escarlet' }] } } }) }
    return { ok: true, json: async () => ({ data: { channels: [{ id: 'channel-1', name: 'Instagram', service: 'instagram' }] } }) }
  }
  const result = await testBufferConnection({ apiToken: 'buf_test', organizationId: 'org-1', channelId: 'channel-1', fetchImpl })
  assert.equal(result.ok, true)
  assert.equal(result.channelName, 'Instagram')
})
