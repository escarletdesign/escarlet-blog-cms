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

test('el upload de post exige receipt, assetType blog_cover y dimensiones correctas', async () => {
  const { prepared, receipt, output } = await readyReceipt('blog_cover')
  await assert.rejects(
    () => uploadMedia({ site: 'escarlet', filename: 'no-receipt.png', kind: 'post', contentBase64: output.toString('base64'), requireBrandGrounding: true }),
    (error) => error.code === 'GENERATION_RECEIPT_REQUIRED'
  )
  await assert.rejects(
    () => uploadMedia({
      site: 'escarlet', filename: 'altered.png', kind: 'post', contentBase64: Buffer.from('not-the-generated-file').toString('base64'),
      requireBrandGrounding: true, generationReceiptId: receipt.receiptId, brandPreparationId: prepared.brandPreparation.preparationId,
      brandAssetType: prepared.brandPreparation.assetType, brandRoute: prepared.brandPreparation.route
    }),
    (error) => error.code === 'GENERATED_FILE_HASH_MISMATCH'
  )
  const uploaded = await uploadMedia({
    site: 'escarlet', filename: `provenance-${Date.now()}.png`, kind: 'post', contentBase64: output.toString('base64'),
    requireBrandGrounding: true, generationReceiptId: receipt.receiptId, brandPreparationId: prepared.brandPreparation.preparationId,
    brandAssetType: prepared.brandPreparation.assetType, brandRoute: prepared.brandPreparation.route
  })
  assert.equal(uploaded.media.brandGrounding.generationReceiptId, receipt.receiptId)
  await assert.rejects(
    () => uploadMedia({
      site: 'escarlet', filename: 'reused.png', kind: 'post', contentBase64: output.toString('base64'),
      requireBrandGrounding: true, generationReceiptId: receipt.receiptId, brandPreparationId: prepared.brandPreparation.preparationId,
      brandAssetType: prepared.brandPreparation.assetType, brandRoute: prepared.brandPreparation.route
    }),
    (error) => error.code === 'PREPARATION_ALREADY_CONSUMED'
  )
  const db = readDb()
  db.media = (db.media || []).filter((media) => media.id !== uploaded.media.id)
  writeDb(db)
  rmSync(join('data', 'media', 'escarlet', uploaded.media.filename), { force: true })
  if (uploaded.media.thumbPath) rmSync(join('data', uploaded.media.thumbPath.replace(/^\/media\//, '')), { force: true })

  const social = await readyReceipt('social_image')
  const socialUploaded = await uploadMedia({
    site: 'escarlet', filename: `social-final-${Date.now()}.png`, kind: 'social', contentBase64: social.output.toString('base64'),
    requireBrandGrounding: true, generationReceiptId: social.receipt.receiptId, brandPreparationId: social.prepared.brandPreparation.preparationId,
    brandAssetType: social.prepared.brandPreparation.assetType, brandRoute: social.prepared.brandPreparation.route,
    textRendered: true, templateId: 'editorial', renderedBy: 'content-system/instagram-renderer',
    textContent: { headline: 'Test', body: 'Texto de prueba.' }
  })
  assert.equal(socialUploaded.media.brandGrounding.socialText.textRendered, true)

  const missingSocialText = await readyReceipt('social_image')
  await assert.rejects(
    () => uploadMedia({
      site: 'escarlet', filename: 'social-without-text.png', kind: 'social', contentBase64: missingSocialText.output.toString('base64'),
      requireBrandGrounding: true, generationReceiptId: missingSocialText.receipt.receiptId, brandPreparationId: missingSocialText.prepared.brandPreparation.preparationId,
      brandAssetType: missingSocialText.prepared.brandPreparation.assetType, brandRoute: missingSocialText.prepared.brandPreparation.route
    }),
    (error) => error.code === 'SOCIAL_TEXT_REQUIRED'
  )

  const socialWrong = await readyReceipt('social_image')
  await assert.rejects(
    () => uploadMedia({
      site: 'escarlet', filename: 'wrong-asset-type.png', kind: 'post', contentBase64: socialWrong.output.toString('base64'),
      requireBrandGrounding: true, generationReceiptId: socialWrong.receipt.receiptId, brandPreparationId: socialWrong.prepared.brandPreparation.preparationId
    }),
    (error) => error.code === 'ASSET_TYPE_MISMATCH'
  )

  const socialThreeFour = prepareImageGeneration('escarlet', { assetType: 'social_image', title: `three-four-${Date.now()}` })
  clearPreparation(socialThreeFour.brandPreparation.preparationId)
  await persistImagePreparation(socialThreeFour)
  const threeFour = await new Jimp(1080, 1440, 0xc45c48ff).getBufferAsync(Jimp.MIME_PNG)
  const threeFourReceipt = await issueGenerationReceipt({
    site: 'escarlet', preparationId: socialThreeFour.brandPreparation.preparationId,
    usedReferences: referenceEvidence(socialThreeFour), generatedResultId: `three-four-${Date.now()}`,
    generatedFileHash: createHash('sha256').update(threeFour).digest('hex'), assetType: 'social_image', route: socialThreeFour.route
    , textRendered: true, templateId: 'impact', renderedBy: 'content-system/instagram-renderer', textContent: { headline: 'Formato', body: 'Tres cuartos también es válido.' }
  })
  const threeFourUpload = await uploadMedia({
    site: 'escarlet', filename: 'social-three-four.png', kind: 'social', contentBase64: threeFour.toString('base64'),
    requireBrandGrounding: true, generationReceiptId: threeFourReceipt.receiptId, brandPreparationId: socialThreeFour.brandPreparation.preparationId,
    brandAssetType: 'social_image', brandRoute: socialThreeFour.route, textRendered: true, templateId: 'impact',
    renderedBy: 'content-system/instagram-renderer', textContent: { headline: 'Formato', body: 'Tres cuartos también es válido.' }
  })
  assert.equal(threeFourUpload.media.brandGrounding.generatedWidth, 1080)
  assert.equal(threeFourUpload.media.brandGrounding.generatedHeight, 1440)

  const squareSocial = prepareImageGeneration('escarlet', { assetType: 'social_image', title: `square-social-${Date.now()}` })
  clearPreparation(squareSocial.brandPreparation.preparationId)
  await persistImagePreparation(squareSocial)
  const squareSocialBuffer = await new Jimp(1080, 1080, 0xc45c48ff).getBufferAsync(Jimp.MIME_PNG)
  const squareSocialReceipt = await issueGenerationReceipt({
    site: 'escarlet', preparationId: squareSocial.brandPreparation.preparationId,
    usedReferences: referenceEvidence(squareSocial), generatedResultId: `square-social-${Date.now()}`,
    generatedFileHash: createHash('sha256').update(squareSocialBuffer).digest('hex'), assetType: 'social_image', route: squareSocial.route,
    textRendered: true, templateId: 'editorial', renderedBy: 'content-system/instagram-renderer', textContent: { headline: 'Cuadrado', body: 'No es un formato Instagram válido.' }
  })
  await assert.rejects(
    () => uploadMedia({
      site: 'escarlet', filename: 'square-social.png', kind: 'social', contentBase64: squareSocialBuffer.toString('base64'),
      requireBrandGrounding: true, generationReceiptId: squareSocialReceipt.receiptId, brandPreparationId: squareSocial.brandPreparation.preparationId,
      brandAssetType: 'social_image', brandRoute: squareSocial.route, textRendered: true, templateId: 'editorial',
      renderedBy: 'content-system/instagram-renderer', textContent: { headline: 'Cuadrado', body: 'No es un formato Instagram válido.' }
    }),
    (error) => error.code === 'GENERATED_IMAGE_DIMENSIONS_MISMATCH'
  )

  const squarePrepared = prepareImageGeneration('escarlet', { assetType: 'blog_cover', title: `square-${Date.now()}` })
  clearPreparation(squarePrepared.brandPreparation.preparationId)
  await persistImagePreparation(squarePrepared)
  const square = await new Jimp(1080, 1080, 0xc45c48ff).getBufferAsync(Jimp.MIME_PNG)
  const squareReceipt = await issueGenerationReceipt({
    site: 'escarlet',
    preparationId: squarePrepared.brandPreparation.preparationId,
    usedReferences: referenceEvidence(squarePrepared),
    generatedResultId: `square-${Date.now()}`,
    generatedFileHash: createHash('sha256').update(square).digest('hex'),
    assetType: 'blog_cover',
    route: squarePrepared.route
  })
  await assert.rejects(
    () => uploadMedia({
      site: 'escarlet', filename: 'wrong-dimensions.png', kind: 'post', contentBase64: square.toString('base64'),
      requireBrandGrounding: true, generationReceiptId: squareReceipt.receiptId, brandPreparationId: squarePrepared.brandPreparation.preparationId
    }),
    (error) => error.code === 'GENERATED_IMAGE_DIMENSIONS_MISMATCH'
  )
})

test('las referencias deben coincidir en identidad, hash y orden', async () => {
  const prepared = prepareImageGeneration('escarlet', { assetType: 'blog_cover', title: `references-${Date.now()}` })
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
