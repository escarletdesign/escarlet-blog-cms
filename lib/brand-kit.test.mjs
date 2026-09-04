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
  assert.ok(agent.includes('blog_get_brand_context'))
  assert.equal(readBrandFile('escarlet', 'agent-rules.md'), agent)
})

test('writeBrandFile persiste en data/brand para revisión humana', () => {
  const site = 'kit-test'
  const marker = 'Corrección humana ' + Date.now()
  writeBrandFile(site, 'voice.md', '# Voz\n\n' + marker + '\n')
  writeBrandFile(site, 'AGENT.md', '# AGENT\n\nFlujo blog_get_brand_context.\n')
  assert.ok(readBrandFile(site, 'voice.md').includes(marker))
  const ctx = getBrandContext(site)
  assert.equal(ctx.voice.includes(marker), true)
  assert.equal(ctx.mediaUpload.preferred, 'blog_upload_media_file')
  assert.ok(ctx.agentRules.includes('Contrato de subida'))
  assert.ok(ctx.agentRules.includes('blog_upload_media_file'))
  assert.ok(Array.isArray(ctx.referenceImages))
  assert.ok(ctx.socialPackChannels)
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
