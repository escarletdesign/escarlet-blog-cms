import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const dataDir = join(root, 'data')
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
    posts: []
  }
}

export function readDb() {
  if (!existsSync(dbPath)) {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(dbPath, JSON.stringify(emptyDb(), null, 2))
  }
  return JSON.parse(readFileSync(dbPath, 'utf8'))
}

export function writeDb(db) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(dbPath, JSON.stringify(db, null, 2))
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
    bodyHtml: post.bodyHtml || '',
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
