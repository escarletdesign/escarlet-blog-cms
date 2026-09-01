import { writeFileSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import {
  readDb,
  writeDb,
  findPost,
  upsertPost,
  mediaDir
} from './db.mjs'
import { loadSiteConfig, listSiteHandles, getRebuildWebhookUrl, getCoolifyApiToken } from './site-config.mjs'
import {
  getBrandContext as readBrandContext,
  getSeoContext as readSeoContext,
  readBrandFile,
  writeBrandFile,
  BRAND_FILES,
  BRAND_FILE_LABELS
} from './brand-kit.mjs'
import { validatePostSeo } from './seo-validator.mjs'
import {
  buildDraftPost,
  normalizeAuthor,
  pickRelated,
  toSlug,
  todayIso,
  validateSlug
} from './post-utils.mjs'
import { mediaForClient, bufferFromUpload, looksLikeImage } from './media-url.mjs'
import { withPostLinks } from './preview-url.mjs'

const DEFAULT_SITE = process.env.DEFAULT_SITE || 'escarlet'

export class CmsError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

export async function notifyRebuild(site) {
  const siteConfig = loadSiteConfig(site)
  const url = getRebuildWebhookUrl(siteConfig)
  if (!url) {
    const message = `Sin webhook para site ${site}. Configúralo en dashboard → Sitio.`
    console.warn(`[rebuild] ${message}`)
    return { ok: false, status: 0, message }
  }
  const token = getCoolifyApiToken(siteConfig)
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'escarlet-blog-cms', site })
    })
    const body = await res.text().catch(() => '')
    if (!res.ok) {
      const message = `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`
      console.error(`[rebuild] ${message} (${site})`)
      return { ok: false, status: res.status, message }
    }
    console.log(`[rebuild] OK ${site} → ${res.status}`)
    return { ok: true, status: res.status, message: 'Rebuild disparado' }
  } catch (error) {
    console.error('[rebuild] webhook failed', error.message)
    return { ok: false, status: 0, message: error.message }
  }
}

export async function saveUploadedMedia({ site, filename, contentBase64, imageUrl, alt = '', kind = 'post' }) {
  const buf = await bufferFromUpload({ contentBase64, imageUrl })
  if (!looksLikeImage(buf)) {
    throw new CmsError(400, 'La imagen no es un PNG, JPG, GIF o WebP válido. Pasa base64 o una URL http.')
  }
  const safeName = basename(filename || 'imagen.png').replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase() || 'imagen.png'
  const sub = kind === 'reference' ? join(site, 'reference') : site
  const dir = join(mediaDir, sub)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, safeName), buf)
  const urlPath =
    kind === 'reference' ? `/media/${site}/reference/${safeName}` : `/media/${site}/${safeName}`
  const db = readDb()
  const item = mediaForClient({
    id: `media-${Date.now()}`,
    site,
    path: urlPath,
    alt,
    kind,
    filename: safeName
  })
  db.media = db.media || []
  db.media.push(item)
  writeDb(db)
  return item
}

export async function listSites() {
  const db = readDb()
  return { sites: db.sites || [], handles: listSiteHandles() }
}

export async function listPosts(site, status) {
  const db = readDb()
  let posts = db.posts.filter((p) => p.site === site)
  if (status) posts = posts.filter((p) => p.status === status)
  return { posts }
}

export async function getPost(site, slug) {
  const db = readDb()
  const post = findPost(db, site, slug)
  if (!post) throw new CmsError(404, 'Post no encontrado')
  return withPostLinks({ post }, site, slug)
}

export async function createDraft(body) {
  const db = readDb()
  const site = body.site || DEFAULT_SITE
  const siteConfig = loadSiteConfig(site)
  const title = String(body.title || '').trim()
  if (!title) throw new CmsError(400, 'Falta title')
  const slug = toSlug(body.slug || title)
  validateSlug(slug)
  if (findPost(db, site, slug)) throw new CmsError(409, `Ya existe slug ${slug}`)
  const author = normalizeAuthor(body.author || body.authorName, siteConfig?.authors)
  const date = body.date || todayIso()
  const existingSlugs = db.posts.filter((p) => p.site === site).map((p) => p.slug)
  const relatedSlugs = pickRelated(existingSlugs, slug, siteConfig?.seo?.relatedSlugsCount || 3)
  const draft = buildDraftPost({
    site,
    slug,
    title,
    author,
    date,
    domain: siteConfig?.domain || 'https://escarlet.design',
    relatedSlugs
  })
  upsertPost(db, draft)
  writeDb(db)
  return withPostLinks({ post: draft, reminder: readBrandContext(site).reminder }, site, slug)
}

export async function updatePost(body) {
  const db = readDb()
  const site = body.site || DEFAULT_SITE
  const slug = body.slug
  if (!slug) throw new CmsError(400, 'Falta slug')
  const existing = findPost(db, site, slug)
  const post = {
    id: slug,
    site,
    status: body.status || existing?.status || 'draft',
    dateModified: todayIso(),
    ...existing,
    ...body
  }
  upsertPost(db, post)
  writeDb(db)
  let rebuild = null
  if (post.status === 'published') rebuild = await notifyRebuild(site)
  return withPostLinks({ post, rebuild }, site, slug)
}

export async function validateSeo(site, slug, postBody) {
  const db = readDb()
  const post = postBody || findPost(db, site, slug)
  if (!post) throw new CmsError(404, 'Post no encontrado')
  return validatePostSeo(post, site)
}

export async function publishPost(site, slug) {
  const db = readDb()
  const post = findPost(db, site, slug)
  if (!post) throw new CmsError(404, 'Post no encontrado')
  const validation = validatePostSeo(post, site)
  if (!validation.ok) throw new CmsError(422, 'SEO no válido', { validation })
  const siteConfig = loadSiteConfig(site)
  if (siteConfig?.requiresHumanApproval && post.status !== 'review') {
    post.status = 'review'
    upsertPost(db, post)
    writeDb(db)
    return withPostLinks({ post, validation, message: 'En revisión. Publica desde el dashboard.' }, site, slug)
  }
  post.status = 'published'
  post.dateModified = todayIso()
  if (!post.datePublished) post.datePublished = todayIso()
  upsertPost(db, post)
  writeDb(db)
  const rebuild = await notifyRebuild(site)
  return withPostLinks({ post, validation, rebuild }, site, slug)
}

export async function uploadMedia(payload) {
  if (!payload.filename || (!payload.contentBase64 && !payload.imageUrl)) {
    throw new CmsError(400, 'Faltan filename y contentBase64 o imageUrl')
  }
  const media = await saveUploadedMedia({
    site: payload.site || DEFAULT_SITE,
    filename: payload.filename,
    contentBase64: payload.contentBase64,
    imageUrl: payload.imageUrl,
    alt: payload.alt || '',
    kind: payload.kind || 'post'
  })
  return { media }
}

export async function getBrandContext(site) {
  return { ...readBrandContext(site), files: BRAND_FILES, labels: BRAND_FILE_LABELS }
}

export async function getBrandFile(site, file) {
  return { site, file, content: readBrandFile(site, file) }
}

export async function updateBrandFile(site, file, content) {
  writeBrandFile(site, file, content || '')
  return { ok: true, file }
}

export async function getSeoContext(site) {
  return readSeoContext(site)
}

export { DEFAULT_SITE }
