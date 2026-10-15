/**
 * F5 human email/password accounts. Google OAuth is deferred (see docs).
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './db.mjs'
import { isProductRestructureV1 } from './product-flags.mjs'
import { CmsError } from './cms-ops-errors.mjs'
import { createSessionBearer } from './access-tokens.mjs'
import { getPgPool, runCoreMigrations } from './pg.mjs'

const usersPath = () => join(dataDir, 'users.json')
const PASSWORD_ROLES = ['client', 'agency_admin', 'owner', 'admin', 'editor', 'author', 'viewer']

function readUsers() {
  if (!existsSync(usersPath())) return { users: [], authorInvites: [] }
  const raw = JSON.parse(readFileSync(usersPath(), 'utf8'))
  return {
    users: Array.isArray(raw.users) ? raw.users : [],
    authorInvites: Array.isArray(raw.authorInvites) ? raw.authorInvites : []
  }
}

function writeUsers(store) {
  mkdirSync(dataDir, { recursive: true })
  const tmp = `${usersPath()}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2))
  renameSync(tmp, usersPath())
}

/** One-way compatibility migration. Postgres becomes canonical when enabled. */
export async function syncLegacyUsersToPostgres() {
  if (!String(process.env.DATABASE_URL || '').trim()) return { migrated: 0 }
  const pool = await getPgPool()
  if (!pool) return { migrated: 0 }
  await runCoreMigrations()
  const store = readUsers()
  let migrated = 0
  for (const user of store.users) {
    const result = await pool.query(`
      INSERT INTO users (id,email,password_hash,password_salt,display_name,bio,avatar_url,disabled,must_set_password,allow_publishing_as,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,NOW()),NOW())
      ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name,bio=EXCLUDED.bio,avatar_url=EXCLUDED.avatar_url,disabled=EXCLUDED.disabled,must_set_password=EXCLUDED.must_set_password,allow_publishing_as=EXCLUDED.allow_publishing_as,updated_at=NOW()
      RETURNING id
    `, [user.id, user.email, user.hash || null, user.salt || null, user.displayName || '', user.bio || '', user.avatarDataUrl || user.avatarUrl || '', Boolean(user.disabled), Boolean(user.mustSetPassword), Boolean(user.allowPublishingAs), user.createdAt || null])
    if (result.rowCount) migrated += 1
    if (user.loginToken) {
      const membership = await pool.query('SELECT workspace_id AS "workspaceId" FROM workspace_members WHERE user_id=$1 ORDER BY created_at LIMIT 1', [user.id])
      await pool.query('INSERT INTO tokens (id,user_id,workspace_id,token_hash,token_type,scopes) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (token_hash) DO NOTHING', [`pat-migrated-${user.id}`, user.id, membership.rows[0]?.workspaceId || null, createHash('sha256').update(user.loginToken).digest('hex'), 'pat', ['mcp', 'app']])
    }
  }
  return { migrated }
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, 64).toString('hex')
  return { salt, hash }
}

function verifyPassword(password, salt, hash) {
  const next = scryptSync(String(password), salt, 64)
  const expected = Buffer.from(hash, 'hex')
  if (next.length !== expected.length) return false
  return timingSafeEqual(next, expected)
}

function tokenHint(token) {
  const raw = String(token || '')
  return raw ? `…${raw.slice(-4)}` : ''
}

const MAX_AVATAR_DATA_URL = 2 * 1024 * 1024

function cleanText(value, max = 240) {
  return String(value || '').trim().slice(0, max)
}

function cleanAvatar(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (!raw.startsWith('data:image/')) {
    throw new CmsError(400, 'El avatar debe ser una imagen válida')
  }
  if (raw.length > MAX_AVATAR_DATA_URL) {
    throw new CmsError(413, 'El avatar es demasiado grande (máximo 2 MB)')
  }
  return raw
}

function profileComplete(user) {
  return Boolean(user?.profileCompletedAt)
}

export function normalizeUserSites({ site, sites } = {}) {
  const list = []
  if (Array.isArray(sites)) list.push(...sites)
  if (site) list.push(site)
  return [...new Set(list.map((s) => String(s || '').trim()).filter(Boolean))]
}

export function userSites(user) {
  return normalizeUserSites({ site: user?.site, sites: user?.sites })
}

function publicUser(user) {
  const sites = userSites(user)
  return {
    id: user.id,
    email: user.email,
    site: sites[0] || user.site || null,
    sites,
    role: user.role,
    createdAt: user.createdAt || null,
    displayName: user.displayName || '',
    bio: user.bio || '',
    avatarUrl: user.avatarDataUrl || user.avatarUrl || '',
    profileComplete: profileComplete(user),
    allowPublishingAs: Boolean(user.allowPublishingAs),
    mustSetPassword: Boolean(user.mustSetPassword),
    hasLoginToken: Boolean(user.loginToken),
    loginTokenHint: user.loginToken ? tokenHint(user.loginToken) : ''
  }
}

export function isPasswordAuthEnabled() {
  return isProductRestructureV1()
}

export function assertPasswordAuthEnabled() {
  if (!isPasswordAuthEnabled()) {
    throw new CmsError(503, 'Email/password auth is unavailable until PRODUCT_RESTRUCTURE_V1 (F5) is enabled.', {
      code: 'PASSWORD_AUTH_UNAVAILABLE'
    })
  }
}

function assertRole(role) {
  if (!PASSWORD_ROLES.includes(role)) {
    throw new CmsError(400, 'role must be owner, admin, editor, author, viewer or a legacy role')
  }
}

/**
 * Register a human user (agency/admin ops). Role: client | agency_admin.
 * invite=true creates the account without a known password and flags mustSetPassword.
 */
export function registerPasswordUser({ email, password, site, sites, role = 'client', invite = false, allowNoSite = false }) {
  assertPasswordAuthEnabled()
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized || !normalized.includes('@')) throw new CmsError(400, 'Valid email is required')
  const assigned = normalizeUserSites({ site, sites })
  if (!assigned.length && !allowNoSite) throw new CmsError(400, 'site is required')
  assertRole(role)
  const scoped = role === 'client' ? assigned.slice(0, 1) : assigned

  let secret = String(password || '')
  if (invite) {
    secret = `${randomBytes(18).toString('base64url')}Aa1!`
  } else if (secret.length < 8) {
    throw new CmsError(400, 'Password must be at least 8 characters')
  }

  const store = readUsers()
  if (store.users.some((u) => u.email === normalized)) {
    throw new CmsError(409, 'Email already registered')
  }
  const { salt, hash } = hashPassword(secret)
  const user = {
    id: `user_${randomBytes(8).toString('hex')}`,
    email: normalized,
    site: scoped[0] || null,
    sites: scoped,
    role,
    salt,
    hash,
    mustSetPassword: Boolean(invite),
    loginToken: null,
    displayName: '',
    bio: '',
    avatarDataUrl: '',
    profileCompletedAt: null,
    allowPublishingAs: false,
    publishingDelegates: [],
    createdAt: new Date().toISOString()
  }
  store.users.push(user)
  writeUsers(store)
  return publicUser(user)
}

/** Public user rows (no password material). */
export function listPasswordUsers({ site } = {}) {
  assertPasswordAuthEnabled()
  const store = readUsers()
  const rows = (store.users || []).map((u) => publicUser(u))
  const handle = String(site || '').trim()
  if (!handle) return rows.sort((a, b) => String(a.email).localeCompare(String(b.email)))
  return rows
    .filter((u) => (u.sites || []).includes(handle))
    .sort((a, b) => String(a.email).localeCompare(String(b.email)))
}

export function getPasswordUserById(id) {
  assertPasswordAuthEnabled()
  const needle = String(id || '').trim()
  if (!needle) return null
  return readUsers().users.find((u) => u.id === needle) || null
}

export function getPasswordUserByEmail(email) {
  assertPasswordAuthEnabled()
  const needle = String(email || '').trim().toLowerCase()
  if (!needle) return null
  return readUsers().users.find((u) => u.email === needle) || null
}

export function updatePasswordUser({ id, email, sites, role, allowPublishingAs } = {}) {
  assertPasswordAuthEnabled()
  const store = readUsers()
  const user = store.users.find((u) => u.id === String(id || '').trim())
  if (!user) throw new CmsError(404, 'Usuario no encontrado')
  if (email !== undefined) {
    const normalized = String(email || '').trim().toLowerCase()
    if (!normalized || !normalized.includes('@')) throw new CmsError(400, 'Valid email is required')
    if (store.users.some((candidate) => candidate.id !== user.id && candidate.email === normalized)) {
      throw new CmsError(409, 'Email already registered')
    }
    user.email = normalized
  }
  if (role) {
    assertRole(role)
    user.role = role
  }
  if (sites) {
    const assigned = normalizeUserSites({ sites })
    if (!assigned.length) throw new CmsError(400, 'site is required')
    const scoped = (role || user.role) === 'client' ? assigned.slice(0, 1) : assigned
    user.sites = scoped
    user.site = scoped[0]
  }
  if (allowPublishingAs !== undefined) user.allowPublishingAs = Boolean(allowPublishingAs)
  writeUsers(store)
  return publicUser(user)
}

/** Update the signed-in user's author profile. */
export function updateUserProfile({ id, displayName, bio, avatarDataUrl, allowPublishingAs } = {}) {
  assertPasswordAuthEnabled()
  const store = readUsers()
  const user = store.users.find((u) => u.id === String(id || '').trim())
  if (!user) throw new CmsError(404, 'Usuario no encontrado')
  if (displayName !== undefined) user.displayName = cleanText(displayName, 120) || String(user.email || '').split('@')[0]
  if (bio !== undefined) user.bio = cleanText(bio, 500)
  if (avatarDataUrl !== undefined) user.avatarDataUrl = cleanAvatar(avatarDataUrl)
  if (allowPublishingAs !== undefined) user.allowPublishingAs = Boolean(allowPublishingAs)
  user.profileCompletedAt = new Date().toISOString()
  writeUsers(store)
  return publicUser(user)
}

/** Users from the same site that can be explicitly delegated to publish as the owner. */
export function listPublishingDelegates({ ownerId, site } = {}) {
  assertPasswordAuthEnabled()
  const store = readUsers()
  const owner = store.users.find((user) => user.id === String(ownerId || '').trim())
  const handle = String(site || '').trim()
  if (!owner || !handle || !userSites(owner).includes(handle)) {
    throw new CmsError(404, 'Perfil de autor no encontrado para este sitio')
  }
  const delegates = new Set(owner.publishingDelegates || [])
  return store.users
    .filter((user) => user.id !== owner.id && userSites(user).includes(handle))
    .map((user) => ({
      ...publicUser(user),
      enabled: delegates.has(user.id)
    }))
    .sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)))
}

/** Toggle an explicit same-site publishing delegation without issuing an invite link. */
export function setPublishingDelegate({ ownerId, delegateId, site, enabled } = {}) {
  assertPasswordAuthEnabled()
  const store = readUsers()
  const owner = store.users.find((user) => user.id === String(ownerId || '').trim())
  const delegate = store.users.find((user) => user.id === String(delegateId || '').trim())
  const handle = String(site || '').trim()
  if (!owner || !delegate || !handle || !userSites(owner).includes(handle) || !userSites(delegate).includes(handle)) {
    throw new CmsError(404, 'El usuario no pertenece a este sitio')
  }
  const current = new Set(owner.publishingDelegates || [])
  if (enabled) current.add(delegate.id)
  else current.delete(delegate.id)
  owner.publishingDelegates = [...current]
  writeUsers(store)
  return { delegate: publicUser(delegate), enabled: current.has(delegate.id), site: handle }
}

export function mintAuthorInvite({ ownerId, site, ttlMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
  assertPasswordAuthEnabled()
  const store = readUsers()
  const owner = store.users.find((user) => user.id === String(ownerId || '').trim())
  const handle = String(site || '').trim()
  if (!owner || !handle || !userSites(owner).includes(handle)) throw new CmsError(404, 'Perfil de autor no encontrado para este sitio')
  const token = `author_${randomBytes(24).toString('base64url')}`
  store.authorInvites = (store.authorInvites || []).filter((invite) => invite.expiresAt > Date.now())
  store.authorInvites.push({ token, ownerId: owner.id, site: handle, expiresAt: Date.now() + Math.min(Number(ttlMs) || 7 * 24 * 60 * 60 * 1000, 30 * 24 * 60 * 60 * 1000) })
  writeUsers(store)
  return { token, site: handle, expiresAt: store.authorInvites.at(-1).expiresAt, owner: publicUser(owner) }
}

export function consumeAuthorInvite({ token, userId } = {}) {
  assertPasswordAuthEnabled()
  const store = readUsers()
  const needle = String(token || '').trim()
  const recipient = store.users.find((user) => user.id === String(userId || '').trim())
  const invite = (store.authorInvites || []).find((row) => row.token === needle)
  if (!invite || invite.expiresAt <= Date.now()) throw new CmsError(410, 'El enlace de autor ha caducado')
  if (!recipient || !userSites(recipient).includes(invite.site)) throw new CmsError(403, 'No tienes acceso a este sitio')
  const owner = store.users.find((user) => user.id === invite.ownerId)
  if (!owner || !userSites(owner).includes(invite.site)) throw new CmsError(404, 'El perfil de autor ya no está disponible')
  owner.publishingDelegates = [...new Set([...(owner.publishingDelegates || []), recipient.id])]
  store.authorInvites = (store.authorInvites || []).filter((row) => row.token !== needle)
  writeUsers(store)
  return { ok: true, owner: publicUser(owner), site: invite.site }
}

/** Authors available to a site-scoped editor. */
export function listSiteAuthors({ site, requesterId, requesterRole } = {}) {
  assertPasswordAuthEnabled()
  const handle = String(site || '').trim()
  if (!handle) return []
  return readUsers().users
    .filter((user) => userSites(user).includes(handle))
    .map((user) => {
      const isSelf = Boolean(requesterId && user.id === requesterId)
      const canPublishAs = requesterRole === 'admin' || requesterRole === 'agency_admin' || isSelf || Boolean(user.allowPublishingAs) || (user.publishingDelegates || []).includes(requesterId)
      return {
        id: user.id,
        userId: user.id,
        name: user.displayName || user.email,
        url: '',
        avatarUrl: user.avatarDataUrl || user.avatarUrl || '',
        bio: user.bio || '',
        allowPublishingAs: Boolean(user.allowPublishingAs),
        canPublishAs
      }
    })
    .filter((author) => author.canPublishAs)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

export function assertAuthorAllowed({ site, authorName, requesterId, requesterRole } = {}) {
  if (!isPasswordAuthEnabled()) return
  const handle = String(site || '').trim()
  const name = String(authorName || '').trim().toLowerCase()
  if (!handle || !name || requesterRole === 'admin' || requesterRole === 'agency_admin') return
  const target = readUsers().users.find((user) => {
    if (!userSites(user).includes(handle)) return false
    return String(user.displayName || user.email || '').trim().toLowerCase() === name
  })
  if (!target) return
  const allowed = target.id === requesterId || Boolean(target.allowPublishingAs) || (target.publishingDelegates || []).includes(requesterId)
  if (!allowed) throw new CmsError(403, 'Este autor no permite publicaciones en su nombre')
}

/**
 * Drafts are private to their creator unless the creator explicitly allows
 * publishing-as access (or delegates it to this same-site user). Published
 * posts remain visible to every member of the site; this helper only answers
 * whether a non-published post may be exposed to the requester.
 */
export function canViewOwnedDraft({ site, ownerId, requesterId, requesterRole } = {}) {
  if (requesterRole === 'viewer') return false
  if (requesterRole === 'admin' || requesterRole === 'agency_admin') return true
  const handle = String(site || '').trim()
  const users = readUsers().users
  const owner = users.find((user) => user.id === String(ownerId || '').trim())
  if (!owner || !handle || !userSites(owner).includes(handle)) return false
  if (owner.id === requesterId) return true
  if (owner.allowPublishingAs) return userSites(users.find((user) => user.id === String(requesterId || '').trim()) || {}).includes(handle)
  return (owner.publishingDelegates || []).includes(requesterId)
}

export function deletePasswordUser({ id, email } = {}) {
  assertPasswordAuthEnabled()
  const store = readUsers()
  const before = store.users.length
  const needleId = String(id || '').trim()
  const needleEmail = String(email || '').trim().toLowerCase()
  store.users = store.users.filter((u) => {
    if (needleId && u.id === needleId) return false
    if (needleEmail && u.email === needleEmail) return false
    return true
  })
  if (store.users.length === before) throw new CmsError(404, 'Usuario no encontrado')
  writeUsers(store)
  return { deleted: true }
}

function sessionFromUser(user) {
  const sites = userSites(user)
  const session = createSessionBearer({
    site: sites[0],
    sites,
    role: user.role,
    userId: user.id,
    mustSetPassword: Boolean(user.mustSetPassword),
    ttlMs: 1000 * 60 * 60 * 8
  })
  return {
    user: publicUser(user),
    token: session.token,
    expiresAt: session.expiresAt
  }
}

export function loginPasswordUser({ email, password }) {
  assertPasswordAuthEnabled()
  const normalized = String(email || '').trim().toLowerCase()
  const store = readUsers()
  const user = store.users.find((u) => u.email === normalized)
  if (!user || !verifyPassword(password, user.salt, user.hash)) {
    throw new CmsError(401, 'Email or password incorrect')
  }
  return sessionFromUser(user)
}

export function setUserPassword({ id, email, password }) {
  assertPasswordAuthEnabled()
  if (String(password || '').length < 8) throw new CmsError(400, 'Password must be at least 8 characters')
  const store = readUsers()
  const needleId = String(id || '').trim()
  const needleEmail = String(email || '').trim().toLowerCase()
  const user = store.users.find((u) => (needleId && u.id === needleId) || (needleEmail && u.email === needleEmail))
  if (!user) throw new CmsError(404, 'Usuario no encontrado')
  const { salt, hash } = hashPassword(password)
  user.salt = salt
  user.hash = hash
  user.mustSetPassword = false
  writeUsers(store)
  return publicUser(user)
}

export function mintUserLoginToken({ id }) {
  assertPasswordAuthEnabled()
  const store = readUsers()
  const user = store.users.find((u) => u.id === String(id || '').trim())
  if (!user) throw new CmsError(404, 'Usuario no encontrado')
  const token = `user_${randomBytes(24).toString('base64url')}`
  user.loginToken = token
  writeUsers(store)
  return { ...publicUser(user), token }
}

export function revokeUserLoginToken({ id }) {
  assertPasswordAuthEnabled()
  const store = readUsers()
  const user = store.users.find((u) => u.id === String(id || '').trim())
  if (!user) throw new CmsError(404, 'Usuario no encontrado')
  user.loginToken = null
  writeUsers(store)
  return publicUser(user)
}

export async function mintUserLoginTokenAsync({ id }) {
  const minted = mintUserLoginToken({ id })
  if (!String(process.env.DATABASE_URL || '').trim()) return minted
  const pool = await getPgPool()
  if (!pool) return minted
  await runCoreMigrations()
  const membership = await pool.query('SELECT workspace_id AS "workspaceId" FROM workspace_members WHERE user_id=$1 ORDER BY created_at LIMIT 1', [id])
  const tokenHash = createHash('sha256').update(minted.token).digest('hex')
  await pool.query('UPDATE tokens SET revoked_at=NOW() WHERE user_id=$1 AND token_type=\'pat\' AND revoked_at IS NULL', [id])
  await pool.query('INSERT INTO tokens (id,user_id,workspace_id,token_hash,token_type,scopes) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (token_hash) DO NOTHING', [`pat-${randomBytes(8).toString('hex')}`, id, membership.rows[0]?.workspaceId || null, tokenHash, 'pat', ['mcp', 'app']])
  return minted
}

export async function revokeUserLoginTokenAsync({ id }) {
  const profile = revokeUserLoginToken({ id })
  if (String(process.env.DATABASE_URL || '').trim()) {
    const pool = await getPgPool()
    if (pool) {
      await runCoreMigrations()
      await pool.query('UPDATE tokens SET revoked_at=NOW() WHERE user_id=$1 AND token_type=\'pat\' AND revoked_at IS NULL', [id])
    }
  }
  return profile
}

export function resolveUserAccessToken(rawToken) {
  const token = String(rawToken || '').trim()
  if (!token.startsWith('user_')) return null
  if (!existsSync(usersPath())) return null
  const store = readUsers()
  const user = store.users.find((u) => u.loginToken && u.loginToken === token)
  if (!user) return null
  const sites = userSites(user)
  return {
    role: user.role,
    site: sites[0],
    sites,
    userId: user.id,
    mustSetPassword: Boolean(user.mustSetPassword)
  }
}

export function googleAuthStatus() {
  return {
    available: false,
    deferred: true,
    message: 'Google OAuth is deferred past F5. Use a personal PAT, magic link, or email/password.'
  }
}
