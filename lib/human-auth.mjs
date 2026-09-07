/**
 * F5 human email/password accounts. Google OAuth is deferred (see docs).
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './db.mjs'
import { isProductRestructureV1 } from './product-flags.mjs'
import { CmsError } from './cms-ops-errors.mjs'
import { createSessionBearer } from './access-tokens.mjs'

const usersPath = () => join(dataDir, 'users.json')
const PASSWORD_ROLES = ['client', 'agency_admin']

function readUsers() {
  if (!existsSync(usersPath())) return { users: [] }
  const raw = JSON.parse(readFileSync(usersPath(), 'utf8'))
  return { users: Array.isArray(raw.users) ? raw.users : [] }
}

function writeUsers(store) {
  mkdirSync(dataDir, { recursive: true })
  const tmp = `${usersPath()}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2))
  renameSync(tmp, usersPath())
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
    throw new CmsError(400, 'role must be client or agency_admin')
  }
}

/**
 * Register a human user (agency/admin ops). Role: client | agency_admin.
 * invite=true creates the account without a known password and flags mustSetPassword.
 */
export function registerPasswordUser({ email, password, site, sites, role = 'client', invite = false }) {
  assertPasswordAuthEnabled()
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized || !normalized.includes('@')) throw new CmsError(400, 'Valid email is required')
  const assigned = normalizeUserSites({ site, sites })
  if (!assigned.length) throw new CmsError(400, 'site is required')
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
    site: scoped[0],
    sites: scoped,
    role,
    salt,
    hash,
    mustSetPassword: Boolean(invite),
    loginToken: null,
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

export function updatePasswordUser({ id, sites, role } = {}) {
  assertPasswordAuthEnabled()
  const store = readUsers()
  const user = store.users.find((u) => u.id === String(id || '').trim())
  if (!user) throw new CmsError(404, 'Usuario no encontrado')
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
  writeUsers(store)
  return publicUser(user)
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
    message: 'Google OAuth is deferred past F5. Use site token, magic link, or email/password.'
  }
}
