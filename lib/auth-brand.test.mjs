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
const {
  resolveAuth,
  canAccessSite,
  assertSiteAccess,
  generateSiteAccessToken,
  publicAuthSession
} = await import('../lib/auth.mjs')
const { saveSiteConfig } = await import('../lib/site-config.mjs')
const { importBrandKitZip, readBrandFile } = await import('../lib/brand-kit.mjs')

after(() => {
  rmSync(dataRoot, { recursive: true, force: true })
})

test('admin token ve todo y site token solo su handle', async () => {
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
  const tokenA = generateSiteAccessToken()
  saveSiteConfig('cliente-a', { siteAccessToken: tokenA })

  const admin = resolveAuth('admin-secret-token')
  assert.equal(admin.role, 'admin')
  assert.equal(canAccessSite(admin, 'cliente-a'), true)
  assert.equal(canAccessSite(admin, 'cliente-b'), true)

  const siteAuth = resolveAuth(tokenA)
  assert.equal(siteAuth.role, 'site')
  assert.equal(siteAuth.site, 'cliente-a')
  assert.equal(canAccessSite(siteAuth, 'cliente-a'), true)
  assert.equal(canAccessSite(siteAuth, 'cliente-b'), false)
  assert.throws(() => assertSiteAccess(siteAuth, 'cliente-b'), /solo gestiona/)

  const session = publicAuthSession(siteAuth)
  assert.deepEqual(session.sites, ['cliente-a'])
  assert.equal(session.canCreateSites, false)
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
