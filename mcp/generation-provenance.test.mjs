import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import Jimp from 'jimp'
import { readDb, writeDb } from '../lib/db.mjs'
import { prepareImageGeneration } from '../lib/brand-kit.mjs'
import {
  assertGenerationReceipt,
  consumeGenerationReceipt,
  generationReceiptFromPostgresRow,
  issueGenerationReceipt,
  persistImagePreparation
} from '../lib/generation-provenance.mjs'
import { uploadMedia } from '../lib/cms-ops.mjs'

function referenceEvidence(prepared) {
  return prepared.resolvedReferences.map((reference) => ({
    id: reference.id,
    filename: reference.filename,
    attachmentIndex: reference.attachmentIndex,
    sha256: createHash('sha256').update(readFileSync(`data/media/escarlet/reference/${reference.filename}`)).digest('hex')
  }))
}

function clearPreparation(preparationId) {
  const db = readDb()
  if (db.imagePreparations) delete db.imagePreparations[preparationId]
  if (db.generationReceipts) {
    for (const [id, receipt] of Object.entries(db.generationReceipts)) {
      if (receipt.preparationId === preparationId) delete db.generationReceipts[id]
    }
  }
  writeDb(db)
}

test('el receipt reconstruido desde Postgres conserva la versión y el uso único', () => {
  const receipt = generationReceiptFromPostgresRow({
    id: 'pg-receipt',
    preparation_id: 'pg-preparation',
    site: 'escarlet',
    status: 'issued',
    issued_at: '2026-09-21T15:00:00.000Z',
    expected_asset_count: 1
  })
  assert.equal(receipt.provenanceVersion, '2')
  assert.equal(receipt.timestamp, '2026-09-21T15:00:00.000Z')
  assert.equal(receipt.singleUse, true)
})

async function readyReceipt(assetType = 'presentation') {
  const prepared = prepareImageGeneration('escarlet', { assetType, title: `provenance-${Date.now()}` })
  const db = readDb()
  if (db.imagePreparations) delete db.imagePreparations[prepared.brandPreparation.preparationId]
  if (db.generationReceipts) {
    for (const [id, receipt] of Object.entries(db.generationReceipts)) {
      if (receipt.preparationId === prepared.brandPreparation.preparationId) delete db.generationReceipts[id]
    }
  }
  writeDb(db)
  await persistImagePreparation(prepared)
  const [width, height] = prepared.composition.dimensions.split('x').map(Number)
  const output = await new Jimp(width, height, 0xc45c48ff).getBufferAsync(Jimp.MIME_PNG)
  const receipt = await issueGenerationReceipt({
    site: 'escarlet',
    preparationId: prepared.brandPreparation.preparationId,
    usedReferences: referenceEvidence(prepared),
    generatedResultId: `test-${Date.now()}`,
    generatedFileHash: createHash('sha256').update(output).digest('hex'),
    assetType,
    route: prepared.route,
    ...(assetType === 'social_image' || assetType === 'instagram_background'
      ? { textRendered: true, templateId: 'editorial', renderedBy: 'content-system/instagram-renderer', textContent: { headline: 'Test', body: 'Texto de prueba.' } }
      : {})
  })
  return { prepared, receipt, output }
}

test('generationReceipt certifica el flujo válido y rechaza variaciones', async () => {
  const { prepared, receipt, output } = await readyReceipt()
  const valid = await assertGenerationReceipt({
    site: 'escarlet',
    receiptId: receipt.receiptId,
    preparationId: prepared.brandPreparation.preparationId,
    assetType: prepared.brandPreparation.assetType,
    route: prepared.brandPreparation.route,
    fileHash: createHash('sha256').update(output).digest('hex')
  })
  assert.equal(valid.receipt.receiptId, receipt.receiptId)

  await assert.rejects(
    () => issueGenerationReceipt({ site: 'escarlet', preparationId: 'missing', usedReferences: [], generatedResultId: 'x', generatedFileHash: '0'.repeat(64) }),
    (error) => error.code === 'BRAND_PREPARATION_REQUIRED'
  )
  await assert.rejects(
    () => assertGenerationReceipt({ site: 'bespoke', receiptId: receipt.receiptId }),
    (error) => error.code === 'SITE_MISMATCH'
  )
  await assert.rejects(
    () => assertGenerationReceipt({ site: 'escarlet', receiptId: receipt.receiptId, preparationId: 'other-preparation' }),
    (error) => error.code === 'GENERATION_RECEIPT_INVALID'
  )
  await assert.rejects(
    () => assertGenerationReceipt({ site: 'escarlet', receiptId: receipt.receiptId, fileHash: 'f'.repeat(64) }),
    (error) => error.code === 'GENERATED_FILE_HASH_MISMATCH'
  )

  await consumeGenerationReceipt(receipt.receiptId)
  const associated = await assertGenerationReceipt({
    site: 'escarlet',
    receiptId: receipt.receiptId,
    preparationId: prepared.brandPreparation.preparationId,
    assetType: prepared.brandPreparation.assetType,
    allowConsumed: true
  })
  assert.equal(associated.receipt.status, 'consumed')
})

test('el upload conserva los bytes de ChatGPT y valida la preparación, sin receipt', async () => {
  const { prepared, output } = await readyReceipt('blog_cover')
  const preparation = prepared.brandPreparation
  const grounding = {
    provenanceVersion: '3',
    brandPreparationId: preparation.preparationId,
    brandKitVersionId: preparation.brandKitVersionId,
    brandKitSnapshotHash: prepared.brandKitSnapshotHash,
    brandRoute: prepared.route,
    assetType: preparation.assetType,
    resolvedReferenceIds: prepared.resolvedReferences.map((reference) => reference.id),
    resolvedReferenceHashes: prepared.resolvedReferences.map((reference) => reference.sha256),
    itemId: 'item-1',
    channels: ['blog'],
    assetIndex: 0
  }
  await assert.rejects(
    () => uploadMedia({ site: 'escarlet', filename: 'no-preparation.png', kind: 'post', contentBase64: output.toString('base64'), requireBrandGrounding: true }),
    (error) => error.code === 'BRAND_PREPARATION_REQUIRED'
  )
  const uploaded = await uploadMedia({
    site: 'escarlet', filename: `provenance-${Date.now()}.png`, kind: 'post', contentBase64: output.toString('base64'),
    requireBrandGrounding: true, brandGroundingOverride: grounding
  })
  assert.equal(uploaded.media.brandGrounding.brandPreparationId, preparation.preparationId)
  assert.equal(uploaded.media.brandGrounding.generatedFileHash, createHash('sha256').update(output).digest('hex'))
  assert.deepEqual(readFileSync(join('data', 'media', uploaded.media.path.replace(/^\/media\//, ''))), output)
  const db = readDb()
  db.media = (db.media || []).filter((media) => media.id !== uploaded.media.id)
  writeDb(db)
  rmSync(join('data', 'media', 'escarlet', uploaded.media.filename), { force: true })
})

test('las referencias deben coincidir en identidad, hash y orden', async () => {
  const prepared = prepareImageGeneration('escarlet', { assetType: 'blog_cover', title: `references-${Date.now()}`, useCharacter: true })
  assert.ok(prepared.resolvedReferences.length >= 2)
  clearPreparation(prepared.brandPreparation.preparationId)
  await persistImagePreparation(prepared)
  const evidence = referenceEvidence(prepared)
  await assert.rejects(
    () => issueGenerationReceipt({ site: 'escarlet', preparationId: prepared.brandPreparation.preparationId, usedReferences: evidence.map((item, index) => index === 0 ? { ...item, sha256: 'a'.repeat(64) } : item), generatedResultId: 'altered-ref', generatedFileHash: 'b'.repeat(64) }),
    (error) => error.code === 'REFERENCE_SET_MISMATCH'
  )
  await assert.rejects(
    () => issueGenerationReceipt({ site: 'escarlet', preparationId: prepared.brandPreparation.preparationId, usedReferences: [...evidence].reverse(), generatedResultId: 'reordered-ref', generatedFileHash: 'b'.repeat(64) }),
    (error) => error.code === 'REFERENCE_SET_MISMATCH'
  )
})

test('generationBlocked no puede emitir un receipt', async () => {
  const site = `missing-provenance-${Date.now()}`
  const prepared = prepareImageGeneration(site, { assetType: 'generic', title: 'blocked' })
  assert.equal(prepared.generationBlocked, true)
  await persistImagePreparation(prepared)
  await assert.rejects(
    () => issueGenerationReceipt({ site, preparationId: prepared.brandPreparation.preparationId, usedReferences: [], generatedResultId: 'blocked', generatedFileHash: 'c'.repeat(64) }),
    (error) => error.code === 'GENERATION_BLOCKED'
  )
})
