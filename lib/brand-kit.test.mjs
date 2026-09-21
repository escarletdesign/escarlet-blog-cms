import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readBrandFile, writeBrandFile, getBrandContext } from './brand-kit.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('readBrandFile sirve voz y AGENT.md (alias agent-rules)', () => {
  const voice = readBrandFile('escarlet', 'voice.md')
  assert.ok(voice.includes('Escarlet'))
  const agent = readBrandFile('escarlet', 'AGENT.md')
  assert.ok(agent.includes('brand_get_context'))
  assert.ok(agent.includes('content_list_items'))
  assert.doesNotMatch(agent, /blog_get_brand_context|blog_list_posts/)
  assert.equal(readBrandFile('escarlet', 'agent-rules.md'), agent)
})

test('getBrandContext incluye la política editorial compartida fuera del AGENT del sitio', () => {
  const ctx = getBrandContext('escarlet', { auth: { role: 'site', site: 'escarlet' } })
  assert.equal(ctx.sharedEditorialPolicy.id, 'storyscope-inspired-human-writing')
  assert.equal(ctx.sharedEditorialPolicy.version, '1.1')
  assert.match(ctx.sharedEditorialPolicy.guidance, /No inventes experiencias personales/i)
  assert.match(ctx.sharedEditorialPolicy.guidance, /guiones horizontales/i)
  assert.match(ctx.sharedEditorialPolicy.imageGuidance, /referenceImages/)
  assert.match(ctx.sharedEditorialPolicy.instagramGuidance, /móvil/i)
})

test('writeBrandFile persiste en data/brand para revisión humana', () => {
  const site = 'kit-test'
  const marker = 'Corrección humana ' + Date.now()
  writeBrandFile(site, 'voice.md', '# Voz\n\n' + marker + '\n')
  writeBrandFile(site, 'AGENT.md', '# AGENT\n\nFlujo blog_get_brand_context.\n')
  assert.ok(readBrandFile(site, 'voice.md').includes(marker))
  const ctx = getBrandContext(site)
  assert.equal(ctx.voice.includes(marker), true)
  assert.equal(ctx.mediaUpload.preferred, 'content_upload_media')
  assert.equal(ctx.mediaUpload.fallback, null)
  assert.match(ctx.mediaUpload.autonomy, /contentBase64|trozos/)
  assert.ok(ctx.agentRules.includes('Contrato de subida'))
  assert.ok(ctx.agentRules.includes('content_upload_media'))
  assert.match(ctx.reminder, /A→B→C|contentBase64/)
  assert.ok(ctx.workflow.some((step) => /mediaUpload A→B→C|contentBase64/.test(step)))
  assert.ok(Array.isArray(ctx.referenceImages))
  assert.ok(ctx.socialPackChannels)
  assert.equal(ctx.blogEnabled, true)
  assert.equal(ctx.socialPackChannels.instagramCarousel, true)
  assert.ok(ctx.postFields.some((f) => f.key === 'socialPack.instagramSlides'))
  rmSync(join(root, 'data', 'brand', site), { recursive: true, force: true })
})

test('writeBrandFile persiste image-spec.json y getBrandContext lo expone', () => {
  const site = 'kit-spec-test'
  writeBrandFile(
    site,
    'image-spec.json',
    JSON.stringify({ lighting: 'soft daylight', crops: { cover: '16:9' } })
  )
  const ctx = getBrandContext(site)
  assert.equal(ctx.imageSpec.lighting, 'soft daylight')
  assert.equal(ctx.imageSpec.crops.cover, '16:9')
  assert.match(ctx.reminder, /image-spec/)
  assert.throws(() => writeBrandFile(site, 'image-spec.json', 'no-es-json'), /JSON válido/)
  rmSync(join(root, 'data', 'brand', site), { recursive: true, force: true })
})

test('editor con brand_kit_access recibe una proyección visual sin archivos privados', () => {
  const ctx = getBrandContext('escarlet', {
    auth: { role: 'editor', site: 'escarlet', capabilities: ['brand_kit_access'] }
  })
  assert.equal(ctx.brandAccessLevel, 'sanitized')
  assert.equal(ctx.brandCapabilityDeclared, true)
  assert.equal(ctx.brandCapabilityEffective, true)
  assert.ok(ctx.visualContext)
  assert.ok(ctx.visualContext.palette.includes('#12B8D6'))
  assert.equal(ctx.visualContext.typography.heading, 'Inter, Arial, sans-serif')
  assert.deepEqual(ctx.visualContext.typography.weights.sort((a, b) => a - b), [400, 500, 700, 800])
  assert.match(ctx.visualContext.typography.uses.heading, /titulares/i)
  assert.equal(ctx.visualContext.imageSpec.blogCover.allowText, false)
  assert.ok(ctx.visualContext.archetypes.length >= 7)
  assert.ok(ctx.visualContext.references.length >= 1)
  assert.equal(ctx.files['visual-style.md'], undefined)
  assert.equal(ctx.files['image-guide.md'], undefined)
  assert.equal(ctx.files['image-spec.json'], undefined)
  assert.ok(ctx.grantedBrandResources.includes('visualStyle'))
  assert.deepEqual(ctx.deniedBrandResources, [])
  assert.ok(!JSON.stringify(ctx).includes('source_file_private_normalized_projection_only\n'))
})

test('todos los miembros reciben el contexto visual normalizado', () => {
  const editor = getBrandContext('escarlet', { auth: { role: 'editor', site: 'escarlet', capabilities: [] } })
  assert.equal(editor.brandAccessLevel, 'sanitized')
  assert.ok(editor.visualContext)
  const client = getBrandContext('escarlet', { auth: { role: 'client', site: 'escarlet', capabilities: [] } })
  assert.equal(client.brandAccessLevel, 'sanitized')
  assert.ok(client.visualContext)
  assert.deepEqual(client.files && Object.keys(client.files).sort(), ['AGENT.md', 'keywords.md'])
})

test('el acceso al contexto no depende de un interruptor brand_kit_access', () => {
  const ctx = getBrandContext('escarlet', {
    auth: { role: 'editor', site: 'escarlet', capabilities: ['brand_kit_access'] },
    brandCapabilities: { brand_kit_access: false }
  })
  assert.equal(ctx.brandCapabilityDeclared, true)
  assert.equal(ctx.brandCapabilityEffective, true)
  assert.equal(ctx.brandAccessLevel, 'sanitized')
})

test('el contexto visual sanitizado no filtra credenciales de documentos permitidos', () => {
  const site = 'kit-secret-test'
  writeBrandFile(site, 'AGENT.md', 'Flujo autorizado. API_TOKEN=super-secret-value\n')
  writeBrandFile(site, 'keywords.md', 'access_token: another-secret-value\n')
  const ctx = getBrandContext(site, { auth: { role: 'editor', site, capabilities: ['brand_kit_access'] } })
  const serialized = JSON.stringify(ctx)
  assert.doesNotMatch(serialized, /super-secret-value|another-secret-value/)
  assert.match(ctx.agentRules, /Flujo autorizado/)
  rmSync(join(root, 'data', 'brand', site), { recursive: true, force: true })
})

test('un brand kit inexistente devuelve un contexto limitado y referencias vacías sin romper MCP', () => {
  const site = 'kit-missing-test'
  const ctx = getBrandContext(site, { auth: { role: 'editor', site, capabilities: ['brand_kit_access'] } })
  assert.equal(ctx.brandAccessLevel, 'sanitized')
  assert.deepEqual(ctx.referenceImages, [])
  assert.ok(ctx.missingBrand.includes('keywords.md'))
  assert.ok(ctx.missingBrand.includes('AGENT.md'))
  rmSync(join(root, 'data', 'brand', site), { recursive: true, force: true })
})
