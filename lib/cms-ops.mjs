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
import { mediaForClient, bufferFromUpload, looksLikeImage, resolveImageSrc, resolvePostImageSrc } from './media-url.mjs'
import { withPostLinks } from './preview-url.mjs'

const DEFAULT_SITE = process.env.DEFAULT_SITE || 'escarlet'

function withResolvedImages(post) {
  if (!post) return post
  const imageUrl = resolvePostImageSrc(post.imageUrl, post.site || 'escarlet') || resolveImageSrc(post.imageUrl)
  return { ...post, imageUrl }
}

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
  return { posts: posts.map(withResolvedImages) }
}

export async function getPost(site, slug) {
  const db = readDb()
  const post = findPost(db, site, slug)
  if (!post) throw new CmsError(404, 'Post no encontrado')
  return withPostLinks({ post: withResolvedImages(post) }, site, slug)
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
  return withPostLinks({ post: withResolvedImages(draft), reminder: readBrandContext(site).reminder }, site, slug)
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
  const siteConfig = loadSiteConfig(site)
  const validation = validatePostSeo(post, site)
  return withPostLinks(
    {
      post: withResolvedImages(post),
      rebuild,
      validation,
      blockingErrors: validation.errors,
      warnings: validation.warnings,
      hint: seoHints(validation, siteConfig)
    },
    site,
    slug
  )
}

function seoHints(validation, siteConfig) {
  const needsHuman = Boolean(siteConfig?.requiresHumanApproval)
  if (validation.ok) {
    return needsHuman
      ? 'SEO válido. Llama blog_publish para enviar a revisión humana o publica desde el dashboard.'
      : 'SEO válido. Puedes llamar blog_publish.'
  }
  if (needsHuman) {
    return 'SEO incompleto. Corrige con blog_update_post o llama blog_publish para enviar el borrador a revisión humana (previewUrl).'
  }
  return 'SEO incompleto. Corrige los errores con blog_update_post antes de blog_publish.'
}

export async function validateSeo(site, slug, postBody) {
  const db = readDb()
  const post = postBody || findPost(db, site, slug)
  if (!post) throw new CmsError(404, 'Post no encontrado')
  const siteConfig = loadSiteConfig(site)
  const validation = validatePostSeo(post, site)
  return withPostLinks(
    {
      ...validation,
      blockingErrors: validation.errors,
      canSubmitForReview: Boolean(siteConfig?.requiresHumanApproval),
      hint: seoHints(validation, siteConfig)
    },
    site,
    slug
  )
}

export async function publishPost(site, slug) {
  const db = readDb()
  const post = findPost(db, site, slug)
  if (!post) throw new CmsError(404, 'Post no encontrado')
  const siteConfig = loadSiteConfig(site)
  const validation = validatePostSeo(post, site)
  const needsHuman = Boolean(siteConfig?.requiresHumanApproval)

  if (needsHuman && post.status === 'draft') {
    post.status = 'review'
    post.dateModified = todayIso()
    upsertPost(db, post)
    writeDb(db)
    return withPostLinks(
      {
        post: withResolvedImages(post),
        validation,
        submittedForReview: true,
        blockingErrors: validation.errors,
        warnings: validation.warnings,
        message: validation.ok
          ? 'Post enviado a revisión. Abre previewUrl y publícalo desde el dashboard cuando esté listo.'
          : 'Post enviado a revisión con avisos SEO. Corrige en el dashboard o pide otra pasada al agente antes de publicar.'
      },
      site,
      slug
    )
  }

  if (!validation.ok) {
    throw new CmsError(422, 'SEO no válido. Corrige los errores antes de publicar.', {
      validation,
      blockingErrors: validation.errors,
      warnings: validation.warnings,
      hint: seoHints(validation, siteConfig)
    })
  }

  post.status = 'published'
  post.dateModified = todayIso()
  if (!post.datePublished) post.datePublished = todayIso()
  upsertPost(db, post)
  writeDb(db)
  const rebuild = await notifyRebuild(site)
  return withPostLinks(
    { post: withResolvedImages(post), validation, rebuild, published: true },
    site,
    slug
  )
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
