import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { readDb, writeDb } from './db.mjs'

const PREFIX = 'enc:chatgpt:v1:'
const MAX = 24_000
const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token'
const RESOURCE = 'https://api.openai.com/v1'
const REQUIRED_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct']
const QUICKSTART_URL = 'https://developers.openai.com/siwc/quickstart'

function text(value, max = 500) { return String(value ?? '').trim().slice(0, max) }

function keyFromEnv(env = process.env) {
  const raw = text(env.CHATGPT_SIWC_ENCRYPTION_KEY || env.CMS_SECRET_KEY || env.AI_CONNECTOR_ENCRYPTION_KEY, MAX)
  if (!raw) return null
  const bytes = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'utf8')
  if (bytes.length < 32) return null
  return createHash('sha256').update(bytes).digest()
}

function encrypt(value, env) {
  const key = keyFromEnv(env)
  if (!key) throw Object.assign(new Error('CHATGPT_SIWC_ENCRYPTION_KEY es obligatorio para guardar la conexión.'), { status: 503, code: 'chatgpt_siwc_key_required' })
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const serialized = JSON.stringify(value)
  if (serialized.length > MAX) throw Object.assign(new Error('El registro de Sign in with ChatGPT supera el tamaño permitido.'), { status: 413, code: 'chatgpt_siwc_credentials_too_large' })
  const encrypted = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()])
  return `${PREFIX}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`
}

function decrypt(value, env) {
  const stored = text(value, MAX)
  if (!stored.startsWith(PREFIX)) return null
  const key = keyFromEnv(env)
  if (!key) return null
  const parts = stored.split(':')
  if (parts.length !== 6) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[3], 'base64url'))
    decipher.setAuthTag(Buffer.from(parts[4], 'base64url'))
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[5], 'base64url')), decipher.final()]).toString('utf8'))
  } catch { return null }
}

function records(db) {
  return db?.chatgptConnections && typeof db.chatgptConnections === 'object' && !Array.isArray(db.chatgptConnections) ? db.chatgptConnections : {}
}

function normalizedScopes(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/)
  return [...new Set(list.map((scope) => text(scope, 120)).filter(Boolean))]
}

function expiresAt(input) {
  const explicit = text(input.expires_at || input.expiresAt, 50)
  if (explicit) {
    const numeric = Number(explicit)
    if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric > 1e12 ? numeric : numeric * 1000).toISOString()
    return explicit
  }
  const seconds = Number(input.expires_in)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : ''
}

function publicConnection(value) {
  if (!value) return { connected: false, mode: 'personal', scopes: [], expiresAt: null, email: null }
  const expires = text(value.expiresAt, 50)
  return {
    connected: true,
    mode: 'personal',
    email: text(value.email, 240) || null,
    subject: text(value.subject, 240) || null,
    clientId: text(value.clientId, 240) || null,
    hostId: text(value.hostId, 240) || null,
    scopes: normalizedScopes(value.scopes),
    expiresAt: expires || null,
    expired: Boolean(expires && Date.parse(expires) <= Date.now()),
    updatedAt: text(value.updatedAt, 50) || null
  }
}

export function chatGptSiwcInstructions() {
  return {
    flow: 'local_oauth_transfer',
    docs: QUICKSTART_URL,
    resource: RESOURCE,
    tokenUrl: TOKEN_URL,
    requiredScopes: REQUIRED_SCOPES,
    message: 'Completa Sign in with ChatGPT en un cliente local y transfiere aquí el registro de credenciales solo en tu servidor autoalojado. La interfaz no devuelve ni muestra los tokens.'
  }
}

export function getChatGptConnection(userId, { db = readDb(), env = process.env } = {}) {
  const id = text(userId, 240)
  if (!id) return { connected: false, mode: 'personal', instructions: chatGptSiwcInstructions() }
  return { ...publicConnection(decrypt(records(db)[id], env)), instructions: chatGptSiwcInstructions() }
}

export function saveChatGptConnection(userId, input = {}, { db, env = process.env, now = new Date().toISOString() } = {}) {
  if (!db || typeof db !== 'object') throw new TypeError('db es obligatorio')
  const id = text(userId, 240)
  if (!id) throw Object.assign(new Error('La sesión no tiene userId.'), { status: 401, code: 'user_id_required' })
  const source = input?.credentials && typeof input.credentials === 'object' ? input.credentials : input
  const accessToken = text(source.access_token || source.accessToken, 16_000)
  const refreshToken = text(source.refresh_token || source.refreshToken, 16_000)
  const clientId = text(source.client_id || source.clientId, 240)
  const hostId = text(source.ext_agent_host_id || source.extAgentHostId || source.host_id, 240)
  const scopes = normalizedScopes(source.scope || source.scopes)
  const missing = REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope))
  if (!accessToken || !refreshToken || !clientId || !hostId || missing.length) {
    throw Object.assign(new Error(`El registro Sign in with ChatGPT no es válido. Faltan: ${[!accessToken && 'access_token', !refreshToken && 'refresh_token', !clientId && 'client_id', !hostId && 'ext_agent_host_id', ...missing].filter(Boolean).join(', ')}.`), { status: 422, code: 'chatgpt_siwc_credentials_invalid' })
  }
  const value = {
    accessToken,
    refreshToken,
    clientId,
    hostId,
    idToken: text(source.id_token || source.idToken, 16_000),
    email: text(source.email, 240),
    subject: text(source.sub || source.subject, 240),
    scopes,
    expiresAt: expiresAt(source),
    updatedAt: text(now, 50)
  }
  db.chatgptConnections = { ...records(db), [id]: encrypt(value, env) }
  return publicConnection(value)
}

export function disconnectChatGpt(userId, { db } = {}) {
  if (!db || typeof db !== 'object') throw new TypeError('db es obligatorio')
  const id = text(userId, 240)
  const next = { ...records(db) }
  delete next[id]
  db.chatgptConnections = next
  return { connected: false, mode: 'personal', instructions: chatGptSiwcInstructions() }
}

export async function getChatGptAccessToken(userId, { db = readDb(), env = process.env, fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const id = text(userId, 240)
  if (!id) return ''
  const current = decrypt(records(db)[id], env)
  if (!current?.accessToken) return ''
  if (!current.expiresAt || Date.parse(current.expiresAt) - now.getTime() > 60_000) return current.accessToken
  if (typeof fetchImpl !== 'function' || !current.refreshToken) return ''
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current.refreshToken, client_id: current.clientId, resource: RESOURCE })
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.access_token) throw Object.assign(new Error('OpenAI rechazó la renovación de Sign in with ChatGPT.'), { status: response.status >= 500 ? 502 : 401, code: 'chatgpt_siwc_refresh_failed' })
  const next = { ...current, accessToken: text(payload.access_token, 16_000), refreshToken: text(payload.refresh_token, 16_000) || current.refreshToken, expiresAt: expiresAt(payload), updatedAt: new Date().toISOString() }
  db.chatgptConnections = { ...records(db), [id]: encrypt(next, env) }
  writeDb(db)
  return next.accessToken
}
