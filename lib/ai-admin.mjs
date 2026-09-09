/**
 * Server-only administration for AI connectors. Credentials are persisted only
 * in the CMS data store and all exported DTOs intentionally replace them with
 * a boolean state. This module must never be imported by the PWA bundle.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const PROVIDERS = Object.freeze({
  openai: { name: 'OpenAI', defaultModel: 'gpt-4.1-mini', envKey: 'OPENAI_API_KEY' },
  gemini: { name: 'Google Gemini', defaultModel: 'gemini-2.5-flash', envKey: 'GEMINI_API_KEY' },
  grok: { name: 'xAI Grok', defaultModel: 'grok-3-mini', envKey: 'XAI_API_KEY' }
})

const MAX_MODEL_LENGTH = 100
const MAX_SECRET_LENGTH = 4096
const ENCRYPTED_SECRET_PREFIX = 'enc:v1:'

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max)
}

function badRequest(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

export function supportedAiProviders() {
  return Object.keys(PROVIDERS)
}

export function normalizeAiProvider(value) {
  const provider = text(value, 30).toLowerCase()
  if (!Object.hasOwn(PROVIDERS, provider)) throw badRequest('Proveedor de IA no compatible.')
  return provider
}

function records(db) {
  return db?.aiProviders && typeof db.aiProviders === 'object' && !Array.isArray(db.aiProviders)
    ? db.aiProviders
    : {}
}

function envKeyFor(provider, env) {
  return text(env?.[PROVIDERS[provider].envKey], MAX_SECRET_LENGTH)
}

function connectorEncryptionKey(env = process.env) {
  const raw = text(env?.AI_CONNECTOR_ENCRYPTION_KEY, MAX_SECRET_LENGTH)
  if (!raw) return null
  const bytes = /^[a-f0-9]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : /^[A-Za-z0-9+/]{43}=$|^[A-Za-z0-9_-]{43}$/.test(raw)
      ? Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
      : Buffer.from(raw, 'utf8')
  // A human-readable passphrase must still contain sufficient entropy. Hashing only
  // normalizes a valid deployment secret into the fixed AES-256 key length.
  if (bytes.length < 32) return null
  return createHash('sha256').update(bytes).digest()
}

/** Encrypts a connector credential as AES-256-GCM; never use this value in a response. */
export function encryptAiConnectorSecret(secret, { env = process.env } = {}) {
  const key = connectorEncryptionKey(env)
  if (!key) throw Object.assign(new Error('AI_CONNECTOR_ENCRYPTION_KEY es obligatorio para guardar claves de IA.'), { status: 503 })
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(text(secret, MAX_SECRET_LENGTH), 'utf8'), cipher.final()])
  return `${ENCRYPTED_SECRET_PREFIX}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`
}

function decryptAiConnectorSecret(value, { env = process.env } = {}) {
  const stored = text(value, MAX_SECRET_LENGTH)
  if (!stored) return ''
  if (!stored.startsWith(ENCRYPTED_SECRET_PREFIX)) {
    // Existing plaintext databases are intentionally unreadable by default. A one-time
    // migration can explicitly opt in, then save the connector to re-encrypt it.
    return env?.AI_CONNECTOR_ALLOW_LEGACY_PLAINTEXT === '1' ? stored : ''
  }
  const key = connectorEncryptionKey(env)
  if (!key) return ''
  const parts = stored.split(':')
  if (parts.length !== 5) return ''
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[2], 'base64url'))
    decipher.setAuthTag(Buffer.from(parts[3], 'base64url'))
    return text(Buffer.concat([decipher.update(Buffer.from(parts[4], 'base64url')), decipher.final()]).toString('utf8'), MAX_SECRET_LENGTH)
  } catch { return '' }
}

/** Returns a server-only resolved connector. Do not serialize this return value. */
export function getAiProviderConnector(provider, { db = {}, env = process.env } = {}) {
  const id = normalizeAiProvider(provider)
  const saved = records(db)[id] && typeof records(db)[id] === 'object' ? records(db)[id] : {}
  const persistedKey = decryptAiConnectorSecret(saved.apiKey, { env })
  const configuredKey = persistedKey || envKeyFor(id, env)
  return {
    provider: id,
    enabled: saved.enabled !== false,
    model: text(saved.model, MAX_MODEL_LENGTH) || text(env?.[`${id.toUpperCase()}_MODEL`], MAX_MODEL_LENGTH) || PROVIDERS[id].defaultModel,
    apiKey: configuredKey,
    credentialSource: persistedKey ? 'stored' : configuredKey ? 'environment' : 'none',
    updatedAt: text(saved.updatedAt, 40)
  }
}

/** Safe admin response: intentionally omits API key, price-like metadata and env source details. */
export function publicAiProviderConnector(provider, options = {}) {
  const connector = getAiProviderConnector(provider, options)
  return {
    provider: connector.provider,
    name: PROVIDERS[connector.provider].name,
    enabled: connector.enabled,
    model: connector.model,
    apiKeyConfigured: Boolean(connector.apiKey),
    credentialSource: connector.credentialSource === 'stored' ? 'stored' : connector.credentialSource === 'environment' ? 'environment' : 'none',
    updatedAt: connector.updatedAt || null
  }
}

export function listPublicAiProviderConnectors(options = {}) {
  return supportedAiProviders().map((provider) => publicAiProviderConnector(provider, options))
}

/**
 * Update only explicitly supported connector fields. A blank apiKey means
 * "preserve current key", avoiding accidental credential erasure from forms.
 */
export function saveAiProviderConnector(provider, input = {}, { db, env = process.env, now = new Date().toISOString() } = {}) {
  if (!db || typeof db !== 'object') throw new TypeError('db is required')
  const id = normalizeAiProvider(provider)
  const current = records(db)[id] && typeof records(db)[id] === 'object' ? records(db)[id] : {}
  const next = { ...current }
  if (Object.hasOwn(input, 'enabled')) next.enabled = input.enabled !== false
  if (Object.hasOwn(input, 'model')) {
    const model = text(input.model, MAX_MODEL_LENGTH)
    if (!model) throw badRequest('El modelo es obligatorio.')
    next.model = model
  }
  if (Object.hasOwn(input, 'apiKey')) {
    const apiKey = text(input.apiKey, MAX_SECRET_LENGTH)
    if (apiKey) next.apiKey = encryptAiConnectorSecret(apiKey, { env })
  }
  if (input.clearApiKey === true) delete next.apiKey
  next.updatedAt = now
  db.aiProviders = { ...records(db), [id]: next }
  return publicAiProviderConnector(id, { db, env })
}

function responseError(response, fallback) {
  const error = new Error(fallback)
  error.status = Number(response?.status) || 502
  return error
}

/**
 * Performs a tiny authenticated request without exposing keys to the caller.
 * It is deliberately injectable so callers can test it without a network.
 */
export async function testAiProviderConnector(provider, { db, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const connector = getAiProviderConnector(provider, { db, env })
  if (!connector.enabled) return { provider: connector.provider, ok: false, reason: 'connector_disabled' }
  if (!connector.apiKey) return { provider: connector.provider, ok: false, reason: 'api_key_missing' }
  if (typeof fetchImpl !== 'function') return { provider: connector.provider, ok: false, reason: 'fetch_unavailable' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  const started = Date.now()
  try {
    let url
    let init
    if (connector.provider === 'openai') {
      url = 'https://api.openai.com/v1/responses'
      init = { method: 'POST', headers: { Authorization: `Bearer ${connector.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: connector.model, max_output_tokens: 1, input: 'ping' }), signal: controller.signal }
    } else if (connector.provider === 'gemini') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(connector.model)}:generateContent`
      init = { method: 'POST', headers: { 'x-goog-api-key': connector.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } }), signal: controller.signal }
    } else {
      url = 'https://api.x.ai/v1/chat/completions'
      init = { method: 'POST', headers: { Authorization: `Bearer ${connector.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: connector.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }), signal: controller.signal }
    }
    const response = await fetchImpl(url, init)
    if (!response?.ok) throw responseError(response, 'El proveedor rechazó la comprobación.')
    return { provider: connector.provider, ok: true, model: connector.model, latencyMs: Date.now() - started }
  } catch (cause) {
    return {
      provider: connector.provider,
      ok: false,
      reason: cause?.name === 'AbortError' ? 'timeout' : 'provider_request_failed',
      // Do not return upstream messages: they may echo account/credential details.
      status: Number(cause?.status) || null
    }
  } finally {
    clearTimeout(timeout)
  }
}
