/**
 * Stripe Payment Links webhook → site entitlements (ops-first F4).
 * Metadata expected on Checkout Session / Payment Link:
 *   site, kind=setup|membership|hosting, planId (optional for membership)
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { loadSiteConfig, saveSiteConfig, normalizeEntitlements } from './site-config.mjs'
import { isProductRestructureV1 } from './product-flags.mjs'
import { recordStripeEvent, recordStripePayment } from './stripe-ledger.mjs'
import { CmsError } from './cms-ops-errors.mjs'

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
    planId: String(meta.planId || meta.plan_id || '').trim() || null
  }
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

  const { site, kind, planId } = metaFromSession(session)
  if (!site) throw new CmsError(400, 'Checkout metadata.site is required')
  if (!['setup', 'membership', 'hosting'].includes(kind)) {
    throw new CmsError(400, 'Checkout metadata.kind must be setup|membership|hosting')
  }

  const eventId = event.id
  const recorded = await recordStripeEvent({
    eventId,
    type: event.type,
    site,
    kind,
    payload: { sessionId: session.id, amount_total: session.amount_total, currency: session.currency }
  })
  if (recorded.duplicate) {
    return { applied: false, duplicate: true, site, kind }
  }

  const cfg = loadSiteConfig(site)
  if (!cfg) throw new CmsError(404, `Unknown site ${site}`)

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
export async function handleStripeEvent(event) {
  if (!event || typeof event !== 'object') throw new CmsError(400, 'Invalid event')
  if (event.type === 'checkout.session.completed') {
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
      purpose: 'Monthly CMS access + quotas',
      metadata: { site: '<handle>', kind: 'membership', planId: 'standard' }
    },
    hosting: {
      purpose: 'Optional Escarlet hosting add-on',
      metadata: { site: '<handle>', kind: 'hosting' }
    },
    webhookPath: '/api/stripe/webhook',
    env: ['STRIPE_WEBHOOK_SECRET', 'DATABASE_URL (optional Coolify Postgres)', 'PRODUCT_RESTRUCTURE_V1=1']
  }
}
