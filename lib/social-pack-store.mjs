import { randomUUID } from 'node:crypto'
import { readDb, writeDb } from './db.mjs'
import { normalizeSocialPack } from './social-pack-host.mjs'

const MAX_TITLE_CHARS = 240
const MAX_BRIEF_CHARS = 12_000

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max)
}

function safeSourceUrl(value) {
  const raw = cleanText(value, 2_000)
  if (!raw) return ''
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw Object.assign(new Error('El enlace del Social Pack no es válido.'), { status: 400 })
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw Object.assign(new Error('El enlace del Social Pack debe usar HTTPS.'), { status: 400 })
  }
  return parsed.toString()
}

function sitePacks(db, site) {
  db.socialPacks = Array.isArray(db.socialPacks) ? db.socialPacks : []
  return db.socialPacks.filter((pack) => pack?.site === site)
}

export function saveStandaloneSocialPack({
  site,
  title,
  brief,
  sourceUrl,
  socialPack,
  actorId,
  id
} = {}, { db = readDb() } = {}) {
  const handle = cleanText(site, 64)
  if (!handle) throw Object.assign(new Error('Falta site.'), { status: 400 })
  if (!socialPack || typeof socialPack !== 'object' || Array.isArray(socialPack)) {
    throw Object.assign(new Error('Falta socialPack.'), { status: 400 })
  }
  const now = new Date().toISOString()
  const existingId = cleanText(id, 120)
  const item = {
    id: existingId || randomUUID(),
    site: handle,
    title: cleanText(title, MAX_TITLE_CHARS),
    brief: cleanText(brief, MAX_BRIEF_CHARS),
    sourceUrl: safeSourceUrl(sourceUrl),
    socialPack: normalizeSocialPack(socialPack, cleanText(title, MAX_TITLE_CHARS)),
    createdAt: now,
    updatedAt: now,
    createdBy: cleanText(actorId, 160)
  }
  db.socialPacks = Array.isArray(db.socialPacks) ? db.socialPacks : []
  const index = db.socialPacks.findIndex((pack) => pack?.id === item.id && pack?.site === handle)
  if (index >= 0) {
    item.createdAt = db.socialPacks[index].createdAt || now
    db.socialPacks[index] = { ...db.socialPacks[index], ...item }
  } else {
    db.socialPacks.push(item)
  }
  writeDb(db)
  return item
}

export function listStandaloneSocialPacks(site, { db = readDb() } = {}) {
  return sitePacks(db, cleanText(site, 64))
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
    .map((pack) => ({
      id: pack.id,
      site: pack.site,
      title: pack.title || '',
      brief: pack.brief || '',
      sourceUrl: pack.sourceUrl || '',
      createdAt: pack.createdAt || '',
      updatedAt: pack.updatedAt || ''
    }))
}

export function getStandaloneSocialPack(site, id, { db = readDb() } = {}) {
  const handle = cleanText(site, 64)
  const packId = cleanText(id, 120)
  return sitePacks(db, handle).find((pack) => pack.id === packId) || null
}
