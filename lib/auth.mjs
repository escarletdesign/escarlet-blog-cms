import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { listSiteHandles, loadSiteConfig, saveSiteConfig, publicSiteConfig } from './site-config.mjs'
import { isValidAccessToken } from './oauth-mcp.mjs'

function adminToken() {
  return process.env.ADMIN_TOKEN || 'cambia-esto'
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
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
 * @returns {{ role: 'admin' } | { role: 'site', site: string } | null}
 */
export function resolveAuth(rawToken) {
  const token = String(rawToken || '').trim()
  if (!token) return null
  if (safeEqual(token, adminToken())) return { role: 'admin' }
  if (isValidAccessToken(token)) return { role: 'admin', via: 'oauth' }

  for (const handle of listSiteHandles()) {
    const cfg = loadSiteConfig(handle)
    const siteToken = cfg?.siteAccessToken
    if (siteToken && safeEqual(token, siteToken)) {
      return { role: 'site', site: handle }
    }
  }
  return null
}

export function resolveRequestAuth(req, url) {
  return resolveAuth(extractBearerOrCookie(req, url))
}

export function isSuperAdmin(auth) {
  return auth?.role === 'admin'
}

export function canAccessSite(auth, site) {
  if (!auth || !site) return false
  if (auth.role === 'admin') return true
  return auth.role === 'site' && auth.site === site
}

export function allowedSiteHandles(auth) {
  if (!auth) return []
  if (auth.role === 'admin') return listSiteHandles()
  if (auth.role === 'site') return [auth.site]
  return []
}

export function assertSiteAccess(auth, site) {
  if (canAccessSite(auth, site)) return
  const err = new Error(
    auth?.role === 'site'
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

export function generateSiteAccessToken() {
  return `site_${randomBytes(24).toString('base64url')}`
}

export function hashTokenHint(token) {
  if (!token) return ''
  const raw = String(token)
  return `…${raw.slice(-4)}`
}

export function publicAuthSession(auth) {
  if (!auth) return null
  if (auth.role === 'admin') {
    return {
      role: 'admin',
      site: null,
      sites: listSiteHandles(),
      canCreateSites: true,
      canManageAllSites: true
    }
  }
  return {
    role: 'site',
    site: auth.site,
    sites: [auth.site],
    canCreateSites: false,
    canManageAllSites: false
  }
}

export function publicSiteConfigForAuth(config, auth) {
  const base = publicSiteConfig(config)
  if (!base) return null
  const hasSiteAccessToken = Boolean(config?.siteAccessToken)
  const out = {
    ...base,
    siteAccessToken: undefined,
    hasSiteAccessToken,
    siteAccessTokenHint: hasSiteAccessToken ? hashTokenHint(config.siteAccessToken) : ''
  }
  if (!isSuperAdmin(auth)) {
    // Clientes no ven ni regeneran tokens de acceso ni Coolify secrets extras
    delete out.hasCoolifyApiToken
    delete out.coolifyApiTokenHint
    delete out.rebuildWebhookUrl
    delete out.hasSiteAccessToken
    delete out.siteAccessTokenHint
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
