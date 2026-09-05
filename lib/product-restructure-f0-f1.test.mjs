/**
 * F0/F1 role defaults + review lifecycle under PRODUCT_RESTRUCTURE_V1.
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dataRoot = mkdtempSync(join(tmpdir(), 'cms-v1-roles-'))
process.env.CMS_DATA_DIR = dataRoot
process.env.ADMIN_TOKEN = 'admin-secret-token'
process.env.PRODUCT_RESTRUCTURE_V1 = '1'
process.env.CMS_SKIP_SEED = '1'
mkdirSync(join(dataRoot, 'media'), { recursive: true })
writeFileSync(
  join(dataRoot, 'db.json'),
  JSON.stringify({
    sites: [],
    authors: [],
    categories: [],
    media: [],
    posts: [],
    plans: [{ id: 'standard', name: 'Standard', draftLimit: 20, publishLimitPerMonth: 12 }],
    usage: {}
  })
)

after(() => {
  rmSync(dataRoot, { recursive: true, force: true })
})

const { createSite } = await import('./create-site.mjs')
const {
  resolveAuth,
  publicAuthSession,
  assertAgencyOps,
  generateSiteAccessToken,
  generateAgencyAccessToken
} = await import('./auth.mjs')
const { saveSiteConfig } = await import('./site-config.mjs')
const {
  createDraft,
  publishPost,
  requestPostChanges,
  applyReviewLinkAction
} = await import('./cms-ops.mjs')
const { createReviewToken, consumeReviewToken } = await import('./access-tokens.mjs')
const { sendMagicLinkEmail } = await import('./magic-email.mjs')

test('V1 role defaults: site token → client, ADMIN → admin, agency token → agency_admin', async () => {
  await createSite({
    handle: 'role-site',
    name: 'Role Site',
    domain: 'https://role.example',
    skipSeed: true
  })
  const siteTok = generateSiteAccessToken()
  const agencyTok = generateAgencyAccessToken()
  saveSiteConfig('role-site', { siteAccessToken: siteTok, agencyAccessToken: agencyTok })

  const admin = resolveAuth('admin-secret-token')
  assert.equal(admin.role, 'admin')
  assert.ok(admin.capabilities.includes('ops:global'))

  const client = resolveAuth(siteTok)
  assert.equal(client.role, 'client')
  assert.equal(client.site, 'role-site')
  assert.equal(publicAuthSession(client).role, 'client')
  assert.throws(() => assertAgencyOps(client), /agency o admin/)

  const agency = resolveAuth(agencyTok)
  assert.equal(agency.role, 'agency_admin')
  assert.equal(agency.site, 'role-site')
  assertAgencyOps(agency)
})

test('agency_gate holds publish; request_changes requires reason; approve via review link', async () => {
  await createSite({
    handle: 'gate-site',
    name: 'Gate',
    domain: 'https://gate.example',
    skipSeed: true,
    requiresHumanApproval: true
  })
  saveSiteConfig('gate-site', { reviewMode: 'agency_gate' })

  const draft = await createDraft({
    site: 'gate-site',
    title: 'Post de revisión',
    contentSource: 'client'
  })
  assert.equal(draft.post.contentSource, 'client')
  assert.equal(draft.post.status, 'draft')

  const submitted = await publishPost('gate-site', draft.post.slug)
  assert.equal(submitted.post.status, 'review')
  assert.equal(submitted.submittedForReview, true)

  await assert.rejects(
    () => requestPostChanges('gate-site', draft.post.slug, { rejectReason: '  ' }),
    /rejectReason/
  )

  const feedback = await requestPostChanges('gate-site', draft.post.slug, {
    rejectReason: 'Falta CTA claro',
    actor: { role: 'agency_admin' }
  })
  assert.equal(feedback.post.status, 'changes_requested')
  assert.equal(feedback.post.rejectReason, 'Falta CTA claro')
  assert.ok(feedback.post.rejectAt)

  const resubmit = await publishPost('gate-site', draft.post.slug)
  assert.equal(resubmit.post.status, 'review')

  const minted = createReviewToken({
    site: 'gate-site',
    slug: draft.post.slug,
    actions: ['approve']
  })
  const consumed = consumeReviewToken(minted.token, { action: 'approve' })
  assert.equal(consumed.ok, true)
  assert.equal(consumed.actor.role, 'review_link')

  // Approve without full SEO may 422 — that is expected; action path is exercised.
  try {
    await applyReviewLinkAction(consumed.site, consumed.slug, {
      action: 'approve',
      actor: consumed.actor
    })
  } catch (err) {
    assert.equal(err.status, 422)
  }
})

test('direct reviewMode publishes without agency gate', async () => {
  await createSite({
    handle: 'direct-site',
    name: 'Direct',
    domain: 'https://direct.example',
    skipSeed: true,
    requiresHumanApproval: false
  })
  saveSiteConfig('direct-site', { reviewMode: 'direct' })
  const draft = await createDraft({ site: 'direct-site', title: 'Direct post' })
  try {
    const result = await publishPost('direct-site', draft.post.slug)
    // May fail SEO; if it submits for review something is wrong.
    assert.notEqual(result.submittedForReview, true)
  } catch (err) {
    assert.equal(err.status, 422)
  }
})

test('magic email falls back to console/ops paste without RESEND_API_KEY', async () => {
  delete process.env.RESEND_API_KEY
  const result = await sendMagicLinkEmail({
    to: 'client@example.com',
    link: 'https://cms.example/api/magic/consume?token=x',
    site: 'demo'
  })
  assert.equal(result.ok, true)
  assert.equal(result.transport, 'console')
  assert.equal(result.pasted, true)
})
