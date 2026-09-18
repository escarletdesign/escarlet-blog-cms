import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { invokeMcpTool } from './create-mcp-server.mjs'
import { assertBrandFileAccess, getBrandContext, writeBrandFile } from '../lib/brand-kit.mjs'

function payload(result) {
  return JSON.parse(result.content.find((block) => block.type === 'text')?.text || '{}')
}

test('la skill del brand kit publica el mismo contrato canónico que el MCP', () => {
  const skill = readFileSync(new URL('../payload/escarlet-brandkit/SKILL.md', import.meta.url), 'utf8')
  assert.match(skill, /brand_prepare_image_generation/)
  assert.match(skill, /#12B8D6/)
  assert.match(skill, /generationBlocked/)
  assert.doesNotMatch(skill, /verde bosque|sistema v2|pendiente de confirmación/i)
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
    cyan: '#12B8D6', greenSoft: '#62B38A', cream: '#F3E7D0', gold: '#E8B73A', charcoal: '#1E1E1E', gray: '#6D6D6D', white: '#FFFFFF'
  })
  assert.equal(values[0].imageSpec.version, '2.2.0')
  assert.equal(values[0].imageSpec.global.referenceSelection.coverCountAutomatic, 'route')
  assert.equal(values[0].brandCore.decisionRules.referenceSelectionPolicy.assistantMayChoose, false)
  assert.doesNotMatch(JSON.stringify(values), /#F4F1EA|#E8E0D3|#1F4D3A|#15352A|#C8674B/)
})

test('la petición genérica resuelve la ruta positiva y adjunta referencias en orden', async () => {
  const result = await invokeMcpTool('brand_prepare_image_generation', { site: 'escarlet', assetType: 'generic', title: 'imagen de prueba' }, { role: 'admin' })
  const value = payload(result)
  assert.equal(value.route, 'positive_or_inspirational')
  assert.equal(value.generationBlocked, false)
  assert.deepEqual(value.resolvedReferences.map((reference) => reference.filename), [
    '05-tablero-visual.png', 'fondo-escarlet.jpg', 'reference-visual-style-02.png'
  ])
  const images = result.content.filter((block) => block.type === 'image')
  assert.equal(images.length, value.resolvedReferences.length)
  assert.deepEqual(value.resolvedReferences.map((reference) => reference.attachmentIndex), [1, 2, 3])
})

test('las rutas de escenas son cerradas y no heredan referencias de otro sitio', async () => {
  const work = payload(await invokeMcpTool('brand_prepare_image_generation', { site: 'escarlet', topic: 'trabajo y colaboración' }, { role: 'admin' }))
  const tense = payload(await invokeMcpTool('brand_prepare_image_generation', { site: 'escarlet', topic: 'duda e introspección' }, { role: 'admin' }))
  assert.equal(work.route, 'human_or_work')
  assert.equal(tense.route, 'introspective_or_tense')
  for (const value of [work, tense]) assert.ok(value.resolvedReferences.every((reference) => reference.mediaId?.startsWith('media-1789')))
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
