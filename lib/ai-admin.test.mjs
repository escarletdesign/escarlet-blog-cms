import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  encryptAiConnectorSecret,
  getAiProviderConnector,
  listPublicAiProviderConnectors,
  saveAiProviderConnector,
  testAiProviderConnector
} from './ai-admin.mjs'

const encryptionEnv = { AI_CONNECTOR_ENCRYPTION_KEY: 'a'.repeat(64) }

test('AI provider persistence encrypts secrets, returns sanitized DTOs, and preserves a blank replacement key', () => {
  const db = {}
  const saved = saveAiProviderConnector('gemini', { enabled: true, model: 'gemini-2.5-flash', apiKey: 'secret-gemini-key' }, { db, env: encryptionEnv, now: '2026-09-09T00:00:00.000Z' })
  assert.equal(saved.apiKeyConfigured, true)
  assert.match(db.aiProviders.gemini.apiKey, /^enc:v1:/)
  assert.equal(db.aiProviders.gemini.apiKey.includes('secret-gemini-key'), false)
  assert.equal(JSON.stringify(saved).includes('secret-gemini-key'), false)
  saveAiProviderConnector('gemini', { model: 'gemini-2.5-pro', apiKey: '' }, { db, env: encryptionEnv })
  assert.equal(getAiProviderConnector('gemini', { db, env: encryptionEnv }).apiKey, 'secret-gemini-key')
  assert.equal(listPublicAiProviderConnectors({ db, env: encryptionEnv }).find((item) => item.provider === 'gemini').model, 'gemini-2.5-pro')
})

test('AI provider key persistence fails closed without encryption configuration and plaintext is opt-in only', () => {
  assert.throws(() => saveAiProviderConnector('openai', { apiKey: 'private' }, { db: {}, env: {} }), { status: 503 })
  const db = { aiProviders: { openai: { apiKey: 'legacy-plaintext' } } }
  assert.equal(getAiProviderConnector('openai', { db, env: {} }).apiKey, '')
  assert.equal(getAiProviderConnector('openai', { db, env: { AI_CONNECTOR_ALLOW_LEGACY_PLAINTEXT: '1' } }).apiKey, 'legacy-plaintext')
  assert.match(encryptAiConnectorSecret('private', { env: encryptionEnv }), /^enc:v1:/)
})

test('AI provider test uses stored server credential and Gemini sends it in a header, never in the URL', async () => {
  const db = {}
  saveAiProviderConnector('gemini', { apiKey: 'private-gemini-key', model: 'gemini-2.5-flash' }, { db, env: encryptionEnv })
  let call
  const result = await testAiProviderConnector('gemini', {
    db, env: encryptionEnv,
    fetchImpl: async (url, init) => { call = { url, init }; return { ok: true, status: 200 } }
  })
  assert.equal(result.ok, true)
  assert.equal(result.provider, 'gemini')
  assert.equal(JSON.stringify(result).includes('private-gemini-key'), false)
  assert.match(call.url, /^https:\/\/generativelanguage\.googleapis\.com\//)
  assert.equal(call.url.includes('private-gemini-key'), false)
  assert.equal(call.url.includes('?key='), false)
  assert.equal(call.init.headers['x-goog-api-key'], 'private-gemini-key')
})
