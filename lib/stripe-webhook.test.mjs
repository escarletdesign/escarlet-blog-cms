/**
 * F4 Stripe Payment Links + idempotent ledger (file backend when no DATABASE_URL).
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dataRoot = mkdtempSync(join(tmpdir(), 'cms-f4-stripe-'))
process.env.CMS_DATA_DIR = dataRoot
process.env.ADMIN_TOKEN = 'admin-secret-token'
process.env.PRODUCT_RESTRUCTURE_V1 = '1'
process.env.CMS_SKIP_SEED = '1'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
delete process.env.DATABASE_URL
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
const { loadSiteConfig, saveSiteConfig } = await import('./site-config.mjs')
const {
  verifyStripeSignature,
  applyCheckoutSessionCompleted,
  handleStripeEvent
} = await import('./stripe-webhook.mjs')

function signBody(rawBody, secret = process.env.STRIPE_WEBHOOK_SECRET) {
  const t = Math.floor(Date.now() / 1000)
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex')
  return `t=${t},v1=${v1}`
}

test('verifyStripeSignature accepts valid header and rejects bad ones', () => {
  const raw = '{"id":"evt_1"}'
  const good = signBody(raw)
  assert.equal(verifyStripeSignature(raw, good, process.env.STRIPE_WEBHOOK_SECRET), true)
  assert.throws(() => verifyStripeSignature(raw, 't=1,v1=dead', process.env.STRIPE_WEBHOOK_SECRET))
})

test('membership payment activates plan and duplicate webhook is idempotent', async () => {
  await createSite({
    handle: 'pay-site',
    name: 'Pay',
    domain: 'https://pay.example',
    skipSeed: true
  })
  saveSiteConfig('pay-site', {
    planId: 'starter',
    entitlements: { membership: 'suspended', hosting: false }
  })

  const event = {
    id: 'evt_membership_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        amount_total: 4900,
        currency: 'eur',
        metadata: { site: 'pay-site', kind: 'membership', planId: 'standard' }
      }
    }
  }

  const first = await applyCheckoutSessionCompleted(event)
  assert.equal(first.applied, true)
  assert.equal(loadSiteConfig('pay-site').entitlements.membership, 'active')
  assert.equal(loadSiteConfig('pay-site').planId, 'standard')

  const second = await applyCheckoutSessionCompleted(event)
  assert.equal(second.duplicate, true)
  assert.equal(second.applied, false)
})

test('hosting add-on alone sets hosting without changing draft/publish plan limits', async () => {
  await createSite({
    handle: 'host-site',
    name: 'Host',
    domain: 'https://host.example',
    skipSeed: true
  })
  saveSiteConfig('host-site', {
    planId: 'standard',
    entitlements: { membership: 'active', hosting: false }
  })

  const event = {
    id: 'evt_hosting_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_host',
        amount_total: 1500,
        currency: 'eur',
        metadata: { site: 'host-site', kind: 'hosting' }
      }
    }
  }

  const result = await handleStripeEvent(event)
  assert.equal(result.applied, true)
  const cfg = loadSiteConfig('host-site')
  assert.equal(cfg.entitlements.hosting, true)
  assert.equal(cfg.planId, 'standard')
  assert.equal(cfg.entitlements.membership, 'active')
})

test('credit pack settlement increments AI credits once and records the credit payment ledger', async () => {
  await createSite({
    handle: 'credit-site',
    name: 'Credits',
    domain: 'https://credits.example',
    skipSeed: true
  })

  const event = {
    id: 'evt_credits_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_credits_1',
        customer: 'cus_credit_site',
        amount_total: 990,
        currency: 'eur',
        metadata: { site: 'credit-site', kind: 'credits', packId: 'credits-100k' }
      }
    }
  }

  const first = await handleStripeEvent(event)
  assert.deepEqual(first, {
    applied: true,
    site: 'credit-site',
    kind: 'credits',
    packId: 'credits-100k',
    tokenCredits: 100_000,
    balance: 100_000
  })

  const { readDb } = await import('./db.mjs')
  assert.deepEqual(readDb().aiCredits['credit-site'], {
    balance: 100_000,
    stripeCustomerId: 'cus_credit_site'
  })

  const duplicate = await handleStripeEvent(event)
  assert.equal(duplicate.duplicate, true)
  assert.equal(readDb().aiCredits['credit-site'].balance, 100_000)

  const ledger = JSON.parse((await import('node:fs')).readFileSync(join(dataRoot, 'stripe-ledger.json'), 'utf8'))
  assert.equal(ledger.payments.filter((payment) => payment.eventId === 'evt_credits_1').length, 1)
  assert.equal(ledger.payments.find((payment) => payment.eventId === 'evt_credits_1').kind, 'credits')
})
