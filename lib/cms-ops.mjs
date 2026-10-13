import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, basename } from 'node:path'
import { fetchRemote } from './remote-fetch.mjs'
import {
  readDb,
  writeDb,
  findPost,
  upsertPost,
  mediaDir
} from './db.mjs'
import { loadSiteConfig, listSiteHandles, getRebuildWebhookUrl, getCoolifyApiToken, withCoolifyForceRebuild, isAgencyGate } from './site-config.mjs'
import {
  getBrandContext as readBrandContext,
  getSeoContext as readSeoContext,
  readBrandFile,
  writeBrandFile,
  BRAND_ALL_FILES,
  BRAND_FILE_LABELS,
  importBrandKitZip,
  assertBrandFileAccess,
  brandFilesForAuth,
  brandLabelsForAuth,
  invalidateBrandKitCache
} from './brand-kit.mjs'
import { validatePostSeo } from './seo-validator.mjs'
import { renderPostBody } from './content-render.mjs'
import {
  buildDraftPost,
  normalizeAuthor,
  pickRelated,
  toSlug,
  todayIso,
  validateSlug,
  parsePublishAt,
  isFuturePublishAt,
  normalizeContentSource
} from './post-utils.mjs'

import {
  mediaForClient,
  findMediaForClient,
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
import { optimizeImageBuffer, generateThumbBuffer, generatePreviewBuffer } from './media-optimize.mjs'
import { normalizeGeneratedImage } from './image-normalize.mjs'
import { assertAssetTypeForMediaKind, assertSocialTextMetadata } from './generation-provenance.mjs'
import { collectUploadChunk, isChunkedUpload, rememberUploadResult } from './upload-chunks.mjs'
import { createImageDrop, readImageDrop, consumeImageDrop } from './media-inbox.mjs'
import { pickConnectorFile } from './openai-file.mjs'
import { MCP_SERVER_VERSION } from './media-upload-contract.mjs'
import { CmsError } from './cms-ops-errors.mjs'
import { assertEntitlementWrite, recordUsage, assertMembershipActive, getQuotaSnapshot } from './plans.mjs'

export { CmsError } from './cms-ops-errors.mjs'
export { getQuotaSnapshot } from './plans.mjs'

const DEFAULT_SITE = process.env.DEFAULT_SITE || 'escarlet'
const REBUILD_COOLDOWN_MS = Number(process.env.REBUILD_COOLDOWN_MS || 25_000)

function withResolvedImages(post) {
  if (!post) return post
  const site = post.site || 'escarlet'
  const imageUrl = resolvePostImageSrc(post.imageUrl, site) || resolveImageSrc(post.imageUrl)
  const media = findMediaForClient(imageUrl || post.imageUrl, site)
  if (!media) return { ...post, imageUrl }
  return {
    ...post,
    imageUrl,
    imagePreviewUrl: media.previewUrl || media.previewPath || imageUrl,
    imageThumbUrl: media.thumbUrl || media.thumbPath || media.previewUrl || media.previewPath || imageUrl,
    ...(media.width ? { imageWidth: media.width } : {}),
    ...(media.height ? { imageHeight: media.height } : {}),
    ...(media.originalBytes ? { imageOriginalBytes: media.originalBytes } : {}),
    ...(media.storedBytes ? { imageStoredBytes: media.storedBytes } : {}),
    ...(media.previewBytes ? { imagePreviewBytes: media.previewBytes } : {}),
    ...(media.thumbBytes ? { imageThumbBytes: media.thumbBytes } : {})
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
    let result = await fetchRemote(url, { method: 'GET', headers, maxBytes: 512 * 1024, timeoutMs: 20_000 })
    if (result.response.status === 405) result = await fetchRemote(url, { method: 'POST', headers, maxBytes: 512 * 1024, timeoutMs: 20_000 })
    const res = result.response
    const body = result.body.toString('utf8')
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
  kind = 'post',
  brandGrounding = null,
  imageDimensions = null
}) {
  const mediaKind = normalizeMediaKind(kind)
  const buf = await bufferFromUpload({ contentBase64, imageUrl, filePath, buffer })
  const integrity = inspectImageBuffer(buf)
  if (!integrity.ok) {
    throw new CmsError(400, imageIntegrityMessage(integrity), { integrity })
  }
  const stored = mediaKind === 'reference'
    ? await optimizeImageBuffer(buf, { kind: mediaKind, filename })
    : {
        buffer: buf,
        filename,
        format: integrity.format,
        optimized: false,
        metadataSanitized: false,
        originalBytes: buf.length
      }
  if (mediaKind === 'reference' && stored.metadataSanitized !== true) {
    throw new CmsError(400, 'No se pudo limpiar los metadatos de la referencia. Usa JPG, PNG o GIF.')
  }
  const contentHash = createHash('sha256').update(stored.buffer).digest('hex')
  const expectedExtension = { jpeg: '.jpg', png: '.png', gif: '.gif', webp: '.webp' }[stored.format || integrity.format] || ''
  const requestedName = basename(stored.filename || filename || `imagen${expectedExtension || '.jpg'}`)
  const normalizedName = expectedExtension && !requestedName.toLowerCase().endsWith(expectedExtension)
    ? requestedName.replace(/\.[a-z0-9]+$/i, '') + expectedExtension
    : requestedName
  const safeBaseName = normalizedName.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase() || 'imagen.jpg'
  const sub = mediaKind === 'reference' ? join(site, 'reference') : site
  const db = readDb()
  const candidatePath = mediaKind === 'reference' ? `/media/${site}/reference/${safeBaseName}` : `/media/${site}/${safeBaseName}`
  const collides = mediaKind !== 'reference' && (db.media || []).some((entry) => entry.site === site && entry.path === candidatePath && entry.sha256 && entry.sha256 !== contentHash)
  const safeName = mediaKind === 'reference' || !collides
    ? safeBaseName
    : `${safeBaseName.replace(/\.[a-z0-9]+$/i, '')}-${contentHash.slice(0, 12)}${safeBaseName.match(/\.[a-z0-9]+$/i)?.[0] || ''}`
  const dir = join(mediaDir, sub)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, safeName), stored.buffer)

  const baseName = safeName.replace(/\.[a-z0-9]+$/i, '')
  const urlPath =
    mediaKind === 'reference' ? `/media/${site}/reference/${safeName}` : `/media/${site}/${safeName}`
  const storedIntegrity = inspectImageBuffer(stored.buffer)
  const sha256 = contentHash
  const persistDerivative = async (suffix, generate) => {
    try {
      const derivative = await generate(stored.buffer)
      if (!derivative?.ok || !derivative.buffer) return null
      const isCanonicalEnough =
        derivative.width === storedIntegrity.width &&
        derivative.height === storedIntegrity.height &&
        derivative.buffer.length >= stored.buffer.length
      if (isCanonicalEnough) {
        return {
          path: urlPath,
          bytes: stored.buffer.length,
          width: storedIntegrity.width,
          height: storedIntegrity.height,
          sourceHash: sha256
        }
      }
      const filename = `${baseName}_${suffix}.jpg`
      writeFileSync(join(dir, filename), derivative.buffer)
      return {
        path: mediaKind === 'reference' ? `/media/${site}/reference/${filename}` : `/media/${site}/${filename}`,
        bytes: derivative.buffer.length,
        width: derivative.width,
        height: derivative.height,
        sourceHash: sha256
      }
    } catch (error) {
      console.warn(`[media] no se pudo generar ${suffix}`, error.message)
      return null
    }
  }
  // Deterministic names plus the canonical hash in the client URL make this
  // safe to repeat when a file is reindexed or uploaded again.
  const thumb = await persistDerivative('thumb', (input) => generateThumbBuffer(input, 400))
  const preview = await persistDerivative('preview', (input) => generatePreviewBuffer(input, 1200))
  const item = mediaForClient({
    id: `media-${Date.now()}`,
    site,
    path: urlPath,
    alt,
    kind: mediaKind,
    filename: safeName,
    originalBytes: stored.originalBytes || buf.length,
    storedBytes: stored.buffer.length,
    width: storedIntegrity.width || stored.width || integrity.width || 0,
    height: storedIntegrity.height || stored.height || integrity.height || 0,
    optimized: Boolean(stored.optimized),
    metadataSanitized: Boolean(stored.metadataSanitized),
    mimeType: { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[stored.format || integrity.format] || '',
    sha256,
    provenanceVersion: brandGrounding?.provenanceVersion || 'legacy',
    metadata: {
      alt: String(alt || ''),
      ...(imageDimensions ? {
        originalDimensions: imageDimensions.original,
        normalizedDimensions: imageDimensions.final,
        autoNormalized: Boolean(imageDimensions.normalized),
        originalSha256: imageDimensions.originalSha256
      } : {}),
      ...(brandGrounding ? { assetType: brandGrounding.assetType } : {})
    },
    ...(imageDimensions ? {
      originalDimensions: imageDimensions.original,
      normalizedDimensions: imageDimensions.final,
      autoNormalized: Boolean(imageDimensions.normalized)
    } : {}),
    ...(thumb ? { thumbPath: thumb.path, thumbBytes: thumb.bytes, thumbWidth: thumb.width, thumbHeight: thumb.height } : {}),
    ...(preview ? { previewPath: preview.path, previewBytes: preview.bytes, previewWidth: preview.width, previewHeight: preview.height } : {}),
    ...(brandGrounding ? { brandGrounding } : {})
  })
  db.media = db.media || []
  db.media.push(item)
  writeDb(db)
  if (mediaKind === 'reference') invalidateBrandKitCache(site)
  return item
}

export async function saveUploadedVideoMedia({
  site,
  filename = `escarlet-video-${Date.now()}.webm`,
  buffer,
  mimeType = 'video/webm',
  format = 'portrait',
  alt = '',
  skipLegacyDb = false
} = {}) {
  const { persistVideoFile } = await import('./video-media.mjs')
  try {
    return persistVideoFile({ site, filename, buffer, mimeType, format, alt, role: 'source_video', skipLegacyDb })
  } catch (error) {
    throw new CmsError(error.status || 400, error.message, error.extra)
  }
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
  assertEntitlementWrite(site, 'drafts', { skipQuota: Boolean(body.skipQuota), db, userId: body.membershipUserId || '' })
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
    relatedSlugs,
    contentSource: normalizeContentSource(body.contentSource || 'agency'),
    ownerId: body.ownerId || body.createdBy || '',
    assistantConversationId: String(body.assistantConversationId || body.conversationId || '').trim()
  })
  upsertPost(db, draft)
  if (!body.skipQuota) recordUsage(site, 'drafts', { db })
  writeDb(db)
  return withPostLinks({ post: withResolvedImages(draft), reminder: readBrandContext(site).reminder }, site, slug)
}

export async function updatePost(body) {
  const db = readDb()
  const site = body.site || DEFAULT_SITE
  assertMembershipActive(site, { db, userId: body.membershipUserId || '' })
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
  const needsHuman = isAgencyGate(siteConfig) && body.direct !== true
  const wasPublished = existing.status === 'published'
  const wasScheduled =
    existing.status === 'scheduled' || existing.status === 'pending_schedule'
  const keepPublished = Boolean(body.keepPublished)
  const { originalSlug: _originalSlug, keepPublished: _keepPublished, direct: _direct, membershipUserId: _membershipUserId, ...fields } = body

  const hasExplicitStatus = Object.prototype.hasOwnProperty.call(fields, 'status') && fields.status != null && fields.status !== ''
  let status = hasExplicitStatus ? fields.status : existing.status || 'draft'
  let demotedToReview = false
  if (wasPublished && needsHuman && !keepPublished && !hasExplicitStatus) {
    status = 'review'
    demotedToReview = true
  }
  // Editar un programado sin keepPublished lo saca de la cola.
  if (wasScheduled && !keepPublished && !hasExplicitStatus) {
    status = needsHuman ? 'review' : 'draft'
    demotedToReview = needsHuman
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
  if (wasPublished) post.publicationCounted = true

  // Preserve ownership metadata for per-user draft visibility. Older posts do
  // not have an owner and continue to behave as legacy/admin-managed content.
  if (!post.ownerId && (body.ownerId || body.createdBy)) {
    post.ownerId = body.ownerId || body.createdBy
  }

  if (Object.prototype.hasOwnProperty.call(fields, 'contentSource')) {
    post.contentSource = normalizeContentSource(fields.contentSource, existing.contentSource || 'agency')
  } else if (!post.contentSource) {
    post.contentSource = existing.contentSource || 'agency'
  }

  // Clearing reject metadata when leaving changes_requested via explicit status.
  if (status !== 'changes_requested' && existing.status === 'changes_requested' && hasExplicitStatus) {
    delete post.rejectReason
    delete post.rejectActor
    delete post.rejectAt
  }

  if (Object.prototype.hasOwnProperty.call(fields, 'publishAt')) {
    try {
      const nextAt = fields.publishAt ? parsePublishAt(fields.publishAt) : ''
      post.publishAt = nextAt || undefined
      if (!nextAt) delete post.publishAt
    } catch (err) {
      throw new CmsError(400, err.message)
    }
  }

  // Persistimos HTML semántico. Si llega Markdown (editor/API), lo convertimos.
  if (Object.prototype.hasOwnProperty.call(fields, 'bodyHtml')) {
    post.bodyHtml = renderPostBody(post.bodyHtml || '')
  }

  if (status === 'draft' || status === 'review' || status === 'changes_requested') {
    if (!Object.prototype.hasOwnProperty.call(fields, 'publishAt')) {
      // Al demote, limpia publishAt salvo que el cliente lo reenvíe.
      if (wasScheduled) delete post.publishAt
    }
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

export async function unpublishPost(site, slug, options = {}) {
  assertMembershipActive(site, { userId: options.membershipUserId || '' })
  const db = readDb()
  const post = findPost(db, site, slug)
  if (!post) throw new CmsError(404, 'Post no encontrado')
  const wasLive = post.status === 'published'
  post.status = 'draft'
  post.dateModified = todayIso()
  delete post.publishAt
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

export async function deletePost(site, slug, options = {}) {
  assertMembershipActive(site, { userId: options.membershipUserId || '' })
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
  const needsHuman = isAgencyGate(siteConfig)
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
      canSubmitForReview: isAgencyGate(siteConfig),
      hint: seoHints(validation, siteConfig)
    },
    site,
    slug
  )
}

export async function publishPost(site, slug, options = {}) {
  const db = readDb()
  const post = findPost(db, site, slug)
  if (!post) throw new CmsError(404, 'Post no encontrado')
  const siteConfig = loadSiteConfig(site)
  const validation = withCoverIntegrity(validatePostSeo(post, site), post)
  const needsHuman = isAgencyGate(siteConfig) && options.direct !== true
  const skipQuota = Boolean(options.skipQuota)
  const ignoreSeo = Boolean(options.ignoreSeo)

  assertMembershipActive(site, { db, userId: options.membershipUserId || '' })

  let publishAt = ''
  try {
    publishAt = options.publishAt ? parsePublishAt(options.publishAt) : ''
  } catch (err) {
    throw new CmsError(400, err.message)
  }

  if (publishAt && isFuturePublishAt(publishAt)) {
    return schedulePost(site, slug, publishAt, { db, post, siteConfig, validation, skipQuota, ignoreSeo, direct: options.direct === true, membershipUserId: options.membershipUserId || '' })
  }

  // Agency gate: draft or changes_requested → review (hold live publish).
  if (needsHuman && (post.status === 'draft' || post.status === 'changes_requested')) {
    post.status = 'review'
    post.dateModified = todayIso()
    if (post.status === 'review' && post.rejectReason && options.clearReject !== false) {
      // Keep last rejectReason visible until agency clears or republishes.
    }
    if (publishAt) post.publishAt = publishAt
    else delete post.publishAt
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

  if (!post.publicationCounted && post.status !== 'published') assertEntitlementWrite(site, 'publishes', { skipQuota, db, userId: options.membershipUserId || '' })

  if (!validation.ok && !ignoreSeo) {
    throw new CmsError(422, 'SEO no válido. Corrige los errores antes de publicar.', {
      validation,
      blockingErrors: validation.errors,
      warnings: validation.warnings,
      hint: seoHints(validation, siteConfig)
    })
  }

  const firstPublication = !post.publicationCounted && post.status !== 'published'
  post.publicationCounted = true
  post.status = 'published'
  post.dateModified = todayIso()
  if (!post.datePublished) post.datePublished = publishAt || todayIso()
  delete post.publishAt
  delete post.rejectReason
  delete post.rejectActor
  delete post.rejectAt
  upsertPost(db, post)
  if (firstPublication && !skipQuota) recordUsage(site, 'publishes', { db })
  writeDb(db)
  const rebuild = await notifyRebuild(site)
  return withPostLinks(
    { post: withResolvedImages(post), validation, rebuild, published: true, seoBypassed: Boolean(ignoreSeo && !validation.ok) },
    site,
    slug
  )
}

/**
 * Agency returns a post in review with a required non-empty reason.
 */
export async function requestPostChanges(site, slug, options = {}) {
  const reason = String(options.rejectReason || '').trim()
  if (!reason) throw new CmsError(400, 'rejectReason is required')
  const db = readDb()
  const post = findPost(db, site, slug)
  if (!post) throw new CmsError(404, 'Post no encontrado')
  if (post.status !== 'review' && post.status !== 'draft') {
    throw new CmsError(400, 'Solo se pueden pedir cambios sobre un post en review o draft.')
  }
  const actor = options.actor || {}
  post.status = 'changes_requested'
  post.rejectReason = reason
  post.rejectActor = actor.role || actor.id || 'agency'
  post.rejectAt = new Date().toISOString()
  post.dateModified = todayIso()
  upsertPost(db, post)
  writeDb(db)
  return withPostLinks(
    {
      post: withResolvedImages(post),
      changesRequested: true,
      message: 'Cambios solicitados. El cliente verá el motivo en el admin, MCP y el enlace de revisión.'
    },
    site,
    slug
  )
}

/**
 * Apply a shareable review-link action (approve → publish live; request_changes → reason).
 */
export async function applyReviewLinkAction(site, slug, { action, rejectReason, actor } = {}) {
  if (action === 'request_changes') {
    return requestPostChanges(site, slug, { rejectReason, actor })
  }
  if (action === 'approve') {
    const db = readDb()
    const post = findPost(db, site, slug)
    if (!post) throw new CmsError(404, 'Post no encontrado')
    if (post.status === 'draft' || post.status === 'changes_requested') {
      post.status = 'review'
      upsertPost(db, post)
      writeDb(db)
    }
    return publishPost(site, slug, { fromReviewLink: true })
  }
  throw new CmsError(400, `Acción de revisión desconocida: ${action}`)
}

async function schedulePost(site, slug, publishAt, ctx = {}) {
  const db = ctx.db || readDb()
  const post = ctx.post || findPost(db, site, slug)
  if (!post) throw new CmsError(404, 'Post no encontrado')
  const siteConfig = ctx.siteConfig || loadSiteConfig(site)
  const validation =
    ctx.validation || withCoverIntegrity(validatePostSeo(post, site), post)
  const ignoreSeo = Boolean(ctx.ignoreSeo)

  if (!validation.ok && !ignoreSeo) {
    throw new CmsError(422, 'SEO no válido. Corrige los errores antes de programar.', {
      validation,
      blockingErrors: validation.errors,
      warnings: validation.warnings,
      hint: seoHints(validation, siteConfig)
    })
  }

  const needsConfirm = siteConfig?.requiresPublishConfirmation !== false && ctx.direct !== true
  post.publishAt = publishAt
  post.status = needsConfirm ? 'pending_schedule' : 'scheduled'
  post.dateModified = todayIso()
  if (ctx.skipQuota) post.quotaExempt = true
  upsertPost(db, post)
  writeDb(db)

  return withPostLinks(
    {
      post: withResolvedImages(post),
      validation,
      scheduled: !needsConfirm,
      pendingConfirmation: needsConfirm,
      publishAt,
      seoBypassed: Boolean(ignoreSeo && !validation.ok),
      message: needsConfirm
        ? `Post programado para ${publishAt}. Espera confirmación del super-admin antes de entrar en la cola.`
        : `Post programado para ${publishAt}. Se publicará automáticamente ese día.`
    },
    site,
    slug
  )
}

export async function schedulePostForDate(site, slug, publishAt, options = {}) {
  assertMembershipActive(site, { userId: options.membershipUserId || '' })
  let day = ''
  try {
    day = parsePublishAt(publishAt)
  } catch (err) {
    throw new CmsError(400, err.message)
  }
  if (!day) throw new CmsError(400, 'Falta publishAt (YYYY-MM-DD).')
  if (!isFuturePublishAt(day)) {
    return publishPost(site, slug, { publishAt: day, ignoreSeo: Boolean(options.ignoreSeo), direct: options.direct === true, skipQuota: Boolean(options.skipQuota), membershipUserId: options.membershipUserId || '' })
  }
  return schedulePost(site, slug, day, { ignoreSeo: Boolean(options.ignoreSeo), direct: options.direct === true, skipQuota: Boolean(options.skipQuota), membershipUserId: options.membershipUserId || '' })
}

export async function confirmSchedule(site, slug, options = {}) {
  const db = readDb()
  const post = findPost(db, site, slug)
  if (!post) throw new CmsError(404, 'Post no encontrado')
  if (post.status !== 'pending_schedule') {
    throw new CmsError(400, 'Solo se confirman posts en pending_schedule.')
  }
  let publishAt = ''
  try {
    publishAt = parsePublishAt(post.publishAt)
  } catch (err) {
    throw new CmsError(400, err.message)
  }
  if (!publishAt) throw new CmsError(400, 'El post no tiene publishAt.')

  const validation = withCoverIntegrity(validatePostSeo(post, site), post)
  if (!validation.ok) {
    throw new CmsError(422, 'SEO no válido. Corrige antes de confirmar.', {
      validation,
      blockingErrors: validation.errors,
      warnings: validation.warnings
    })
  }

  if (!isFuturePublishAt(publishAt)) {
    assertEntitlementWrite(site, 'publishes', { db, skipQuota: Boolean(options.skipQuota), userId: options.membershipUserId || '' })
    post.status = 'published'
    post.dateModified = todayIso()
    if (!post.datePublished) post.datePublished = publishAt
    delete post.publishAt
    upsertPost(db, post)
    if (!post.quotaExempt) recordUsage(site, 'publishes', { db })
    delete post.quotaExempt
    writeDb(db)
    const rebuild = await notifyRebuild(site)
    return withPostLinks(
      {
        post: withResolvedImages(post),
        validation,
        published: true,
        rebuild,
        message: 'Fecha ya vencida. Post publicado en vivo.'
      },
      site,
      slug
    )
  }

  post.status = 'scheduled'
  post.dateModified = todayIso()
  upsertPost(db, post)
  writeDb(db)
  return withPostLinks(
    {
      post: withResolvedImages(post),
      validation,
      confirmed: true,
      publishAt,
      message: `Confirmado. Se publicará el ${publishAt}.`
    },
    site,
    slug
  )
}

export async function cancelSchedule(site, slug, options = {}) {
  assertMembershipActive(site, { userId: options.membershipUserId || '' })
  const db = readDb()
  const post = findPost(db, site, slug)
  if (!post) throw new CmsError(404, 'Post no encontrado')
  if (post.status !== 'pending_schedule' && post.status !== 'scheduled') {
    throw new CmsError(400, 'El post no está programado.')
  }
  const siteConfig = loadSiteConfig(site)
  const needsHuman = isAgencyGate(siteConfig)
  post.status = needsHuman ? 'review' : 'draft'
  post.dateModified = todayIso()
  delete post.publishAt
  upsertPost(db, post)
  writeDb(db)
  return withPostLinks(
    {
      post: withResolvedImages(post),
      cancelled: true,
      message: needsHuman
        ? 'Programación cancelada. El post volvió a revisión.'
        : 'Programación cancelada. El post volvió a borrador.'
    },
    site,
    slug
  )
}

export async function listCalendarPosts(site, from, to) {
  const db = readDb()
  let fromDay = ''
  let toDay = ''
  try {
    fromDay = from ? parsePublishAt(from) : ''
    toDay = to ? parsePublishAt(to) : ''
  } catch (err) {
    throw new CmsError(400, err.message)
  }

  const posts = db.posts
    .filter((p) => {
      if (site && p.site !== site) return false
      if (!['pending_schedule', 'scheduled'].includes(p.status)) return false
      const day = String(p.publishAt || '').slice(0, 10)
      if (!day) return false
      if (fromDay && day < fromDay) return false
      if (toDay && day > toDay) return false
      return true
    })
    .map((p) => {
      const calendarDate = String(p.publishAt || '').slice(0, 10)
      return withResolvedImages({ ...p, calendarDate })
    })
    .sort((a, b) => String(b.calendarDate).localeCompare(String(a.calendarDate)))

  return { posts, from: fromDay || null, to: toDay || null }
}

export async function promoteDueScheduledPosts(today = todayIso()) {
  const db = readDb()
  const due = db.posts.filter(
    (p) => p.status === 'scheduled' && p.publishAt && String(p.publishAt).slice(0, 10) <= today
  )
  if (!due.length) return { promoted: [], rebuilds: {}, skipped: [] }

  const sites = new Set()
  const promoted = []
  const skipped = []
  for (const post of due) {
    try {
      assertMembershipActive(post.site, { db, userId: post.ownerId || '' })
      if (!post.publicationCounted && !post.quotaExempt) assertEntitlementWrite(post.site, 'publishes', { db, userId: post.ownerId || '' })
    } catch (err) {
      if (err.extra?.code === 'MEMBERSHIP_SUSPENDED') {
        post.membershipHeldPublishAt = post.publishAt
        post.status = 'draft'
        delete post.publishAt
      }
      skipped.push({
        site: post.site,
        slug: post.slug,
        code: err.extra?.code || 'ENTITLEMENT',
        message: err.message
      })
      continue
    }
    const firstPublication = !post.publicationCounted
    post.publicationCounted = true
    post.status = 'published'
    post.dateModified = today
    if (!post.datePublished) post.datePublished = String(post.publishAt).slice(0, 10)
    delete post.publishAt
    upsertPost(db, post)
    if (firstPublication && !post.quotaExempt) recordUsage(post.site, 'publishes', { db })
    delete post.quotaExempt
    sites.add(post.site)
    promoted.push({ site: post.site, slug: post.slug, datePublished: post.datePublished })
  }
  writeDb(db)

  const rebuilds = {}
  for (const site of sites) {
    rebuilds[site] = await notifyRebuild(site)
  }
  return { promoted, rebuilds, skipped, count: promoted.length }
}

export async function uploadMedia(payload) {
  const site = payload.site || DEFAULT_SITE
  assertMembershipActive(site, { userId: payload.membershipUserId || '' })
  const connectorFile = pickConnectorFile(payload)
  if (connectorFile?.sandboxPath && !connectorFile.download_url) {
    throw new CmsError(400, sandboxImageHint(connectorFile.sandboxPath), {
      recovery: {
        next: 'A→B→C',
        tools: ['content_upload_media'],
        use: 'Adjunta file. Si el host no lo acepta, usa contentBase64 o trozos con uploadId. Resuelve solo.',
        kind: ['post', 'social', 'reference'],
        avoid: ['/mnt/data', 'curl', 'PUT', 'preguntar al humano']
      }
    })
  }
  const kind = inferMediaKind({
    kind: payload.kind,
    filename: payload.filename || connectorFile?.file_name || payload.filePath
  })
  const alt = payload.alt || payload.imageAlt || ''
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
      filename,
      metadata: {
        site,
        filename,
        kind,
        preparationId: payload.preparationId || '',
        itemId: payload.itemId || '',
        channels: payload.channels || [],
        assetIndex: Number(payload.assetIndex ?? 0),
        expectedDimensions: payload.expectedDimensions || '',
        sourceDimensions: payload.sourceDimensions || null,
        autoNormalize: payload.autoNormalize !== false,
        alt,
        idempotencyKey: payload.idempotencyKey || ''
      }
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
    if (assembled.finalizedResult) return { ...assembled.finalizedResult, idempotentReplay: true }
    const result = await finalizeUploadedMedia({
      site,
      filename: assembled.filename || filename,
      contentBase64: assembled.contentBase64,
      alt,
      kind,
      generationReceiptId: payload.generationReceiptId,
      brandPreparationId: payload.brandPreparationId,
      brandAssetType: payload.brandAssetType,
      brandRoute: payload.brandRoute,
      itemId: payload.itemId,
      textRendered: payload.textRendered,
      templateId: payload.templateId,
      renderedBy: payload.renderedBy,
      textContent: payload.textContent,
      brandGroundingOverride: payload.brandGroundingOverride,
      requireBrandGrounding: payload.requireBrandGrounding,
      autoNormalize: payload.autoNormalize !== false,
      composeMode: payload.composeMode
    })
    rememberUploadResult(payload.uploadId, result)
    return result
  }

  if (!filename || (!contentBase64 && !imageUrl && !filePath && !hasBinary)) {
    throw new CmsError(
      400,
      'Falta la imagen. Usa content_upload_media con file, contentBase64/blob o uploadId a trozos. Resuelve solo. kind post, social o reference.',
      {
        recovery: {
          next: 'A→B→C',
          tools: ['content_upload_media'],
          kind: ['post', 'social', 'reference'],
          use: ['file', 'contentBase64', 'blob', 'uploadId+chunkIndex+chunkCount'],
          autonomy: 'Si file no es invocable, usa contentBase64 o blob al momento.'
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
        tools: ['content_upload_media'],
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
    alt,
    kind,
    generationReceiptId: payload.generationReceiptId,
    brandPreparationId: payload.brandPreparationId,
    brandAssetType: payload.brandAssetType,
    brandRoute: payload.brandRoute,
    itemId: payload.itemId,
    textRendered: payload.textRendered,
    templateId: payload.templateId,
    renderedBy: payload.renderedBy,
    textContent: payload.textContent,
    brandGroundingOverride: payload.brandGroundingOverride,
    requireBrandGrounding: payload.requireBrandGrounding,
    composeMode: payload.composeMode,
    autoNormalize: payload.autoNormalize !== false
  })
}

export async function finalizeUploadedMedia({ site, filename, contentBase64, imageUrl, filePath, buffer, alt, kind, generationReceiptId, brandPreparationId, brandAssetType, brandRoute, itemId, textRendered, templateId, renderedBy, textContent, brandGroundingOverride, requireBrandGrounding, autoNormalize = true, composeMode } = {}) {
  const requestedComposeMode = String(composeMode || brandGroundingOverride?.composeMode || '').trim().toLowerCase()
  if (requestedComposeMode && requestedComposeMode !== 'passthrough') {
    throw new CmsError(409, 'La composición CMS está desactivada. Sube siempre la imagen final con texto integrado.', { code: 'CMS_COMPOSITION_DISABLED' })
  }
  const sourceBuffer = await bufferFromUpload({ contentBase64, imageUrl, filePath, buffer })
  let uploadBuffer = sourceBuffer
  let imageDimensions = null
  let logoApplied = false
  let brandGrounding = brandGroundingOverride && typeof brandGroundingOverride === 'object' ? brandGroundingOverride : null
  const originalSha256 = createHash('sha256').update(sourceBuffer).digest('hex')
  if (brandGrounding) {
    assertAssetTypeForMediaKind(kind, brandGrounding.assetType)
    const normalized = await normalizeGeneratedImage(sourceBuffer, brandGrounding.assetType, { autoNormalize })
    uploadBuffer = normalized.buffer
    const socialAsset = ['social_image', 'instagram_story'].includes(String(brandGrounding.assetType || '').trim())
    const renderedText = socialAsset
      ? assertSocialTextMetadata({
          assetType: brandGrounding.assetType,
          textRendered: brandGrounding.textRendered ?? textRendered,
          templateId: brandGrounding.templateId || templateId,
          renderedBy: brandGrounding.renderedBy || renderedBy,
          textContent: brandGrounding.textContent || brandGrounding.socialTextContent || textContent
        })
      : null
    const final = normalized.final
    if (!final.ok || !final.width || !final.height) throw new CmsError(400, 'No se pudo verificar la imagen final.', { code: 'IMAGE_VERIFY_FAILED' })
    imageDimensions = {
      original: { width: normalized.source.width, height: normalized.source.height },
      final: { width: final.width, height: final.height },
      normalized: normalized.normalized,
      textRendered: Boolean(renderedText),
      originalSha256
    }
    const { socialTextContent, ...safeGrounding } = brandGrounding
    delete safeGrounding.composeMode
    brandGrounding = {
      ...safeGrounding,
      ...(renderedText || {}),
      logoApplied: false,
      backgroundSha256: createHash('sha256').update(normalized.buffer).digest('hex'),
      generatedFileHash: createHash('sha256').update(uploadBuffer).digest('hex'),
      generatedWidth: imageDimensions.final.width,
      generatedHeight: imageDimensions.final.height,
      generatedFormat: final.format,
      originalWidth: imageDimensions.original.width,
      originalHeight: imageDimensions.original.height,
      autoNormalized: imageDimensions.normalized
    }
  }
  if (requireBrandGrounding && ['post', 'social'].includes(kind) && !brandGrounding) {
    throw new CmsError(409, 'La imagen necesita una preparación visual válida. Llama brand_prepare_image_generation y vuelve a subirla con preparationId.', { code: 'BRAND_PREPARATION_REQUIRED' })
  }
  const media = await saveUploadedMedia({
    site,
    filename,
    contentBase64,
    imageUrl,
    filePath,
    buffer: uploadBuffer,
    alt,
    kind,
    brandGrounding,
    imageDimensions
  })
  const absolute = absoluteMediaUrl(media.path || media.url)
  const previewAbsolute = absoluteMediaUrl(media.previewPath || media.previewUrl || media.path || media.url)
  const finalSha256 = media.sha256 || createHash('sha256').update(uploadBuffer).digest('hex')
  const suggestedPostPatch =
    kind === 'social'
      ? String(brandGrounding?.assetType || '') === 'instagram_story'
        ? {
            site,
            socialPack: {
              instagramStory: {
                frames: [{
                  assetIndex: Number(brandGrounding?.assetIndex ?? 0),
                  imageUrl: absolute,
                  alt: alt || '',
                  ...(brandGrounding?.textContent ? { textContent: brandGrounding.textContent } : {})
                }]
              }
            }
          }
        : {
            site,
            socialPack: {
              instagramSlides: [{
                assetIndex: Number(brandGrounding?.assetIndex ?? 0),
                imageUrl: absolute,
                alt: alt || '',
                ...(brandGrounding?.textContent ? { textContent: brandGrounding.textContent } : {})
              }]
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
    previewUrl: previewAbsolute || absolute,
    originalSha256,
    finalSha256,
    textRendered: Boolean(brandGrounding?.textRendered),
    logoApplied,
    kind,
    nextStep: kind === 'social'
      ? 'Imagen social final guardada tal cual, con texto integrado por ChatGPT.'
      : 'Usa media.url como portada del post.',
    suggestedTool: 'blog_update_post',
    suggestedPostPatch,
    reviewHint:
      kind === 'social'
        ? `Slide lista. Preview: ${previewAbsolute || absolute}`
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
    alt: payload.alt || '',
    membershipUserId: payload.membershipUserId || '',
    brandPreparationId: payload.brandPreparationId || '',
    generationReceiptId: payload.generationReceiptId || '',
    brandAssetType: payload.brandAssetType || '',
    brandRoute: payload.brandRoute || '',
    itemId: payload.itemId || '',
    textRendered: payload.textRendered,
    templateId: payload.templateId || '',
    renderedBy: payload.renderedBy || '',
    textContent: payload.textContent,
    requireBrandGrounding: Boolean(payload.requireBrandGrounding)
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
    membershipUserId: meta.membershipUserId || '',
    brandPreparationId: meta.brandPreparationId || '',
    generationReceiptId: meta.generationReceiptId || '',
    brandAssetType: meta.brandAssetType || '',
    brandRoute: meta.brandRoute || '',
    itemId: meta.itemId || '',
    textRendered: meta.textRendered,
    templateId: meta.templateId || '',
    renderedBy: meta.renderedBy || '',
    textContent: meta.textContent,
    requireBrandGrounding: Boolean(meta.requireBrandGrounding),
    buffer
  })
  consumeImageDrop(token)
  return result
}

export async function deleteMedia(site, id, pathHint = '', options = {}) {
  assertMembershipActive(site, { userId: options.membershipUserId || '' })
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

  const variantCandidates = []
  for (const variantPath of [item?.thumbPath, item?.previewPath]) {
    const variantRel = String(variantPath || '')
      .replace(/^https?:\/\/[^/]+/i, '')
      .replace(/^\/media\//, '')
      .split('?')[0]
    if (variantRel && !variantRel.includes('..')) variantCandidates.push(join(mediaDir, variantRel))
  }
  for (const suffix of ['_thumb.jpg', '_thumb.webp', '_preview.jpg', '_preview.webp']) {
    variantCandidates.push(disk.replace(/\.[a-z0-9]+$/i, suffix))
  }
  for (const variantDisk of new Set(variantCandidates)) {
    if (!variantDisk || !existsSync(variantDisk)) continue
    try {
      unlinkSync(variantDisk)
    } catch (error) {
      console.warn('[media] no se pudo borrar derivado', variantDisk, error.message)
    }
  }

  if (item?.kind === 'reference') invalidateBrandKitCache(site)

  return { deleted: true, id: item?.id || null, path: `/media/${rel}` }
}

export async function updateMediaAlt(site, id, alt = '', options = {}) {
  return updateMediaDetails(site, id, { alt }, options)
}

export async function updateMediaDetails(site, id, details = {}, options = {}) {
  assertMembershipActive(site, { userId: options.membershipUserId || '' })
  if (!id) throw new CmsError(400, 'Falta id')
  const db = readDb()
  const list = db.media || []
  const idx = list.findIndex((m) => m.id === id && (!site || m.site === site))
  if (idx < 0) throw new CmsError(404, 'Media no encontrado')
  const filename = String(details.filename ?? list[idx].filename ?? '').trim().replace(/[\\/]+/g, '-').slice(0, 240)
  const metadata = { ...(list[idx].metadata && typeof list[idx].metadata === 'object' ? list[idx].metadata : {}) }
  if (details.usage !== undefined) metadata.usage = String(details.usage || '').trim().slice(0, 80)
  list[idx] = {
    ...list[idx],
    ...(details.alt !== undefined ? { alt: String(details.alt || '').slice(0, 500) } : {}),
    ...(filename ? { filename } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {})
  }
  db.media = list
  writeDb(db)
  return { media: mediaForClient(list[idx]) }
}

export async function getBrandContext(site, options = {}) {
  const files = brandFilesForAuth(options.auth || { role: 'admin' })
  const labels = brandLabelsForAuth(options.auth || { role: 'admin' })
  return {
    ...readBrandContext(site, options),
    files,
    labels
  }
}

export async function getBrandFile(site, file, options = {}) {
  try {
    const name = assertBrandFileAccess(options.auth, file, { write: false })
    return { site, file: name, content: readBrandFile(site, name) }
  } catch (err) {
    throw new CmsError(err.status || 400, err.message)
  }
}

export async function updateBrandFile(site, file, content, options = {}) {
  try {
    const name = assertBrandFileAccess(options.auth, file, { write: true })
    writeBrandFile(site, name, content || '')
    return { ok: true, file: name }
  } catch (err) {
    throw new CmsError(err.status || 400, err.message, err.extra || {})
  }
}

export async function importBrandZip(site, payload = {}, options = {}) {
  if (options.auth && options.auth.role !== 'admin') {
    throw new CmsError(403, 'Solo el super-admin puede importar un ZIP de brand kit.')
  }
  return importBrandKitZip(site, payload)
}

export async function getSeoContext(site) {
  return readSeoContext(site)
}

export { DEFAULT_SITE }
