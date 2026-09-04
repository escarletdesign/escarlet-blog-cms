import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { join, basename } from 'node:path'
import {
  readDb,
  writeDb,
  findPost,
  upsertPost,
  mediaDir
} from './db.mjs'
import { loadSiteConfig, listSiteHandles, getRebuildWebhookUrl, getCoolifyApiToken, withCoolifyForceRebuild } from './site-config.mjs'
import {
  getBrandContext as readBrandContext,
  getSeoContext as readSeoContext,
  readBrandFile,
  writeBrandFile,
  BRAND_ALL_FILES,
  BRAND_FILE_LABELS,
  importBrandKitZip
} from './brand-kit.mjs'
import { validatePostSeo } from './seo-validator.mjs'
import { renderPostBody } from './content-render.mjs'
import {
  buildDraftPost,
  normalizeAuthor,
  pickRelated,
  toSlug,
  todayIso,
  validateSlug
} from './post-utils.mjs'
import {
  mediaForClient,
  bufferFromUpload,
  inspectImageBuffer,
  imageIntegrityMessage,
  coverImageError,
  resolveImageSrc,
  resolvePostImageSrc,
  isSandboxOrLocalImageRef,
  sandboxImageHint,
  pickBase64Payload
} from './media-url.mjs'
import { withPostLinks, absoluteMediaUrl, cmsPublicUrl } from './preview-url.mjs'
import { getOnboardingPlaybook } from './onboarding.mjs'
import { normalizeMediaKind, inferMediaKind } from './media-kind.mjs'
import { optimizeImageBuffer } from './media-optimize.mjs'
import { collectUploadChunk, isChunkedUpload } from './upload-chunks.mjs'
import { createImageDrop, readImageDrop, consumeImageDrop } from './media-inbox.mjs'
import { pickConnectorFile } from './openai-file.mjs'
import { MCP_SERVER_VERSION } from './media-upload-contract.mjs'

const DEFAULT_SITE = process.env.DEFAULT_SITE || 'escarlet'
const REBUILD_COOLDOWN_MS = Number(process.env.REBUILD_COOLDOWN_MS || 25_000)

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

const lastRebuildAt = new Map()
const pendingRebuildFollowUp = new Map()
const rebuildFollowUpTimers = new Map()

function scheduleRebuildFollowUp(site) {
  pendingRebuildFollowUp.set(site, true)
  if (rebuildFollowUpTimers.has(site)) return
  const wait = Math.max(REBUILD_COOLDOWN_MS, 50) + 200
  const timer = setTimeout(() => {
    rebuildFollowUpTimers.delete(site)
    if (!pendingRebuildFollowUp.get(site)) return
    pendingRebuildFollowUp.delete(site)
    lastRebuildAt.delete(site)
    notifyRebuild(site).catch((err) => {
      console.error(`[rebuild] follow-up falló (${site})`, err.message)
    })
  }, wait)
  if (typeof timer.unref === 'function') timer.unref()
  rebuildFollowUpTimers.set(site, timer)
}

export async function notifyRebuild(site) {
  const siteConfig = loadSiteConfig(site)
  const url = withCoolifyForceRebuild(getRebuildWebhookUrl(siteConfig))
  if (!url) {
    const message = `Sin webhook para site ${site}. Configúralo en dashboard → Sitio.`
    console.warn(`[rebuild] ${message}`)
    return { ok: false, status: 0, message }
  }
  const now = Date.now()
  const previous = lastRebuildAt.get(site) || 0
  if (now - previous < REBUILD_COOLDOWN_MS) {
    scheduleRebuildFollowUp(site)
    const wait = Math.ceil((REBUILD_COOLDOWN_MS - (now - previous)) / 1000)
    return {
      ok: true,
      status: 202,
      coalesced: true,
      followUp: true,
      message: `Rebuild ya pedido. Coolify sigue con el anterior. Se disparará otro en ${wait}s para no perder el publicar.`
    }
  }
  lastRebuildAt.set(site, now)
  pendingRebuildFollowUp.delete(site)
  const token = getCoolifyApiToken(siteConfig)
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    let res = await fetch(url, { method: 'GET', headers })
    if (res.status === 405) {
      res = await fetch(url, { method: 'POST', headers })
    }
    const body = await res.text().catch(() => '')
    if (!res.ok) {
      lastRebuildAt.delete(site)
      const message = `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`
      console.error(`[rebuild] ${message} (${site})`)
      return { ok: false, status: res.status, message }
    }
    console.log(`[rebuild] OK ${site} → ${res.status}`)
    return { ok: true, status: res.status, message: 'Rebuild disparado sin caché de capas.' }
  } catch (error) {
    lastRebuildAt.delete(site)
    console.error('[rebuild] webhook failed', error.message)
    return { ok: false, status: 0, message: error.message }
  }
}

function withCoverIntegrity(validation, post) {
  const next = {
    ...validation,
    errors: [...(validation.errors || [])],
    warnings: [...(validation.warnings || [])]
  }
  const coverError = coverImageError(post?.imageUrl, post?.site || DEFAULT_SITE)
  if (coverError) next.errors.push(coverError)
  next.ok = next.errors.length === 0
  next.readyToPublish = next.errors.length === 0
  next.checklist = {
    blocking: next.errors,
    recommended: next.warnings
  }
  return next
}

export async function saveUploadedMedia({
  site,
  filename,
  contentBase64,
  imageUrl,
  filePath,
  buffer,
  alt = '',
  kind = 'post'
}) {
  const mediaKind = normalizeMediaKind(kind)
  const buf = await bufferFromUpload({ contentBase64, imageUrl, filePath, buffer })
  const integrity = inspectImageBuffer(buf)
  if (!integrity.ok) {
    throw new CmsError(400, imageIntegrityMessage(integrity), { integrity })
  }
  const optimized = await optimizeImageBuffer(buf, { kind: mediaKind, filename })
  const safeName =
    basename(optimized.filename || filename || 'imagen.jpg').replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase() ||
    'imagen.jpg'
  const sub = mediaKind === 'reference' ? join(site, 'reference') : site
  const dir = join(mediaDir, sub)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, safeName), optimized.buffer)
  const urlPath =
    mediaKind === 'reference' ? `/media/${site}/reference/${safeName}` : `/media/${site}/${safeName}`
  const db = readDb()
  const item = mediaForClient({
    id: `media-${Date.now()}`,
    site,
    path: urlPath,
    alt,
    kind: mediaKind,
    filename: safeName,
    originalBytes: optimized.originalBytes || buf.length,
    storedBytes: optimized.buffer.length,
    optimized: Boolean(optimized.optimized)
  })
  db.media = db.media || []
  db.media.push(item)
  writeDb(db)
  return item
}

export async function listSites() {
  const db = readDb()
  const handles = new Set([
    ...listSiteHandles(),
    ...(db.sites || []).map((s) => s.handle || s.id).filter(Boolean)
  ])
  return { sites: db.sites || [], handles: [...handles].sort() }
}

export async function getOnboarding(site) {
  const handle = site || DEFAULT_SITE
  const config = loadSiteConfig(handle)
  return getOnboardingPlaybook({
    handle,
    name: config?.name,
    domain: config?.domain,
    cmsUrl: process.env.CMS_PUBLIC_URL
  })
}

export async function createSiteRecord(input) {
  const { createSite } = await import('./create-site.mjs')
  try {
    return await createSite(input)
  } catch (err) {
    throw new CmsError(err.status || 500, err.message)
  }
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
  const nextSlug = String(body.slug || '').trim()
  if (!nextSlug) throw new CmsError(400, 'Falta slug')
  validateSlug(nextSlug)

  const lookupSlug = String(body.originalSlug || nextSlug).trim()
  const existing = findPost(db, site, lookupSlug)
  if (!existing) {
    throw new CmsError(
      404,
      `Post no encontrado (${lookupSlug}). Usa blog_list_posts y blog_get_post. No crees un borrador nuevo para editar.`
    )
  }

  if (nextSlug !== lookupSlug) {
    if (findPost(db, site, nextSlug)) {
      throw new CmsError(409, `Ya existe slug ${nextSlug}`)
    }
    db.posts = db.posts.filter((p) => !(p.site === site && p.slug === lookupSlug))
  }

  const siteConfig = loadSiteConfig(site)
  const needsHuman = Boolean(siteConfig?.requiresHumanApproval)
  const wasPublished = existing.status === 'published'
  const keepPublished = Boolean(body.keepPublished)
  const { originalSlug: _originalSlug, keepPublished: _keepPublished, ...fields } = body

  const hasExplicitStatus = Object.prototype.hasOwnProperty.call(fields, 'status') && fields.status != null && fields.status !== ''
  let status = hasExplicitStatus ? fields.status : existing.status || 'draft'
  let demotedToReview = false
  if (wasPublished && needsHuman && !keepPublished && !hasExplicitStatus) {
    status = 'review'
    demotedToReview = true
  }

  const post = {
    ...existing,
    ...fields,
    id: nextSlug,
    site,
    slug: nextSlug,
    status,
    dateModified: todayIso()
  }

  // Persistimos HTML semántico. Si llega Markdown (editor/API), lo convertimos.
  if (Object.prototype.hasOwnProperty.call(fields, 'bodyHtml')) {
    post.bodyHtml = renderPostBody(post.bodyHtml || '')
  }

  upsertPost(db, post)
  writeDb(db)

  const validation = validatePostSeo(post, site)
  return withPostLinks(
    {
      post: withResolvedImages(post),
      rebuild: null,
      savedOnly: true,
      validation,
      blockingErrors: validation.errors,
      warnings: validation.warnings,
      demotedToReview,
      renamedFrom: nextSlug !== lookupSlug ? lookupSlug : null,
      hint: demotedToReview
        ? 'El post estaba publicado. Con aprobación humana, pasó a review y salió del blog. Un humano debe publicar en vivo desde el dashboard.'
        : 'Guardado en el CMS. La web pública no cambia hasta Publicar en vivo.'
    },
    site,
    nextSlug
  )
}

export async function unpublishPost(site, slug) {
  const db = readDb()
  const post = findPost(db, site, slug)
  if (!post) throw new CmsError(404, 'Post no encontrado')
  const wasLive = post.status === 'published'
  post.status = 'draft'
  post.dateModified = todayIso()
  upsertPost(db, post)
  writeDb(db)
  let rebuild = null
  if (wasLive) rebuild = await notifyRebuild(site)
  return withPostLinks(
    {
      post: withResolvedImages(post),
      rebuild,
      unpublished: true,
      message: wasLive
        ? 'Post despublicado. Está en draft y ya no sale en el blog.'
        : 'Post pasado a draft.'
    },
    site,
    slug
  )
}

export async function deletePost(site, slug) {
  const db = readDb()
  const post = findPost(db, site, slug)
  if (!post) throw new CmsError(404, 'Post no encontrado')
  const wasLive = post.status === 'published'
  db.posts = db.posts.filter((p) => !(p.site === site && p.slug === slug))
  writeDb(db)
  // Rebuild siempre: el sync del frontend solo lee published; si el post estaba en vivo
  // (o el sitio tenía una copia antigua), el deploy lo quita del blog.
  const rebuild = await notifyRebuild(site)
  const rebuildOk = Boolean(rebuild?.ok)
  const message = rebuildOk
    ? wasLive
      ? 'Post eliminado del CMS y rebuild del sitio disparado. Saldrá del blog al terminar el deploy.'
      : 'Post eliminado del CMS. Rebuild del sitio disparado por si aún aparecía en el blog.'
    : `Post eliminado del CMS. El rebuild del sitio falló${rebuild?.message ? `: ${rebuild.message}` : ''}. Configura el webhook en Sitio o dispara rebuild a mano.`
  return {
    deleted: true,
    site,
    slug,
    wasPublished: wasLive,
    rebuild,
    message
  }
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
  const validation = withCoverIntegrity(validatePostSeo(post, site), post)
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
  const validation = withCoverIntegrity(validatePostSeo(post, site), post)
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
          ? 'Post enviado a revisión. En Posts aparece como review. Abre Preview y pulsa Publicar en vivo cuando esté listo.'
          : 'Post enviado a revisión con avisos SEO. Corrige en el dashboard o pide otra pasada al agente. Luego pulsa Publicar en vivo.'
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
  const site = payload.site || DEFAULT_SITE
  const connectorFile = pickConnectorFile(payload)
  if (connectorFile?.sandboxPath && !connectorFile.download_url) {
    throw new CmsError(400, sandboxImageHint(connectorFile.sandboxPath), {
      recovery: {
        next: 'A→B→C',
        tools: ['blog_upload_media_file', 'blog_upload_media'],
        use: 'Si file no es invocable, contentBase64 o trozos con uploadId. Resuelve solo.',
        kind: ['post', 'social', 'reference'],
        avoid: ['/mnt/data', 'curl', 'PUT', 'preguntar al humano']
      }
    })
  }
  const kind = inferMediaKind({
    kind: payload.kind,
    filename: payload.filename || connectorFile?.file_name || payload.filePath
  })
  const filename =
    payload.filename || connectorFile?.file_name || payload.filePath || 'imagen.jpg'
  const imageUrl = String(payload.imageUrl || connectorFile?.download_url || '').trim()
  const filePath = String(payload.filePath || payload.path || '').trim()
  const contentBase64 = pickBase64Payload(payload)
  const hasBinary = Buffer.isBuffer(payload.buffer) && payload.buffer.length > 0

  if (isChunkedUpload(payload) && Number(payload.chunkCount) > 1) {
    const assembled = collectUploadChunk({
      uploadId: payload.uploadId,
      chunkIndex: payload.chunkIndex,
      chunkCount: payload.chunkCount,
      contentBase64,
      filename
    })
    if (!assembled.complete) {
      return {
        ok: false,
        awaitingChunks: true,
        uploadId: assembled.uploadId,
        received: assembled.received,
        count: assembled.count,
        nextChunkIndex: assembled.nextChunkIndex,
        missing: assembled.missing,
        kind,
        hint: `Trozo ${assembled.received} de ${assembled.count} recibido. Envía chunkIndex ${assembled.nextChunkIndex} con el mismo uploadId.`
      }
    }
    return finalizeUploadedMedia({
      site,
      filename: assembled.filename || filename,
      contentBase64: assembled.contentBase64,
      alt: payload.alt || '',
      kind
    })
  }

  if (!filename || (!contentBase64 && !imageUrl && !filePath && !hasBinary)) {
    throw new CmsError(
      400,
      'Falta la imagen. Plan A file, plan B contentBase64/blob, plan C uploadId a trozos. Resuelve solo. kind post, social o reference.',
      {
        recovery: {
          next: 'A→B→C',
          tools: ['blog_upload_media_file', 'blog_upload_media'],
          kind: ['post', 'social', 'reference'],
          use: ['file', 'contentBase64', 'blob', 'uploadId+chunkIndex+chunkCount'],
          autonomy: 'Si file no es invocable, usa blog_upload_media al momento.'
        }
      }
    )
  }

  if ((imageUrl && isSandboxOrLocalImageRef(imageUrl) && !contentBase64 && !hasBinary) ||
      (filePath && isSandboxOrLocalImageRef(filePath) && !contentBase64 && !hasBinary)) {
    const badRef = imageUrl || filePath
    throw new CmsError(400, sandboxImageHint(badRef), {
      recovery: {
        next: 'A→B→C',
        tools: ['blog_upload_media_file', 'blog_upload_media'],
        use: 'file nativo o contentBase64 por MCP. Si el host recorta, trozos.',
        kind: ['post', 'social', 'reference'],
        avoid: ['/mnt/data', 'curl', 'PUT', 'sandbox:', 'file://', 'preguntar al humano']
      }
    })
  }

  return finalizeUploadedMedia({
    site,
    filename,
    contentBase64,
    imageUrl: imageUrl && isSandboxOrLocalImageRef(imageUrl) ? undefined : imageUrl || undefined,
    filePath,
    buffer: hasBinary ? payload.buffer : undefined,
    alt: payload.alt || '',
    kind
  })
}

async function finalizeUploadedMedia({ site, filename, contentBase64, imageUrl, filePath, buffer, alt, kind }) {
  const media = await saveUploadedMedia({
    site,
    filename,
    contentBase64,
    imageUrl,
    filePath,
    buffer,
    alt,
    kind
  })
  const absolute = absoluteMediaUrl(media.path || media.url)
  const suggestedPostPatch =
    kind === 'social'
      ? {
          site,
          socialPack: {
            instagramSlides: [{ imageUrl: absolute, alt: alt || '', headline: alt || '' }]
          }
        }
      : {
          site,
          imageUrl: absolute,
          ...(alt ? { imageAlt: alt } : {})
        }
  return {
    ok: true,
    media: { ...media, url: absolute, path: media.path || media.url },
    cmsImageUrl: absolute,
    kind,
    nextStep:
      kind === 'social'
        ? 'Añade media.url a socialPack.instagramSlides. No sustituyas la portada.'
        : 'Llama blog_update_post con la URL del CMS en imageUrl.',
    suggestedTool: 'blog_update_post',
    suggestedPostPatch,
    reviewHint:
      kind === 'social'
        ? `Slide lista. Pega ${absolute} en socialPack.instagramSlides.`
        : `Usa esta URL en imageUrl del post. ${absolute}`
  }
}

export function openImageDrop(payload = {}) {
  const site = payload.site || DEFAULT_SITE
  const filename = String(payload.filename || 'imagen.png')
  const kind = inferMediaKind({ kind: payload.kind, filename })
  const drop = createImageDrop({
    site,
    filename,
    kind,
    alt: payload.alt || ''
  })
  const putUrl = `${cmsPublicUrl()}/api/media-inbox/${drop.token}`
  const sandboxPath = `/mnt/data/${filename}`
  return {
    ok: true,
    version: MCP_SERVER_VERSION,
    tool: 'blog_open_image_drop',
    putUrl,
    method: 'PUT',
    token: drop.token,
    site,
    filename,
    kind,
    expiresInSeconds: 20 * 60,
    sandboxPython: [
      'from pathlib import Path',
      'import urllib.request',
      `path = Path(${JSON.stringify(sandboxPath)})`,
      `req = urllib.request.Request(${JSON.stringify(putUrl)}, data=path.read_bytes(), method="PUT")`,
      'req.add_header("Content-Type", "application/octet-stream")',
      'print(urllib.request.urlopen(req).read().decode())'
    ].join('\n'),
    nextStep:
      'Solo úsalo si el host puede hacer PUT. El sandbox de ChatGPT no resuelve DNS. ChatGPT debe usar blog_upload_media_file.'
  }
}

export async function receiveImageDrop(token, buffer) {
  const meta = readImageDrop(token)
  if (!meta) {
    throw new CmsError(404, 'El buzón expiró o no existe. Llama blog_open_image_drop otra vez.')
  }
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new CmsError(400, 'El cuerpo está vacío. Envía el PNG o JPG en binario con PUT.')
  }
  const result = await uploadMedia({
    site: meta.site,
    filename: meta.filename,
    kind: meta.kind,
    alt: meta.alt,
    buffer
  })
  consumeImageDrop(token)
  return result
}

export async function deleteMedia(site, id, pathHint = '') {
  const db = readDb()
  const list = db.media || []
  let idx = -1
  if (id) idx = list.findIndex((m) => m.id === id && (!site || m.site === site))
  if (idx < 0 && pathHint) {
    const normalized = String(pathHint)
      .replace(/^https?:\/\/[^/]+/i, '')
      .split('?')[0]
    idx = list.findIndex((m) => {
      const p = String(m.path || m.url || '')
        .replace(/^https?:\/\/[^/]+/i, '')
        .split('?')[0]
      return p === normalized && (!site || m.site === site)
    })
  }
  let item = idx >= 0 ? list[idx] : null
  if (idx >= 0) {
    list.splice(idx, 1)
    db.media = list
    writeDb(db)
  }

  const rel = String(item?.path || item?.url || pathHint || '')
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/media\//, '')
    .split('?')[0]
  if (!rel || rel.includes('..')) {
    if (!item) throw new CmsError(404, 'Media no encontrado')
    return { deleted: true, id: item?.id || null, path: item?.path || item?.url || null }
  }
  const disk = join(mediaDir, rel)
  if (existsSync(disk)) {
    try {
      unlinkSync(disk)
    } catch (error) {
      console.warn('[media] no se pudo borrar archivo', disk, error.message)
    }
  } else if (!item) {
    throw new CmsError(404, 'Media no encontrado')
  }
  return { deleted: true, id: item?.id || null, path: `/media/${rel}` }
}

export async function getBrandContext(site) {
  return { ...readBrandContext(site), files: BRAND_ALL_FILES, labels: BRAND_FILE_LABELS }
}

export async function getBrandFile(site, file) {
  return { site, file, content: readBrandFile(site, file) }
}

export async function updateBrandFile(site, file, content) {
  writeBrandFile(site, file, content || '')
  return { ok: true, file }
}

export async function importBrandZip(site, payload = {}) {
  return importBrandKitZip(site, payload)
}

export async function getSeoContext(site) {
  return readSeoContext(site)
}

export { DEFAULT_SITE }
