import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { listSiteHandles, loadSiteConfig, saveSiteConfig, publicSiteConfig } from './site-config.mjs'
import { resolveOAuthAccessToken } from './oauth-mcp.mjs'
import { isProductRestructureV1 } from './product-flags.mjs'
import { resolveSessionBearer } from './access-tokens.mjs'
import { resolveUserAccessToken, getPasswordUserById } from './human-auth.mjs'

function adminToken() {
  return process.env.ADMIN_TOKEN || 'cambia-esto'
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export const SESSION_ROLES = ['admin', 'agency_admin', 'client']

const CLIENT_CAPABILITIES = [
  'posts:read',
  'posts:write',
  'posts:review_feedback',
  'brand:limited',
  'social_pack:read',
  'quota:read'
]

const AGENCY_CAPABILITIES = [
  ...CLIENT_CAPABILITIES,
  'posts:publish_live',
  'brand:full',
  'ops:site',
  'ops:rebuild',
  'quota:override'
]

const ADMIN_CAPABILITIES = [...AGENCY_CAPABILITIES, 'ops:global', 'sites:create']

export function capabilitiesForRole(role) {
  if (role === 'admin') return [...ADMIN_CAPABILITIES]
  if (role === 'agency_admin') return [...AGENCY_CAPABILITIES]
  if (role === 'client' || role === 'site') return [...CLIENT_CAPABILITIES]
  return []
}

/** Site-scoped roles (legacy `site` + V1 client/agency_admin). */
export function isSiteScopedRole(role) {
  return role === 'site' || role === 'client' || role === 'agency_admin'
}

export function extractBearerOrCookie(req, url) {
  const header = req.headers.authorization || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const cookie = String(req.headers.cookie || '')
  const cookieToken = decodeURIComponent(cookie.match(/(?:^|;\s*)escarlet_cms=([^;]+)/)?.[1] || '')
  const queryToken = url?.searchParams?.get('token') || ''
  return bearer || cookieToken || queryToken || ''
}

/**
 * @returns {{ role: string, site?: string, capabilities?: string[] } | null}
 */
export function resolveAuth(rawToken) {
  const token = String(rawToken || '').trim()
  if (!token) return null
  if (safeEqual(token, adminToken())) {
    return withCapabilities({ role: 'admin' })
  }

  const sessionAuth = resolveSessionBearer(token)
  if (sessionAuth) return withCapabilities(sessionAuth)

  if (isProductRestructureV1()) {
    const userTok = resolveUserAccessToken(token)
    if (userTok) return withCapabilities(userTok)
  }

  const oauth = resolveOAuthAccessToken(token)
  if (oauth) return withCapabilities(oauth)

  for (const handle of listSiteHandles()) {
    const cfg = loadSiteConfig(handle)
    const siteToken = cfg?.siteAccessToken
    if (siteToken && safeEqual(token, siteToken)) {
      // V1 maps site token → client; legacy keeps role `site`.
      const role = isProductRestructureV1() ? 'client' : 'site'
      return withCapabilities({ role, site: handle })
    }
    const agencyToken = cfg?.agencyAccessToken
    if (agencyToken && safeEqual(token, agencyToken)) {
      return withCapabilities({ role: 'agency_admin', site: handle })
    }
  }
  return null
}

function withCapabilities(auth) {
  if (!auth) return null
  if (Array.isArray(auth.capabilities) && auth.capabilities.length) return auth
  return { ...auth, capabilities: capabilitiesForRole(auth.role) }
}

export function resolveRequestAuth(req, url) {
  return resolveAuth(extractBearerOrCookie(req, url))
}

export function isSuperAdmin(auth) {
  return auth?.role === 'admin'
}

/** Agency ops (Coolify, webhooks, brand secrets, plan edits). */
export function isAgencyOrAdmin(auth) {
  return auth?.role === 'admin' || auth?.role === 'agency_admin'
}

export function canAccessSite(auth, site) {
  if (!auth || !site) return false
  if (auth.role === 'admin') return true
  if (!isSiteScopedRole(auth.role)) return false
  const handles =
    Array.isArray(auth.sites) && auth.sites.length ? auth.sites : auth.site ? [auth.site] : []
  return handles.includes(site)
}

export function allowedSiteHandles(auth) {
  if (!auth) return []
  if (auth.role === 'admin') return listSiteHandles()
  if (isSiteScopedRole(auth.role)) {
    const requested =
      Array.isArray(auth.sites) && auth.sites.length ? auth.sites : auth.site ? [auth.site] : []
    const known = new Set(listSiteHandles())
    return requested.filter((handle) => known.has(handle))
  }
  return []
}

export function assertSiteAccess(auth, site) {
  if (canAccessSite(auth, site)) return
  const err = new Error(
    isSiteScopedRole(auth?.role)
      ? `Este token solo gestiona el sitio ${auth.site}.`
      : 'No autorizado para este sitio.'
  )
  err.status = 403
  throw err
}

export function assertSuperAdmin(auth) {
  if (isSuperAdmin(auth)) return
  const err = new Error('Solo el administrador global puede hacer esta acción.')
  err.status = 403
  throw err
}

/** Deny client (and legacy site) from agency-only ops APIs. */
export function assertAgencyOps(auth) {
  if (isAgencyOrAdmin(auth)) return
  const err = new Error('Solo agency o admin pueden hacer esta acción.')
  err.status = 403
  throw err
}

export function generateSiteAccessToken() {
  return `site_${randomBytes(24).toString('base64url')}`
}

export function generateAgencyAccessToken() {
  return `agency_${randomBytes(24).toString('base64url')}`
}

export function hashTokenHint(token) {
  if (!token) return ''
  const raw = String(token)
  return `…${raw.slice(-4)}`
}

function liveMustSetPassword(auth) {
  if (auth?.userId && isProductRestructureV1()) {
    try {
      const user = getPasswordUserById(auth.userId)
      if (user) return Boolean(user.mustSetPassword)
    } catch {
      // ignore lookup errors and fall back to the session flag
    }
  }
  return Boolean(auth?.mustSetPassword)
}

export function publicAuthSession(auth) {
  if (!auth) return null
  const capabilities = auth.capabilities || capabilitiesForRole(auth.role)
  const v1Extras = isProductRestructureV1()
    ? { productRestructureV1: true, socialPackHost: 'cms' }
    : {}
  const scopedSites =
    Array.isArray(auth.sites) && auth.sites.length ? auth.sites : auth.site ? [auth.site] : []
  const extras = {
    mustSetPassword: liveMustSetPassword(auth),
    userId: auth.userId || null
  }
  if (auth.role === 'admin') {
    return {
      role: 'admin',
      site: null,
      sites: listSiteHandles(),
      canCreateSites: true,
      canManageAllSites: true,
      capabilities,
      ...extras,
      ...v1Extras
    }
  }
  if (auth.role === 'agency_admin') {
    return {
      role: 'agency_admin',
      site: scopedSites[0] || auth.site || null,
      sites: scopedSites,
      canCreateSites: false,
      canManageAllSites: false,
      capabilities,
      ...extras,
      ...v1Extras
    }
  }
  // Legacy `site` and V1 `client`
  const publicRole = isProductRestructureV1()
    ? auth.role === 'site'
      ? 'client'
      : auth.role
    : auth.role
  return {
    role: publicRole,
    site: scopedSites[0] || auth.site,
    sites: scopedSites,
    canCreateSites: false,
    canManageAllSites: false,
    capabilities,
    ...extras,
    ...v1Extras
  }
}

export function publicSiteConfigForAuth(config, auth) {
  const base = publicSiteConfig(config)
  if (!base) return null
  const hasSiteAccessToken = Boolean(config?.siteAccessToken)
  const out = {
    ...base,
    siteAccessToken: undefined,
    agencyAccessToken: undefined,
    hasSiteAccessToken,
    siteAccessTokenHint: hasSiteAccessToken ? hashTokenHint(config.siteAccessToken) : ''
  }
  if (!isAgencyOrAdmin(auth)) {
    // Clients do not see Coolify secrets, webhooks, or token regeneration hints.
    delete out.hasCoolifyApiToken
    delete out.coolifyApiTokenHint
    delete out.rebuildWebhookUrl
    delete out.hasSiteAccessToken
    delete out.siteAccessTokenHint
    delete out.agencyAccessToken
  }
  return out
}

export function setSiteAccessToken(handle, token) {
  return saveSiteConfig(handle, { siteAccessToken: token })
}

export function clearSiteAccessToken(handle) {
  return saveSiteConfig(handle, { clearSiteAccessToken: true })
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}
