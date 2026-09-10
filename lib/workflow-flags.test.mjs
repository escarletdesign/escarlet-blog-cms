import test from 'node:test'
import assert from 'node:assert/strict'
import { getWorkflowFlags, setWorkflowFlags } from './workflow-flags.mjs'

test('workflow flags default on and update independently', () => {
  const db = { featureFlags: { creditCheckoutWithoutStripe: true } }
  assert.deepEqual(getWorkflowFlags(db), { assistantEnabled: true, blogWizardEnabled: true, updatedAt: null })
  setWorkflowFlags({ db, assistantEnabled: false, actorId: 'admin-1', now: '2026-09-10T00:00:00.000Z' })
  assert.deepEqual(getWorkflowFlags(db), { assistantEnabled: false, blogWizardEnabled: true, updatedAt: '2026-09-10T00:00:00.000Z' })
  assert.equal(db.featureFlags.creditCheckoutWithoutStripe, true)
})
