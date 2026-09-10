import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, readdirSync, statSync, unlinkSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPostBody } from './content-render.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function resolveDataDir() {
  if (process.env.CMS_DATA_DIR) return process.env.CMS_DATA_DIR.replace(/\/$/, '')

  // Solo en contenedor real. Coolify monta Persistent Storage aquí.
  if (existsSync('/.dockerenv')) {
    const candidates = ['/app/data', '/data']
    for (const dir of candidates) {
      if (existsSync(join(dir, 'db.json')) || existsSync(join(dir, '.cms-persistent'))) {
        return dir
      }
    }
    return '/app/data'
  }

  return join(root, 'data')
}

export const dataDir = resolveDataDir()
export const dbPath = join(dataDir, 'db.json')
export const mediaDir = join(dataDir, 'media')

export function emptyDb() {
  return {
    sites: [{ id: 'escarlet', name: 'Escarlet', handle: 'escarlet', domain: 'https://escarlet.design' }],
    authors: [
      { id: 'charly', name: 'Charly', url: 'https://www.linkedin.com/in/carlos-brugiafredo/' },
      { id: 'silvia', name: 'Silvia', url: '' }
    ],
    categories: [],
    media: [],
    posts: [],
    plans: [
      { id: 'standard', name: 'Standard', draftLimit: 20, publishLimitPerMonth: 12 }
    ],
    usage: {},
    // Server-only configuration. API routes return sanitized connection/catalog DTOs.
    aiProviders: {},
    aiConversations: {},
    aiCreditPacks: {},
    featureFlags: {}
  }
}

export function readDb() {
  if (!existsSync(dbPath)) {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(dbPath, JSON.stringify(emptyDb(), null, 2), { mode: 0o600 })
  }
  const db = JSON.parse(readFileSync(dbPath, 'utf8'))
  if (!Array.isArray(db.plans) || !db.plans.length) {
    db.plans = emptyDb().plans
  }
  if (!db.usage || typeof db.usage !== 'object') db.usage = {}
  if (!db.aiProviders || typeof db.aiProviders !== 'object' || Array.isArray(db.aiProviders)) db.aiProviders = {}
  if (!db.aiConversations || typeof db.aiConversations !== 'object' || Array.isArray(db.aiConversations)) db.aiConversations = {}
  if (!db.aiCreditPacks || typeof db.aiCreditPacks !== 'object' || Array.isArray(db.aiCreditPacks)) db.aiCreditPacks = {}
  if (!db.featureFlags || typeof db.featureFlags !== 'object' || Array.isArray(db.featureFlags)) db.featureFlags = {}
  return db
}

const USAGE_FIELDS = ['inputTokens', 'outputTokens', 'totalTokens', 'creditsUsed', 'tokenCreditsUsed']

function isUsageRow(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && USAGE_FIELDS.some((field) => Object.hasOwn(value, field)))
}

function nonNegativeWhole(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

function mergeUsageRows(latest = {}, incoming = {}) {
  const merged = { ...latest, ...incoming }
  for (const field of USAGE_FIELDS) {
    const latestValue = nonNegativeWhole(latest[field])
    const incomingValue = nonNegativeWhole(incoming[field])
    if (latestValue || incomingValue || Object.hasOwn(latest, field) || Object.hasOwn(incoming, field)) {
      merged[field] = Math.max(latestValue, incomingValue)
    }
  }
  return merged
}

function mergeUsageSite(latest, incoming) {
  if (!latest || typeof latest !== 'object') return incoming
  if (!incoming || typeof incoming !== 'object') return latest
  if (isUsageRow(latest) || isUsageRow(incoming)) return mergeUsageRows(latest, incoming)
  const merged = { ...latest, ...incoming }
  for (const month of new Set([...Object.keys(latest), ...Object.keys(incoming)])) {
    const latestRow = latest[month]
    const incomingRow = incoming[month]
    if (latestRow && incomingRow && typeof latestRow === 'object' && typeof incomingRow === 'object') {
      merged[month] = mergeUsageRows(latestRow, incomingRow)
    } else if (latestRow && !incomingRow) {
      merged[month] = latestRow
    }
  }
  return merged
}

function usageScore(db, site) {
  const raw = db?.aiUsage?.[site]
  if (!raw || typeof raw !== 'object') return 0
  const rows = isUsageRow(raw) ? [raw] : Object.values(raw)
  return rows.reduce((total, row) => {
    if (!row || typeof row !== 'object') return total
    return total + Math.max(
      nonNegativeWhole(row.creditsUsed),
      nonNegativeWhole(row.tokenCreditsUsed),
      nonNegativeWhole(row.totalTokens)
    )
  }, 0)
}

function accountBalance(account) {
  if (!account || typeof account !== 'object') return 0
  if (Object.hasOwn(account, 'balance')) return nonNegativeWhole(account.balance)
  return Math.max(
    nonNegativeWhole(account.purchased ?? account.totalPurchased) -
      nonNegativeWhole(account.spent ?? account.consumed),
    0
  )
}

/**
 * Preserve monotonic AI accounting when an async operation writes a stale
 * snapshot of the database after a generation or credit grant completed.
 * Content fields still use the caller's snapshot; only usage counters and
 * credit balances are reconciled at the final write boundary.
 */
function mergeAiAccounting(latest, incoming) {
  const latestUsage = latest?.aiUsage && typeof latest.aiUsage === 'object' ? latest.aiUsage : {}
  const incomingUsage = incoming?.aiUsage && typeof incoming.aiUsage === 'object' ? incoming.aiUsage : {}
  const usage = { ...latestUsage, ...incomingUsage }
  for (const site of new Set([...Object.keys(latestUsage), ...Object.keys(incomingUsage)])) {
    usage[site] = mergeUsageSite(latestUsage[site], incomingUsage[site])
  }
  if (Object.keys(usage).length) incoming.aiUsage = usage

  const latestCredits = latest?.aiCredits && typeof latest.aiCredits === 'object' ? latest.aiCredits : {}
  const incomingCredits = incoming?.aiCredits && typeof incoming.aiCredits === 'object' ? incoming.aiCredits : {}
  const credits = { ...latestCredits, ...incomingCredits }
  for (const site of new Set([...Object.keys(latestCredits), ...Object.keys(incomingCredits)])) {
    const previous = latestCredits[site]
    const next = incomingCredits[site]
    if (!previous || typeof previous !== 'object') {
      credits[site] = next
      continue
    }
    if (!next || typeof next !== 'object') {
      credits[site] = previous
      continue
    }
    const latestActivity = usageScore(latest, site)
    const incomingActivity = usageScore(incoming, site)
    const latestBalance = accountBalance(previous)
    const incomingBalance = accountBalance(next)
    // A higher balance represents a grant/payment. A lower balance is only
    // accepted as an intentional spend when the same write also advances usage;
    // otherwise it is a stale non-billing write and must not erase credits.
    if (incomingBalance > latestBalance || (incomingBalance < latestBalance && incomingActivity > latestActivity)) {
      credits[site] = next
    } else {
      credits[site] = { ...previous, ...next }
      if (Object.hasOwn(previous, 'balance') || Object.hasOwn(next, 'balance')) {
        credits[site].balance = Math.max(latestBalance, incomingBalance)
      }
    }
  }
  if (Object.keys(credits).length) incoming.aiCredits = credits
  return incoming
}

export function writeDb(db, { mergeAccounting = true } = {}) {
  mkdirSync(dataDir, { recursive: true })
  // A request may have held an older object while an AI generation settled.
  // Merge accounting from the file that exists immediately before this write
  // so a post/media/settings save cannot make credits appear full again.
  if (mergeAccounting && existsSync(dbPath)) {
    try {
      const latest = JSON.parse(readFileSync(dbPath, 'utf8'))
      mergeAiAccounting(latest, db)
    } catch {
      // The normal atomic write below remains the recovery path for malformed
      // legacy data; never fail an otherwise valid content write here.
    }
  }
  const tmp = `${dbPath}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 })
  renameSync(tmp, dbPath)
  // Connector credentials are part of this store; restrict it even when an old DB existed.
  chmodSync(dbPath, 0o600)
}

export function countMediaFiles(dir = mediaDir) {
  if (!existsSync(dir)) return 0
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) count += countMediaFiles(full)
    else if (entry.isFile() && !entry.name.startsWith('.')) count += 1
  }
  return count
}

export function isLikelyMountPoint(dir) {
  try {
    mkdirSync(dir, { recursive: true })
    const self = statSync(dir)
    const parent = statSync(join(dir, '..'))
    return self.dev !== parent.dev
  } catch {
    return false
  }
}

export function checkDataWritable() {
  try {
    mkdirSync(dataDir, { recursive: true })
    const probe = join(dataDir, '.write-probe')
    writeFileSync(probe, String(Date.now()))
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

export function markPersistent() {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(
    join(dataDir, '.cms-persistent'),
    JSON.stringify(
      {
        markedAt: new Date().toISOString(),
        dataDir,
        hint: 'Si este archivo desaparece tras un deploy, el volumen de Coolify no está montado en CMS_DATA_DIR.'
      },
      null,
      2
    ) + '\n'
  )
}

export function getPersistenceStatus() {
  const writable = checkDataWritable()
  let posts = 0
  let media = 0
  let dbExists = existsSync(dbPath)
  try {
    if (dbExists) posts = readDb().posts?.length || 0
    media = countMediaFiles()
  } catch {
    dbExists = false
  }

  const mounted = isLikelyMountPoint(dataDir)
  const marker = existsSync(join(dataDir, '.cms-persistent'))
  const ok = writable && (mounted || marker || process.env.NODE_ENV !== 'production')

  return {
    dataDir,
    dbPath,
    mediaDir,
    writable,
    dbExists,
    posts,
    mediaFiles: media,
    likelyDockerVolume: mounted,
    markerPresent: marker,
    ok,
    hint: ok
      ? 'Datos listos. Confirma que tras un redeploy posts y media siguen aquí.'
      : 'PELIGRO: /app/data parece efímero. En Coolify → Persistent Storage monta un volumen en exactamente /app/data (o pon CMS_DATA_DIR al path del volumen).'
  }
}

export function publicPost(post) {
  return {
    slug: post.slug,
    title: post.title,
    metaTitle: post.metaTitle || { es: post.title },
    metaDescription: post.metaDescription || { es: post.excerptEs || post.title },
    datePublished: post.datePublished,
    dateModified: post.dateModified || post.datePublished,
    imageUrl: post.imageUrl || '',
    imageAlt: post.imageAlt || post.title,
    imagePosition: post.imagePosition || '',
    substackUrl: post.substackUrl || '',
    authorName: post.authorName || 'Escarlet',
    excerptEs: post.excerptEs || '',
    // Si el admin guardó Markdown por error, convertirlo aquí para el sync/frontend.
    bodyHtml: renderPostBody(post.bodyHtml || ''),
    relatedSlugs: post.relatedSlugs || [],
    socialPack: post.socialPack || null,
    status: post.status || 'draft'
  }
}

export function findPost(db, site, slug) {
  return db.posts.find((p) => p.site === site && p.slug === slug)
}

export function upsertPost(db, post) {
  const idx = db.posts.findIndex((p) => p.site === post.site && p.slug === post.slug)
  const next = {
    ...post,
    dateModified: post.dateModified || new Date().toISOString().slice(0, 10)
  }
  if (idx >= 0) db.posts[idx] = { ...db.posts[idx], ...next }
  else db.posts.push(next)
  return next
}
