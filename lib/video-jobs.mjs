import { randomUUID } from 'node:crypto'
import { getPgPool, runCoreMigrations, withPgTransaction } from './pg.mjs'
import { normalizeProvider } from './video-provider.mjs'
import {
  persistVideoFile,
  resolveVideoUploadBuffer,
  VIDEO_MAX_IMPORT_BYTES,
  videoImportAllowlistCheck
} from './video-media.mjs'
import { fetchRemote } from './remote-fetch.mjs'
import { canonicalCmsPublicUrl } from './cms-url.mjs'
import { absoluteMediaUrl } from './preview-url.mjs'
import {
  attachContentMedia,
  createContentBatch,
  registerContentMedia,
  updateContentItem
} from './workspace-domain.mjs'

export const VIDEO_JOB_STATUSES = Object.freeze([
  'raw', 'queued', 'transcribing', 'editing', 'rendering', 'ready_for_review',
  'approved', 'scheduled', 'published', 'failed', 'cancelled'
])

function text(value, max = 500) { return String(value ?? '').trim().slice(0, max) }
function jsonObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }

function videoError(message, status, code, extra = {}) {
  return Object.assign(new Error(message), { status, code, extra })
}

async function poolOrThrow() {
  await runCoreMigrations()
  const pool = await getPgPool()
  if (!pool) throw videoError('Postgres no está configurado.', 503, 'postgres_required')
  return pool
}

export function newVideoJobId() {
  return `vid_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

function rowToJob(row, siteHandle = '') {
  if (!row) return null
  const metadata = jsonObject(row.metadata)
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    contentItemId: row.content_item_id,
    sourceMediaId: row.source_media_id,
    finalMediaId: row.final_media_id,
    coverMediaId: row.cover_media_id,
    provider: row.provider,
    status: row.status,
    providerProjectId: row.provider_project_id,
    providerCompositionId: row.provider_composition_id,
    speaker: row.speaker,
    channel: row.channel,
    format: row.format,
    objective: row.objective,
    topic: row.topic,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    brand: siteHandle || row.site_handle || ''
  }
}

async function loadMediaUrls(client, mediaIds = []) {
  const ids = [...new Set(mediaIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const result = await client.query('SELECT id,storage_key,public_url,content_type,metadata FROM media_assets WHERE id = ANY($1::text[])', [ids])
  return new Map(result.rows.map((row) => [row.id, row]))
}

function publicMediaUrl(row) {
  if (!row) return ''
  const fromDb = text(row.public_url, 2000)
  if (fromDb) return canonicalCmsPublicUrl(fromDb)
  const key = text(row.storage_key, 1000)
  return key ? canonicalCmsPublicUrl(absoluteMediaUrl(`/${key.replace(/^\//, '')}`)) : ''
}

export async function assembleVideoJobContext(job, { siteHandle = '', mediaById = null } = {}) {
  const source = mediaById?.get(job.sourceMediaId)
  const finalMedia = mediaById?.get(job.finalMediaId)
  const cover = mediaById?.get(job.coverMediaId)
  const sourceUrl = publicMediaUrl(source)
  const finalUrl = publicMediaUrl(finalMedia)
  const coverUrl = publicMediaUrl(cover)
  const localhostWarning = [sourceUrl, finalUrl].some((url) => /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url))
  return {
    videoJobId: job.id,
    contentItemId: job.contentItemId,
    sourceMediaId: job.sourceMediaId,
    finalMediaId: job.finalMediaId,
    coverMediaId: job.coverMediaId,
    sourceUrl,
    finalUrl,
    coverUrl,
    brand: siteHandle || job.brand,
    speaker: job.speaker,
    channel: job.channel,
    format: job.format,
    objective: job.objective,
    topic: job.topic,
    status: job.status,
    provider: job.provider,
    providerProjectId: job.providerProjectId,
    providerCompositionId: job.providerCompositionId,
    metadata: job.metadata,
    ...(localhostWarning ? { urlWarning: 'Las URLs de vídeo no son públicas en internet. Descript y Buffer necesitan HTTPS accesible desde fuera.' } : {})
  }
}

async function appendVersionMetadata(metadata, entry) {
  const base = jsonObject(metadata)
  const versions = Array.isArray(base.versions) ? base.versions.slice() : []
  versions.push(entry)
  return { ...base, versions }
}

export async function getVideoJobRecord({ workspaceId, siteId, videoJobId, contentItemId } = {}) {
  const pool = await poolOrThrow()
  let result
  if (videoJobId) {
    result = await pool.query(`
      SELECT vj.*, s.handle AS site_handle
      FROM video_jobs vj
      JOIN sites s ON s.id = vj.site_id
      WHERE vj.id=$1 AND vj.workspace_id=$2 ${siteId ? 'AND vj.site_id=$3' : ''}
      LIMIT 1
    `, siteId ? [videoJobId, workspaceId, siteId] : [videoJobId, workspaceId])
  } else if (contentItemId) {
    result = await pool.query(`
      SELECT vj.*, s.handle AS site_handle
      FROM video_jobs vj
      JOIN sites s ON s.id = vj.site_id
      WHERE vj.content_item_id=$1 AND vj.workspace_id=$2 ${siteId ? 'AND vj.site_id=$3' : ''}
      ORDER BY vj.updated_at DESC
      LIMIT 1
    `, siteId ? [contentItemId, workspaceId, siteId] : [contentItemId, workspaceId])
  } else {
    throw videoError('videoJobId o contentItemId es obligatorio.', 400, 'VIDEO_JOB_NOT_FOUND')
  }
  if (!result.rowCount) throw videoError('Video job no encontrado.', 404, 'VIDEO_JOB_NOT_FOUND')
  return rowToJob(result.rows[0], result.rows[0].site_handle)
}

export async function listVideoJobs({ workspaceId, siteId, status, limit = 50 } = {}) {
  const pool = await poolOrThrow()
  const cleanStatus = text(status, 40)
  const max = Math.min(Math.max(Number(limit) || 50, 1), 200)
  const result = await pool.query(`
    SELECT vj.*, s.handle AS site_handle
    FROM video_jobs vj
    JOIN sites s ON s.id = vj.site_id
    WHERE vj.workspace_id=$1 ${siteId ? 'AND vj.site_id=$2' : ''}
    ${cleanStatus ? `AND vj.status=$${siteId ? 3 : 2}` : ''}
    ORDER BY vj.updated_at DESC
    LIMIT ${max}
  `, cleanStatus ? (siteId ? [workspaceId, siteId, cleanStatus] : [workspaceId, cleanStatus]) : (siteId ? [workspaceId, siteId] : [workspaceId]))
  return result.rows.map((row) => rowToJob(row, row.site_handle))
}

export async function createVideoJob({
  workspaceId,
  siteId,
  siteHandle,
  userId,
  role,
  contentItemId = null,
  sourceMediaId = null,
  provider = 'unknown',
  speaker = '',
  channel = 'instagram',
  format = 'reel',
  objective = '',
  topic = '',
  metadata = {},
  idempotencyKey = '',
  createContentIfMissing = false
} = {}) {
  const pool = await poolOrThrow()
  let itemId = text(contentItemId, 160) || null
  if (!itemId && createContentIfMissing) {
    const batch = await createContentBatch({
      workspaceId,
      siteId,
      userId,
      role,
      title: 'Vídeo',
      items: [{ brief: text(topic, 500) || 'Vídeo', title: 'Vídeo', variants: { video: { socialPack: { videoScript: text(topic, 2000) } } } }],
      channels: ['video'],
      metadata: { source: 'video_hub' }
    })
    itemId = batch.itemIds?.[0] || null
  }
  return withPgTransaction(pool, async (client) => {
    const cleanKey = text(idempotencyKey, 300)
    if (cleanKey) {
      const previous = await client.query('SELECT response FROM mutation_idempotency WHERE workspace_id=$1 AND scope=$2 AND idempotency_key=$3 FOR UPDATE', [workspaceId, 'video_create_job', cleanKey])
      if (previous.rowCount) return previous.rows[0].response
    }
    if (itemId) {
      const item = await client.query('SELECT id FROM content_items WHERE id=$1 AND workspace_id=$2 AND site_id=$3', [itemId, workspaceId, siteId])
      if (!item.rowCount) throw videoError('El content item no existe para esta marca.', 404, 'CONTENT_ITEM_NOT_FOUND')
    }
    if (sourceMediaId) {
      const media = await client.query('SELECT id FROM media_assets WHERE id=$1 AND workspace_id=$2 AND site_id=$3', [sourceMediaId, workspaceId, siteId])
      if (!media.rowCount) throw videoError('El medio fuente no pertenece a esta marca.', 404, 'MEDIA_ASSET_NOT_FOUND')
    }
    const jobId = newVideoJobId()
    const inserted = await client.query(`
      INSERT INTO video_jobs (
        id,workspace_id,site_id,content_item_id,source_media_id,provider,status,
        speaker,channel,format,objective,topic,metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [
      jobId, workspaceId, siteId, itemId, sourceMediaId, normalizeProvider(provider), 'raw',
      text(speaker, 120) || null, text(channel, 50) || null, text(format, 50) || null,
      text(objective, 500) || null, text(topic, 500) || null, JSON.stringify(jsonObject(metadata))
    ])
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      workspaceId, siteId, userId || null, 'video.job_created', 'video_job', jobId,
      JSON.stringify({ itemId, provider: normalizeProvider(provider), sourceMediaId })
    ])
    const job = rowToJob(inserted.rows[0], siteHandle)
    const response = { job, videoJobId: job.id }
    if (cleanKey) {
      await client.query('INSERT INTO mutation_idempotency (workspace_id,scope,idempotency_key,response) VALUES ($1,$2,$3,$4)', [workspaceId, 'video_create_job', cleanKey, JSON.stringify(response)])
    }
    console.info('[video] job_created', { videoJobId: jobId, itemId, provider: job.provider })
    return response
  })
}

export async function updateVideoJob({
  workspaceId,
  siteId,
  videoJobId,
  userId,
  role,
  status,
  provider,
  providerProjectId,
  providerCompositionId,
  speaker,
  channel,
  format,
  objective,
  topic,
  metadata,
  finalMediaId,
  sourceMediaId,
  coverMediaId,
  caption,
  readyForReview = false,
  skipEdit = false
} = {}) {
  const pool = await poolOrThrow()
  const sideEffects = []
  const result = await withPgTransaction(pool, async (client) => {
    const current = await client.query('SELECT * FROM video_jobs WHERE id=$1 AND workspace_id=$2 AND site_id=$3 FOR UPDATE', [videoJobId, workspaceId, siteId])
    if (!current.rowCount) throw videoError('Video job no encontrado.', 404, 'VIDEO_JOB_NOT_FOUND')
    const row = current.rows[0]
    const fromStatus = row.status
    let nextMetadata = jsonObject(row.metadata)
    if (metadata !== undefined) nextMetadata = { ...nextMetadata, ...jsonObject(metadata) }
    let nextSource = row.source_media_id
    let nextFinal = row.final_media_id
    let nextCover = row.cover_media_id
    if (sourceMediaId !== undefined) nextSource = sourceMediaId || null
    if (finalMediaId !== undefined) nextFinal = finalMediaId || null
    if (coverMediaId !== undefined) nextCover = coverMediaId || null
    if (skipEdit && row.source_media_id) {
      nextFinal = row.source_media_id
      nextMetadata = await appendVersionMetadata(nextMetadata, {
        mediaId: row.source_media_id,
        role: 'final_video',
        provider: 'manual',
        createdAt: new Date().toISOString(),
        note: 'publish_without_edit'
      })
    }
    let nextStatus = status !== undefined ? text(status, 40) : row.status
    if (skipEdit) nextStatus = 'ready_for_review'
    if (nextStatus && !VIDEO_JOB_STATUSES.includes(nextStatus)) throw videoError('Estado de vídeo no válido.', 400, 'VIDEO_STATUS_INVALID')
    const updated = await client.query(`
      UPDATE video_jobs SET
        provider=COALESCE($4,provider),
        status=COALESCE($5,status),
        provider_project_id=COALESCE($6,provider_project_id),
        provider_composition_id=COALESCE($7,provider_composition_id),
        speaker=COALESCE($8,speaker),
        channel=COALESCE($9,channel),
        format=COALESCE($10,format),
        objective=COALESCE($11,objective),
        topic=COALESCE($12,topic),
        source_media_id=$13,
        final_media_id=$14,
        cover_media_id=$15,
        metadata=$16,
        updated_at=NOW()
      WHERE id=$1 AND workspace_id=$2 AND site_id=$3
      RETURNING *
    `, [
      videoJobId, workspaceId, siteId,
      provider !== undefined ? normalizeProvider(provider) : null,
      nextStatus || null,
      providerProjectId !== undefined ? text(providerProjectId, 300) || null : null,
      providerCompositionId !== undefined ? text(providerCompositionId, 300) || null : null,
      speaker !== undefined ? text(speaker, 120) || null : null,
      channel !== undefined ? text(channel, 50) || null : null,
      format !== undefined ? text(format, 50) || null : null,
      objective !== undefined ? text(objective, 500) || null : null,
      topic !== undefined ? text(topic, 500) || null : null,
      nextSource, nextFinal, nextCover,
      JSON.stringify(nextMetadata)
    ])
    const job = rowToJob(updated.rows[0])
    if (nextFinal && row.content_item_id) {
      sideEffects.push({ type: 'attach', itemId: row.content_item_id, mediaAssetId: nextFinal })
    }
    if (caption && row.content_item_id) {
      sideEffects.push({
        type: 'caption',
        itemId: row.content_item_id,
        caption: text(caption, 5000)
      })
    }
    const shouldReview = readyForReview || skipEdit || nextStatus === 'ready_for_review'
    if (shouldReview && row.content_item_id) {
      sideEffects.push({ type: 'review', itemId: row.content_item_id })
      if (nextStatus !== 'ready_for_review') {
        await client.query("UPDATE video_jobs SET status='ready_for_review',updated_at=NOW() WHERE id=$1", [videoJobId])
        job.status = 'ready_for_review'
      }
    }
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      workspaceId, siteId, userId || null, 'video.status_changed', 'video_job', videoJobId,
      JSON.stringify({ from: fromStatus, to: job.status, itemId: row.content_item_id })
    ])
    console.info('[video] status_changed', { videoJobId, from: fromStatus, to: job.status, itemId: row.content_item_id })
    return { job }
  })
  for (const effect of sideEffects) {
    if (effect.type === 'attach') {
      await attachContentMedia({
        workspaceId,
        siteId,
        itemId: effect.itemId,
        userId,
        role,
        mediaAssetId: effect.mediaAssetId,
        channels: ['video'],
        assetIndex: 0,
        createMissingVariants: ['video'],
        removeReplacedAssets: false
      })
    } else if (effect.type === 'caption') {
      await updateContentItem({
        workspaceId,
        siteId,
        itemId: effect.itemId,
        userId,
        role,
        channel: 'video',
        body: { publishCopy: effect.caption, socialPack: { videoCaption: effect.caption } }
      })
    } else if (effect.type === 'review') {
      await updateContentItem({
        workspaceId,
        siteId,
        itemId: effect.itemId,
        userId,
        role,
        readyForReview: true
      })
    }
  }
  return result
}

export async function getVideoJob({ workspaceId, siteId, siteHandle, videoJobId, contentItemId } = {}) {
  const job = await getVideoJobRecord({ workspaceId, siteId, videoJobId, contentItemId })
  const pool = await poolOrThrow()
  const mediaById = await loadMediaUrls(pool, [job.sourceMediaId, job.finalMediaId, job.coverMediaId])
  return assembleVideoJobContext(job, { siteHandle, mediaById })
}

export async function ingestVideoUpload({
  workspaceId,
  siteId,
  siteHandle,
  userId,
  role,
  payload = {},
  mediaRole = 'source_video',
  format = 'portrait',
  contentItemId = null,
  videoJobId = null,
  attachToItem = true
} = {}) {
  const resolved = await resolveVideoUploadBuffer(payload)
  if (resolved.awaitingChunks) return resolved
  const stored = persistVideoFile({
    site: siteHandle,
    filename: resolved.filename,
    buffer: resolved.buffer,
    mimeType: payload.mimeType,
    format,
    role: mediaRole,
    skipLegacyDb: true
  })
  const asset = await registerContentMedia({ workspaceId, siteId, userId, role, media: stored })
  let job = null
  if (videoJobId) {
    const updated = await updateVideoJob({
      workspaceId,
      siteId,
      videoJobId,
      userId,
      role,
      sourceMediaId: mediaRole === 'source_video' ? asset.id : undefined,
      finalMediaId: mediaRole === 'final_video' ? asset.id : undefined,
      coverMediaId: mediaRole === 'video_cover' ? asset.id : undefined,
      status: mediaRole === 'final_video' ? 'ready_for_review' : 'raw',
      readyForReview: mediaRole === 'final_video'
    })
    job = updated.job
  } else if (contentItemId) {
    job = (await ensureVideoJobForContentItem({
      workspaceId,
      siteId,
      siteHandle,
      userId,
      role,
      contentItemId,
      sourceMediaId: asset.id
    })).job
  }
  if (attachToItem && contentItemId) {
    await attachContentMedia({
      workspaceId,
      siteId,
      itemId: contentItemId,
      userId,
      role,
      mediaAssetId: asset.id,
      channels: ['video'],
      assetIndex: format === 'landscape' ? 1 : 0,
      createMissingVariants: ['video'],
      removeReplacedAssets: mediaRole === 'source_video'
    })
  }
  return { media: stored, mediaAsset: asset, mediaAssetId: asset.id, videoJob: job, videoJobId: job?.id || videoJobId || null }
}

export async function importExternalVideoMedia({
  workspaceId,
  siteId,
  siteHandle,
  userId,
  role,
  videoJobId,
  sourceUrl,
  idempotencyKey = ''
} = {}) {
  const pool = await poolOrThrow()
  const cleanKey = text(idempotencyKey, 300)
  if (cleanKey) {
    const previous = await pool.query('SELECT response FROM mutation_idempotency WHERE workspace_id=$1 AND scope=$2 AND idempotency_key=$3', [workspaceId, 'video_import_external_media', cleanKey])
    if (previous.rowCount) return previous.rows[0].response
  }
  const jobSnapshot = await pool.query('SELECT * FROM video_jobs WHERE id=$1 AND workspace_id=$2 AND site_id=$3', [videoJobId, workspaceId, siteId])
  if (!jobSnapshot.rowCount) throw videoError('Video job no encontrado.', 404, 'VIDEO_JOB_NOT_FOUND')
  const url = text(sourceUrl, 2000)
  if (!url) throw videoError('sourceUrl es obligatoria.', 400, 'VIDEO_EXTERNAL_IMPORT_FAILED')
  let parsed
  try { parsed = new URL(url) } catch {
    throw videoError('sourceUrl no es válida.', 400, 'VIDEO_EXTERNAL_IMPORT_FAILED')
  }
  if (!videoImportAllowlistCheck(parsed.hostname)) {
    throw videoError('El host de importación no está permitido.', 400, 'VIDEO_EXTERNAL_IMPORT_FAILED')
  }
  let buffer
  try {
    buffer = await fetchRemote(url, { maxBytes: VIDEO_MAX_IMPORT_BYTES })
  } catch (error) {
    throw videoError(error.message || 'No se pudo descargar el vídeo externo.', error.status || 502, 'VIDEO_EXTERNAL_IMPORT_FAILED')
  }
  const stored = persistVideoFile({
    site: siteHandle,
    filename: parsed.pathname.split('/').pop() || 'imported-video.mp4',
    buffer,
    format: jobSnapshot.rows[0].format === 'landscape' ? 'landscape' : 'portrait',
    role: 'final_video',
    skipLegacyDb: true
  })
  const existingFinal = jobSnapshot.rows[0].final_media_id
  if (existingFinal) {
    const previous = await pool.query('SELECT sha256 FROM media_assets WHERE id=$1', [existingFinal])
    if (previous.rows[0]?.sha256 && previous.rows[0].sha256 === stored.sha256) {
      const job = rowToJob(jobSnapshot.rows[0])
      const response = { job, mediaAssetId: existingFinal, deduplicated: true }
      if (cleanKey) await pool.query('INSERT INTO mutation_idempotency (workspace_id,scope,idempotency_key,response) VALUES ($1,$2,$3,$4)', [workspaceId, 'video_import_external_media', cleanKey, JSON.stringify(response)])
      return response
    }
  }
  const asset = await registerContentMedia({ workspaceId, siteId, userId, role, media: stored })
  const metadata = await appendVersionMetadata(jsonObject(jobSnapshot.rows[0].metadata), {
    mediaId: asset.id,
    role: 'final_video',
    provider: jobSnapshot.rows[0].provider,
    createdAt: new Date().toISOString(),
    sourceUrl: url
  })
  const response = await withPgTransaction(pool, async (client) => {
    await client.query(`
      UPDATE video_jobs SET final_media_id=$4,status='ready_for_review',metadata=$5,updated_at=NOW()
      WHERE id=$1 AND workspace_id=$2 AND site_id=$3
    `, [videoJobId, workspaceId, siteId, asset.id, JSON.stringify(metadata)])
    await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      workspaceId, siteId, userId || null, 'video.imported', 'video_job', videoJobId,
      JSON.stringify({ mediaId: asset.id, sourceUrl: url })
    ])
    const job = rowToJob({ ...jobSnapshot.rows[0], final_media_id: asset.id, status: 'ready_for_review', metadata })
    const payload = { job, mediaAsset: asset, mediaAssetId: asset.id }
    if (cleanKey) await client.query('INSERT INTO mutation_idempotency (workspace_id,scope,idempotency_key,response) VALUES ($1,$2,$3,$4)', [workspaceId, 'video_import_external_media', cleanKey, JSON.stringify(payload)])
    return payload
  })
  const contentItemId = jobSnapshot.rows[0].content_item_id
  if (contentItemId) {
    await attachContentMedia({
      workspaceId,
      siteId,
      itemId: contentItemId,
      userId,
      role,
      mediaAssetId: asset.id,
      channels: ['video'],
      assetIndex: 0,
      createMissingVariants: ['video'],
      removeReplacedAssets: false
    })
    await updateContentItem({
      workspaceId,
      siteId,
      itemId: contentItemId,
      userId,
      role,
      readyForReview: true
    })
  }
  console.info('[video] imported', { videoJobId, mediaId: asset.id, itemId: contentItemId })
  return response
}

export async function ensureVideoJobForContentItem({
  workspaceId,
  siteId,
  siteHandle,
  userId,
  role,
  contentItemId,
  sourceMediaId = null,
  speaker = '',
  channel = 'instagram',
  format = 'reel',
  objective = '',
  topic = ''
} = {}) {
  try {
    const existing = await getVideoJobRecord({ workspaceId, siteId, contentItemId })
    if (sourceMediaId && existing.sourceMediaId !== sourceMediaId) {
      const updated = await updateVideoJob({ workspaceId, siteId, videoJobId: existing.id, userId, role, sourceMediaId, status: 'raw' })
      return { job: updated.job, created: false }
    }
    return { job: existing, created: false }
  } catch (error) {
    if (error.code !== 'VIDEO_JOB_NOT_FOUND') throw error
  }
  const created = await createVideoJob({
    workspaceId,
    siteId,
    siteHandle,
    userId,
    role,
    contentItemId,
    sourceMediaId,
    channel,
    format,
    speaker,
    objective,
    topic
  })
  return { job: created.job, created: true, videoJobId: created.videoJobId }
}

export function buildChatGptVideoPrompt(context = {}) {
  const lines = [
    'Edita este vídeo en Descript (o tu herramienta) y vuelve a subir el resultado final al CMS Escarlet.',
    `Video job: ${context.videoJobId || ''}`,
    `Marca: ${context.brand || ''}`,
    `Speaker: ${context.speaker || 'sin definir'}`,
    `Canal/formato: ${context.channel || 'instagram'} / ${context.format || 'reel'}`,
    `Objetivo: ${context.objective || context.topic || ''}`,
    `URL del RAW: ${context.sourceUrl || ''}`,
    'Cuando termines, llama video_import_external_media con la URL HTTPS pública del export final.'
  ]
  return lines.filter(Boolean).join('\n')
}
