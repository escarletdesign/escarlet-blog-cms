/**
 * PWA billing domain helpers.
 *
 * This module intentionally has no HTTP routes and no Stripe SDK dependency.  Routes can
 * call the exported session helpers on the server, while the PWA only receives the public
 * catalog/snapshot values.  Stripe secret and price IDs never appear in public snapshots.
 */
import { getPlan, getQuotaSnapshot, utcMonthKey } from './plans.mjs'
import { loadSiteConfig } from './site-config.mjs'

const CREDIT_CURRENCY = 'eur'

/** Plan-level PWA entitlement metadata. Existing plan draft/publish limits stay in plans.mjs. */
export const PWA_PLAN_CATALOG = Object.freeze([
  Object.freeze({ id: 'starter', aiTokenCreditsPerMonth: 25_000, allowedModels: ['escarlet-fast', 'gpt-4.1-mini', 'gemini-2.5-flash'] }),
  Object.freeze({ id: 'standard', aiTokenCreditsPerMonth: 100_000, allowedModels: ['escarlet-fast', 'gpt-4.1-mini', 'gemini-2.5-flash', 'grok-3-mini'] }),
  Object.freeze({ id: 'growth', aiTokenCreditsPerMonth: 300_000, allowedModels: ['escarlet-fast', 'gpt-4.1-mini', 'gpt-4.1', 'gemini-2.5-flash', 'grok-3-mini'] })
])

/**
 * UI-safe model catalog. `creditMultiplier` is the gateway billing multiplier,
 * not a provider price or a promise that an API key is configured.
 */
export const PWA_MODEL_CATALOG = Object.freeze([
  Object.freeze({ id: 'escarlet-fast', name: 'Escarlet Fast', provider: 'included', creditMultiplier: 0, availablePlanIds: ['starter', 'standard', 'growth'] }),
  Object.freeze({ id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', provider: 'openai', creditMultiplier: 1, availablePlanIds: ['starter', 'standard', 'growth'] }),
  Object.freeze({ id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', creditMultiplier: 4, availablePlanIds: ['growth'] }),
  Object.freeze({ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini', creditMultiplier: 1, availablePlanIds: ['starter', 'standard', 'growth'] }),
  Object.freeze({ id: 'grok-3-mini', name: 'Grok 3 Mini', provider: 'grok', creditMultiplier: 2, availablePlanIds: ['standard', 'growth'] })
])

/** Stripe credit-pack definitions. Stripe remains the source of truth for amount/currency. */
export const PWA_CREDIT_PACK_CATALOG = Object.freeze([
  Object.freeze({ id: 'credits-25k', name: '25K AI credits', tokenCredits: 25_000, priceEnv: 'PWA_STRIPE_PRICE_CREDITS_25K' }),
  Object.freeze({ id: 'credits-100k', name: '100K AI credits', tokenCredits: 100_000, priceEnv: 'PWA_STRIPE_PRICE_CREDITS_100K' }),
  Object.freeze({ id: 'credits-500k', name: '500K AI credits', tokenCredits: 500_000, priceEnv: 'PWA_STRIPE_PRICE_CREDITS_500K' })
])

const PLAN_PRICE_ENV = Object.freeze({
  starter: 'PWA_STRIPE_PRICE_PLAN_STARTER',
  standard: 'PWA_STRIPE_PRICE_PLAN_STANDARD',
  growth: 'PWA_STRIPE_PRICE_PLAN_GROWTH'
})

function text(value) {
  return String(value ?? '').trim()
}

function nonNegative(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function whole(value) {
  return Math.floor(nonNegative(value))
}

function currentMonthRow(raw, monthKey) {
  if (!raw || typeof raw !== 'object') return {}
  if (raw[monthKey] && typeof raw[monthKey] === 'object') return raw[monthKey]
  // Accept a single current-month row to make a future storage migration non-breaking.
  return raw
}

function planPwaMetadata(planId) {
  return PWA_PLAN_CATALOG.find((plan) => plan.id === planId) || PWA_PLAN_CATALOG.find((plan) => plan.id === 'standard')
}

function priceIdFromEnv(primaryEnvName, env = process.env) {
  if (!primaryEnvName) return ''
  // STRIPE_PRICE_* aliases make the PWA module work with conventional deployment env names.
  const alias = primaryEnvName.replace(/^PWA_/, '')
  return text(env?.[primaryEnvName] || env?.[alias])
}

function planPriceId(planId, env) {
  return priceIdFromEnv(PLAN_PRICE_ENV[planId], env)
}

function creditPackPriceId(pack, env) {
  return priceIdFromEnv(pack?.priceEnv, env)
}

function publicModel(model) {
  return { ...model }
}

function publicCreditPack(pack, env) {
  return {
    id: pack.id,
    name: pack.name,
    tokenCredits: pack.tokenCredits,
    configured: Boolean(creditPackPriceId(pack, env))
  }
}

/** Return models accessible by a plan. Unknown legacy plans receive Standard's safe catalog. */
export function getPwaModelCatalog(planId = 'standard') {
  const effectivePlanId = planPwaMetadata(planId).id
  return PWA_MODEL_CATALOG
    .filter((model) => model.availablePlanIds.includes(effectivePlanId))
    .map(publicModel)
}

/** Return only public credit-pack facts; configured marks whether a checkout can be created. */
export function getPwaCreditPackCatalog({ env = process.env } = {}) {
  return PWA_CREDIT_PACK_CATALOG.map((pack) => publicCreditPack(pack, env))
}

/** Public Stripe capability map. It intentionally excludes keys, price IDs and webhook secrets. */
export function getPwaStripeConfig({ env = process.env } = {}) {
  const plans = Object.fromEntries(
    Object.keys(PLAN_PRICE_ENV).map((planId) => [planId, Boolean(planPriceId(planId, env))])
  )
  const creditPacks = Object.fromEntries(
    PWA_CREDIT_PACK_CATALOG.map((pack) => [pack.id, Boolean(creditPackPriceId(pack, env))])
  )
  const secretConfigured = Boolean(text(env?.STRIPE_SECRET_KEY))
  return {
    enabled: secretConfigured && (Object.values(plans).some(Boolean) || Object.values(creditPacks).some(Boolean)),
    checkoutEnabled: secretConfigured,
    portalEnabled: secretConfigured,
    plans,
    creditPacks
  }
}

/**
 * A combined PWA snapshot. It does not increment draft, publishing or AI consumption.
 *
 * AI storage contract (additive):
 *   db.aiUsage[site][YYYY-MM] = { inputTokens, outputTokens, totalTokens, creditsUsed }
 *   db.aiCredits[site] = { balance } or { purchased, spent }
 */
export function getPwaBillingSnapshot(site, { db, siteConfig, env = process.env, monthKey = utcMonthKey() } = {}) {
  if (!db || typeof db !== 'object') throw new TypeError('db is required for a PWA billing snapshot')
  const config = siteConfig || loadSiteConfig(site) || {}
  const baseQuota = getQuotaSnapshot(site, { db, siteConfig: config })
  const plan = getPlan(db, baseQuota.planId)
  const pwaPlan = planPwaMetadata(plan.id)
  const usage = currentMonthRow(db.aiUsage?.[site], monthKey)
  const inputTokens = whole(usage.inputTokens)
  const outputTokens = whole(usage.outputTokens)
  const totalTokens = whole(usage.totalTokens) || inputTokens + outputTokens
  const creditsUsed = whole(usage.creditsUsed ?? usage.tokenCreditsUsed ?? totalTokens)
  const creditAccount = db.aiCredits?.[site] || {}
  const purchasedBalance = Object.hasOwn(creditAccount, 'balance')
    ? whole(creditAccount.balance)
    : Math.max(whole(creditAccount.purchased ?? creditAccount.totalPurchased) - whole(creditAccount.spent ?? creditAccount.consumed), 0)
  const monthlyIncluded = pwaPlan.aiTokenCreditsPerMonth
  const monthlyRemaining = Math.max(monthlyIncluded - creditsUsed, 0)

  return {
    ...baseQuota,
    plan: {
      id: plan.id,
      name: plan.name,
      draftLimit: plan.draftLimit,
      publishLimitPerMonth: plan.publishLimitPerMonth,
      aiTokenCreditsPerMonth: monthlyIncluded
    },
    models: getPwaModelCatalog(plan.id),
    creditPacks: getPwaCreditPackCatalog({ env }),
    ai: {
      monthKey,
      usage: { inputTokens, outputTokens, totalTokens, creditsUsed },
      tokenCredits: {
        monthlyIncluded,
        monthlyRemaining,
        purchasedBalance,
        available: monthlyRemaining + purchasedBalance
      }
    },
    stripe: getPwaStripeConfig({ env })
  }
}

/** Resolve an env-configured Stripe Price ID without exposing any secret. */
export function resolvePwaStripePrice({ kind, planId, packId } = {}, { env = process.env } = {}) {
  if (kind === 'membership') {
    const effectivePlanId = planPwaMetadata(planId).id
    return { kind, planId: effectivePlanId, priceId: planPriceId(effectivePlanId, env) || null }
  }
  if (kind === 'credits') {
    const pack = PWA_CREDIT_PACK_CATALOG.find((item) => item.id === packId)
    return { kind, packId: pack?.id || null, priceId: pack ? creditPackPriceId(pack, env) || null : null }
  }
  return { kind: text(kind) || null, priceId: null }
}

function checkoutParams({ site, kind, planId, packId, successUrl, cancelUrl, customerId, customerEmail }, price) {
  const params = new URLSearchParams()
  params.set('mode', kind === 'membership' ? 'subscription' : 'payment')
  params.set('line_items[0][price]', price.priceId)
  params.set('line_items[0][quantity]', '1')
  params.set('client_reference_id', site)
  params.set('metadata[site]', site)
  params.set('metadata[kind]', kind)
  if (price.planId) params.set('metadata[planId]', price.planId)
  if (price.packId) params.set('metadata[packId]', price.packId)
  if (kind === 'membership') {
    params.set('subscription_data[metadata][site]', site)
    params.set('subscription_data[metadata][kind]', kind)
    if (price.planId) params.set('subscription_data[metadata][planId]', price.planId)
  }
  if (text(customerId)) params.set('customer', text(customerId))
  else if (text(customerEmail)) params.set('customer_email', text(customerEmail))
  if (text(successUrl)) params.set('success_url', text(successUrl))
  if (text(cancelUrl)) params.set('cancel_url', text(cancelUrl))
  return params
}

async function stripeJson(response) {
  const body = typeof response?.json === 'function' ? await response.json() : {}
  if (!response?.ok) {
    const error = new Error(text(body?.error?.message) || 'Stripe request failed')
    error.code = text(body?.error?.code) || 'stripe_request_failed'
    error.status = Number(response?.status) || 502
    throw error
  }
  return body
}

/**
 * Create a hosted Checkout Session with the Stripe REST API. With missing secret/price it
 * returns a safe, non-throwing stub that routes can render as an unavailable purchase action.
 */
export async function createPwaCheckoutSession(input = {}, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const site = text(input.site)
  const kind = text(input.kind)
  const secret = text(env?.STRIPE_SECRET_KEY)
  const price = resolvePwaStripePrice(input, { env })
  if (!secret) return { configured: false, reason: 'stripe_not_configured', url: null, price }
  if (!price.priceId) return { configured: false, reason: 'price_not_configured', url: null, price }
  if (!site) return { configured: false, reason: 'site_required', url: null, price }
  if (!['membership', 'credits'].includes(kind)) return { configured: false, reason: 'unsupported_checkout_kind', url: null, price }
  if (typeof fetchImpl !== 'function') return { configured: false, reason: 'fetch_unavailable', url: null, price }

  const response = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: checkoutParams({ ...input, site, kind }, price).toString()
  })
  const session = await stripeJson(response)
  return { configured: true, sessionId: text(session.id) || null, url: text(session.url) || null, price }
}

/** Create a hosted Customer Portal session; like checkout, this is safe when Stripe is absent. */
export async function createPwaPortalSession({ customerId, returnUrl } = {}, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const secret = text(env?.STRIPE_SECRET_KEY)
  const customer = text(customerId)
  if (!secret) return { configured: false, reason: 'stripe_not_configured', url: null }
  if (!customer) return { configured: false, reason: 'customer_required', url: null }
  if (typeof fetchImpl !== 'function') return { configured: false, reason: 'fetch_unavailable', url: null }

  const params = new URLSearchParams({ customer })
  if (text(returnUrl)) params.set('return_url', text(returnUrl))
  const response = await fetchImpl('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  })
  const session = await stripeJson(response)
  return { configured: true, url: text(session.url) || null }
}

export { CREDIT_CURRENCY }
