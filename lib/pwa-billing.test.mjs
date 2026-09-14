import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getPwaModelCatalog,
  getPwaCreditPackCatalog,
  getPwaStripeConfig,
  getPwaBillingSnapshot,
  getBillingTestFlags,
  setBillingTestFlags,
  grantPwaTestCredits,
  resolvePwaStripePrice,
  createPwaCheckoutSession,
  createPwaPortalSession
} from './pwa-billing.mjs'

const configuredEnv = {
  STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
  PWA_STRIPE_PRICE_PLAN_STANDARD: 'price_standard',
  PWA_STRIPE_PRICE_CREDITS_100K: 'price_credits_100k'
}

function sampleDb() {
  return {
    plans: [{ id: 'standard', name: 'Standard', draftLimit: 20, publishLimitPerMonth: 12 }],
    usage: { 'pwa-site': { '2026-09': { draftsCreated: 3, publishes: 2 } } },
    aiUsage: { 'pwa-site': { '2026-09': { inputTokens: 120, outputTokens: 80, creditsUsed: 250 } } },
    aiCredits: { 'pwa-site': { balance: 500 } }
  }
}

test('PWA catalog filters models by plan and only exposes configured credit packs', () => {
  assert.deepEqual(getPwaModelCatalog('starter').map((model) => model.id), [
    'escarlet-fast',
    'gpt-4.1-mini',
    'gemini-2.5-flash'
  ])
  const packs = getPwaCreditPackCatalog({ env: configuredEnv })
  assert.equal(packs.find((pack) => pack.id === 'credits-100k').configured, true)
  assert.equal(packs.find((pack) => pack.id === 'credits-25k').configured, false)
  assert.deepEqual(getPwaStripeConfig({ env: configuredEnv }).plans, {
    starter: false,
    standard: true,
    growth: false
  })
})

test('PWA billing snapshot combines existing quotas with non-mutating AI credits', () => {
  const db = sampleDb()
  const snapshot = getPwaBillingSnapshot('pwa-site', {
    db,
    siteConfig: { planId: 'standard', entitlements: { membership: 'active', hosting: false } },
    monthKey: '2026-09',
    env: configuredEnv
  })
  assert.equal(snapshot.drafts.used, 3)
  assert.equal(snapshot.publishes.used, 2)
  assert.deepEqual(snapshot.ai.usage, {
    inputTokens: 120,
    outputTokens: 80,
    totalTokens: 200,
    creditsUsed: 250
  })
  assert.deepEqual(snapshot.ai.tokenCredits, {
    monthlyIncluded: 100000,
    monthlyRemaining: 99750,
    purchasedBalance: 500,
    available: 100250
  })
  assert.equal(snapshot.models.some((model) => model.id === 'grok-3-mini'), true)
})

test('temporary billing flag grants a configured credit pack and records the test grant', () => {
  const db = sampleDb()
  assert.equal(getBillingTestFlags(db).creditCheckoutWithoutStripe, false)
  setBillingTestFlags({ db, creditCheckoutWithoutStripe: true, actorId: 'admin', now: '2026-09-10T12:00:00.000Z' })
  const result = grantPwaTestCredits('pwa-site', 'credits-25k', {
    db,
    actorId: 'client-1',
    now: '2026-09-10T12:01:00.000Z'
  })
  assert.equal(result.tokenCredits, 25_000)
  assert.equal(result.balance, 25_500)
  assert.equal(db.aiCredits['pwa-site'].balance, 25_500)
  assert.equal(db.aiCreditTestGrants.at(-1).actorId, 'client-1')
  assert.equal(getBillingTestFlags(db).updatedAt, '2026-09-10T12:00:00.000Z')
})

test('QA credit checkout adds a pack without resetting monthly consumption', () => {
  const db = sampleDb()
  db.aiUsage['pwa-site']['2026-09'].creditsUsed = 75_000
  setBillingTestFlags({ db, creditCheckoutWithoutStripe: true, actorId: 'admin' })
  grantPwaTestCredits('pwa-site', 'credits-25k', { db, actorId: 'client-1' })
  const snapshot = getPwaBillingSnapshot('pwa-site', { db, monthKey: '2026-09' })
  assert.equal(snapshot.ai.tokenCredits.monthlyRemaining, 25_000)
  assert.equal(snapshot.ai.tokenCredits.purchasedBalance, 25_500)
  assert.equal(snapshot.ai.tokenCredits.available, 50_500)
})

test('Stripe price resolution and checkout stubs are safe when Stripe is not configured', async () => {
  assert.deepEqual(resolvePwaStripePrice({ kind: 'membership', planId: 'standard' }, { env: {} }), {
    kind: 'membership',
    planId: 'standard',
    priceId: null,
    trialDays: 0
  })
  assert.deepEqual(await createPwaCheckoutSession({ site: 'pwa-site', kind: 'membership', planId: 'standard' }, { env: {} }), {
    configured: false,
    reason: 'stripe_not_configured',
    url: null,
    price: { kind: 'membership', planId: 'standard', priceId: null, trialDays: 0 }
  })
  assert.deepEqual(await createPwaPortalSession({ customerId: 'cus_123' }, { env: {} }), {
    configured: false,
    reason: 'stripe_not_configured',
    url: null
  })
})

test('MCP membership checkout includes the configured Stripe trial', async () => {
  const db = {
    plans: [{ id: 'mcp', name: 'CMS con ChatGPT', draftLimit: 20, publishLimitPerMonth: 12, priceId: 'price_mcp', trialDays: 14, enabled: true }]
  }
  const calls = []
  const result = await createPwaCheckoutSession(
    { site: 'trial-site', kind: 'membership', planId: 'mcp' },
    {
      db,
      env: { STRIPE_SECRET_KEY: 'sk_test' },
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return { ok: true, status: 200, json: async () => ({ id: 'cs_trial', url: 'https://checkout.test/trial' }) }
      }
    }
  )
  assert.equal(result.configured, true)
  assert.match(calls[0].init.body, /subscription_data%5Btrial_period_days%5D=14/)
  assert.match(calls[0].init.body, /subscription_data%5Btrial_settings%5D%5Bend_behavior%5D%5Bmissing_payment_method%5D=cancel/)
})

test('checkout and customer portal form server-side Stripe requests from configured price IDs', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      json: async () => url.includes('checkout')
        ? { id: 'cs_123', url: 'https://checkout.stripe.test/cs_123' }
        : { url: 'https://billing.stripe.test/session_123' }
    }
  }
  const checkout = await createPwaCheckoutSession(
    {
      site: 'pwa-site',
      kind: 'membership',
      planId: 'standard',
      successUrl: 'https://app.test/billing/success',
      cancelUrl: 'https://app.test/billing/cancel'
    },
    { env: configuredEnv, fetchImpl }
  )
  assert.equal(checkout.configured, true)
  assert.equal(checkout.url, 'https://checkout.stripe.test/cs_123')
  assert.match(calls[0].init.body, /line_items%5B0%5D%5Bprice%5D=price_standard/)
  assert.match(calls[0].init.body, /metadata%5Bsite%5D=pwa-site/)
  assert.match(calls[0].init.body, /subscription_data%5Bmetadata%5D%5BplanId%5D=standard/)

  const portal = await createPwaPortalSession(
    { customerId: 'cus_123', returnUrl: 'https://app.test/settings' },
    { env: configuredEnv, fetchImpl }
  )
  assert.deepEqual(portal, { configured: true, url: 'https://billing.stripe.test/session_123' })
  assert.equal(calls[1].url, 'https://api.stripe.com/v1/billing_portal/sessions')
  assert.match(calls[1].init.body, /customer=cus_123/)
})

test('persisted admin credit packs override legacy catalog without exposing Stripe price IDs', () => {
  const db = sampleDb()
  db.aiCreditPacks = {
    'credits-100k': { name: '100K editable', tokenCredits: 101000, priceId: 'price_private_100k', enabled: true },
    'credits-custom': { name: 'Custom credits', tokenCredits: 75000, priceId: 'price_private_custom', enabled: true }
  }
  const packs = getPwaCreditPackCatalog({ db, env: {} })
  assert.deepEqual(packs.find((pack) => pack.id === 'credits-100k'), { id: 'credits-100k', name: '100K editable', tokenCredits: 101000, configured: true })
  assert.equal(JSON.stringify(packs).includes('price_private'), false)
  assert.deepEqual(resolvePwaStripePrice({ kind: 'credits', packId: 'credits-custom' }, { db, env: {} }), {
    kind: 'credits', packId: 'credits-custom', priceId: 'price_private_custom'
  })
})
