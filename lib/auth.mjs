import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { listSiteHandles, loadSiteConfig, saveSiteConfig, publicSiteConfig } from './site-config.mjs'
import { resolveOAuthAccessToken } from './oauth-mcp.mjs'
import { isProductRestructureV1 } from './product-flags.mjs'
import { resolveSessionBearer } from './access-tokens.mjs'
import { resolveUserAccessToken, getPasswordUserById } from './human-auth.mjs'
import { getPgPool, runCoreMigrations } from './pg.mjs'

function adminToken() {
  return String(process.env.ADMIN_TOKEN || '').trim()
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export const SESSION_ROLES = ['admin', 'agency_admin', 'client', 'client_mcp', 'owner', 'editor', 'author', 'viewer']

/** Canonical workspace role used by the v2 domain regardless of legacy token kind. */
export function workspaceRoleForAuth(authOrRole) {
  const role = typeof authOrRole === 'string' ? authOrRole : authOrRole?.role
  if (role === 'admin') return 'admin'
  if (role === 'agency_admin') return 'owner'
  if (role === 'owner') return 'owner'
  if (role === 'editor') return 'editor'
  if (role === 'author') return 'author'
  if (role === 'viewer') return 'viewer'
  return 'editor'
}

const CLIENT_CAPABILITIES = [
  'posts:read',
  'posts:write',
  'posts:review_feedback',
  'brand:limited',
  'social_pack:read',
  'quota:read',
  'brand_kit_access',
  'review_content'
]

const AGENCY_CAPABILITIES = [
  ...CLIENT_CAPABILITIES,
  'posts:publish_live',
  'brand:full',
  'ops:site',
  'ops:rebuild',
  'quota:override',
  'approve_content',
  'schedule_content',
  'manage_connections',
  'manage_members',
  'manage_billing',
  'content_publishing',
  'blog_publishing',
  'presentation_generation'
]

const ADMIN_CAPABILITIES = [...AGENCY_CAPABILITIES, 'ops:global', 'sites:create']

export function capabilitiesForRole(role) {
  if (role === 'client_mcp') return [
    ...CLIENT_CAPABILITIES.filter((c) => c !== 'brand:limited'),
    'brand:full',
    'posts:publish_live',
    'content_publishing',
    'blog_publishing',
    'presentation_generation',
    'approve_content',
    'schedule_content'
  ]
  if (role === 'admin') return [...ADMIN_CAPABILITIES]
  if (role === 'owner' || role === 'agency_admin') return [...AGENCY_CAPABILITIES]
  if (role === 'editor') return [...CLIENT_CAPABILITIES, 'approve_content', 'schedule_content', 'content_publishing', 'blog_publishing']
  if (role === 'author' || role === 'client' || role === 'site') return [...CLIENT_CAPABILITIES.filter((capability) => capability !== 'posts:publish_live'), 'content_publishing']
  if (role === 'viewer') return ['posts:read', 'quota:read']
  return []
}

/** Site-scoped roles (legacy `site` + V1 client/agency_admin). */
export function isSiteScopedRole(role) {
  return role === 'site' || role === 'client' || role === 'client_mcp' || role === 'agency_admin' || role === 'owner' || role === 'editor' || role === 'author' || role === 'viewer'
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
  if (auth.userId) {
    const user = getPasswordUserById(auth.userId)
    // During the JSON → Postgres cutover, canonical workspace members may not
    // have a legacy users.json row. Keep the Postgres identity in that case;
    // legacy user tokens still fail closed when their row is missing.
    if (!user && !auth.workspaceId) return null
    if (user && (user.disabled || !SESSION_ROLES.includes(user.role))) return null
    if (user) auth = { ...auth, role: user.role, site: user.site, sites: user.sites, email: user.email }
  }
  return { ...auth, capabilities: capabilitiesForRole(auth.role) }
}

export function resolveRequestAuth(req, url) {
  return resolveAuth(extractBearerOrCookie(req, url))
}

/**
 * Resolve canonical Postgres sessions/tokens after the legacy adapters. The
 * synchronous resolver remains for old JSON routes, while v2 and MCP can use
 * this async path to share one workspace identity across every transport.
 */
export async function resolveRequestAuthAsync(req, url) {
  const rawToken = extractBearerOrCookie(req, url)
  const legacy = resolveAuth(rawToken)
  if (legacy || !rawToken || !String(process.env.DATABASE_URL || '').trim()) return legacy
  const pool = await getPgPool()
  if (!pool) return null
  await runCoreMigrations()
  const tokenHash = createHash('sha256').update(String(rawToken)).digest('hex')
  const result = await pool.query(`
    SELECT user_id AS "userId",workspace_id AS "workspaceId",token_type AS "tokenType"
    FROM tokens
    WHERE token_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>NOW())
    UNION ALL
    SELECT user_id AS "userId",workspace_id AS "workspaceId",'session' AS "tokenType"
    FROM sessions
    WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>NOW()
    LIMIT 1
  `, [tokenHash])
  if (!result.rowCount) return null
  const identity = result.rows[0]
  const member = await pool.query('SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 LIMIT 1', [identity.workspaceId, identity.userId])
  if (!member.rowCount) return null
  const sites = await pool.query(`SELECT s.id,s.handle FROM workspace_member_sites wms JOIN workspace_members wm ON wm.id=wms.member_id JOIN sites s ON s.id=wms.site_id WHERE wm.workspace_id=$1 AND wm.user_id=$2 ORDER BY s.handle`, [identity.workspaceId, identity.userId])
  return withCapabilities({ userId: identity.userId, workspaceId: identity.workspaceId, role: member.rows[0].role, sites: sites.rows.map((site) => site.handle), site: sites.rows[0]?.handle || undefined, tokenType: identity.tokenType })
}

export function isSuperAdmin(auth) {
  return auth?.role === 'admin'
}

/** Agency ops (Coolify, webhooks, brand secrets, plan edits). */
export function isAgencyOrAdmin(auth) {
  return auth?.role === 'admin' || auth?.role === 'agency_admin' || auth?.role === 'owner'
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
  let humanUser = null
  if (auth.userId && isProductRestructureV1()) {
    try {
      humanUser = getPasswordUserById(auth.userId)
    } catch {
      humanUser = null
    }
  }
  const extras = {
    mustSetPassword: liveMustSetPassword(auth),
    userId: auth.userId || null,
    email: humanUser?.email || auth.email || null,
    displayName: humanUser?.displayName || '',
    bio: humanUser?.bio || '',
    avatarUrl: humanUser?.avatarDataUrl || humanUser?.avatarUrl || '',
    profileComplete: Boolean(humanUser?.profileCompletedAt),
    allowPublishingAs: Boolean(humanUser?.allowPublishingAs),
    // Never expose the token itself in the session. The user can request it
    // once from the profile endpoint and only receives a short hint here.
    hasLoginToken: Boolean(humanUser?.loginToken),
    loginTokenHint: humanUser?.loginToken ? hashTokenHint(humanUser.loginToken) : ''
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
