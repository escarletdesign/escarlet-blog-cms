import * as oidc from 'openid-client'
import { sanitizeNext } from './embed-session.mjs'

const TRANSACTION_TTL_MS = 10 * 60 * 1000
const transactions = new Map()
let discoveryPromise = null

function text(value) {
  return String(value || '').trim()
}

function normalizeIssuer(value) {
  const raw = text(value)
  if (!raw) return ''
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    return url.protocol === 'https:' ? url.toString().replace(/\/$/, '') : ''
  } catch {
    return ''
  }
}

function validHttps(value) {
  try { return new URL(value).protocol === 'https:' } catch { return false }
}

export function getAuth0UiConfig() {
  const issuer = normalizeIssuer(process.env.AUTH0_UI_ISSUER || process.env.AUTH0_DOMAIN)
  const clientId = text(process.env.AUTH0_CLIENT_ID)
  const clientSecret = text(process.env.AUTH0_CLIENT_SECRET)
  const callbackUrl = text(process.env.AUTH0_UI_CALLBACK_URL || `${process.env.CMS_PUBLIC_URL || ''}/api/auth0/callback`)
  const logoutUrl = text(process.env.AUTH0_UI_LOGOUT_URL || `${process.env.CMS_PUBLIC_URL || ''}/app`)
  const enabled = text(process.env.AUTH0_UI_ENABLED) === '1'
  const error = !enabled
    ? null
    : !issuer || !clientId || !clientSecret
      ? 'AUTH0_DOMAIN, AUTH0_CLIENT_ID y AUTH0_CLIENT_SECRET son obligatorios.'
      : !validHttps(issuer) || !validHttps(callbackUrl) || !validHttps(logoutUrl)
        ? 'El issuer, callback y logout de Auth0 deben usar HTTPS.'
        : null
  return Object.freeze({
    enabled: enabled && !error,
    configured: enabled,
    issuer,
    clientId,
    clientSecret,
    callbackUrl,
    logoutUrl,
    userIdClaim: text(process.env.AUTH0_UI_USER_ID_CLAIM || 'https://escarlet.design/user_id'),
    error
  })
}

function prune() {
  const now = Date.now()
  for (const [state, transaction] of transactions) {
    if (transaction.expiresAt <= now) transactions.delete(state)
  }
}

async function discover(config) {
  if (!config.enabled) return null
  if (!discoveryPromise) {
    discoveryPromise = oidc.discovery(new URL(config.issuer), config.clientId, config.clientSecret)
      .catch((error) => {
        discoveryPromise = null
        throw error
      })
  }
  return discoveryPromise
}

export async function createAuth0Login({ next = '/' } = {}) {
  const config = getAuth0UiConfig()
  if (!config.enabled) {
    const error = new Error(config.error || 'El login Auth0 de la aplicación no está configurado.')
    error.status = 503
    throw error
  }
  prune()
  const codeVerifier = oidc.randomPKCECodeVerifier()
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier)
  const state = oidc.randomState()
  const nonce = oidc.randomNonce()
  const transaction = {
    codeVerifier,
    nonce,
    next: sanitizeNext(next) || '/app',
    expiresAt: Date.now() + TRANSACTION_TTL_MS
  }
  transactions.set(state, transaction)
  const client = await discover(config)
  const url = oidc.buildAuthorizationUrl(client, {
    redirect_uri: config.callbackUrl,
    response_type: 'code',
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  })
  return { url, state, expiresAt: transaction.expiresAt }
}

export async function completeAuth0Login({ callbackUrl, stateCookie }) {
  const config = getAuth0UiConfig()
  if (!config.enabled) {
    const error = new Error(config.error || 'El login Auth0 de la aplicación no está configurado.')
    error.status = 503
    throw error
  }
  const state = new URL(callbackUrl).searchParams.get('state') || ''
  const transaction = transactions.get(state)
  transactions.delete(state)
  if (!state || !stateCookie || state !== stateCookie || !transaction || transaction.expiresAt <= Date.now()) {
    const error = new Error('La transacción de login Auth0 no es válida o ha caducado.')
    error.status = 400
    throw error
  }
  const client = await discover(config)
  const tokens = await oidc.authorizationCodeGrant(client, new URL(callbackUrl), {
    pkceCodeVerifier: transaction.codeVerifier,
    expectedState: state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true
  })
  const claims = tokens.claims() || {}
  let profile = claims
  if (!profile.email && tokens.access_token) {
    profile = await oidc.fetchUserInfo(client, tokens.access_token, claims.sub)
  }
  return {
    next: transaction.next,
    subject: text(profile.sub),
    email: text(profile.email).toLowerCase(),
    userId: text(profile[config.userIdClaim]),
    emailVerified: profile.email_verified === true
  }
}

export function auth0LogoutUrl() {
  const config = getAuth0UiConfig()
  if (!config.enabled) return config.logoutUrl || '/app'
  const url = new URL('/v2/logout', `${config.issuer}/`)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('returnTo', config.logoutUrl)
  return url.toString()
}

export function auth0TransactionCookie(state, { clear = false } = {}) {
  const secure = process.env.NODE_ENV === 'production' || String(process.env.CMS_PUBLIC_URL || '').startsWith('https:') ? '; Secure' : ''
  return clear
    ? `auth0_tx=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
    : `auth0_tx=${encodeURIComponent(state)}; Path=/; Max-Age=${Math.ceil(TRANSACTION_TTL_MS / 1000)}; HttpOnly; SameSite=Lax${secure}`
}

export function auth0UiStatus() {
  const config = getAuth0UiConfig()
  return { configured: config.configured, enabled: config.enabled, error: config.error }
}
