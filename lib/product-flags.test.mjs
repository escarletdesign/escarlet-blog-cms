import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertCmsAiEnabled, isCmsAiEnabled, setCmsAiEnabled } from './product-flags.mjs'

test('CMS AI kill switch honors environment precedence and persisted flag', () => {
  assert.equal(isCmsAiEnabled({ db: { featureFlags: {} }, env: {} }), true)
  assert.equal(isCmsAiEnabled({ db: { featureFlags: { cmsAiEnabled: false } }, env: {} }), false)
  assert.equal(isCmsAiEnabled({ db: { featureFlags: { cmsAiEnabled: true } }, env: { CMS_AI_ENABLED: '0' } }), false)
  assert.equal(isCmsAiEnabled({ db: { featureFlags: { cmsAiEnabled: false } }, env: { CMS_AI_ENABLED: '1' } }), true)

  assert.throws(
    () => assertCmsAiEnabled({ db: { featureFlags: { cmsAiEnabled: false } }, env: {} }),
    (error) => error.status === 403 && error.extra?.code === 'CMS_AI_DISABLED'
  )

  const db = { featureFlags: { creditCheckoutWithoutStripe: true } }
  assert.equal(setCmsAiEnabled({ db, enabled: false, actorId: 'admin', now: '2026-09-14T00:00:00.000Z' }), false)
  assert.equal(db.featureFlags.cmsAiEnabled, false)
  assert.equal(db.featureFlags.creditCheckoutWithoutStripe, true)
  assert.equal(db.featureFlags.updatedBy, 'admin')
})
