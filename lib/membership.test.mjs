import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getMembershipGrant,
  saveMembershipGrant,
  revokeMembershipGrant,
  membershipState,
  saveMcpPlan
} from './membership.mjs'

test('complimentary membership grants are auditable and can expire or be revoked', () => {
  const db = { plans: [{ id: 'mcp', name: 'CMS con ChatGPT', draftLimit: 20, publishLimitPerMonth: 12 }] }
  const grant = saveMembershipGrant('free-site', 'user-founder', {
    kind: 'complimentary',
    activeUntil: '2026-10-01T00:00:00.000Z',
    reason: 'Cliente fundador'
  }, { db, actorId: 'admin', now: '2026-09-14T12:00:00.000Z' })
  assert.equal(grant.active, true)
  assert.equal(membershipState('free-site', db, { planId: 'mcp', entitlements: { membership: 'suspended' } }, Date.parse('2026-09-20T00:00:00.000Z'), 'user-founder').status, 'complimentary')
  assert.equal(membershipState('free-site', db, { planId: 'mcp', entitlements: { membership: 'suspended' } }, Date.parse('2026-09-20T00:00:00.000Z'), 'other-user').active, false)
  assert.equal(getMembershipGrant('free-site', 'user-founder', db, Date.parse('2026-10-02T00:00:00.000Z')).active, false)
  assert.equal(membershipState('free-site', db, { planId: 'standard', entitlements: { membership: 'active' } }, Date.parse('2026-10-02T00:00:00.000Z'), 'user-founder').status, 'complimentary_expired')
  revokeMembershipGrant('free-site', 'user-founder', { db, actorId: 'admin', now: '2026-09-21T00:00:00.000Z' })
  assert.equal(getMembershipGrant('free-site', 'user-founder', db, Date.parse('2026-09-21T00:00:01.000Z')).active, false)
})

test('MCP plans validate and persist a bounded Stripe trial', () => {
  const db = { plans: [] }
  const plan = saveMcpPlan({ priceId: 'price_mcp', draftLimit: 20, publishLimitPerMonth: 12, trialDays: 14, enabled: true }, db)
  assert.equal(plan.trialDays, 14)
  assert.throws(() => saveMcpPlan({ priceId: 'price_mcp', draftLimit: 20, publishLimitPerMonth: 12, trialDays: 366 }, db), { status: 400 })
})

test('Stripe trial membership is active until its trial access date', () => {
  const db = {
    memberships: {
      'trial-site': { status: 'trialing', accessUntil: Math.floor(Date.parse('2026-10-01T00:00:00.000Z') / 1000), trialEndsAt: Math.floor(Date.parse('2026-10-01T00:00:00.000Z') / 1000) }
    },
    plans: [{ id: 'mcp', name: 'CMS con ChatGPT', draftLimit: 20, publishLimitPerMonth: 12 }]
  }
  const active = membershipState('trial-site', db, { planId: 'mcp', entitlements: { membership: 'active' } }, Date.parse('2026-09-20T00:00:00.000Z'))
  assert.equal(active.active, true)
  assert.equal(active.status, 'trialing')
  const expired = membershipState('trial-site', db, { planId: 'mcp', entitlements: { membership: 'active' } }, Date.parse('2026-10-02T00:00:00.000Z'))
  assert.equal(expired.active, false)
})
