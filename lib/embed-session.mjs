/**
 * One-time SSO codes so WordPress (or other hosts) can open /admin
 * without pasting the site token into the browser.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './db.mjs'

const TTL_MS = 5 * 60 * 1000
const FILE = () => join(dataDir, 'embed-sessions.json')

/** @type {Map<string, { token: string, site: string | null, next: string, expiresAt: number }>} */
const memory = new Map()

function loadDisk() {
  try {
    if (!existsSync(FILE())) return
    const raw = JSON.parse(readFileSync(FILE(), 'utf8'))
    const now = Date.now()
    for (const [code, row] of Object.entries(raw || {})) {
      if (row?.expiresAt > now && row?.token) memory.set(code, row)
    }
  } catch {
    // ignore corrupt file
  }
}

function persistDisk() {
  const now = Date.now()
  const out = {}
  for (const [code, row] of memory.entries()) {
    if (row.expiresAt <= now) {
      memory.delete(code)
      continue
    }
    out[code] = row
  }
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(FILE(), `${JSON.stringify(out, null, 2)}\n`)
}

let loaded = false
function ensureLoaded() {
  if (loaded) return
  loadDisk()
  loaded = true
}

function prune() {
  const now = Date.now()
  for (const [code, row] of memory.entries()) {
    if (row.expiresAt <= now) memory.delete(code)
  }
}

/**
 * @param {{ token: string, site?: string | null, next?: string }} input
 */
export function createEmbedSession(input) {
  ensureLoaded()
  prune()
  const token = String(input.token || '').trim()
  if (!token) {
    const err = new Error('Falta el token de sesión')
    err.status = 400
    throw err
  }
  const next = sanitizeNext(input.next)
  const code = randomBytes(24).toString('base64url')
  const expiresAt = Date.now() + TTL_MS
  memory.set(code, {
    token,
    site: input.site || null,
    next,
    expiresAt
  })
  persistDisk()
  return { code, expiresAt, next }
}

/**
 * Consume a one-time code. Returns null if missing/expired.
 * @param {string} code
 */
export function consumeEmbedSession(code) {
  ensureLoaded()
  prune()
  const key = String(code || '').trim()
  if (!key) return null
  const row = memory.get(key)
  if (!row) return null
  memory.delete(key)
  persistDisk()
  if (row.expiresAt <= Date.now()) return null
  return {
    token: row.token,
    site: row.site,
    next: row.next || '#/entradas'
  }
}

export function sanitizeNext(raw) {
  const value = String(raw || '').trim()
  if (!value) return '#/entradas'
  // Only allow in-app hash routes (no open redirects).
  if (value.startsWith('#/')) return value.slice(0, 200)
  if (/^(entradas|marca|calendario|media|sitio)(\/|$)/.test(value)) {
    return `#/${value}`.slice(0, 200)
  }
  if (/^entrada\/[a-z0-9\-._~/]+$/i.test(value)) {
    return `#/${value}`.slice(0, 200)
  }
  return '#/entradas'
}

/**
 * Build Content-Security-Policy frame-ancestors for a site domain allowlist.
 * @param {string | string[]} domains
 */
export function frameAncestorsHeader(domains) {
  const list = (Array.isArray(domains) ? domains : [domains])
    .map((d) => String(d || '').trim().replace(/\/$/, ''))
    .filter(Boolean)
    .map((d) => {
      try {
        const u = new URL(d.includes('://') ? d : `https://${d}`)
        return u.origin
      } catch {
        return ''
      }
    })
    .filter(Boolean)
  const unique = [...new Set(list)]
  if (!unique.length) return "frame-ancestors 'self'"
  return `frame-ancestors 'self' ${unique.join(' ')}`
}

export const EMBED_SESSION_TTL_MS = TTL_MS
