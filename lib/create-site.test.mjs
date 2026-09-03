import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dataRoot = mkdtempSync(join(tmpdir(), 'cms-onboard-'))
process.env.CMS_DATA_DIR = dataRoot
process.env.CMS_SKIP_SEED = '1'
mkdirSync(join(dataRoot, 'media'), { recursive: true })
writeFileSync(
  join(dataRoot, 'db.json'),
  JSON.stringify({ sites: [], authors: [], categories: [], media: [], posts: [] })
)

const { getOnboardingPlaybook, renderOnboardingMarkdown } = await import('../lib/onboarding.mjs')
const { createSite, validateSiteHandle } = await import('../lib/create-site.mjs')
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

test('getOnboardingPlaybook incluye Coolify y sync', () => {
  const pb = getOnboardingPlaybook({ handle: 'demo', domain: 'https://demo.test', name: 'Demo' })
  assert.equal(pb.site.handle, 'demo')
  assert.ok(pb.phases.some((p) => p.id === 'coolify-webhook'))
  assert.ok(pb.phases.some((p) => p.id === 'frontend'))
  assert.ok(pb.agentContentWorkflow.create.includes('blog_get_brand_context'))
  const md = renderOnboardingMarkdown(pb)
  assert.match(md, /Deploy webhook/i)
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
  assert.match(readBrandFile('demo-site', 'AGENT.md'), /demo-site/)
  assert.ok(result.nextSteps.length >= 2)

  await assert.rejects(() => createSite({ handle: 'demo-site', name: 'X' }), /Ya existe/)
})
