import {
  createHash,
  randomBytes,
  timingSafeEqual
} from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync
} from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './db.mjs'

const CODE_TTL_MS = 10 * 60 * 1000
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SCOPE = 'mcp'
const CHATGPT_REDIRECTS = new Set([
  'https://chatgpt.com/connector_platform_oauth_redirect',
  'https://chatgpt.com/connector/oauth',
  'https://chat.openai.com/connector_platform_oauth_redirect'
])

function oauthDir() {
  const base = (process.env.CMS_DATA_DIR || dataDir).replace(/\/$/, '')
  const dir = join(base, 'oauth')
  mkdirSync(dir, { recursive: true })
  return dir
}

function storePath(name) {
  return join(oauthDir(), name)
}

function readJson(name, fallback) {
  const path = storePath(name)
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(name, value) {
  const path = storePath(name)
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, path)
}

function publicBase() {
  const fromEnv = (process.env.CMS_PUBLIC_URL || '').replace(/\/$/, '')
  if (fromEnv && !/localhost|127\.0\.0\.1/i.test(fromEnv)) return fromEnv
  return (process.env.CMS_PUBLIC_URL_FALLBACK || 'https://blog-cms.escarlet.cc').replace(/\/$/, '')
}

function adminToken() {
  return process.env.ADMIN_TOKEN || 'cambia-esto'
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function sha256Base64Url(value) {
  return createHash('sha256').update(String(value)).digest('base64url')
}

function cleanupExpired(map, now = Date.now()) {
  let changed = false
  for (const [key, item] of Object.entries(map)) {
    if (!item?.expiresAt || item.expiresAt <= now) {
      delete map[key]
      changed = true
    }
  }
  return changed
}

function isAllowedRedirect(uri, allowedList = []) {
  if (!uri) return false
  if (CHATGPT_REDIRECTS.has(uri)) return true
  if (uri.startsWith('https://chatgpt.com/connector/oauth/')) return true
  if (uri.startsWith('https://chat.openai.com/connector/oauth/')) return true
  return allowedList.includes(uri)
}

async function resolveClient(clientId) {
  if (!clientId) throw new Error('Falta client_id')

  const clients = readJson('clients.json', {})
  if (clients[clientId]) return clients[clientId]

  if (/^https:\/\//i.test(clientId)) {
    const res = await fetch(clientId, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) throw new Error(`No se pudo leer CIMD (${res.status})`)
    const doc = await res.json()
    if (doc.client_id && doc.client_id !== clientId) {
      throw new Error('client_id del documento CIMD no coincide')
    }
    const redirectUris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris : []
    if (!redirectUris.length) throw new Error('CIMD sin redirect_uris')
    const client = {
      client_id: clientId,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: doc.token_endpoint_auth_method || 'none',
      source: 'cimd'
    }
    clients[clientId] = client
    writeJson('clients.json', clients)
    return client
  }

  // Cliente local registrado por DCR o login previo
  return {
    client_id: clientId,
    redirect_uris: [...CHATGPT_REDIRECTS],
    token_endpoint_auth_method: 'none',
    source: 'implicit'
  }
}

export function getIssuer() {
  return publicBase()
}

export function getResource() {
  return `${publicBase()}/mcp`
}

export function protectedResourceMetadata() {
  const issuer = getIssuer()
  return {
    resource: getResource(),
    authorization_servers: [issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_documentation: `${issuer}/admin`
  }
}

export function authorizationServerMetadata() {
  const issuer = getIssuer()
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    revocation_endpoint_auth_methods_supported: ['none']
  }
}

export function wwwAuthenticateHeader() {
  const meta = `${getIssuer()}/.well-known/oauth-protected-resource`
  return `Bearer realm="escarlet-blog-cms", resource_metadata="${meta}", scope="${SCOPE}"`
}

export function isValidAccessToken(token) {
  if (!token) return false
  if (safeEqual(token, adminToken())) return true
  const tokens = readJson('tokens.json', {})
  cleanupExpired(tokens)
  const item = tokens[token]
  if (!item || item.isRefresh) return false
  if (item.expiresAt <= Date.now()) {
    delete tokens[token]
    writeJson('tokens.json', tokens)
    return false
  }
  if (item.resource && item.resource !== getResource() && item.resource !== getIssuer()) {
    return false
  }
  return true
}

export function renderAuthorizePage({ query, error = '' }) {
  const params = new URLSearchParams(query)
  const hidden = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'code_challenge', 'code_challenge_method', 'resource']
    .map((key) => {
      const value = params.get(key) || ''
      return `<input type="hidden" name="${key}" value="${escapeAttr(value)}" />`
    })
    .join('\n')

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Autorizar Escarlet Blog CMS</title>
  <style>
    :root { font-family: system-ui, sans-serif; color: #1c1c1a; background: #f4f1eb; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1rem; }
    .card { width: min(440px, 100%); background: #fff; border: 1px solid #e2ddd3; border-radius: 14px; padding: 1.5rem; box-shadow: 0 8px 24px rgba(21,41,31,.08); }
    h1 { margin: 0 0 .4rem; font-size: 1.25rem; }
    p { color: #666; line-height: 1.5; }
    label { display: block; font-size: .85rem; font-weight: 600; margin: 1rem 0 .35rem; }
    input[type=password] { width: 100%; box-sizing: border-box; padding: .65rem .75rem; border: 1px solid #ccc; border-radius: 8px; font: inherit; }
    button { margin-top: 1rem; width: 100%; border: 0; border-radius: 8px; padding: .7rem 1rem; background: #2d6a4f; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
    .err { color: #b42318; font-size: .9rem; margin-top: .75rem; }
  </style>
</head>
<body>
  <form class="card" method="post" action="/oauth/authorize">
    <h1>Autorizar ChatGPT</h1>
    <p>Pega el token de administración del CMS para conectar el MCP de Escarlet Blog.</p>
    ${hidden}
    <label for="admin_token">ADMIN_TOKEN</label>
    <input id="admin_token" name="admin_token" type="password" autocomplete="current-password" required />
    ${error ? `<p class="err">${escapeAttr(error)}</p>` : ''}
    <button type="submit">Autorizar</button>
  </form>
</body>
</html>`
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export async function handleAuthorizeGet(url) {
  const clientId = url.searchParams.get('client_id') || ''
  const redirectUri = url.searchParams.get('redirect_uri') || ''
  const responseType = url.searchParams.get('response_type') || ''
  const codeChallenge = url.searchParams.get('code_challenge') || ''
  const method = url.searchParams.get('code_challenge_method') || ''

  if (responseType !== 'code') {
    return { status: 400, html: renderAuthorizePage({ query: url.searchParams, error: 'response_type debe ser code' }) }
  }
  if (!codeChallenge || method !== 'S256') {
    return { status: 400, html: renderAuthorizePage({ query: url.searchParams, error: 'Se requiere PKCE S256' }) }
  }

  try {
    const client = await resolveClient(clientId)
    if (!isAllowedRedirect(redirectUri, client.redirect_uris)) {
      return { status: 400, html: renderAuthorizePage({ query: url.searchParams, error: 'redirect_uri no permitido' }) }
    }
  } catch (error) {
    return { status: 400, html: renderAuthorizePage({ query: url.searchParams, error: error.message }) }
  }

  return { status: 200, html: renderAuthorizePage({ query: url.searchParams }) }
}

export async function handleAuthorizePost(body) {
  const clientId = String(body.client_id || '')
  const redirectUri = String(body.redirect_uri || '')
  const state = String(body.state || '')
  const codeChallenge = String(body.code_challenge || '')
  const method = String(body.code_challenge_method || '')
  const resource = String(body.resource || getResource())
  const token = String(body.admin_token || '')
  const query = new URLSearchParams(body)

  if (!safeEqual(token, adminToken())) {
    return {
      status: 401,
      html: renderAuthorizePage({ query, error: 'Token incorrecto' })
    }
  }

  if (method !== 'S256' || !codeChallenge) {
    return { status: 400, html: renderAuthorizePage({ query, error: 'PKCE S256 obligatorio' }) }
  }

  const client = await resolveClient(clientId)
  if (!isAllowedRedirect(redirectUri, client.redirect_uris)) {
    return { status: 400, html: renderAuthorizePage({ query, error: 'redirect_uri no permitido' }) }
  }

  const code = randomToken(24)
  const codes = readJson('codes.json', {})
  cleanupExpired(codes)
  codes[code] = {
    clientId,
    redirectUri,
    codeChallenge,
    resource,
    scope: String(body.scope || SCOPE),
    expiresAt: Date.now() + CODE_TTL_MS
  }
  writeJson('codes.json', codes)

  const redirect = new URL(redirectUri)
  redirect.searchParams.set('code', code)
  if (state) redirect.searchParams.set('state', state)
  redirect.searchParams.set('iss', getIssuer())

  return { status: 302, location: redirect.toString() }
}

export async function handleToken(body) {
  const grantType = String(body.grant_type || '')
  if (grantType === 'refresh_token') {
    return handleRefresh(body)
  }
  if (grantType !== 'authorization_code') {
    return { status: 400, json: { error: 'unsupported_grant_type' } }
  }

  const code = String(body.code || '')
  const redirectUri = String(body.redirect_uri || '')
  const clientId = String(body.client_id || '')
  const verifier = String(body.code_verifier || '')
  const resource = String(body.resource || getResource())

  const codes = readJson('codes.json', {})
  cleanupExpired(codes)
  const item = codes[code]
  if (!item) return { status: 400, json: { error: 'invalid_grant' } }
  if (item.expiresAt <= Date.now()) {
    delete codes[code]
    writeJson('codes.json', codes)
    return { status: 400, json: { error: 'invalid_grant' } }
  }
  if (item.clientId !== clientId || item.redirectUri !== redirectUri) {
    return { status: 400, json: { error: 'invalid_grant' } }
  }
  if (sha256Base64Url(verifier) !== item.codeChallenge) {
    return { status: 400, json: { error: 'invalid_grant' } }
  }

  delete codes[code]
  writeJson('codes.json', codes)

  const accessToken = randomToken(32)
  const refreshToken = randomToken(32)
  const expiresIn = Math.floor(TOKEN_TTL_MS / 1000)
  const tokens = readJson('tokens.json', {})
  cleanupExpired(tokens)
  const record = {
    clientId,
    resource: item.resource || resource,
    scope: item.scope || SCOPE,
    expiresAt: Date.now() + TOKEN_TTL_MS,
    refreshOf: null
  }
  tokens[accessToken] = record
  tokens[refreshToken] = {
    ...record,
    expiresAt: Date.now() + TOKEN_TTL_MS * 2,
    refreshOf: accessToken,
    isRefresh: true
  }
  writeJson('tokens.json', tokens)

  return {
    status: 200,
    json: {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: item.scope || SCOPE
    }
  }
}

function handleRefresh(body) {
  const refreshToken = String(body.refresh_token || '')
  const clientId = String(body.client_id || '')
  const tokens = readJson('tokens.json', {})
  cleanupExpired(tokens)
  const item = tokens[refreshToken]
  if (!item?.isRefresh) return { status: 400, json: { error: 'invalid_grant' } }
  if (item.clientId !== clientId) return { status: 400, json: { error: 'invalid_grant' } }
  if (item.expiresAt <= Date.now()) {
    delete tokens[refreshToken]
    writeJson('tokens.json', tokens)
    return { status: 400, json: { error: 'invalid_grant' } }
  }

  const accessToken = randomToken(32)
  tokens[accessToken] = {
    clientId,
    resource: item.resource || getResource(),
    scope: item.scope || SCOPE,
    expiresAt: Date.now() + TOKEN_TTL_MS,
    refreshOf: null
  }
  writeJson('tokens.json', tokens)
  return {
    status: 200,
    json: {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: Math.floor(TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope: item.scope || SCOPE
    }
  }
}

export async function handleRegister(body) {
  const clientId = randomToken(16)
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : []
  if (!redirectUris.length) {
    return { status: 400, json: { error: 'invalid_client_metadata', error_description: 'redirect_uris requerido' } }
  }
  const clients = readJson('clients.json', {})
  clients[clientId] = {
    client_id: clientId,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    source: 'dcr',
    client_name: String(body.client_name || 'chatgpt-connector')
  }
  writeJson('clients.json', clients)
  return {
    status: 201,
    json: {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: 'none',
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code']
    }
  }
}

export function parseFormBody(raw) {
  const params = new URLSearchParams(String(raw || ''))
  const out = {}
  for (const [key, value] of params.entries()) out[key] = value
  return out
}
