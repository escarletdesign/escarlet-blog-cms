import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, readdirSync, statSync, unlinkSync } from 'node:fs'
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
    usage: {}
  }
}

export function readDb() {
  if (!existsSync(dbPath)) {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(dbPath, JSON.stringify(emptyDb(), null, 2))
  }
  const db = JSON.parse(readFileSync(dbPath, 'utf8'))
  if (!Array.isArray(db.plans) || !db.plans.length) {
    db.plans = emptyDb().plans
  }
  if (!db.usage || typeof db.usage !== 'object') db.usage = {}
  return db
}

export function writeDb(db) {
  mkdirSync(dataDir, { recursive: true })
  const tmp = `${dbPath}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(db, null, 2))
  renameSync(tmp, dbPath)
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
