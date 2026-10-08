import {
  createHash,
  createPublicKey,
  randomBytes,
  createVerify,
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
import { resolveSessionBearer } from './access-tokens.mjs'
import { resolveUserAccessToken, getPasswordUserById } from './human-auth.mjs'
import { CANONICAL_CMS_URL, canonicalCmsPublicUrl } from './cms-url.mjs'

const CODE_TTL_MS = 10 * 60 * 1000
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SCOPE = 'mcp'
// Human users can connect their own access token to MCP. Keep this list
// aligned with the account roles accepted by the password-auth system while
// still excluding transient invite/review identities.
const OAUTH_AUTH_ROLES = new Set([
  'admin',
  'agency_admin',
  'client',
  'owner',
  'editor',
  'author',
  'viewer'
])
const CHATGPT_REDIRECTS = new Set([
  'https://chatgpt.com/connector_platform_oauth_redirect',
  'https://chatgpt.com/connector/oauth',
  'https://chat.openai.com/connector_platform_oauth_redirect'
])
const CLAUDE_REDIRECTS = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback'
])
const DEFAULT_PUBLIC_REDIRECTS = new Set([
  ...CHATGPT_REDIRECTS,
  ...CLAUDE_REDIRECTS
])
const AUTH0_JWKS_CACHE_TTL_MS = 10 * 60 * 1000
const AUTH0_CLOCK_SKEW_SECONDS = 60
const AUTH0_NAMESPACE = 'https://escarlet.design/'
const AUTH0_MCP_PERMISSIONS = new Set([
  'brand:read',
  'asset:read',
  'asset:write',
  'copy:validate',
  'generation:prepare',
  'generation:provenance',
  'generation:run',
  'production:motion',
  'publication:read',
  'publication:write',
  'publication:publish'
])

let auth0JwksCache = null

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
  if (fromEnv && !/localhost|127\.0\.0\.1/i.test(fromEnv)) return canonicalCmsPublicUrl(fromEnv)
  return canonicalCmsPublicUrl(process.env.CMS_PUBLIC_URL_FALLBACK || CANONICAL_CMS_URL)
}

function envText(name) {
  return String(process.env[name] || '').trim()
}

function normalizeIssuer(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function claimName(value, fallback) {
  const name = envText(value)
  return name || fallback
}

function validHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Auth0 remains opt-in. A partial configuration is considered invalid and
 * never downgrades to the local PAT/OAuth adapter for a JWT bearer token.
 */
export function getAuth0Config() {
  const issuer = normalizeIssuer(process.env.AUTH0_ISSUER)
  const audience = envText('AUTH0_AUDIENCE')
  const explicitlyDisabled = envText('AUTH0_ENABLED') === '0'
  const configured = !explicitlyDisabled && (envText('AUTH0_ENABLED') === '1' || Boolean(issuer || audience || envText('AUTH0_JWKS_URL')))
  const jwksUrl = envText('AUTH0_JWKS_URL') || (issuer ? `${issuer}/.well-known/jwks.json` : '')
  const namespace = `${envText('AUTH0_CLAIM_NAMESPACE') || AUTH0_NAMESPACE}`.replace(/\/+$/, '') + '/'
  const error = !configured
    ? null
    : !issuer || !audience
      ? 'AUTH0_ISSUER y AUTH0_AUDIENCE son obligatorios.'
      : !validHttpsUrl(issuer) || !validHttpsUrl(jwksUrl)
        ? 'AUTH0_ISSUER y AUTH0_JWKS_URL deben usar HTTPS.'
        : !validHttpsUrl(namespace)
          ? 'AUTH0_CLAIM_NAMESPACE debe ser un namespace HTTPS.'
          : null
  return Object.freeze({
    enabled: configured && !error,
    configured,
    issuer,
    audience,
    jwksUrl,
    namespace,
    claims: Object.freeze({
      userId: claimName('AUTH0_USER_ID_CLAIM', `${namespace}user_id`),
      workspaceId: claimName('AUTH0_WORKSPACE_ID_CLAIM', `${namespace}workspace_id`),
      workspaceIds: claimName('AUTH0_WORKSPACE_IDS_CLAIM', `${namespace}workspace_ids`),
      siteIds: claimName('AUTH0_SITE_IDS_CLAIM', `${namespace}site_ids`),
      sites: claimName('AUTH0_SITES_CLAIM', `${namespace}sites`),
      role: claimName('AUTH0_ROLE_CLAIM', `${namespace}role`),
      permissions: claimName('AUTH0_PERMISSIONS_CLAIM', 'permissions')
    }),
    error
  })
}

function decodeJwtPart(value) {
  try {
    const raw = Buffer.from(String(value || ''), 'base64url').toString('utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function normalizeClaimList(value, { max = 100 } = {}) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : []
  return [...new Set(values.map((entry) => String(entry || '').trim()).filter(Boolean))].slice(0, max)
}

function auth0AudienceMatches(value, expected) {
  const audiences = Array.isArray(value) ? value : [value]
  return audiences.some((entry) => String(entry || '') === expected)
}

function cacheKeys(jwksUrl, keys) {
  auth0JwksCache = { jwksUrl, keys, expiresAt: Date.now() + AUTH0_JWKS_CACHE_TTL_MS }
  return keys
}

async function fetchAuth0Keys(config, { force = false } = {}) {
  if (!force && auth0JwksCache?.jwksUrl === config.jwksUrl && auth0JwksCache.expiresAt > Date.now()) {
    return auth0JwksCache.keys
  }
  const response = await fetch(config.jwksUrl, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(8000)
  })
  if (!response.ok) throw new Error(`Auth0 JWKS respondió ${response.status}.`)
  const document = await response.json()
  const keys = Array.isArray(document?.keys)
    ? document.keys.filter((key) => key?.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig') && key.n && key.e && key.kid)
    : []
  if (!keys.length) throw new Error('Auth0 JWKS no contiene claves RSA de firma.')
  return cacheKeys(config.jwksUrl, keys)
}

function verifyJwtSignature(token, header, keys) {
  const key = keys.find((entry) => entry.kid === header.kid)
  if (!key) return false
  try {
    const verifier = createVerify('RSA-SHA256')
    const [encodedHeader, encodedPayload, encodedSignature] = String(token).split('.')
    verifier.update(`${encodedHeader}.${encodedPayload}`)
    verifier.end()
    return verifier.verify(createPublicKey({ key, format: 'jwk' }), Buffer.from(encodedSignature, 'base64url'))
  } catch {
    return false
  }
}

function jwtClaims(token, config) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return null
  const header = decodeJwtPart(parts[0])
  const payload = decodeJwtPart(parts[1])
  if (!header || !payload || header.alg !== 'RS256' || !header.kid) return null
  if (!payload.sub || normalizeIssuer(payload.iss) !== config.issuer || !auth0AudienceMatches(payload.aud, config.audience)) return null
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now - AUTH0_CLOCK_SKEW_SECONDS) return null
  if (payload.nbf !== undefined && Number(payload.nbf) > now + AUTH0_CLOCK_SKEW_SECONDS) return null
  if (payload.iat !== undefined && Number(payload.iat) > now + AUTH0_CLOCK_SKEW_SECONDS) return null
  return { header, payload }
}

/**
 * Verify an Auth0 JWT and return only tenancy claims needed by the control
 * plane. No JWT is accepted when Auth0 is disabled or partially configured.
 */
export async function resolveAuth0AccessToken(token) {
  const raw = String(token || '').trim()
  const config = getAuth0Config()
  if (!config.enabled || !raw || raw.split('.').length !== 3) return null
  const claims = jwtClaims(raw, config)
  if (!claims) return null
  let keys
  try {
    keys = await fetchAuth0Keys(config)
  } catch {
    return null
  }
  if (!verifyJwtSignature(raw, claims.header, keys)) {
    try {
      keys = await fetchAuth0Keys(config, { force: true })
    } catch {
      return null
    }
    if (!verifyJwtSignature(raw, claims.header, keys)) return null
  }

  const payload = claims.payload
  const workspaceId = String(payload[config.claims.workspaceId] || '').trim()
  const workspaceIds = normalizeClaimList(payload[config.claims.workspaceIds], { max: 10 })
  if (!workspaceId && workspaceIds.length !== 1) return null
  if (workspaceId && workspaceIds.length && !workspaceIds.includes(workspaceId)) return null
  const selectedWorkspaceId = workspaceId || workspaceIds[0]
  const siteIds = normalizeClaimList(payload[config.claims.siteIds])
  const sites = normalizeClaimList(payload[config.claims.sites])
  const permissions = normalizeClaimList([
    ...normalizeClaimList(payload[config.claims.permissions]),
    ...normalizeClaimList(payload.scope)
  ]).filter((permission) => AUTH0_MCP_PERMISSIONS.has(permission))
  return {
    via: 'auth0',
    subject: String(payload.sub),
    userId: String(payload[config.claims.userId] || payload.sub).trim(),
    email: typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : undefined,
    workspaceId: selectedWorkspaceId,
    siteIds,
    sites,
    role: String(payload[config.claims.role] || 'viewer').trim().toLowerCase() || 'viewer',
    ...(permissions.length ? { permissions } : {})
  }
}

function adminToken() {
  return String(process.env.ADMIN_TOKEN || '').trim()
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
  if (CLAUDE_REDIRECTS.has(uri)) return true
  if (uri.startsWith('https://chatgpt.com/connector/oauth/')) return true
  if (uri.startsWith('https://chat.openai.com/connector/oauth/')) return true
  if (uri.startsWith('https://claude.ai/api/mcp/auth_callback')) return true
  if (uri.startsWith('https://claude.com/api/mcp/auth_callback')) return true
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
    redirect_uris: [...DEFAULT_PUBLIC_REDIRECTS],
    token_endpoint_auth_method: 'none',
    source: 'implicit'
  }
}

export function getIssuer() {
  return publicBase()
}

export function getResource(resourcePath = '/mcp/v3') {
  const suffix = String(resourcePath || '/mcp/v3').startsWith('/') ? String(resourcePath || '/mcp/v3') : `/${resourcePath}`
  return `${publicBase()}${suffix}`
}

export function isSupportedResource(resource) {
  const value = String(resource || '').trim()
  if (!value) return false
  const auth0 = getAuth0Config()
  return value === getResource() || value === getIssuer() || (auth0.enabled && value === auth0.audience)
}

export function protectedResourceMetadata({ resourcePath = '/mcp/v3' } = {}) {
  const issuer = getIssuer()
  const auth0 = getAuth0Config()
  return {
    resource: auth0.enabled ? auth0.audience : getResource(resourcePath),
    authorization_servers: [auth0.enabled ? auth0.issuer : issuer],
    scopes_supported: auth0.enabled ? [...AUTH0_MCP_PERMISSIONS] : [SCOPE],
    bearer_methods_supported: ['header'],
    resource_documentation: `${issuer}/app`
  }
}

export function authorizationServerMetadata() {
  const issuer = getIssuer()
  const auth0 = getAuth0Config()
  if (auth0.enabled) {
    return {
      issuer: auth0.issuer,
      authorization_endpoint: `${auth0.issuer}/authorize`,
      token_endpoint: `${auth0.issuer}/oauth/token`,
      jwks_uri: auth0.jwksUrl,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [...AUTH0_MCP_PERMISSIONS],
      authorization_response_iss_parameter_supported: true
    }
  }
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
  return `Bearer realm="escarlet-cms-v2", resource_metadata="${meta}", scope="${SCOPE}"`
}

/**
 * Resolve an issued OAuth access token to the same user that authorized the
 * connector. User grants keep only authUserId; memberships are refreshed by
 * the request resolver instead of being copied into the OAuth token.
 * @returns {{ role: 'admin'|'agency_admin'|'client'|'owner'|'editor'|'author'|'viewer', site?: string, sites?: string[], userId?: string, via: 'oauth' } | null}
 */
export function resolveOAuthAccessToken(token) {
  if (!token) return null
  const tokens = readJson('tokens.json', {})
  const changed = cleanupExpired(tokens)
  if (changed) writeJson('tokens.json', tokens)
  const item = tokens[token]
  if (!item || item.isRefresh) return null
  if (item.authUserId) {
    const user = getPasswordUserById(item.authUserId)
    if (!user) return null
    item.authRole = user.role
    item.authSite = user.site
    item.authSites = user.sites
  }
  if (item.expiresAt <= Date.now()) {
    delete tokens[token]
    writeJson('tokens.json', tokens)
    return null
  }
  if (item.resource && !isSupportedResource(item.resource)) {
    return null
  }
  const role = item.authRole
  if (!OAUTH_AUTH_ROLES.has(role)) return null
  const sites = Array.isArray(item.authSites) && item.authSites.length
    ? item.authSites.filter(Boolean)
    : item.authSite
      ? [item.authSite]
      : []
  return {
    role,
    site: item.authSite || sites[0] || undefined,
    ...(sites.length ? { sites } : {}),
    ...(item.authUserId ? { userId: item.authUserId } : {}),
    ...(item.authEmail ? { email: item.authEmail } : {}),
    via: 'oauth'
  }
}

export function isValidAccessToken(token) {
  if (!token) return false
  if (safeEqual(token, adminToken())) return true
  return Boolean(resolveOAuthAccessToken(token))
}

function resolveLoginToken(token) {
  const raw = String(token || '').trim()
  if (!raw) return null
  if (safeEqual(raw, adminToken())) return { role: 'admin', site: null }
  // Human user tokens and session bearers carry the role and site list issued
  // by the account system. A one-shot magic token is intentionally not
  // accepted here; consume it in /app first and use the resulting session or
  // the user's durable login token to authorize the connector.
  const user = resolveUserAccessToken(raw)
  if (user) return user
  const session = resolveSessionBearer(raw)
  if (session) return session
  return null
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
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #edf3ef; background: #101516; }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at 78% 10%, rgba(185,245,98,.16), transparent 36%), #101516; }
    .shell { width: min(100%, 520px); }
    .brand { display: flex; align-items: center; gap: 10px; margin: 0 0 16px 4px; color: #edf3ef; font-size: .96rem; font-weight: 700; letter-spacing: -.01em; }
    .mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; color: #152013; background: #b9f562; font-family: Georgia, serif; font-size: 1.28rem; font-weight: 800; }
    .card { width: 100%; background: linear-gradient(145deg, #171e1e, #121918); border: 1px solid #30403d; border-radius: 24px; padding: clamp(24px, 6vw, 42px); box-shadow: 0 30px 90px rgba(0,0,0,.34); }
    .eyebrow { margin: 0 0 10px; color: #b9f562; font-size: .7rem; font-weight: 760; letter-spacing: .13em; }
    h1 { margin: 0 0 10px; color: #edf3ef; font-size: clamp(2rem, 7vw, 3rem); letter-spacing: -.045em; line-height: 1.05; }
    .intro { margin: 0; color: #aebbb5; line-height: 1.55; }
    .info { display: grid; gap: 4px; margin: 24px 0 22px; padding: 13px 14px; border: 1px solid #405249; border-radius: 12px; background: #1a2824; }
    .info strong { color: #d0dfd7; font-size: .84rem; }
    .info span { color: #aebbb5; font-size: .78rem; line-height: 1.5; }
    label { display: grid; gap: 8px; color: #edf3ef; font-size: .88rem; font-weight: 650; }
    input[type=password] { width: 100%; min-height: 48px; box-sizing: border-box; padding: .72rem .8rem; color: #edf3ef; background: #17201e; border: 1px solid #3c4a46; border-radius: 10px; outline: 0; font: inherit; }
    input[type=password]:focus { border-color: #b9f562; box-shadow: 0 0 0 3px rgba(185,245,98,.12); }
    input::placeholder { color: #71817a; }
    button { margin-top: 19px; width: 100%; min-height: 48px; border: 1px solid #b9f562; border-radius: 10px; padding: .72rem 1rem; color: #152013; background: #b9f562; font: inherit; font-weight: 750; cursor: pointer; transition: transform .18s ease, filter .18s ease; }
    button:hover { filter: brightness(1.06); transform: translateY(-1px); }
    .footnote { margin: 20px 0 0; color: #71817a; font-size: .75rem; line-height: 1.5; }
    .err { margin: 14px 0 0; padding: 11px 12px; color: #ffb4ae; background: #33201f; border: 1px solid #69413d; border-radius: 10px; font-size: .84rem; line-height: 1.45; }
  </style>
</head>
<body>
  <main class="shell">
    <div class="brand"><span class="mark" aria-hidden="true">E</span><span>Escarlet Blog CMS</span></div>
    <form class="card" method="post" action="/oauth/authorize">
      <p class="eyebrow">CONEXIÓN MCP</p>
      <h1>Conecta tu espacio Escarlet</h1>
      <p class="intro">Autoriza ChatGPT o Claude para trabajar con las marcas que tienes asignadas.</p>
      <div class="info"><strong>Tu acceso es personal</strong><span>El MCP solo verá tus marcas y permisos actuales. Puedes revocar tu PAT desde Ajustes.</span></div>
      ${hidden}
      <label for="access_token">PAT personal</label>
      <input id="access_token" name="access_token" type="password" autocomplete="current-password" placeholder="Pega aquí tu token personal" required />
      ${error ? `<p class="err" role="alert">${escapeAttr(error)}</p>` : ''}
      <button type="submit">Continuar con este acceso</button>
      <p class="footnote">El token se usa solo para completar esta conexión segura y no se muestra en la URL.</p>
    </form>
  </main>
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
  const token = String(body.access_token || body.admin_token || '')
  const query = new URLSearchParams(body)

  if (!isSupportedResource(resource)) {
    return { status: 400, html: renderAuthorizePage({ query, error: 'resource no pertenece al MCP v3 configurado' }) }
  }

  const login = resolveLoginToken(token)
  if (!login) {
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
    authUserId: login.userId || null,
    authEmail: login.email || null,
    ...(login.userId ? {} : {
      authRole: login.role,
      authSite: login.site || null,
      authSites: Array.isArray(login.sites) ? login.sites : login.site ? [login.site] : []
    }),
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

  if (!isSupportedResource(resource)) return { status: 400, json: { error: 'invalid_target' } }

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
  if (item.resource && item.resource !== resource) {
    return { status: 400, json: { error: 'invalid_target' } }
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
    authUserId: item.authUserId || null,
    authEmail: item.authEmail || null,
    ...(item.authUserId ? {} : {
      authRole: item.authRole || 'admin',
      authSite: item.authSite || null,
      authSites: Array.isArray(item.authSites) ? item.authSites : item.authSite ? [item.authSite] : []
    }),
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
  if (item.authUserId) {
    const user = getPasswordUserById(item.authUserId)
    if (!user) return { status: 400, json: { error: 'invalid_grant' } }
    item.authRole = user.role
    item.authSite = user.site
    item.authSites = user.sites
  }
  if (!OAUTH_AUTH_ROLES.has(item.authRole)) return { status: 400, json: { error: 'invalid_grant' } }
  if (item.clientId !== clientId) return { status: 400, json: { error: 'invalid_grant' } }
  if (item.resource && !isSupportedResource(item.resource)) return { status: 400, json: { error: 'invalid_target' } }
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
    authUserId: item.authUserId || null,
    authEmail: item.authEmail || null,
    ...(item.authUserId ? {} : {
      authRole: item.authRole || 'admin',
      authSite: item.authSite || null,
      authSites: Array.isArray(item.authSites) ? item.authSites : item.authSite ? [item.authSite] : []
    }),
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
    client_name: String(body.client_name || 'escarlet-blog-connector')
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
