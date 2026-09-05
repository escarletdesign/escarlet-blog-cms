/**
 * RED / threat-matrix tests for magic + review access tokens.
 * Run with PRODUCT_RESTRUCTURE_V1=1.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { after } from 'node:test'

const dataRoot = mkdtempSync(join(tmpdir(), 'cms-access-tokens-'))
process.env.CMS_DATA_DIR = dataRoot
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

const tokens = await import('./access-tokens.mjs')
const { sanitizeNext } = await import('./embed-session.mjs')

test('magic: expired token → 410, no session payload', () => {
  const created = tokens.createMagicToken({
    site: 'demo',
    role: 'client',
    email: 'a@example.com',
    ttlMs: 1
  })
  // Force expiry
  const row = tokens._testGetMagic?.(created.token) || null
  if (row) row.expiresAt = Date.now() - 1000
  else {
    // Implementation must expire via clock; sleep briefly then consume
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
  const result = tokens.consumeMagicToken(created.token)
  assert.equal(result.ok, false)
  assert.ok(result.status === 410 || result.status === 401)
  assert.equal(result.session, undefined)
})

test('magic: reused token → 401/410, no session', () => {
  const created = tokens.createMagicToken({
    site: 'demo',
    role: 'client',
    ttlMs: 15 * 60 * 1000
  })
  const first = tokens.consumeMagicToken(created.token)
  assert.equal(first.ok, true)
  assert.ok(first.session)
  const second = tokens.consumeMagicToken(created.token)
  assert.equal(second.ok, false)
  assert.ok(second.status === 410 || second.status === 401)
  assert.equal(second.session, undefined)
})

test('magic: wrong-site bind is preserved on session', () => {
  const created = tokens.createMagicToken({
    site: 'site-a',
    role: 'client',
    ttlMs: 15 * 60 * 1000
  })
  const result = tokens.consumeMagicToken(created.token)
  assert.equal(result.ok, true)
  assert.equal(result.session.site, 'site-a')
  assert.equal(result.session.role, 'client')
})

test('magic: open-redirect next is sanitized to hash-only', () => {
  assert.equal(sanitizeNext('https://evil.example/phish'), '#/entradas')
  assert.equal(sanitizeNext('//evil'), '#/entradas')
  const created = tokens.createMagicToken({
    site: 'demo',
    role: 'client',
    next: 'https://evil.example',
    ttlMs: 15 * 60 * 1000
  })
  assert.equal(created.next, '#/entradas')
  const result = tokens.consumeMagicToken(created.token)
  assert.equal(result.session.next, '#/entradas')
})

test('magic: CSRF consume rejects cross-origin', () => {
  const created = tokens.createMagicToken({
    site: 'demo',
    role: 'client',
    ttlMs: 15 * 60 * 1000
  })
  const result = tokens.consumeMagicToken(created.token, {
    origin: 'https://evil.example',
    host: 'cms.example'
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
  assert.equal(result.session, undefined)
})

test('review: forged action not in token → denied', () => {
  const created = tokens.createReviewToken({
    site: 'demo',
    slug: 'post-1',
    actions: ['approve'],
    ttlMs: 15 * 60 * 1000
  })
  const result = tokens.consumeReviewToken(created.token, {
    action: 'request_changes',
    rejectReason: 'Needs rewrite'
  })
  assert.equal(result.ok, false)
  assert.ok(result.status === 401 || result.status === 403)
})

test('review: cross-slug mismatch → denied', () => {
  const created = tokens.createReviewToken({
    site: 'demo',
    slug: 'post-1',
    actions: ['approve', 'request_changes'],
    ttlMs: 15 * 60 * 1000
  })
  const result = tokens.consumeReviewToken(created.token, {
    action: 'approve',
    expectedSlug: 'other-post'
  })
  assert.equal(result.ok, false)
  assert.ok(result.status >= 400)
})

test('review: expired → denied', () => {
  const created = tokens.createReviewToken({
    site: 'demo',
    slug: 'post-1',
    actions: ['approve'],
    ttlMs: 1
  })
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
  const result = tokens.consumeReviewToken(created.token, { action: 'approve' })
  assert.equal(result.ok, false)
  assert.ok(result.status === 410 || result.status === 401)
})

test('review: no elevation to agency_admin', () => {
  const created = tokens.createReviewToken({
    site: 'demo',
    slug: 'post-1',
    actions: ['approve'],
    ttlMs: 15 * 60 * 1000
  })
  const result = tokens.consumeReviewToken(created.token, { action: 'approve' })
  assert.equal(result.ok, true)
  assert.notEqual(result.actor?.role, 'agency_admin')
  assert.notEqual(result.actor?.role, 'admin')
  assert.ok(['reviewer', 'client', 'review_link'].includes(result.actor?.role))
})

test('review: empty rejectReason fails for request_changes', () => {
  const created = tokens.createReviewToken({
    site: 'demo',
    slug: 'post-1',
    actions: ['request_changes'],
    ttlMs: 15 * 60 * 1000
  })
  const result = tokens.consumeReviewToken(created.token, {
    action: 'request_changes',
    rejectReason: '   '
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 400)
})
