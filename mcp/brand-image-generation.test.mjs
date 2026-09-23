import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  BRAND_ALL_FILES,
  assertBrandFileAccess,
  getBrandContext,
  loadActiveBrandKitSnapshot,
  prepareImageGeneration,
  writeBrandFile
} from '../lib/brand-kit.mjs'

const root = new URL('../', import.meta.url)
const brandDir = new URL('../data/brand/escarlet/', import.meta.url)
const referenceDir = new URL('../data/media/escarlet/reference/', import.meta.url)

function activeKit() {
  const manifest = Object.fromEntries(BRAND_ALL_FILES.map((name) => {
    const value = readFileSync(new URL(name, brandDir), 'utf8')
    return [name, name.endsWith('.json') ? JSON.parse(value) : value]
  }))
  const assets = readdirSync(referenceDir).filter((name) => /\.(?:png|jpe?g|webp|gif)$/i.test(name)).sort().map((name, index) => ({
    id: `asset-${index + 1}`,
    name: `/app/data/brand/escarlet/${name}`,
    storageKey: `media/escarlet/reference/${name}`,
    metadata: {}
  }))
  return { manifest, assets, id: 'brand-escarlet-active-v3', version: 3 }
}

test('contexto y preparación usan el mismo snapshot activo y sus 11 referencias', () => {
  const active = activeKit()
  active.manifest['brand-core.json'] = {
    ...active.manifest['brand-core.json'],
    fixed: {
      ...active.manifest['brand-core.json'].fixed,
      palette: { cream: '#F4F1EA', primary: '#0E8FA8' }
    }
  }
  const snapshot = loadActiveBrandKitSnapshot('escarlet', { manifest: active.manifest, assets: active.assets, brandKitVersionId: active.id, version: active.version })
  const context = getBrandContext('escarlet', { auth: { role: 'admin' }, canonicalManifest: active.manifest, canonicalAssets: active.assets, brandKitVersionId: active.id, brandKitVersion: { version: active.version } })
  const prepared = prepareImageGeneration('escarlet', { assetType: 'blog_cover', title: 'Diseño con criterio' }, { canonicalSnapshot: snapshot })
  assert.equal(context.brandKitVersionId, active.id)
  assert.equal(prepared.brandKitVersionId, active.id)
  assert.equal(context.brandKitSnapshotHash, prepared.brandKitSnapshotHash)
  assert.equal(context.referenceImages.length, active.assets.length)
  assert.equal(context.referenceImages.length, 11)
  assert.equal(context.canonicalPalette.cream, undefined)
  assert.match(context.brandCore.fixed.typography.heading, /Montserrat/)
})

test('la preparación fija dimensiones finales y cardinalidad sin receipts', () => {
  const active = activeKit()
  const snapshot = loadActiveBrandKitSnapshot('escarlet', { manifest: active.manifest, assets: active.assets, brandKitVersionId: active.id, version: active.version })
  const carousel = prepareImageGeneration('escarlet', { assetType: 'social_image', expectedAssetCount: 4, itemId: 'item-1', channel: 'instagram' }, { canonicalSnapshot: snapshot })
  const story = prepareImageGeneration('escarlet', { assetType: 'instagram_story', itemId: 'item-1', channel: 'instagram_story' }, { canonicalSnapshot: snapshot })
  assert.equal(carousel.composition.dimensions, '1080x1350')
  assert.equal(carousel.generationCardinality.maxImageCount, 4)
  assert.equal(carousel.brandPreparation.finalTextRenderer, 'ChatGPT')
  assert.doesNotMatch(carousel.generationCardinality.rule, /receipt/i)
  assert.equal(story.composition.dimensions, '1080x1920')
  assert.equal(story.composition.aspectRatio, '9:16')
})

test('la escritura local legacy sigue autorizada y expira su snapshot', () => {
  const site = `brand-cache-${Date.now()}`
  try {
    assert.equal(assertBrandFileAccess({ role: 'owner' }, 'brand-core.json', { write: true }), 'brand-core.json')
    assert.throws(() => assertBrandFileAccess({ role: 'editor' }, 'brand-core.json', { write: true }), /owner\/admin/)
    writeBrandFile(site, 'AGENT.md', '# agent\n')
    writeBrandFile(site, 'keywords.md', '# keywords\n')
    const before = getBrandContext(site, { auth: { role: 'admin' } })
    writeBrandFile(site, 'AGENT.md', '# agent actualizado\n')
    const after = getBrandContext(site, { auth: { role: 'admin' } })
    assert.notEqual(after.brandKitVersionId, before.brandKitVersionId)
  } finally {
    rmSync(join(root.pathname, 'data', 'brand', site), { recursive: true, force: true })
  }
})
