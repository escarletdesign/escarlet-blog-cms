import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { invokeMcpTool } from './create-mcp-server.mjs'
import { assertBrandFileAccess, getBrandContext, loadCanonicalBrandKit, validateImagePreparation, writeBrandFile } from '../lib/brand-kit.mjs'

function payload(result) {
  return JSON.parse(result.content.find((block) => block.type === 'text')?.text || '{}')
}

test('la skill del brand kit publica el mismo contrato canónico que el MCP', () => {
  const skill = readFileSync(new URL('../payload/escarlet-brandkit/SKILL.md', import.meta.url), 'utf8')
  assert.match(skill, /brand_prepare_image_generation/)
  assert.match(skill, /#47A4E7/)
  assert.match(skill, /#E8B73A/)
  assert.match(skill, /generationBlocked/)
  assert.match(skill, /exactamente una imagen final/i)
})

test('los tres endpoints usan el mismo snapshot y la misma identidad canónica', async () => {
  const auth = { role: 'admin' }
  const [general, prepared] = await Promise.all([
    invokeMcpTool('brand_get_context', { site: 'escarlet' }, auth),
    invokeMcpTool('brand_prepare_image_generation', { site: 'escarlet', assetType: 'generic', title: 'imagen de prueba' }, auth)
  ])
  const values = [payload(general), payload(prepared)]
  assert.equal(new Set(values.map((value) => value.brandKitVersionId)).size, 1)
  assert.equal(new Set(values.map((value) => value.brandKitSnapshotHash)).size, 1)
  assert.deepEqual(values[0].canonicalPalette, {
    primary: '#47A4E7', cyan: '#12B8D6', teal: '#12B8D6', greenSoft: '#62B38A', gold: '#E8B73A', charcoal: '#1E1E1E', gray: '#6D6D6D', white: '#FFFFFF'
  })
  assert.equal(values[0].imageSpec.version, '2.2.0')
  assert.equal(values[0].imageSpec.global.referenceSelection.coverCountAutomatic, 'route')
  assert.equal(values[0].brandCore.decisionRules.referenceSelectionPolicy.assistantMayChoose, false)
  assert.match(JSON.stringify(values), /#12B8D6|#62B38A|#E8B73A/)
})

test('la petición genérica resuelve la ruta positiva y adjunta referencias en orden', async () => {
  const result = await invokeMcpTool('brand_prepare_image_generation', { site: 'escarlet', assetType: 'generic', title: 'imagen de prueba' }, { role: 'admin' })
  const value = payload(result)
  assert.equal(value.route, 'positive_or_inspirational')
  assert.equal(value.generationBlocked, false)
  assert.equal(value.generationCardinality.defaultImageCount, 1)
  assert.equal(value.generationCardinality.maxImageCount, 1)
  assert.deepEqual(value.resolvedReferences.map((reference) => reference.filename), [
    '05-tablero-visual.png', 'fondo-escarlet.jpg', 'reference-visual-style-02.png'
  ])
  const images = result.content.filter((block) => block.type === 'image')
  assert.equal(images.length, value.resolvedReferences.length)
  assert.deepEqual(value.resolvedReferences.map((reference) => reference.attachmentIndex), [1, 2, 3])
  assert.equal(value.readyForGeneration, true)
  assert.equal(value.referenceDelivery.readyForGeneration, true)
  assert.deepEqual(value.referenceDelivery.exactReferenceOrder, value.resolvedReferences.map((reference) => reference.filename))
  for (const [index, block] of images.entries()) {
    const reference = value.resolvedReferences[index]
    const sourceUrl = new URL(`../data/media/escarlet/reference/${reference.filename}`, import.meta.url)
    const source = readFileSync(sourceUrl)
    assert.equal(block.mimeType, reference.filename.endsWith('.png') ? 'image/png' : 'image/jpeg')
    assert.equal(createHash('sha256').update(Buffer.from(block.data, 'base64')).digest('hex'), createHash('sha256').update(source).digest('hex'))
    assert.equal(block._meta['escarlet/reference'].filename, reference.filename)
    assert.equal(block._meta['escarlet/reference'].attachmentIndex, index + 1)
    assert.equal(block._meta['escarlet/reference'].preparationId, value.brandPreparation.preparationId)
    assert.equal(block._meta['escarlet/reference'].sha256, createHash('sha256').update(source).digest('hex'))
  }
  assert.match(value.brandPreparation.preparationId, /^[a-f0-9]{64}$/)
  assert.deepEqual(value.brandPreparation.exactReferenceFilenames, value.resolvedReferences.map((reference) => reference.filename))
  assert.equal(validateImagePreparation('escarlet', value.brandPreparation.preparationId, { assetType: 'generic', route: value.route }).ok, true)
  assert.equal(validateImagePreparation('escarlet', `${value.brandPreparation.preparationId.slice(0, -1)}0`, { assetType: 'generic', route: value.route }).ok, false)
})

test('un carrusel declara cardinalidad explícita y recibe una preparación multiuso', async () => {
  const value = payload(await invokeMcpTool('brand_prepare_image_generation', {
    site: 'escarlet',
    assetType: 'social_image',
    expectedAssetCount: 4,
    itemId: 'item-carousel-test',
    batchId: 'batch-carousel-test',
    channel: 'instagram',
    topic: 'fondo abstracto editorial'
  }, { role: 'admin' }))
  assert.equal(value.generationCardinality.defaultImageCount, 4)
  assert.equal(value.generationCardinality.maxImageCount, 4)
  assert.equal(value.brandPreparation.expectedAssetCount, 4)
  assert.notEqual(value.brandPreparation.preparationId, payload(await invokeMcpTool('brand_prepare_image_generation', {
    site: 'escarlet', assetType: 'social_image', topic: 'fondo abstracto editorial'
  }, { role: 'admin' })).brandPreparation.preparationId)
})

test('las rutas de escenas son cerradas y no heredan referencias de otro sitio', async () => {
  const work = payload(await invokeMcpTool('brand_prepare_image_generation', { site: 'escarlet', topic: 'trabajo y colaboración' }, { role: 'admin' }))
  const tense = payload(await invokeMcpTool('brand_prepare_image_generation', { site: 'escarlet', topic: 'duda e introspección' }, { role: 'admin' }))
  assert.equal(work.route, 'human_or_work')
  assert.equal(tense.route, 'introspective_or_tense')
  for (const value of [work, tense]) assert.ok(value.resolvedReferences.every((reference) => reference.mediaId?.startsWith('media-1789')))
})

test('la preparación visual es aislada y no modifica el brandkit ni depende del historial del chat', async () => {
  const before = loadCanonicalBrandKit('escarlet', { forceReload: true })
  const result = await invokeMcpTool('brand_prepare_image_generation', {
    site: 'escarlet',
    assetType: 'generic',
    title: 'prueba limpia',
    topic: 'brief aislado sin contexto conversacional'
  }, { role: 'admin' })
  const value = payload(result)
  const after = loadCanonicalBrandKit('escarlet', { forceReload: true })
  assert.equal(value.readyForGeneration, true)
  assert.equal(value.conversationId, undefined)
  assert.equal(value.brandIsolation.conversationIndependent, true)
  assert.equal(value.brandIsolation.writesBrandKit, false)
  assert.equal(after.brandKitSnapshotHash, before.brandKitSnapshotHash)
  assert.equal(after.brandKitVersionId, before.brandKitVersionId)
  assert.deepEqual(after.references.map((reference) => reference.filename), before.references.map((reference) => reference.filename))
})

test('la política de referencias se deriva por marca y no depende de Escarlet', async () => {
  const site = `grounding-${Date.now()}`
  const sourceRoot = new URL('../data/media/escarlet/reference/', import.meta.url)
  try {
    writeBrandFile(site, 'AGENT.md', '# Agente\nUsa brand_prepare_image_generation.\n')
    writeBrandFile(site, 'keywords.md', '# Keywords\n')
    writeBrandFile(site, 'brand-core.json', JSON.stringify({ id: site, version: '1.0.0', fixed: { palette: { ink: '#101010', accent: '#AA5500' } } }))
    writeBrandFile(site, 'reference-library.json', JSON.stringify({
      site,
      version: '1.0.0',
      references: [
        { id: 'authority', role: 'visual-authority', filename: '05-tablero-visual.png', required: true },
        { id: 'background', role: 'background-authority', filename: 'fondo-escarlet.jpg', required: true },
        { id: 'scene', role: 'scene-reference', filename: 'reference-visual-style-02.png', required: false }
      ]
    }))
    const targetDir = new URL(`../data/media/${site}/reference/`, import.meta.url)
    mkdirSync(targetDir, { recursive: true })
    for (const filename of ['05-tablero-visual.png', 'fondo-escarlet.jpg', 'reference-visual-style-02.png']) {
      copyFileSync(new URL(filename, sourceRoot), new URL(filename, targetDir))
    }
    const result = await invokeMcpTool('brand_prepare_image_generation', { site, assetType: 'generic', title: 'prueba de marca independiente' }, { role: 'admin' })
    const value = payload(result)
    assert.equal(value.readyForGeneration, true)
    assert.deepEqual(value.resolvedReferences.map((reference) => reference.filename), ['05-tablero-visual.png', 'fondo-escarlet.jpg', 'reference-visual-style-02.png'])
    assert.match(value.generationPrompt, /mandatory visual grounding/i)
    assert.doesNotMatch(value.generationPrompt, /Escarlet palette/i)
  } finally {
    rmSync(new URL(`../data/brand/${site}`, import.meta.url), { recursive: true, force: true })
    rmSync(new URL(`../data/media/${site}`, import.meta.url), { recursive: true, force: true })
  }
})

test('la escritura canónica está autorizada, es atómica y expira el snapshot', () => {
  const site = `brand-cache-${Date.now()}`
  try {
    assert.equal(assertBrandFileAccess({ role: 'owner' }, 'brand-core.json', { write: true }), 'brand-core.json')
    assert.equal(assertBrandFileAccess({ role: 'admin' }, 'reference-library.json', { write: true }), 'reference-library.json')
    assert.throws(() => assertBrandFileAccess({ role: 'editor' }, 'brand-core.json', { write: true }), /owner\/admin/)
    writeBrandFile(site, 'AGENT.md', '# agent\n')
    writeBrandFile(site, 'keywords.md', '# keywords\n')
    const before = getBrandContext(site, { auth: { role: 'admin' } })
    writeBrandFile(site, 'AGENT.md', '# agent actualizado\n')
    const after = getBrandContext(site, { auth: { role: 'admin' } })
    assert.notEqual(after.brandKitVersionId, before.brandKitVersionId)
    assert.notEqual(after.brandKitSnapshotHash, before.brandKitSnapshotHash)
  } finally {
    rmSync(new URL(`../data/brand/${site}`, import.meta.url), { recursive: true, force: true })
  }
})
