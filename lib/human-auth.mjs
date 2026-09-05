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
import { SESSION_ROLES } from './auth.mjs'

const usersPath = () => join(dataDir, 'users.json')

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

/**
 * Register a human user (agency/admin ops). Role: client | agency_admin.
 */
export function registerPasswordUser({ email, password, site, role = 'client' }) {
  assertPasswordAuthEnabled()
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized || !normalized.includes('@')) throw new CmsError(400, 'Valid email is required')
  if (String(password || '').length < 8) throw new CmsError(400, 'Password must be at least 8 characters')
  if (!site) throw new CmsError(400, 'site is required')
  if (!SESSION_ROLES.includes(role) || role === 'admin') {
    throw new CmsError(400, 'role must be client or agency_admin')
  }

  const store = readUsers()
  if (store.users.some((u) => u.email === normalized)) {
    throw new CmsError(409, 'Email already registered')
  }
  const { salt, hash } = hashPassword(password)
  const user = {
    id: `user_${randomBytes(8).toString('hex')}`,
    email: normalized,
    site,
    role,
    salt,
    hash,
    createdAt: new Date().toISOString()
  }
  store.users.push(user)
  writeUsers(store)
  return { id: user.id, email: user.email, site: user.site, role: user.role }
}

export function loginPasswordUser({ email, password }) {
  assertPasswordAuthEnabled()
  const normalized = String(email || '').trim().toLowerCase()
  const store = readUsers()
  const user = store.users.find((u) => u.email === normalized)
  if (!user || !verifyPassword(password, user.salt, user.hash)) {
    throw new CmsError(401, 'Email or password incorrect')
  }
  const session = createSessionBearer({
    site: user.site,
    role: user.role,
    ttlMs: 1000 * 60 * 60 * 8
  })
  return {
    user: { id: user.id, email: user.email, site: user.site, role: user.role },
    token: session.token,
    expiresAt: session.expiresAt
  }
}

export function googleAuthStatus() {
  return {
    available: false,
    deferred: true,
    message: 'Google OAuth is deferred past F5. Use site token, magic link, or email/password.'
  }
}
