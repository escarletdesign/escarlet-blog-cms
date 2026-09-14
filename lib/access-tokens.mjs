/**
 * Magic-link and shareable review tokens (TTL ≤15m, one-shot).
 * Mirrors embed-session.mjs disk+memory pattern. Does not mint long-lived bearers.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './db.mjs'
import { sanitizeNext } from './embed-session.mjs'

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000
const FILE = () => join(dataDir, 'access-tokens.json')

/** @type {Map<string, object>} */
const magicStore = new Map()
/** @type {Map<string, object>} */
const reviewStore = new Map()
/** @type {Map<string, object>} */
const sessionStore = new Map()

let loaded = false

function loadDisk() {
  try {
    if (!existsSync(FILE())) return
    const raw = JSON.parse(readFileSync(FILE(), 'utf8'))
    const now = Date.now()
    for (const [id, row] of Object.entries(raw?.magic || {})) {
      if (row?.expiresAt > now) magicStore.set(id, row)
    }
    for (const [id, row] of Object.entries(raw?.review || {})) {
      if (row?.expiresAt > now) reviewStore.set(id, row)
    }
    for (const [id, row] of Object.entries(raw?.sessions || {})) {
      if (row?.expiresAt > now) sessionStore.set(id, row)
    }
  } catch {
    // ignore corrupt file
  }
}

function persistDisk() {
  const now = Date.now()
  const magic = {}
  const review = {}
  const sessions = {}
  for (const [id, row] of magicStore.entries()) {
    if (row.expiresAt <= now) {
      magicStore.delete(id)
      continue
    }
    magic[id] = row
  }
  for (const [id, row] of reviewStore.entries()) {
    if (row.expiresAt <= now) {
      reviewStore.delete(id)
      continue
    }
    review[id] = row
  }
  for (const [id, row] of sessionStore.entries()) {
    if (row.expiresAt <= now) {
      sessionStore.delete(id)
      continue
    }
    sessions[id] = row
  }
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(FILE(), `${JSON.stringify({ magic, review, sessions }, null, 2)}\n`)
}

function ensureLoaded() {
  if (loaded) return
  loadDisk()
  loaded = true
}

function prune() {
  const now = Date.now()
  for (const [id, row] of magicStore.entries()) {
    if (row.expiresAt <= now) magicStore.delete(id)
  }
  for (const [id, row] of reviewStore.entries()) {
    if (row.expiresAt <= now) reviewStore.delete(id)
  }
  for (const [id, row] of sessionStore.entries()) {
    if (row.expiresAt <= now) sessionStore.delete(id)
  }
}

function mintId(prefix) {
  return `${prefix}_${randomBytes(24).toString('base64url')}`
}

/**
 * Reject cross-origin POST consume attempts (CSRF).
 * @param {{ origin?: string, host?: string } | undefined} ctx
 */
export function assertConsumeOrigin(ctx) {
  if (!ctx || !ctx.origin) return { ok: true }
  const origin = String(ctx.origin || '').trim()
  const host = String(ctx.host || '').trim()
  if (!origin) return { ok: true }
  try {
    const originHost = new URL(origin).host
    if (host && originHost !== host) {
      return { ok: false, status: 403, message: 'Cross-origin consume denied' }
    }
  } catch {
    return { ok: false, status: 403, message: 'Invalid origin' }
  }
  return { ok: true }
}

/**
 * @param {{ site: string, sites?: string[], role?: 'client'|'client_mcp'|'agency_admin', email?: string, userId?: string, purpose?: string, next?: string, ttlMs?: number }} input
 */
export function createMagicToken(input) {
  ensureLoaded()
  prune()
  const site = String(input.site || '').trim()
  if (!site) {
    const err = new Error('Falta site para magic link')
    err.status = 400
    throw err
  }
  const role = ['agency_admin', 'client_mcp'].includes(input.role) ? input.role : 'client'
  const next = sanitizeNext(input.next)
  const ttl = Math.min(Number(input.ttlMs) || ACCESS_TOKEN_TTL_MS, ACCESS_TOKEN_TTL_MS)
  const token = mintId('magic')
  const expiresAt = Date.now() + Math.max(1, ttl)
  const sites = [
    ...new Set(
      (Array.isArray(input.sites) && input.sites.length ? input.sites : [site])
        .map((s) => String(s || '').trim())
        .filter(Boolean)
    )
  ]
  magicStore.set(token, {
    type: 'magic',
    site,
    sites,
    role,
    email: input.email ? String(input.email).trim() : '',
    userId: input.userId ? String(input.userId).trim() : '',
    purpose: input.purpose ? String(input.purpose).trim() : 'login',
    next,
    expiresAt
  })
  persistDisk()
  return { token, expiresAt, next, site, sites, role }
}

/**
 * @param {string} token
 * @param {{ origin?: string, host?: string }} [ctx]
 */
export function consumeMagicToken(token, ctx = {}) {
  ensureLoaded()
  prune()
  const originCheck = assertConsumeOrigin(ctx)
  if (!originCheck.ok) {
    return { ok: false, status: originCheck.status, message: originCheck.message }
  }
  const key = String(token || '').trim()
  if (!key) return { ok: false, status: 401, message: 'Missing magic token' }
  const row = magicStore.get(key)
  if (!row) return { ok: false, status: 410, message: 'Magic token expired or already used' }
  magicStore.delete(key)
  persistDisk()
  if (row.expiresAt <= Date.now()) {
    return { ok: false, status: 410, message: 'Magic token expired' }
  }
  return {
    ok: true,
    session: {
      site: row.site,
      sites: Array.isArray(row.sites) && row.sites.length ? row.sites : row.site ? [row.site] : [],
      role: row.role,
      email: row.email || undefined,
      userId: row.userId || undefined,
      purpose: row.purpose || 'login',
      next: row.next || '/'
    }
  }
}

/**
 * Mint a short-lived session bearer after magic consume (httpOnly cookie value).
 * Never elevates beyond the role on the magic token.
 */
export function createSessionBearer({ site, sites, role, userId, mustSetPassword, ttlMs }) {
  ensureLoaded()
  prune()
  const safeRole = ['agency_admin', 'client_mcp'].includes(role) ? role : 'client'
  const assigned = [
    ...new Set(
      (Array.isArray(sites) && sites.length ? sites : site ? [site] : []).map((s) => String(s || '').trim()).filter(Boolean)
    )
  ]
  const token = mintId('sess')
  const expiresAt = Date.now() + Math.min(Number(ttlMs) || ACCESS_TOKEN_TTL_MS * 8, 8 * 60 * 60 * 1000)
  sessionStore.set(token, {
    type: 'session',
    site: assigned[0] || site,
    sites: assigned,
    role: safeRole,
    userId: userId || undefined,
    mustSetPassword: Boolean(mustSetPassword),
    expiresAt
  })
  persistDisk()
  return { token, expiresAt, site: assigned[0] || site, sites: assigned, role: safeRole }
}

export function resolveSessionBearer(raw) {
  ensureLoaded()
  prune()
  const key = String(raw || '').trim()
  if (!key.startsWith('sess_')) return null
  const row = sessionStore.get(key)
  if (!row || row.expiresAt <= Date.now()) return null
  const sites =
    Array.isArray(row.sites) && row.sites.length ? row.sites : row.site ? [row.site] : []
  return {
    role: row.role,
    site: row.site,
    sites,
    userId: row.userId,
    mustSetPassword: Boolean(row.mustSetPassword)
  }
}

/**
 * @param {{ site: string, slug: string, actions?: Array<'approve'|'request_changes'>, ttlMs?: number }} input
 */
export function createReviewToken(input) {
  ensureLoaded()
  prune()
  const site = String(input.site || '').trim()
  const slug = String(input.slug || '').trim()
  if (!site || !slug) {
    const err = new Error('Faltan site o slug para review link')
    err.status = 400
    throw err
  }
  const allowed = new Set(['approve', 'request_changes'])
  const actions = (input.actions || ['approve', 'request_changes']).filter((a) => allowed.has(a))
  if (!actions.length) {
    const err = new Error('Review token sin acciones válidas')
    err.status = 400
    throw err
  }
  const ttl = Math.min(Number(input.ttlMs) || ACCESS_TOKEN_TTL_MS, ACCESS_TOKEN_TTL_MS)
  const token = mintId('review')
  const expiresAt = Date.now() + Math.max(1, ttl)
  reviewStore.set(token, {
    type: 'review',
    site,
    slug,
    actions,
    expiresAt
  })
  persistDisk()
  return { token, expiresAt, site, slug, actions }
}

/**
 * @param {string} token
 * @param {{ action: string, rejectReason?: string, expectedSlug?: string, origin?: string, host?: string }} opts
 */
export function consumeReviewToken(token, opts = {}) {
  ensureLoaded()
  prune()
  const originCheck = assertConsumeOrigin(opts)
  if (!originCheck.ok) {
    return { ok: false, status: originCheck.status, message: originCheck.message }
  }
  const key = String(token || '').trim()
  if (!key) return { ok: false, status: 401, message: 'Missing review token' }
  const row = reviewStore.get(key)
  if (!row) return { ok: false, status: 410, message: 'Review token expired or already used' }

  const action = String(opts.action || '').trim()
  if (!row.actions.includes(action)) {
    return { ok: false, status: 403, message: 'Action not allowed for this review token' }
  }
  if (opts.expectedSlug && opts.expectedSlug !== row.slug) {
    return { ok: false, status: 403, message: 'Review token slug mismatch' }
  }
  if (action === 'request_changes') {
    const reason = String(opts.rejectReason || '').trim()
    if (!reason) {
      return { ok: false, status: 400, message: 'rejectReason is required for request_changes' }
    }
  }
  if (row.expiresAt <= Date.now()) {
    reviewStore.delete(key)
    persistDisk()
    return { ok: false, status: 410, message: 'Review token expired' }
  }

  // One-shot: delete before returning success.
  reviewStore.delete(key)
  persistDisk()

  return {
    ok: true,
    site: row.site,
    slug: row.slug,
    action,
    rejectReason: action === 'request_changes' ? String(opts.rejectReason).trim() : undefined,
    // Review links never elevate to agency_admin / admin.
    actor: { role: 'review_link', site: row.site }
  }
}

/** Test helper: peek magic row without consuming. */
export function _testGetMagic(token) {
  ensureLoaded()
  return magicStore.get(String(token || '').trim()) || null
}

export { sanitizeNext }
