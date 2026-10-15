import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dataRoot = mkdtempSync(join(tmpdir(), 'chatgpt-siwc-'))
process.env.CMS_DATA_DIR = dataRoot
process.env.CHATGPT_SIWC_ENCRYPTION_KEY = 'x'.repeat(64)
const { readDb } = await import('./db.mjs')
const { disconnectChatGpt, getChatGptAccessToken, getChatGptConnection, saveChatGptConnection } = await import('./chatgpt-siwc.mjs')

test('guarda Sign in with ChatGPT cifrado y nunca expone tokens', () => {
  const db = readDb()
  const result = saveChatGptConnection('user-1', {
    access_token: 'access-secret',
    refresh_token: 'refresh-secret',
    client_id: 'client-1',
    ext_agent_host_id: 'host-1',
    scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    email: 'user@example.com',
    expires_in: 3600
  }, { db })
  assert.equal(result.connected, true)
  assert.equal(result.email, 'user@example.com')
  assert.doesNotMatch(JSON.stringify(db), /access-secret|refresh-secret/)
  assert.equal(getChatGptConnection('user-1', { db }).connected, true)
})

test('rechaza un registro que no permita uso directo del token', () => {
  assert.throws(() => saveChatGptConnection('user-2', {
    access_token: 'access', refresh_token: 'refresh', client_id: 'client', ext_agent_host_id: 'host', scope: 'openid offline_access'
  }, { db: readDb() }), (error) => error.code === 'chatgpt_siwc_credentials_invalid')
})

test('desconecta la cuenta personal', () => {
  const db = readDb()
  const result = disconnectChatGpt('user-1', { db })
  assert.equal(result.connected, false)
  assert.equal(getChatGptConnection('user-1', { db }).connected, false)
})

test('renueva el access token sin usar client secret', async () => {
  const db = readDb()
  saveChatGptConnection('user-refresh', {
    access_token: 'expired', refresh_token: 'refresh-secret', client_id: 'client-1', ext_agent_host_id: 'host-1',
    scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', expires_at: new Date(Date.now() - 60_000).toISOString()
  }, { db })
  let request
  const token = await getChatGptAccessToken('user-refresh', {
    db,
    fetchImpl: async (url, options) => {
      request = { url, options }
      return { ok: true, status: 200, json: async () => ({ access_token: 'fresh', refresh_token: 'refresh-2', expires_in: 3600 }) }
    }
  })
  assert.equal(token, 'fresh')
  assert.equal(request.options.body.get('client_secret'), null)
  assert.equal(request.options.body.get('resource'), 'https://api.openai.com/v1')
})

test.after(() => rmSync(dataRoot, { recursive: true, force: true }))
