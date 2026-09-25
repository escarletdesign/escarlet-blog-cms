import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchRemote } from './remote-fetch.mjs'

test('fetchRemote bloquea loopback y limita respuestas', async () => {
  await assert.rejects(() => fetchRemote('https://127.0.0.1/internal', { fetchImpl: async () => ({ ok: true }) }), { code: 'unsafe_url' })
  const oversized = {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': '20' }),
    arrayBuffer: async () => new Uint8Array(20).buffer
  }
  await assert.rejects(() => fetchRemote('https://public.example/image', { fetchImpl: async () => oversized, maxBytes: 10 }), { code: 'response_too_large' })
})

test('fetchRemote valida cada redirección', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return { status: 302, headers: new Headers({ location: 'https://127.0.0.1/private' }) }
  }
  await assert.rejects(() => fetchRemote('https://public.example/start', { fetchImpl }), { code: 'unsafe_url' })
  assert.equal(calls, 1)
})
