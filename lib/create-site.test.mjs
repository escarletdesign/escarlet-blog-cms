import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dataRoot = mkdtempSync(join(tmpdir(), 'cms-onboard-'))
process.env.CMS_DATA_DIR = dataRoot
process.env.CMS_SKIP_SEED = '1'
process.env.CMS_SKIP_FAVICON = '1'
mkdirSync(join(dataRoot, 'media'), { recursive: true })
writeFileSync(
  join(dataRoot, 'db.json'),
  JSON.stringify({ sites: [], authors: [], categories: [], media: [], posts: [] })
)

const { getOnboardingPlaybook, renderOnboardingMarkdown } = await import('../lib/onboarding.mjs')
const { createSite, validateSiteHandle, copyFrontendTemplates } = await import('../lib/create-site.mjs')
const { loadSiteConfig, listSiteHandles } = await import('../lib/site-config.mjs')
const { readBrandFile } = await import('../lib/brand-kit.mjs')

after(() => {
  rmSync(dataRoot, { recursive: true, force: true })
})

test('validateSiteHandle rechaza inválidos', () => {
  assert.throws(() => validateSiteHandle('A'), /Handle inválido/)
  assert.throws(() => validateSiteHandle('admin'), /reservado/)
  assert.equal(validateSiteHandle('Mares-24'), 'mares-24')
})

test('getOnboardingPlaybook incluye Coolify, WordPress y sync', () => {
  const pb = getOnboardingPlaybook({ handle: 'demo', domain: 'https://demo.test', name: 'Demo' })
  assert.equal(pb.site.handle, 'demo')
  assert.ok(pb.phases.some((p) => p.id === 'coolify-webhook'))
  assert.ok(pb.phases.some((p) => p.id === 'wordpress'))
  assert.ok(pb.phases.some((p) => p.id === 'frontend'))
  assert.ok(pb.agentContentWorkflow.create.includes('blog_get_brand_context'))
  const md = renderOnboardingMarkdown(pb)
  assert.match(md, /Deploy webhook/i)
  assert.match(md, /escarlet-blog\.mjs/)
  assert.match(md, /\/runtime\/v1/)
  assert.match(md, /WordPress/i)
  assert.ok(pb.phases.some((p) => p.id === 'edit'))
  assert.match(md, /Blog en la web pública/)
})

test('createSite registra handle, brand y runtime', async () => {
  const result = await createSite({
    handle: 'demo-site',
    name: 'Demo Site',
    domain: 'https://demo.example',
    rebuildWebhookUrl: 'https://coolify.test/deploy?uuid=1',
    authors: ['Alex']
  })
  assert.equal(result.ok, true)
  assert.equal(result.site.handle, 'demo-site')
  assert.ok(listSiteHandles().includes('demo-site'))
  const config = loadSiteConfig('demo-site')
  assert.equal(config.domain, 'https://demo.example')
  assert.equal(config.rebuildWebhookUrl, 'https://coolify.test/deploy?uuid=1')
  assert.equal(config.blogEnabled, true)
  assert.match(readBrandFile('demo-site', 'AGENT.md'), /demo-site/)
  assert.ok(result.nextSteps.length >= 2)

  await assert.rejects(() => createSite({ handle: 'demo-site', name: 'X' }), /Ya existe/)
})

test('copyFrontendTemplates deja el hook y no pega los generadores gordos', () => {
  const dest = mkdtempSync(join(tmpdir(), 'cms-runtime-copy-'))
  try {
    const copied = copyFrontendTemplates(dest)
    const names = copied.map((p) => p.slice(dest.length + 1))
    assert.ok(names.includes('escarlet-blog.mjs'))
    assert.ok(names.includes('sync-blog-cms.mjs'))
    const sync = readFileSync(join(dest, 'sync-blog-cms.mjs'), 'utf8')
    const packs = readFileSync(join(dest, 'generate-blog-social-packs.mjs'), 'utf8')
    assert.match(sync, /runCli\(\['sync'\]\)/)
    assert.match(packs, /runCli\(\['packs'\]\)/)
    assert.match(readFileSync(join(dest, 'escarlet-blog.mjs'), 'utf8'), /\/runtime\//)
    assert.equal(existsSync(join(dest, 'wrappers')), false)
  } finally {
    rmSync(dest, { recursive: true, force: true })
  }
})
