import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dataRoot = mkdtempSync(join(tmpdir(), 'cms-auth-'))
process.env.CMS_DATA_DIR = dataRoot
process.env.ADMIN_TOKEN = 'admin-secret-token'
process.env.CMS_SKIP_SEED = '1'
mkdirSync(join(dataRoot, 'media'), { recursive: true })
writeFileSync(
  join(dataRoot, 'db.json'),
  JSON.stringify({ sites: [], authors: [], categories: [], media: [], posts: [] })
)

const { createSite } = await import('../lib/create-site.mjs')
const { readDb } = await import('../lib/db.mjs')
const {
  resolveAuth,
  canAccessSite,
  assertSiteAccess,
  publicAuthSession
} = await import('../lib/auth.mjs')
const { importBrandKitZip, readBrandFile } = await import('../lib/brand-kit.mjs')
const { loadVisualSystem } = await import('../lib/visual-system.mjs')

after(() => {
  rmSync(dataRoot, { recursive: true, force: true })
})

test('admin token ve todo y los tokens de marca antiguos quedan revocados', async () => {
  await createSite({
    handle: 'cliente-a',
    name: 'Cliente A',
    domain: 'https://a.example',
    skipSeed: true
  })
  await createSite({
    handle: 'cliente-b',
    name: 'Cliente B',
    domain: 'https://b.example',
    skipSeed: true
  })
  const admin = resolveAuth('admin-secret-token')
  assert.equal(admin.role, 'admin')
  assert.equal(canAccessSite(admin, 'cliente-a'), true)
  assert.equal(canAccessSite(admin, 'cliente-b'), true)

  assert.equal(resolveAuth('site_revoked_token'), null)
})

test('importBrandKitZip organiza md e imágenes', async () => {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('voice.md', '# Voz de prueba\n')
  zip.file('AGENT.md', '# Agente\n')
  // PNG 1x1 mínimo
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
  zip.file('reference/mood.png', png)
  const buf = await zip.generateAsync({ type: 'nodebuffer' })

  await createSite({
    handle: 'zip-site',
    name: 'Zip',
    domain: 'https://zip.example',
    skipSeed: true,
    force: true
  }).catch(() => null)

  const result = await importBrandKitZip('zip-site', { buffer: buf })
  assert.ok(result.importedMd.includes('voice.md'))
  assert.ok(result.importedMd.includes('AGENT.md'))
  assert.equal(result.importedImages.length, 1)
  assert.match(readBrandFile('zip-site', 'voice.md'), /Voz de prueba/)

  await importBrandKitZip('zip-site', { buffer: buf })
  assert.equal(readDb().media.filter((media) => media.site === 'zip-site' && media.kind === 'reference').length, 1)
})

test('importBrandKitZip acepta estructura libre y pistas por nombre', async () => {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('docs/marca/tono-de-voz.md', '# Tono libre\n')
  zip.file('brand/estilo-visual-2024.md', '# Estilo\n')
  zip.file('misc/notas-random.md', '# Hueco keywords\n')
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
  zip.file('assets/deep/folder/foto.jpg', png)
  zip.file('readme.txt', 'ignorar')
  const buf = await zip.generateAsync({ type: 'nodebuffer' })

  await createSite({
    handle: 'zip-fuzzy',
    name: 'Fuzzy',
    domain: 'https://fuzzy.example',
    skipSeed: true,
    force: true
  })

  const result = await importBrandKitZip('zip-fuzzy', { buffer: buf })
  assert.ok(result.importedMd.includes('voice.md'))
  assert.ok(result.importedMd.includes('visual-style.md'))
  assert.ok(result.importedMd.includes('image-guide.md'), 'MD sin pista va al primer hueco vacío')
  assert.equal(result.importedImages.length, 1)
  assert.match(readBrandFile('zip-fuzzy', 'voice.md'), /Tono libre/)
  assert.match(readBrandFile('zip-fuzzy', 'image-guide.md'), /Hueco keywords/)
  assert.ok(result.skipped.some((s) => s.includes('readme.txt')))
})

test('importBrandKitZip importa JSON brand-spec como image-spec.json', async () => {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('voice.md', '# Voz\n')
  zip.file(
    'maria-morales-brandkit/04-imagenes-brand-spec.json',
    JSON.stringify({ aspectRatio: '4:5', palette: ['#1a1a1a', '#f5f0e8'] }, null, 2)
  )
  zip.file('maria-morales-brandkit/05-tablero-visual.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  const buf = await zip.generateAsync({ type: 'nodebuffer' })

  await createSite({
    handle: 'zip-json',
    name: 'Zip Json',
    domain: 'https://zip-json.example',
    skipSeed: true,
    force: true
  })

  const result = await importBrandKitZip('zip-json', { buffer: buf })
  assert.ok(result.importedData.includes('image-spec.json'))
  assert.ok(result.skipped.some((s) => s.includes('.svg')))
  const raw = readBrandFile('zip-json', 'image-spec.json')
  assert.match(raw, /aspectRatio/)
  const { getBrandContext } = await import('../lib/brand-kit.mjs')
  const ctx = getBrandContext('zip-json')
  assert.equal(ctx.imageSpec.aspectRatio, '4:5')
})

test('importBrandKitZip importa los JSON visuales v2 por sitio', async () => {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('brand-core.json', JSON.stringify({ id: 'zip-visual', version: '2.0.0', identity: { name: 'Visual' }, fixed: { imageRules: [] } }))
  zip.file('visual-system.json', JSON.stringify({ site: 'zip-visual', cover: { allowText: false } }))
  zip.file('image-archetypes.json', JSON.stringify({ site: 'zip-visual', archetypes: [{ id: 'test', name: 'Test' }] }))
  zip.file('reference-library.json', JSON.stringify({ site: 'zip-visual', references: [{ id: 'ref', approved: true }] }))
  zip.file('social-templates.json', JSON.stringify({ site: 'zip-visual', templates: [{ id: 'editorial' }] }))
  const buf = await zip.generateAsync({ type: 'nodebuffer' })

  await createSite({ handle: 'zip-visual', name: 'Visual', domain: 'https://visual.example', skipSeed: true, force: true })
  const result = await importBrandKitZip('zip-visual', { buffer: buf })
  assert.deepEqual(new Set(result.importedData), new Set(['brand-core.json', 'visual-system.json', 'image-archetypes.json', 'reference-library.json', 'social-templates.json']))
  const visual = loadVisualSystem('zip-visual')
  assert.equal(visual.brand.id, 'zip-visual')
  assert.equal(visual.archetypes[0].id, 'test')
  assert.equal(visual.socialTemplates[0].id, 'editorial')
  const { getBrandContext } = await import('../lib/brand-kit.mjs')
  const context = getBrandContext('zip-visual')
  assert.equal(context.brandCore.id, 'zip-visual')
  assert.equal(context.visualSystem.site, 'zip-visual')
})
