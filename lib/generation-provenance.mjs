import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaDir, readDb, writeDb } from './db.mjs'
import { compositionForAssetType, loadCanonicalBrandKit } from './brand-kit.mjs'
import { inspectImageBuffer } from './media-url.mjs'
import { getPgPool, isPostgresConfigured, runCoreMigrations } from './pg.mjs'

export const GENERATION_PROVENANCE_VERSION = '2'
export const GENERATION_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000
const ASSET_TYPES_BY_MEDIA_KIND = Object.freeze({
  post: ['blog_cover'],
  social: ['social_image', 'instagram_background']
})

function nowIso() { return new Date().toISOString() }
function text(value, max = 500) { return String(value ?? '').trim().slice(0, max) }
function sha256(value) { return createHash('sha256').update(value).digest('hex') }
function validHash(value) { return /^[a-f0-9]{64}$/i.test(String(value || '')) }
function error(message, code, extra = {}) {
  return Object.assign(new Error(message), { status: 409, code, extra })
}

export function assertAssetTypeForMediaKind(kind, assetType) {
  const normalizedKind = text(kind, 40).toLowerCase()
  const allowed = ASSET_TYPES_BY_MEDIA_KIND[normalizedKind]
  if (!allowed || allowed.includes(text(assetType, 80))) return true
  throw error(`El assetType ${assetType || '(vacío)'} no es válido para kind ${normalizedKind}.`, 'ASSET_TYPE_MISMATCH', {
    kind: normalizedKind,
    assetType: text(assetType, 80),
    expectedAssetTypes: allowed
  })
}

function validateGeneratedImageBuffer(assetType, buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null
  const info = inspectImageBuffer(buffer)
  if (!info.ok) throw error('El archivo generado no es una imagen válida.', 'GENERATED_IMAGE_INVALID', { image: info })
  if (!info.width || !info.height) throw error('No se pudieron leer las dimensiones del archivo generado.', 'GENERATED_IMAGE_DIMENSIONS_UNAVAILABLE', { image: info })
  const expected = compositionForAssetType(assetType)
  const [expectedWidth, expectedHeight] = String(expected.dimensions).split('x').map(Number)
  if (info.width !== expectedWidth || info.height !== expectedHeight) {
    throw error(`Las dimensiones generadas no coinciden con ${assetType}: se esperaba ${expected.dimensions} y se recibió ${info.width}x${info.height}.`, 'GENERATED_IMAGE_DIMENSIONS_MISMATCH', {
      assetType,
      expectedDimensions: expected.dimensions,
      receivedDimensions: `${info.width}x${info.height}`
    })
  }
  return { width: info.width, height: info.height, format: info.format }
}

function referencePath(reference) {
  const raw = String(reference?.path || '').trim()
  if (!raw.startsWith('/media/') || raw.includes('..')) return ''
  const candidate = join(mediaDir, raw.slice('/media/'.length))
  return existsSync(candidate) ? candidate : ''
}

function referenceEvidence(preparation) {
  return (preparation?.resolvedReferences || []).map((reference) => {
    const path = referencePath(reference)
    const hash = path ? sha256(readFileSync(path)) : ''
    return {
      id: text(reference.id, 200),
      mediaId: text(reference.mediaId, 200) || null,
      filename: text(reference.filename, 300),
      attachmentIndex: Number(reference.attachmentIndex || reference.order || 0),
      sha256: hash
    }
  })
}

function prepareRecordFromPayload(payload, { itemId, batchId, channel, workspaceId, siteId } = {}) {
  const prepared = payload?.brandPreparation || {}
  return {
    preparationId: text(prepared.preparationId, 160),
    site: text(prepared.site || payload?.site, 160),
    siteId: text(siteId, 160) || null,
    workspaceId: text(workspaceId, 160) || null,
    brandKitVersionId: text(prepared.brandKitVersionId || payload?.brandKitVersionId, 160),
    brandKitSnapshotHash: text(prepared.brandKitSnapshotHash || payload?.brandKitSnapshotHash, 160),
    assetType: text(prepared.assetType || payload?.assetType || 'blog_cover', 80),
    route: text(prepared.route || payload?.route, 120),
    expectedReferences: referenceEvidence(payload),
    generationBlocked: Boolean(payload?.generationBlocked),
    state: payload?.generationBlocked ? 'blocked' : 'ready',
    itemId: text(itemId, 160) || null,
    batchId: text(batchId, 160) || null,
    channel: text(channel, 80) || null,
    expectedAssetCount: Number(payload?.generationCardinality?.maxImageCount || 1),
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + GENERATION_RECEIPT_TTL_MS).toISOString(),
    consumedAt: null
  }
}

async function persistPostgresPreparation(record) {
  if (!isPostgresConfigured()) return
  await runCoreMigrations()
  const pool = await getPgPool()
  await pool.query(`
    INSERT INTO image_generation_preparations
      (id,workspace_id,site_id,site,brand_kit_version_id,brand_kit_snapshot_hash,asset_type,route,expected_references,state,item_id,batch_id,channel,expected_asset_count,expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (id) DO UPDATE SET expected_references=EXCLUDED.expected_references,state=CASE WHEN image_generation_preparations.state IN ('receipted','consumed') THEN image_generation_preparations.state ELSE EXCLUDED.state END,expires_at=CASE WHEN image_generation_preparations.state IN ('receipted','consumed') THEN image_generation_preparations.expires_at ELSE EXCLUDED.expires_at END
  `, [record.preparationId, record.workspaceId, record.siteId, record.site, record.brandKitVersionId, record.brandKitSnapshotHash, record.assetType, record.route, JSON.stringify(record.expectedReferences), record.state, record.itemId, record.batchId, record.channel, record.expectedAssetCount, record.expiresAt])
}

export async function persistImagePreparation(payload, options = {}) {
  const record = prepareRecordFromPayload(payload, options)
  if (!record.preparationId) throw error('La preparación no tiene preparationId.', 'BRAND_PREPARATION_REQUIRED')
  const db = readDb()
  db.imagePreparations = db.imagePreparations || {}
  const previous = db.imagePreparations[record.preparationId]
  if (!previous || !['receipted', 'consumed'].includes(previous.state)) db.imagePreparations[record.preparationId] = record
  writeDb(db)
  await persistPostgresPreparation(record)
  return record
}

async function getPostgresPreparation(preparationId) {
  if (!isPostgresConfigured()) return null
  await runCoreMigrations()
  const pool = await getPgPool()
  const result = await pool.query('SELECT * FROM image_generation_preparations WHERE id=$1', [preparationId])
  if (!result.rowCount) return null
  const row = result.rows[0]
  return {
    preparationId: row.id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    site: row.site,
    brandKitVersionId: row.brand_kit_version_id,
    brandKitSnapshotHash: row.brand_kit_snapshot_hash,
    assetType: row.asset_type,
    route: row.route,
    expectedReferences: row.expected_references || [],
    generationBlocked: row.state === 'blocked',
    state: row.state,
    itemId: row.item_id,
    batchId: row.batch_id,
    channel: row.channel,
    expectedAssetCount: row.expected_asset_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at
  }
}

export async function getImagePreparation(preparationId) {
  const id = text(preparationId, 160)
  if (!id) return null
  const postgres = await getPostgresPreparation(id)
  if (postgres) return postgres
  return readDb().imagePreparations?.[id] || null
}

function assertCurrentBrand(preparation) {
  const current = loadCanonicalBrandKit(preparation.site, { forceReload: true })
  if (current.brandKitVersionId !== preparation.brandKitVersionId || current.snapshotHash !== preparation.brandKitSnapshotHash) {
    throw error('El brand kit cambió desde la preparación. Vuelve a preparar la imagen.', 'BRAND_VERSION_MISMATCH', {
      expectedBrandKitVersionId: preparation.brandKitVersionId,
      currentBrandKitVersionId: current.brandKitVersionId
    })
  }
  const byFilename = new Map((current.references || []).map((reference) => [reference.filename, reference]))
  const currentReferences = preparation.expectedReferences.map((expected) => {
    const reference = byFilename.get(expected.filename)
    const path = referencePath(reference)
    return {
      id: text(reference?.id, 200),
      mediaId: text(reference?.mediaId, 200) || null,
      filename: text(reference?.filename, 300),
      attachmentIndex: expected.attachmentIndex,
      sha256: path ? sha256(readFileSync(path)) : ''
    }
  })
  try {
    assertExactReferences(preparation.expectedReferences, currentReferences)
  } catch (cause) {
    throw error('Una referencia del brand kit cambió desde la preparación.', 'REFERENCE_SET_MISMATCH', { cause: cause.message })
  }
  return current
}

function assertPreparationUsable(preparation, site) {
  if (!preparation) throw error('No existe la preparación visual.', 'BRAND_PREPARATION_REQUIRED')
  if (site && preparation.site !== site) throw error('La preparación no pertenece a esta marca.', 'SITE_MISMATCH')
  if (preparation.generationBlocked || preparation.state === 'blocked') throw error('La generación está bloqueada porque faltan referencias obligatorias.', 'GENERATION_BLOCKED')
  if (preparation.expiresAt && new Date(preparation.expiresAt).getTime() <= Date.now()) throw error('La preparación visual ha expirado.', 'GENERATION_RECEIPT_INVALID')
  if (preparation.consumedAt) throw error('La preparación ya fue consumida.', 'PREPARATION_ALREADY_CONSUMED')
}

function assertExactReferences(expected, declared) {
  if (!Array.isArray(declared) || declared.length !== expected.length) throw error('Las referencias declaradas no coinciden con la preparación.', 'REFERENCE_SET_MISMATCH')
  for (let index = 0; index < expected.length; index++) {
    const want = expected[index]
    const got = declared[index] || {}
    if (text(got.id, 200) !== want.id || Number(got.attachmentIndex || index + 1) !== want.attachmentIndex || text(got.filename, 300) !== want.filename || text(got.sha256, 64).toLowerCase() !== want.sha256) {
      throw error('Las referencias utilizadas no coinciden exactamente con resolvedReferences.', 'REFERENCE_SET_MISMATCH', { expected, received: declared })
    }
  }
}

export async function issueGenerationReceipt({ site, preparationId, usedReferences, generatedResultId, generatedFileHash, itemId, batchId, channel, assetType, route } = {}) {
  const preparation = await getImagePreparation(preparationId)
  assertPreparationUsable(preparation, site)
  assertCurrentBrand(preparation)
  if (assetType && text(assetType, 80) !== preparation.assetType) throw error('El assetType no coincide con la preparación.', 'ASSET_TYPE_MISMATCH')
  if (route && text(route, 120) !== preparation.route) throw error('La ruta visual no coincide con la preparación.', 'REFERENCE_SET_MISMATCH')
  if (itemId && preparation.itemId && text(itemId, 160) !== preparation.itemId) throw error('El item no coincide con la preparación.', 'GENERATION_RECEIPT_INVALID')
  if (!validHash(generatedFileHash)) throw error('El hash SHA-256 del archivo generado es obligatorio.', 'GENERATION_RECEIPT_INVALID')
  if (!text(generatedResultId, 300)) throw error('El identificador del resultado generado es obligatorio.', 'GENERATION_RECEIPT_INVALID')
  assertExactReferences(preparation.expectedReferences, usedReferences)
  const receipt = {
    receiptId: randomUUID(),
    provenanceVersion: GENERATION_PROVENANCE_VERSION,
    preparationId: preparation.preparationId,
    site: preparation.site,
    siteId: preparation.siteId,
    workspaceId: preparation.workspaceId,
    brandKitVersionId: preparation.brandKitVersionId,
    brandKitSnapshotHash: preparation.brandKitSnapshotHash,
    assetType: preparation.assetType,
    route: preparation.route,
    resolvedReferenceIds: preparation.expectedReferences.map((reference) => reference.id),
    resolvedReferenceHashes: preparation.expectedReferences.map((reference) => reference.sha256),
    references: preparation.expectedReferences,
    timestamp: nowIso(),
    preparationState: preparation.state,
    generatedResultId: text(generatedResultId, 300),
    generatedFileHash: String(generatedFileHash).toLowerCase(),
    itemId: preparation.itemId || text(itemId, 160) || null,
    batchId: preparation.batchId || text(batchId, 160) || null,
    channel: preparation.channel || text(channel, 80) || null,
    status: 'issued',
    issuedAt: nowIso(),
    expiresAt: preparation.expiresAt,
    consumedAt: null,
    revokedAt: null,
    singleUse: preparation.expectedAssetCount <= 1
  }
  const db = readDb()
  db.generationReceipts = db.generationReceipts || {}
  db.generationReceipts[receipt.receiptId] = receipt
  db.imagePreparations = db.imagePreparations || {}
  db.imagePreparations[preparation.preparationId] = { ...preparation, state: 'receipted' }
  writeDb(db)
  if (isPostgresConfigured()) {
    await runCoreMigrations()
    const pool = await getPgPool()
    await pool.query(`
      INSERT INTO generation_receipts
        (id,preparation_id,workspace_id,site_id,site,brand_kit_version_id,brand_kit_snapshot_hash,asset_type,route,resolved_reference_ids,resolved_reference_hashes,reference_evidence,preparation_state,generated_result_id,generated_file_hash,item_id,batch_id,channel,status,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    `, [receipt.receiptId, receipt.preparationId, receipt.workspaceId, receipt.siteId, receipt.site, receipt.brandKitVersionId, receipt.brandKitSnapshotHash, receipt.assetType, receipt.route, receipt.resolvedReferenceIds, receipt.resolvedReferenceHashes, JSON.stringify(receipt.references), receipt.preparationState, receipt.generatedResultId, receipt.generatedFileHash, receipt.itemId, receipt.batchId, receipt.channel, receipt.status, receipt.expiresAt])
    await pool.query('UPDATE image_generation_preparations SET state=$1 WHERE id=$2 AND state=$3', ['receipted', receipt.preparationId, 'ready'])
  }
  return receipt
}

async function getPostgresReceipt(receiptId) {
  if (!isPostgresConfigured()) return null
  await runCoreMigrations()
  const pool = await getPgPool()
  const result = await pool.query('SELECT * FROM generation_receipts WHERE id=$1', [receiptId])
  if (!result.rowCount) return null
  const row = result.rows[0]
  return {
    receiptId: row.id,
    preparationId: row.preparation_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    site: row.site,
    brandKitVersionId: row.brand_kit_version_id,
    brandKitSnapshotHash: row.brand_kit_snapshot_hash,
    assetType: row.asset_type,
    route: row.route,
    resolvedReferenceIds: row.resolved_reference_ids || [],
    resolvedReferenceHashes: row.resolved_reference_hashes || [],
    references: row.reference_evidence || [],
    preparationState: row.preparation_state,
    generatedResultId: row.generated_result_id,
    generatedFileHash: row.generated_file_hash,
    itemId: row.item_id,
    batchId: row.batch_id,
    channel: row.channel,
    status: row.status,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    revokedAt: row.revoked_at
  }
}

export async function getGenerationReceipt(receiptId) {
  const id = text(receiptId, 160)
  if (!id) return null
  return (await getPostgresReceipt(id)) || readDb().generationReceipts?.[id] || null
}

export async function assertGenerationReceipt({ site, receiptId, preparationId, assetType, route, itemId, fileHash, kind, fileBuffer } = {}) {
  const receipt = await getGenerationReceipt(receiptId)
  if (!receipt) throw error('Falta un generationReceiptId emitido por el backend.', 'GENERATION_RECEIPT_REQUIRED')
  if (receipt.status === 'consumed' || receipt.consumedAt) throw error('El generation receipt ya fue utilizado.', 'PREPARATION_ALREADY_CONSUMED')
  if (receipt.provenanceVersion !== GENERATION_PROVENANCE_VERSION || receipt.status !== 'issued' || receipt.revokedAt) throw error('El generation receipt no es válido o fue revocado.', 'GENERATION_RECEIPT_INVALID')
  if (receipt.site !== site) throw error('El generation receipt pertenece a otra marca.', 'SITE_MISMATCH')
  if (preparationId && receipt.preparationId !== preparationId) throw error('El receipt y la preparación no coinciden.', 'GENERATION_RECEIPT_INVALID')
  if (assetType && receipt.assetType !== assetType) throw error('El assetType no coincide con el receipt.', 'ASSET_TYPE_MISMATCH')
  if (kind) assertAssetTypeForMediaKind(kind, receipt.assetType)
  if (route && receipt.route !== route) throw error('La ruta visual no coincide con el receipt.', 'REFERENCE_SET_MISMATCH')
  if (itemId && receipt.itemId && receipt.itemId !== itemId) throw error('El receipt está vinculado a otro item.', 'GENERATION_RECEIPT_INVALID')
  if (receipt.expiresAt && new Date(receipt.expiresAt).getTime() <= Date.now()) throw error('El generation receipt ha expirado.', 'GENERATION_RECEIPT_INVALID')
  const preparation = await getImagePreparation(receipt.preparationId)
  assertPreparationUsable(preparation, site)
  if (preparation.brandKitVersionId !== receipt.brandKitVersionId || preparation.brandKitSnapshotHash !== receipt.brandKitSnapshotHash) throw error('La versión del brand kit no coincide con el receipt.', 'BRAND_VERSION_MISMATCH')
  assertCurrentBrand(preparation)
  assertExactReferences(preparation.expectedReferences, receipt.references)
  if (fileHash && String(fileHash).toLowerCase() !== receipt.generatedFileHash) throw error('El hash del archivo generado no coincide con el receipt.', 'GENERATED_FILE_HASH_MISMATCH')
  const image = fileBuffer ? validateGeneratedImageBuffer(receipt.assetType, fileBuffer) : null
  return { receipt, preparation, image }
}

export async function consumeGenerationReceipt(receiptId) {
  const receipt = await getGenerationReceipt(receiptId)
  if (!receipt) return null
  const consumedAt = nowIso()
  const next = { ...receipt, status: 'consumed', consumedAt }
  const db = readDb()
  db.generationReceipts = db.generationReceipts || {}
  db.generationReceipts[receipt.receiptId] = next
  db.imagePreparations = db.imagePreparations || {}
  if (db.imagePreparations[receipt.preparationId]) db.imagePreparations[receipt.preparationId].consumedAt = consumedAt
  writeDb(db)
  if (isPostgresConfigured()) {
    await runCoreMigrations()
    const pool = await getPgPool()
    await pool.query('UPDATE generation_receipts SET status=$1,consumed_at=$2 WHERE id=$3 AND status=$4', ['consumed', consumedAt, receipt.receiptId, 'issued'])
    await pool.query('UPDATE image_generation_preparations SET state=$1,consumed_at=$2 WHERE id=$3', ['consumed', consumedAt, receipt.preparationId])
  }
  return next
}
