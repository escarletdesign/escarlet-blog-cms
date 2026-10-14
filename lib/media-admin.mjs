import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve as resolvePath, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { getPgPool, runCoreMigrations, withPgTransaction } from './pg.mjs'
import { mediaDir } from './db.mjs'
import { generateThumbBuffer } from './media-optimize.mjs'

export const CANONICAL_MEDIA_DELETE_MODES = Object.freeze(['selected', 'temporary'])
const MAX_MEDIA_BATCH = 100
const MAX_MEDIA_LIST = 1000

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max)
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function mediaError(message, status, code, details = {}) {
  return Object.assign(new Error(message), { status, code, details })
}

function normalizeIds(value) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((entry) => text(entry, 200))
    .filter(Boolean))]
}

export function normalizeMediaDeleteRequest({ workspaceId, siteId, role, mode = 'selected', assetIds = [], confirm = false, force = false, idempotencyKey = '' } = {}) {
  const normalizedWorkspaceId = text(workspaceId, 160)
  const normalizedSiteId = text(siteId, 160)
  const normalizedMode = text(mode, 30).toLowerCase() || 'selected'
  const ids = normalizeIds(assetIds)
  if (!normalizedWorkspaceId || !normalizedSiteId) throw mediaError('workspaceId y siteId son obligatorios.', 422, 'media_scope_required')
  if (!['owner', 'admin'].includes(String(role || '').toLowerCase())) throw mediaError('Sólo owner o admin pueden eliminar assets canónicos.', 403, 'media_delete_forbidden')
  if (!CANONICAL_MEDIA_DELETE_MODES.includes(normalizedMode)) throw mediaError('mode debe ser selected o temporary.', 422, 'media_delete_mode_invalid')
  if (confirm !== true) throw mediaError('La eliminación requiere confirm=true.', 428, 'media_delete_confirmation_required')
  if (normalizedMode === 'selected' && !ids.length) throw mediaError('selected requiere al menos un assetId.', 422, 'media_ids_required')
  if (ids.length > MAX_MEDIA_BATCH) throw mediaError(`No se pueden eliminar más de ${MAX_MEDIA_BATCH} assets por operación.`, 422, 'media_batch_too_large')
  return {
    workspaceId: normalizedWorkspaceId,
    siteId: normalizedSiteId,
    role: String(role || '').toLowerCase(),
    mode: normalizedMode,
    assetIds: ids,
    confirm: true,
    force: force === true,
    idempotencyKey: text(idempotencyKey, 300)
  }
}

export function normalizeMediaUnlockRequest({ workspaceId, siteId, role, assetIds = [], confirm = false } = {}) {
  const normalizedWorkspaceId = text(workspaceId, 160)
  const normalizedSiteId = text(siteId, 160)
  const ids = normalizeIds(assetIds)
  if (!normalizedWorkspaceId || !normalizedSiteId) throw mediaError('workspaceId y siteId son obligatorios.', 422, 'media_scope_required')
  if (!['owner', 'admin'].includes(String(role || '').toLowerCase())) throw mediaError('Sólo owner o admin pueden desbloquear assets canónicos.', 403, 'media_unlock_forbidden')
  if (confirm !== true) throw mediaError('El desbloqueo requiere confirm=true.', 428, 'media_unlock_confirmation_required')
  if (!ids.length) throw mediaError('assetIds requiere al menos un assetId.', 422, 'media_ids_required')
  if (ids.length > MAX_MEDIA_BATCH) throw mediaError(`No se pueden desbloquear más de ${MAX_MEDIA_BATCH} assets por operación.`, 422, 'media_batch_too_large')
  return { workspaceId: normalizedWorkspaceId, siteId: normalizedSiteId, role: String(role || '').toLowerCase(), assetIds: ids, confirm: true }
}

export function normalizeMediaUpdateRequest({ workspaceId, siteId, role, assetIds = [], filename, alt, usage } = {}) {
  const normalizedWorkspaceId = text(workspaceId, 160)
  const normalizedSiteId = text(siteId, 160)
  const ids = normalizeIds(assetIds)
  if (!normalizedWorkspaceId || !normalizedSiteId) throw mediaError('workspaceId y siteId son obligatorios.', 422, 'media_scope_required')
  if (!['owner', 'admin', 'editor', 'author'].includes(String(role || '').toLowerCase())) throw mediaError('No tienes permisos para editar assets canónicos.', 403, 'media_update_forbidden')
  if (!ids.length) throw mediaError('assetIds requiere al menos un assetId.', 422, 'media_ids_required')
  if (ids.length > MAX_MEDIA_BATCH) throw mediaError(`No se pueden editar más de ${MAX_MEDIA_BATCH} assets por operación.`, 422, 'media_batch_too_large')
  const changes = {}
  if (filename !== undefined) changes.filename = text(filename, 300)
  if (alt !== undefined) changes.alt = text(alt, 1000)
  if (usage !== undefined) changes.usage = text(usage, 80)
  if (!Object.keys(changes).length) throw mediaError('Incluye al menos un campo para actualizar.', 422, 'media_changes_required')
  return { workspaceId: normalizedWorkspaceId, siteId: normalizedSiteId, role: String(role || '').toLowerCase(), assetIds: ids, changes }
}

export function isTemporaryMediaMetadata(metadata) {
  const value = object(metadata)
  return value.temporary === true || value.ephemeral === true || ['temporary', 'ephemeral'].includes(text(value.lifecycle, 40).toLowerCase())
}

export function mediaDeleteBlockers(row = {}) {
  const blockers = []
  const metadata = object(row.metadata)
  const source = text(metadata.source, 80).toLowerCase()
  const brandSource = ['brand-kit', 'brand_kit', 'canonical-reference', 'canonical_reference'].includes(source)
  if (row.contentLinked) blockers.push('content_linked')
  if (row.videoLinked) blockers.push('video_job_linked')
  if (row.brandLinked || brandSource) blockers.push('brand_asset_linked')
  if (row.receiptLinked) blockers.push('generation_receipt_linked')
  return [...new Set(blockers)]
}

function hardDeleteBlockers(row = {}) {
  return mediaDeleteBlockers(row).filter((blocker) => blocker !== 'generation_receipt_linked')
}

function safeStoragePath(storageKey) {
  const raw = text(storageKey, 2000).replace(/\\/g, '/')
  if (!raw || raw.includes('\0')) return null
  const relative = raw.replace(/^\/?media\//i, '').replace(/^\/+/, '')
  if (!relative || relative.split('/').includes('..')) return null
  const root = resolvePath(mediaDir)
  const disk = resolvePath(join(root, relative))
  if (disk !== root && !disk.startsWith(`${root}${sep}`)) return null
  return disk
}

function publicStoragePath(diskPath) {
  const root = resolvePath(mediaDir)
  if (diskPath !== root && !diskPath.startsWith(`${root}${sep}`)) return null
  return `/media/${diskPath.slice(root.length + 1).replace(/\\/g, '/')}`
}

export function mediaStorageArtifacts(row = {}) {
  const metadata = object(row.metadata)
  const values = [
    row.storageKey || row.storage_key,
    metadata.thumbPath,
    metadata.thumbUrl,
    metadata.previewPath,
    metadata.previewUrl
  ]
  return [...new Set(values.map(safeStoragePath).filter(Boolean))]
}

function rowToAsset(row) {
  const blockers = mediaDeleteBlockers(row)
  const metadata = object(row.metadata)
  const derivatives = Object.fromEntries(['thumbUrl', 'thumbPath', 'previewUrl', 'previewPath', 'width', 'height', 'thumbWidth', 'thumbHeight', 'previewWidth', 'previewHeight', 'originalBytes', 'storedBytes', 'thumbBytes', 'previewBytes'].filter((key) => metadata[key] !== undefined).map((key) => [key, metadata[key]]))
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    storageKey: row.storage_key,
    publicUrl: row.public_url,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    ...derivatives,
    metadata,
    createdAt: row.created_at,
    temporary: isTemporaryMediaMetadata(row.metadata),
    deletable: blockers.length === 0,
    deleteBlockers: blockers
  }
}

function storagePathForDerivative(storageKey, suffix) {
  const disk = safeStoragePath(storageKey)
  if (!disk) return null
  return { disk: disk.replace(/\.[a-z0-9]+$/i, `_${suffix}.jpg`), url: publicStoragePath(disk.replace(/\.[a-z0-9]+$/i, `_${suffix}.jpg`)) }
}

async function ensureCanonicalThumbnail(row) {
  const metadata = object(row.metadata)
  const existing = safeStoragePath(metadata.thumbPath || metadata.thumbUrl)
  if (existing ? existsSync(existing) : metadata.thumbUrl && !String(metadata.thumbUrl).startsWith('/media/')) return row
  const target = storagePathForDerivative(row.storage_key, 'thumb')
  const source = safeStoragePath(row.storage_key)
  if (!source || !target || !existsSync(source)) return row
  if (existsSync(target.disk)) return { ...row, metadata: { ...metadata, thumbPath: target.url, thumbUrl: target.url, thumbBytes: statSync(target.disk).size } }
  try {
    const thumb = await generateThumbBuffer(readFileSync(source), 400)
    if (!thumb?.ok || !thumb.buffer?.length) return row
    writeFileSync(target.disk, thumb.buffer)
    return { ...row, metadata: { ...metadata, thumbPath: target.url, thumbUrl: target.url, thumbBytes: thumb.bytes, thumbWidth: thumb.width, thumbHeight: thumb.height } }
  } catch {
    return row
  }
}

// shortcut: four thumbnail jobs at once, enough to warm old libraries without saturating the worker
async function hydrateCanonicalRows(rows) {
  const hydrated = []
  for (let index = 0; index < rows.length; index += 4) hydrated.push(...await Promise.all(rows.slice(index, index + 4).map(ensureCanonicalThumbnail)))
  return hydrated
}

function thumbnailMetadata(metadata) {
  return Object.fromEntries(['thumbPath', 'thumbUrl', 'thumbBytes', 'thumbWidth', 'thumbHeight'].filter((key) => metadata?.[key] !== undefined).map((key) => [key, metadata[key]]))
}

async function poolOrThrow() {
  if (!await runCoreMigrations()) throw mediaError('Las migraciones de Postgres no están listas.', 503, 'migrations_unavailable')
  const pool = await getPgPool()
  if (!pool) throw mediaError('Postgres no está configurado.', 503, 'postgres_required')
  return pool
}

function scopeWhere({ workspaceId, siteId, mode, assetIds }, values = []) {
  const next = [...values, workspaceId, siteId]
  const where = [`ma.workspace_id=$${next.length - 1}`, `ma.site_id=$${next.length}`]
  if (assetIds.length) {
    next.push(assetIds)
    where.push(`ma.id=ANY($${next.length}::text[])`)
  }
  if (mode === 'temporary') {
    where.push(`(COALESCE(ma.metadata->>'temporary','false')='true' OR COALESCE(ma.metadata->>'ephemeral','false')='true' OR LOWER(COALESCE(ma.metadata->>'lifecycle','')) IN ('temporary','ephemeral'))`)
  }
  return { where, values: next }
}

const ASSET_SELECT = `
  SELECT ma.*,
    EXISTS (SELECT 1 FROM content_variant_media cvm WHERE cvm.media_asset_id=ma.id) AS "contentLinked",
    EXISTS (SELECT 1 FROM video_jobs vj WHERE vj.source_media_id=ma.id OR vj.final_media_id=ma.id OR vj.cover_media_id=ma.id) AS "videoLinked",
    EXISTS (
      SELECT 1
      FROM brand_assets ba
      JOIN brand_kit_versions bkv ON bkv.id=ba.brand_kit_version_id
      JOIN brand_kits bk ON bk.id=bkv.brand_kit_id
      WHERE bk.site_id=ma.site_id AND ba.storage_key=ma.storage_key
    ) AS "brandLinked",
    EXISTS (SELECT 1 FROM generation_receipts gr WHERE gr.generated_result_id=ma.id AND gr.status<>'revoked') AS "receiptLinked"
  FROM media_assets ma`

export async function listCanonicalMedia({ workspaceId, siteId, mode = '', temporaryOnly = false, includeProtected = false, assetIds = [], limit = 100, offset = 0, hydrate = true } = {}) {
  const scopeWorkspaceId = text(workspaceId, 160)
  const scopeSiteId = text(siteId, 160)
  if (!scopeWorkspaceId || !scopeSiteId) throw mediaError('workspaceId y siteId son obligatorios.', 422, 'media_scope_required')
  const pool = await poolOrThrow()
  const selectedIds = normalizeIds(assetIds)
  const values = [scopeWorkspaceId, scopeSiteId]
  const where = ['ma.workspace_id=$1', 'ma.site_id=$2']
  if (selectedIds.length) { values.push(selectedIds); where.push(`ma.id=ANY($${values.length}::text[])`) }
  if (mode === 'standalone') {
    where.push(`NOT EXISTS (SELECT 1 FROM content_variant_media cvm_standalone WHERE cvm_standalone.media_asset_id=ma.id)`)
    where.push(`NOT EXISTS (SELECT 1 FROM video_jobs vj_standalone WHERE vj_standalone.source_media_id=ma.id OR vj_standalone.final_media_id=ma.id OR vj_standalone.cover_media_id=ma.id)`)
    where.push(`NOT EXISTS (
      SELECT 1
      FROM brand_assets ba_standalone
      JOIN brand_kit_versions bkv_standalone ON bkv_standalone.id=ba_standalone.brand_kit_version_id
      JOIN brand_kits bk_standalone ON bk_standalone.id=bkv_standalone.brand_kit_id
      WHERE bk_standalone.site_id=ma.site_id AND ba_standalone.storage_key=ma.storage_key
    )`)
    where.push(`LOWER(COALESCE(ma.metadata->>'source','')) NOT IN ('brand-kit', 'brand_kit', 'canonical-reference', 'canonical_reference')`)
  }
  if (mode === 'temporary' || temporaryOnly) where.push(`(COALESCE(ma.metadata->>'temporary','false')='true' OR COALESCE(ma.metadata->>'ephemeral','false')='true' OR LOWER(COALESCE(ma.metadata->>'lifecycle','')) IN ('temporary','ephemeral'))`)
  const max = Math.min(Math.max(Number(limit) || 100, 1), MAX_MEDIA_LIST)
  const cleanOffset = Math.max(Number.parseInt(offset, 10) || 0, 0)
  const result = await pool.query(`${ASSET_SELECT} WHERE ${where.join(' AND ')} ORDER BY ma.created_at DESC LIMIT ${max} OFFSET ${cleanOffset}`, values)
  const originalMetadata = new Map(result.rows.map((row) => [row.id, row.metadata]))
  const rows = hydrate ? await hydrateCanonicalRows(result.rows) : result.rows
  if (hydrate) for (const row of rows) {
    if (row.metadata !== originalMetadata.get(row.id)) {
      await pool.query('UPDATE media_assets SET metadata=metadata || $1::jsonb WHERE id=$2 AND workspace_id=$3 AND site_id=$4', [JSON.stringify(thumbnailMetadata(row.metadata)), row.id, scopeWorkspaceId, scopeSiteId])
    }
  }
  let protectedAssets = []
  if (includeProtected && mode === 'standalone') {
    const protectedResult = await pool.query(`${ASSET_SELECT} WHERE ma.workspace_id=$1 AND ma.site_id=$2 AND (
      EXISTS (SELECT 1 FROM content_variant_media cvm_protected WHERE cvm_protected.media_asset_id=ma.id)
      OR EXISTS (SELECT 1 FROM video_jobs vj_protected WHERE vj_protected.source_media_id=ma.id OR vj_protected.final_media_id=ma.id OR vj_protected.cover_media_id=ma.id)
      OR EXISTS (SELECT 1 FROM brand_assets ba_protected JOIN brand_kit_versions bkv_protected ON bkv_protected.id=ba_protected.brand_kit_version_id JOIN brand_kits bk_protected ON bk_protected.id=bkv_protected.brand_kit_id WHERE bk_protected.site_id=ma.site_id AND ba_protected.storage_key=ma.storage_key)
      OR EXISTS (SELECT 1 FROM generation_receipts gr_protected WHERE gr_protected.generated_result_id=ma.id AND gr_protected.status<>'revoked')
      OR LOWER(COALESCE(ma.metadata->>'source','')) IN ('brand-kit', 'brand_kit', 'canonical-reference', 'canonical_reference')
    ) ORDER BY ma.created_at DESC LIMIT ${max}`, [scopeWorkspaceId, scopeSiteId])
    const protectedOriginalMetadata = new Map(protectedResult.rows.map((row) => [row.id, row.metadata]))
    const protectedRows = hydrate ? await hydrateCanonicalRows(protectedResult.rows) : protectedResult.rows
    if (hydrate) for (const row of protectedRows) {
      if (row.metadata !== protectedOriginalMetadata.get(row.id)) {
        await pool.query('UPDATE media_assets SET metadata=metadata || $1::jsonb WHERE id=$2 AND workspace_id=$3 AND site_id=$4', [JSON.stringify(thumbnailMetadata(row.metadata)), row.id, scopeWorkspaceId, scopeSiteId])
      }
    }
    protectedAssets = protectedRows.map(rowToAsset)
  }
  return { assets: rows.map(rowToAsset), count: result.rowCount, ...(includeProtected ? { protectedAssets } : {}) }
}

export async function unlockCanonicalMedia(input = {}) {
  const request = normalizeMediaUnlockRequest(input)
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const selected = scopeWhere({ ...request, mode: 'selected' })
    const result = await client.query(`${ASSET_SELECT} WHERE ${selected.where.join(' AND ')} FOR UPDATE`, selected.values)
    const foundIds = new Set(result.rows.map((row) => row.id))
    const missing = request.assetIds.filter((id) => !foundIds.has(id))
    if (missing.length) throw mediaError('Uno o más assets no existen en el scope indicado.', 404, 'media_asset_not_found', { assetIds: missing })
    const unlocked = []
    const blocked = []
    for (const row of result.rows) {
      const blockers = mediaDeleteBlockers(row)
      if (blockers.includes('brand_asset_linked')) {
        blocked.push({ id: row.id, blockers })
        continue
      }
      if (row.contentLinked) await client.query('DELETE FROM content_variant_media WHERE media_asset_id=$1', [row.id])
      if (row.videoLinked) await client.query('UPDATE video_jobs SET source_media_id=NULL,final_media_id=NULL,cover_media_id=NULL,updated_at=NOW() WHERE workspace_id=$1 AND site_id=$2 AND (source_media_id=$3 OR final_media_id=$3 OR cover_media_id=$3)', [request.workspaceId, request.siteId, row.id])
      if (row.receiptLinked) await client.query('UPDATE generation_receipts SET status=$1,revoked_at=NOW() WHERE generated_result_id=$2 AND status<>$1', ['revoked', row.id])
      const metadata = { ...object(row.metadata), unlockedForDeletionAt: new Date().toISOString(), unlockedForDeletionBy: input.userId || null }
      await client.query('UPDATE media_assets SET metadata=$1 WHERE workspace_id=$2 AND site_id=$3 AND id=$4', [JSON.stringify(metadata), request.workspaceId, request.siteId, row.id])
      await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [request.workspaceId, request.siteId, input.userId || null, 'media.asset_unlocked', 'media_asset', row.id, JSON.stringify({ blockers })])
      unlocked.push({ id: row.id, previousBlockers: blockers })
    }
    return { unlocked: true, count: unlocked.length, assetIds: unlocked.map((entry) => entry.id), unlockedAssets: unlocked, blocked }
  })
}

export async function deleteCanonicalMedia(input = {}) {
  const request = normalizeMediaDeleteRequest(input)
  const pool = await poolOrThrow()
  const fingerprint = createHash('sha256').update(JSON.stringify({ mode: request.mode, assetIds: request.assetIds })).digest('hex')
  return withPgTransaction(pool, async (client) => {
    if (request.idempotencyKey) {
      const previous = await client.query('SELECT response FROM mutation_idempotency WHERE workspace_id=$1 AND scope=$2 AND idempotency_key=$3 FOR UPDATE', [request.workspaceId, `media_delete:${request.siteId}`, request.idempotencyKey])
      if (previous.rowCount) {
        const stored = object(previous.rows[0].response)
        if (stored.fingerprint !== fingerprint) throw mediaError('La idempotencyKey ya se usó con otra selección de assets.', 409, 'media_delete_idempotency_conflict')
        return { response: { ...object(stored.result), idempotentReplay: true }, artifacts: [] }
      }
    }
    const selected = scopeWhere(request)
    const result = await client.query(`${ASSET_SELECT} WHERE ${selected.where.join(' AND ')} FOR UPDATE`, selected.values)
    const rows = result.rows
    const foundIds = new Set(rows.map((row) => row.id))
    const missing = request.mode === 'selected' ? request.assetIds.filter((id) => !foundIds.has(id)) : []
    if (missing.length) throw mediaError('Uno o más assets no existen en el scope indicado.', 404, 'media_asset_not_found', { assetIds: missing })
    const blocked = rows.map((row) => ({ id: row.id, blockers: hardDeleteBlockers(row), temporary: isTemporaryMediaMetadata(row) })).filter((entry) => entry.blockers.length || (request.mode === 'temporary' && !entry.temporary))
    if (request.mode === 'selected' && blocked.length && !request.force) throw mediaError('La selección contiene assets protegidos o vinculados.', 409, 'media_delete_blocked', { assets: blocked })
    const deletable = rows.filter((row) => (request.force || !hardDeleteBlockers(row).length) && (request.mode !== 'temporary' || isTemporaryMediaMetadata(row)))
    const receiptsRevoked = []
    if (deletable.length) {
      if (request.force) {
        const assetIds = deletable.map((row) => row.id)
        await client.query('DELETE FROM content_variant_media WHERE media_asset_id=ANY($1::text[])', [assetIds])
        await client.query('UPDATE video_jobs SET source_media_id=NULL,final_media_id=NULL,cover_media_id=NULL,updated_at=NOW() WHERE workspace_id=$1 AND site_id=$2 AND (source_media_id=ANY($3::text[]) OR final_media_id=ANY($3::text[]) OR cover_media_id=ANY($3::text[]))', [request.workspaceId, request.siteId, assetIds])
        await client.query('DELETE FROM brand_assets ba USING brand_kit_versions bkv,brand_kits bk WHERE ba.brand_kit_version_id=bkv.id AND bkv.brand_kit_id=bk.id AND bk.site_id=$1 AND ba.storage_key=ANY($2::text[])', [request.siteId, deletable.map((row) => row.storage_key)])
      }
      const receiptRows = await client.query('SELECT id,generated_result_id AS "generatedResultId" FROM generation_receipts WHERE generated_result_id=ANY($1::text[]) AND status<>$2 FOR UPDATE', [deletable.map((row) => row.id), 'revoked'])
      if (receiptRows.rowCount) {
        await client.query('UPDATE generation_receipts SET status=$1,revoked_at=NOW() WHERE generated_result_id=ANY($2::text[]) AND status<>$1', ['revoked', deletable.map((row) => row.id)])
        receiptsRevoked.push(...receiptRows.rows.map((row) => row.id))
      }
      await client.query('DELETE FROM media_assets WHERE workspace_id=$1 AND site_id=$2 AND id=ANY($3::text[])', [request.workspaceId, request.siteId, deletable.map((row) => row.id)])
      for (const row of deletable) {
        await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [request.workspaceId, request.siteId, input.userId || null, 'media.asset_deleted', 'media_asset', row.id, JSON.stringify({ mode: request.mode, confirmed: true, force: request.force, storageKey: row.storage_key })])
      }
    }
    const response = {
      deleted: true,
      mode: request.mode,
      force: request.force,
      count: deletable.length,
      assets: deletable.map((row) => ({ id: row.id, storageKey: row.storage_key })),
      blocked,
      receiptsRevoked,
      filesRemoved: 0,
      fileWarnings: []
    }
    if (request.idempotencyKey) await client.query('INSERT INTO mutation_idempotency (workspace_id,scope,idempotency_key,response) VALUES ($1,$2,$3,$4)', [request.workspaceId, `media_delete:${request.siteId}`, request.idempotencyKey, JSON.stringify({ fingerprint, result: response })])
    return { response, artifacts: deletable.flatMap(mediaStorageArtifacts) }
  }).then(async (result) => {
    const response = result.response
    for (const artifact of result.artifacts) {
      if (!existsSync(artifact)) continue
      try {
        unlinkSync(artifact)
        response.filesRemoved += 1
      } catch (error) {
        response.fileWarnings.push({ path: publicStoragePath(artifact), message: error.message })
      }
    }
    return response
  })
}

export async function updateCanonicalMedia(input = {}) {
  const request = normalizeMediaUpdateRequest(input)
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const selected = scopeWhere(request)
    const result = await client.query(`${ASSET_SELECT} WHERE ${selected.where.join(' AND ')} FOR UPDATE`, selected.values)
    const foundIds = new Set(result.rows.map((row) => row.id))
    const missing = request.assetIds.filter((id) => !foundIds.has(id))
    if (missing.length) throw mediaError('Uno o más assets no existen en el scope indicado.', 404, 'media_asset_not_found', { assetIds: missing })
    for (const row of result.rows) {
      const metadata = { ...object(row.metadata) }
      if (request.changes.filename !== undefined) metadata.filename = request.changes.filename
      if (request.changes.alt !== undefined) metadata.alt = request.changes.alt
      if (request.changes.usage !== undefined) metadata.usage = request.changes.usage
      await client.query('UPDATE media_assets SET metadata=$1 WHERE workspace_id=$2 AND site_id=$3 AND id=$4', [JSON.stringify(metadata), request.workspaceId, request.siteId, row.id])
      await client.query('INSERT INTO audit_log (workspace_id,site_id,user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)', [request.workspaceId, request.siteId, input.userId || null, 'media.asset_updated', 'media_asset', row.id, JSON.stringify({ fields: Object.keys(request.changes) })])
    }
    return { updated: true, count: result.rows.length, assetIds: result.rows.map((row) => row.id) }
  })
}

export const canonicalMediaRow = rowToAsset
