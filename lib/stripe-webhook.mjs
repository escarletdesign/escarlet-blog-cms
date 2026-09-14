/**
 * Stripe Payment Links webhook → site entitlements (ops-first F4).
 * Metadata expected on Checkout Session / Payment Link:
 *   site, kind=setup|membership|hosting, planId (optional for membership)
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { loadSiteConfig, saveSiteConfig, normalizeEntitlements } from './site-config.mjs'
import { readDb, writeDb } from './db.mjs'
import { PWA_CREDIT_PACK_CATALOG } from './pwa-billing.mjs'
import { isProductRestructureV1 } from './product-flags.mjs'
import { recordStripeEvent, recordStripePayment } from './stripe-ledger.mjs'
import { CmsError } from './cms-ops-errors.mjs'
import { applyMembershipEvent } from './stripe-membership.mjs'

export function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSec = 300) {
  if (!secret) throw new CmsError(500, 'STRIPE_WEBHOOK_SECRET is not configured')
  const header = String(signatureHeader || '')
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const [k, v] = p.split('=')
      return [k, v]
    })
  )
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1) throw new CmsError(400, 'Invalid Stripe-Signature header')

  const age = Math.abs(Date.now() / 1000 - Number(t))
  if (age > toleranceSec) throw new CmsError(400, 'Stripe signature timestamp outside tolerance')

  const payload = `${t}.${rawBody}`
  const expected = createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(v1, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new CmsError(400, 'Stripe signature mismatch')
  }
  return true
}

function metaFromSession(session) {
  const meta = session?.metadata || {}
  return {
    site: String(meta.site || meta.handle || '').trim(),
    kind: String(meta.kind || meta.type || '').trim().toLowerCase(),
    planId: String(meta.planId || meta.plan_id || '').trim() || null,
    packId: String(meta.packId || meta.pack_id || '').trim() || null
  }
}

function creditPack(packId) {
  return PWA_CREDIT_PACK_CATALOG.find((pack) => pack.id === packId) || null
}

function wholeNonNegative(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

function applyCreditPack(site, pack, customerId) {
  const db = readDb()
  if (!db.aiCredits || typeof db.aiCredits !== 'object') db.aiCredits = {}
  const account = db.aiCredits[site] && typeof db.aiCredits[site] === 'object' ? db.aiCredits[site] : {}
  // `balance` is the canonical current balance; support the older purchased/spent shape
  // without discarding its audit values when a credit pack is first settled.
  const existingBalance = Object.hasOwn(account, 'balance')
    ? wholeNonNegative(account.balance)
    : Math.max(wholeNonNegative(account.purchased ?? account.totalPurchased) - wholeNonNegative(account.spent ?? account.consumed), 0)
  const balance = existingBalance + pack.tokenCredits
  const stripeCustomerId = String(customerId || '').trim()
  db.aiCredits[site] = {
    ...account,
    balance,
    ...(stripeCustomerId ? { stripeCustomerId } : {})
  }
  writeDb(db)
  return balance
}

/**
 * Apply entitlements for a paid checkout session.
 * @returns {{ applied: boolean, duplicate?: boolean, site?: string, kind?: string }}
 */
export async function applyCheckoutSessionCompleted(event) {
  if (!isProductRestructureV1()) {
    return { applied: false, reason: 'PRODUCT_RESTRUCTURE_V1 off' }
  }
  const session = event?.data?.object
  if (!session) throw new CmsError(400, 'Missing checkout session object')

  const { site, kind, planId, packId } = metaFromSession(session)
  if (!site) throw new CmsError(400, 'Checkout metadata.site is required')
  if (!['setup', 'membership', 'hosting', 'credits'].includes(kind)) {
    throw new CmsError(400, 'Checkout metadata.kind must be setup|membership|hosting|credits')
  }
  const pack = kind === 'credits' ? creditPack(packId) : null
  if (kind === 'credits' && !pack) {
    throw new CmsError(400, 'Checkout metadata.packId must identify a supported credit pack')
  }

  const eventId = event.id
  const recorded = await recordStripeEvent({
    eventId,
    type: event.type,
    site,
    kind,
    payload: {
      sessionId: session.id,
      amount_total: session.amount_total,
      currency: session.currency,
      packId: pack?.id || null,
      tokenCredits: pack?.tokenCredits || null
    }
  })
  if (recorded.duplicate) {
    return { applied: false, duplicate: true, site, kind }
  }

  const cfg = loadSiteConfig(site)
  if (!cfg) throw new CmsError(404, `Unknown site ${site}`)

  if (kind === 'credits') {
    const balance = applyCreditPack(site, pack, session.customer)
    await recordStripePayment({
      eventId,
      site,
      kind,
      planId: null,
      amountTotal: session.amount_total,
      currency: session.currency
    })
    return { applied: true, site, kind, packId: pack.id, tokenCredits: pack.tokenCredits, balance }
  }

  const entitlements = normalizeEntitlements(cfg.entitlements)
  const patch = { entitlements: { ...entitlements } }

  if (kind === 'membership' || kind === 'setup') {
    patch.entitlements.membership = 'active'
    if (planId) patch.planId = planId
  }
  if (kind === 'hosting') {
    patch.entitlements.hosting = true
  }
  if (kind === 'setup' && planId) {
    patch.planId = planId
  }

  saveSiteConfig(site, patch)
  await recordStripePayment({
    eventId,
    site,
    kind,
    planId: planId || cfg.planId || null,
    amountTotal: session.amount_total,
    currency: session.currency
  })

  return { applied: true, site, kind, planId: patch.planId || cfg.planId || null }
}

/**
 * Handle a verified Stripe event payload (object).
 */
export async function handleStripeEvent(event, options = {}) {
  if (!event || typeof event !== 'object') throw new CmsError(400, 'Invalid event')
  if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.trial_will_end', 'invoice.paid', 'invoice.payment_failed'].includes(event.type) ||
      (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && event.data?.object?.metadata?.kind === 'membership')) {
    return applyMembershipEvent(event, options)
  }
  if (event.type === 'checkout.session.completed') {
    if (event.data?.object?.payment_status && event.data.object.payment_status !== 'paid') return { applied: false, reason: 'payment_not_paid' }
    return applyCheckoutSessionCompleted(event)
  }
  return { applied: false, ignored: true, type: event.type }
}

export function buildPaymentLinkHints() {
  return {
    setup: {
      purpose: 'Brand kit / onboarding setup fee',
      metadata: { site: '<handle>', kind: 'setup', planId: 'standard' }
    },
    membership: {
      purpose: 'Monthly CMS access + quotas (plan mcp = ChatGPT generates, CMS stores/publishes)',
      metadata: { site: '<handle>', kind: 'membership', planId: 'mcp' }
    },
    hosting: {
      purpose: 'Optional Escarlet hosting add-on',
      metadata: { site: '<handle>', kind: 'hosting' }
    },
    credits: {
      purpose: 'One-off AI token credit pack for the PWA',
      metadata: { site: '<handle>', kind: 'credits', packId: 'credits-100k' }
    },
    webhookPath: '/api/stripe/webhook',
    env: ['STRIPE_WEBHOOK_SECRET', 'DATABASE_URL (optional Coolify Postgres)', 'PRODUCT_RESTRUCTURE_V1=1']
  }
}
