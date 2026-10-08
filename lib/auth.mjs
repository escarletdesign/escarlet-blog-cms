import { createHash, timingSafeEqual } from 'node:crypto'
import { listSiteHandles, publicSiteConfig } from './site-config.mjs'
import { getAuth0Config, resolveAuth0AccessToken, resolveOAuthAccessToken } from './oauth-mcp.mjs'
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

export const SESSION_ROLES = ['admin', 'owner', 'editor', 'author', 'viewer', 'client', 'agency_admin']

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
  'review_content'
]

// A client token is intentionally limited to the explicitly shareable kit
// files. Visual brand context is an editor capability, not an implicit side
// effect of having a site-scoped token.
const EDITOR_BRAND_CAPABILITIES = []

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
  if (role === 'admin') return [...ADMIN_CAPABILITIES]
  if (role === 'owner' || role === 'agency_admin') return [...AGENCY_CAPABILITIES, ...EDITOR_BRAND_CAPABILITIES]
  if (role === 'editor') return [...CLIENT_CAPABILITIES, ...EDITOR_BRAND_CAPABILITIES, 'approve_content', 'schedule_content', 'content_publishing', 'blog_publishing']
  if (role === 'author' || role === 'client') return [...CLIENT_CAPABILITIES.filter((capability) => capability !== 'posts:publish_live'), 'content_publishing']
  if (role === 'viewer') return ['posts:read', 'quota:read']
  return []
}

/** User roles that can be scoped to one or more current brand memberships. */
export function isSiteScopedRole(role) {
  return role === 'client' || role === 'agency_admin' || role === 'owner' || role === 'editor' || role === 'author' || role === 'viewer'
}

export function extractBearerOrCookie(req, url) {
  const header = req.headers.authorization || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const cookie = String(req.headers.cookie || '')
  const cookieToken = decodeURIComponent(cookie.match(/(?:^|;\s*)escarlet_cms=([^;]+)/)?.[1] || '')
  const queryToken = url?.searchParams?.get('token') || ''
  return bearer || cookieToken || queryToken || ''
}

function requestHost(req) {
  const raw = String(req?.headers?.host || '').trim().toLowerCase()
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    return end > 0 ? raw.slice(1, end) : raw
  }
  return raw.split(':')[0]
}

function isLoopbackAddress(address) {
  const value = String(address || '')
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1'
}

export function isLocalDevAutoLogin() {
  return process.env.NODE_ENV !== 'production' && process.env.LOCAL_AUTO_LOGIN !== '0'
}

function localDevAdminAuth(req) {
  if (!isLocalDevAutoLogin()) return null
  if (!isLoopbackAddress(req?.socket?.remoteAddress)) return null
  const host = requestHost(req)
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return null
  return withCapabilities({ role: 'admin', systemAdmin: true })
}

/**
 * @returns {{ role: string, site?: string, capabilities?: string[] } | null}
 */
export function resolveAuth(rawToken) {
  const token = String(rawToken || '').trim()
  if (!token) return null
  if (safeEqual(token, adminToken())) {
    return withCapabilities({ role: 'admin', systemAdmin: true })
  }

  const sessionAuth = resolveSessionBearer(token)
  if (sessionAuth) return withCapabilities(sessionAuth)

  if (isProductRestructureV1()) {
    const userTok = resolveUserAccessToken(token)
    if (userTok) return withCapabilities(userTok)
  }

  const oauth = resolveOAuthAccessToken(token)
  if (oauth) return withCapabilities(oauth)

  // Site and agency bearer tokens were revoked. Human and MCP access now
  // requires a personal PAT or an OAuth grant bound to a user.
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
    if (user && !auth.workspaceId) auth = { ...auth, role: user.role, site: user.site, sites: user.sites, email: user.email }
    else if (user && !auth.email) auth = { ...auth, email: user.email }
  }
  return { ...auth, capabilities: capabilitiesForRole(auth.role) }
}

export function resolveRequestAuth(req, url) {
  return resolveAuth(extractBearerOrCookie(req, url)) || localDevAdminAuth(req)
}

async function resolveAuth0Workspace(pool, external) {
  const workspaceId = String(external?.workspaceId || '').trim()
  const userId = String(external?.userId || '').trim()
  if (!workspaceId || !userId) return null
  const memberships = await pool.query(`
    SELECT wm.workspace_id AS "workspaceId", wm.role AS "workspaceRole",
           s.id AS "siteId", s.handle,
           COALESCE(wms.role, wm.role) AS "brandRole"
    FROM workspace_members wm
    JOIN users u ON u.id=wm.user_id AND u.disabled=FALSE
    JOIN sites s ON s.workspace_id=wm.workspace_id
    LEFT JOIN workspace_member_sites wms ON wms.member_id=wm.id AND wms.site_id=s.id
    WHERE wm.workspace_id=$1 AND wm.user_id=$2
      AND (wm.role IN ('owner','admin') OR wms.site_id IS NOT NULL)
    ORDER BY s.handle
  `, [workspaceId, userId])
  if (!memberships.rowCount) return null
  const claimSites = new Set([...(external.siteIds || []), ...(external.sites || [])].map((value) => String(value || '').trim()).filter(Boolean))
  const rows = claimSites.size
    ? memberships.rows.filter((row) => claimSites.has(row.siteId) || claimSites.has(row.handle))
    : memberships.rows
  if (!rows.length) return null
  const first = rows[0]
  const role = String(first.workspaceRole || '').trim().toLowerCase()
  if (!SESSION_ROLES.includes(role)) return null
  return withCapabilities({
    via: 'auth0',
    subject: external.subject,
    userId,
    email: external.email,
    workspaceId,
    role,
    workspaceRole: role,
    brandRoles: Object.fromEntries(rows.map((row) => [row.handle, row.brandRole])),
    sites: [...new Set(rows.map((row) => row.handle).filter(Boolean))],
    site: first.handle,
    ...(Array.isArray(external.permissions) && external.permissions.length ? { permissions: external.permissions } : {}),
    tokenType: 'auth0'
  })
}

/**
 * Resolve canonical Postgres sessions/tokens after the legacy adapters. The
 * synchronous resolver remains for old JSON routes, while v2 and MCP can use
 * this async path to share one workspace identity across every transport.
 */
export async function resolveRequestAuthAsync(req, url) {
  const rawToken = extractBearerOrCookie(req, url)
  const legacy = resolveAuth(rawToken)
  if (!rawToken) return legacy || localDevAdminAuth(req)
  const auth0 = getAuth0Config()
  const external = await resolveAuth0AccessToken(rawToken)
  const looksLikeJwt = rawToken.split('.').length === 3
  if (auth0.configured && looksLikeJwt && !external) return null
  if (!String(process.env.DATABASE_URL || '').trim()) return external ? null : legacy
  const pool = await getPgPool()
  if (!pool) return null
  await runCoreMigrations()
  if (external) return resolveAuth0Workspace(pool, external)
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
  if (!result.rowCount) {
    // OAuth grants are stored by the connector adapter. Rebuild their scope
    // from current Postgres memberships so brand invitations and revocations
    // take effect without reconnecting the client.
    if (legacy?.userId) {
      const memberships = await pool.query(`
        SELECT wm.workspace_id AS "workspaceId", wm.role AS "workspaceRole",
               s.id AS "siteId", s.handle, COALESCE(wms.role, wm.role) AS "brandRole"
        FROM workspace_members wm
        JOIN sites s ON s.workspace_id=wm.workspace_id
        LEFT JOIN workspace_member_sites wms ON wms.member_id=wm.id AND wms.site_id=s.id
        WHERE wm.user_id=$1
          AND (wm.role IN ('owner','admin') OR wms.site_id IS NOT NULL)
        ORDER BY wm.created_at ASC, s.handle ASC
      `, [legacy.userId])
      if (memberships.rowCount) {
        const first = memberships.rows[0]
        const sites = memberships.rows.filter((row) => row.handle).map((row) => row.handle)
        return withCapabilities({
          ...legacy,
          userId: legacy.userId,
          workspaceId: first.workspaceId,
          role: first.workspaceRole,
          workspaceRole: first.workspaceRole,
          brandRoles: Object.fromEntries(memberships.rows.filter((row) => row.handle).map((row) => [row.handle, row.brandRole])),
          sites: [...new Set(sites)],
          site: sites[0] || undefined
        })
      }
    }
    // Once Postgres is active, a user token without a current workspace
    // membership is revoked even if its legacy JSON adapter still exists.
    if (legacy?.userId) return null
    return legacy
  }
  const identity = result.rows[0]
  const canonicalUser = await pool.query('SELECT email,disabled FROM users WHERE id=$1 LIMIT 1', [identity.userId])
  if (canonicalUser.rowCount && canonicalUser.rows[0].disabled) return null
  const member = await pool.query('SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 LIMIT 1', [identity.workspaceId, identity.userId])
  if (!member.rowCount) return null
  const sites = await pool.query(`SELECT s.id,s.handle,COALESCE(wms.role,wm.role) AS role FROM workspace_members wm JOIN sites s ON s.workspace_id=wm.workspace_id LEFT JOIN workspace_member_sites wms ON wms.member_id=wm.id AND wms.site_id=s.id WHERE wm.workspace_id=$1 AND wm.user_id=$2 AND (wm.role IN ('owner','admin') OR wms.site_id IS NOT NULL) ORDER BY s.handle`, [identity.workspaceId, identity.userId])
  return withCapabilities({
    userId: identity.userId,
    workspaceId: identity.workspaceId,
    role: member.rows[0].role,
    workspaceRole: member.rows[0].role,
    brandRoles: Object.fromEntries(sites.rows.map((site) => [site.handle, site.role])),
    sites: sites.rows.map((site) => site.handle),
    site: sites.rows[0]?.handle || undefined,
    tokenType: identity.tokenType,
    email: canonicalUser.rows[0]?.email || undefined
  })
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
    // With Postgres enabled this list is rebuilt from current memberships and
    // may include a brand that has no legacy site-config directory yet.
    return [...new Set(requested.map((handle) => String(handle || '').trim()).filter(Boolean))]
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
    systemAdmin: Boolean(auth.systemAdmin || (auth.role === 'admin' && !auth.userId)),
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
  // Personal user roles. Brand scope is resolved from current memberships.
  const publicRole = isProductRestructureV1()
    ? auth.role
    : auth.role
  return {
    role: publicRole,
    site: scopedSites[0] || auth.site,
    sites: scopedSites,
    canCreateSites: auth.role === 'admin' || auth.role === 'owner',
    canManageAllSites: auth.role === 'admin' || auth.role === 'owner',
    capabilities,
    ...extras,
    ...v1Extras
  }
}

export function publicSiteConfigForAuth(config, auth) {
  const base = publicSiteConfig(config)
  if (!base) return null
  const out = {
    ...base
  }
  if (!isAgencyOrAdmin(auth)) {
    // Clients do not see Coolify secrets, webhooks, or token regeneration hints.
    delete out.hasCoolifyApiToken
    delete out.coolifyApiTokenHint
    delete out.rebuildWebhookUrl
  }
  return out
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}
