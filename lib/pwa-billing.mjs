/**
 * PWA billing domain helpers.
 *
 * This module intentionally has no HTTP routes and no Stripe SDK dependency.  Routes can
 * call the exported session helpers on the server, while the PWA only receives the public
 * catalog/snapshot values.  Stripe secret and price IDs never appear in public snapshots.
 */
import { randomUUID } from 'node:crypto'
import { getPlan, getQuotaSnapshot, utcMonthKey } from './plans.mjs'
import { loadSiteConfig } from './site-config.mjs'
import { membershipState } from './membership.mjs'
import { readDb, writeDb } from './db.mjs'

const CREDIT_CURRENCY = 'eur'
const BILLING_TEST_FLAG = 'creditCheckoutWithoutStripe'

/** Plan-level PWA entitlement metadata. Existing plan draft/publish limits stay in plans.mjs. */
export const PWA_PLAN_CATALOG = Object.freeze([
  Object.freeze({ id: 'mcp', aiTokenCreditsPerMonth: 0, allowedModels: ['gpt-4.1-mini', 'gemini-2.5-flash', 'grok-3-mini'] }),
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
  // Accept a single current-month row to make a future storage migration
  // non-breaking, but never mistake a map of older months for one usage row.
  if (['inputTokens', 'outputTokens', 'totalTokens', 'creditsUsed', 'tokenCreditsUsed'].some((field) => Object.hasOwn(raw, field))) return raw
  return {}
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

function planPriceId(planId, env, db) {
  if (planId === 'mcp') {
    const plan = db?.plans?.find((p) => p.id === 'mcp')
    return plan?.enabled && plan.draftLimit > 0 && plan.publishLimitPerMonth > 0 ? text(plan.priceId) : ''
  }
  return priceIdFromEnv(PLAN_PRICE_ENV[planId], env)
}

function planTrialDays(planId, db) {
  if (planId !== 'mcp') return 0
  const trialDays = Number(db?.plans?.find((plan) => plan.id === planId)?.trialDays || 0)
  return Number.isSafeInteger(trialDays) && trialDays > 0 ? Math.min(trialDays, 365) : 0
}

function creditPackPriceId(pack, env) {
  // An admin-managed Stripe price takes precedence over legacy environment aliases.
  return text(pack?.priceId) || priceIdFromEnv(pack?.priceEnv, env)
}

function packRecords(db) {
  return db?.aiCreditPacks && typeof db.aiCreditPacks === 'object' && !Array.isArray(db.aiCreditPacks)
    ? db.aiCreditPacks
    : {}
}

/** Temporary, super-admin controlled switch for production credit-flow testing. */
export function getBillingTestFlags(db) {
  const raw = db?.featureFlags && typeof db.featureFlags === 'object' && !Array.isArray(db.featureFlags)
    ? db.featureFlags
    : {}
  return {
    creditCheckoutWithoutStripe: raw[BILLING_TEST_FLAG] === true,
    updatedAt: text(raw.updatedAt) || null
  }
}

export function isBillingTestCreditsEnabled(db) {
  return getBillingTestFlags(db).creditCheckoutWithoutStripe
}

export function setBillingTestFlags({ db, creditCheckoutWithoutStripe, actorId, now = new Date().toISOString() } = {}) {
  if (!db || typeof db !== 'object') throw new TypeError('db is required')
  const previous = db.featureFlags && typeof db.featureFlags === 'object' && !Array.isArray(db.featureFlags)
    ? db.featureFlags
    : {}
  db.featureFlags = {
    ...previous,
    [BILLING_TEST_FLAG]: typeof creditCheckoutWithoutStripe === 'boolean'
      ? creditCheckoutWithoutStripe
      : previous[BILLING_TEST_FLAG] === true,
    updatedAt: text(now),
    ...(text(actorId) ? { updatedBy: text(actorId).slice(0, 120) } : {})
  }
  return getBillingTestFlags(db)
}

/** Grant one configured pack without touching Stripe, only while the temporary flag is on. */
export function grantPwaTestCredits(site, packId, { db, actorId, now = new Date().toISOString() } = {}) {
  if (!isBillingTestCreditsEnabled(db)) {
    const error = new Error('El modo de prueba de créditos no está habilitado.')
    error.status = 403
    throw error
  }
  const handle = text(site)
  const pack = getPwaCreditPackDefinitions({ db }).find((item) => item.id === text(packId))
  if (!handle) {
    const error = new Error('El sitio es obligatorio.')
    error.status = 400
    throw error
  }
  if (!pack) {
    const error = new Error('Pack de créditos no encontrado.')
    error.status = 404
    throw error
  }
  if (!db.aiCredits || typeof db.aiCredits !== 'object' || Array.isArray(db.aiCredits)) db.aiCredits = {}
  const account = db.aiCredits[handle] && typeof db.aiCredits[handle] === 'object' ? db.aiCredits[handle] : {}
  const existingBalance = Object.hasOwn(account, 'balance')
    ? whole(account.balance)
    : Math.max(whole(account.purchased ?? account.totalPurchased) - whole(account.spent ?? account.consumed), 0)
  const balance = existingBalance + pack.tokenCredits
  db.aiCredits[handle] = { ...account, balance }
  const grant = {
    id: `test_${randomUUID()}`,
    site: handle,
    packId: pack.id,
    tokenCredits: pack.tokenCredits,
    actorId: text(actorId).slice(0, 120) || null,
    createdAt: text(now)
  }
  const grants = Array.isArray(db.aiCreditTestGrants) ? db.aiCreditTestGrants : []
  db.aiCreditTestGrants = [...grants, grant].slice(-500)
  return { ...grant, balance }
}

/** Combine the static catalog with persisted changes without changing legacy defaults. */
export function getPwaCreditPackDefinitions({ db } = {}) {
  const saved = packRecords(db)
  const base = new Map(PWA_CREDIT_PACK_CATALOG.map((pack) => [pack.id, { ...pack }]))
  for (const [id, raw] of Object.entries(saved)) {
    if (!raw || typeof raw !== 'object') continue
    if (raw.deleted === true) { base.delete(id); continue }
    const previous = base.get(id) || { id }
    const name = text(raw.name, 120) || previous.name
    const tokenCredits = whole(raw.tokenCredits) || previous.tokenCredits
    // Invalid/incomplete persisted rows cannot replace compatible static catalog rows.
    if (!name || !tokenCredits) continue
    base.set(id, {
      ...previous,
      id,
      name,
      tokenCredits,
      enabled: raw.enabled !== false,
      priceId: text(raw.priceId, 200),
      updatedAt: text(raw.updatedAt, 40)
    })
  }
  return [...base.values()].filter((pack) => pack.enabled !== false)
}

function allPwaCreditPackDefinitions({ db } = {}) {
  const saved = packRecords(db)
  const active = getPwaCreditPackDefinitions({ db })
  return active.map((pack) => ({ ...pack, deleted: false })).concat(
    Object.entries(saved)
      .filter(([id, raw]) => raw?.deleted === true && !active.some((pack) => pack.id === id))
      .map(([id, raw]) => ({ id, deleted: true, updatedAt: text(raw.updatedAt, 40) }))
  )
}

function safePackId(value) {
  const id = text(value, 80).toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) {
    const error = new Error('El identificador del pack solo puede contener letras, números y guiones.')
    error.status = 400
    throw error
  }
  return id
}

/** Server-admin mutation helper. Its return value intentionally hides Stripe price IDs. */
export function savePwaCreditPack(input = {}, { db, now = new Date().toISOString() } = {}) {
  if (!db || typeof db !== 'object') throw new TypeError('db is required')
  const id = safePackId(input.id)
  const previous = packRecords(db)[id] && typeof packRecords(db)[id] === 'object' ? packRecords(db)[id] : {}
  const defaults = PWA_CREDIT_PACK_CATALOG.find((pack) => pack.id === id)
  const name = text(input.name, 120) || text(previous.name, 120) || defaults?.name
  const tokenCredits = whole(input.tokenCredits) || whole(previous.tokenCredits) || defaults?.tokenCredits
  if (!name || !tokenCredits) {
    const error = new Error('El nombre y los créditos del pack son obligatorios.')
    error.status = 400
    throw error
  }
  const next = { ...previous, name, tokenCredits, enabled: input.enabled !== false, deleted: false, updatedAt: now }
  if (Object.hasOwn(input, 'priceId')) {
    const priceId = text(input.priceId, 200)
    if (priceId) next.priceId = priceId
  }
  if (input.clearPriceId === true) delete next.priceId
  db.aiCreditPacks = { ...packRecords(db), [id]: next }
  return getPwaCreditPackCatalog({ db }).find((pack) => pack.id === id)
}

/** Deleting a legacy pack writes a tombstone so the static compatibility catalog stays hidden. */
export function deletePwaCreditPack(id, { db, now = new Date().toISOString() } = {}) {
  if (!db || typeof db !== 'object') throw new TypeError('db is required')
  const safeId = safePackId(id)
  const exists = PWA_CREDIT_PACK_CATALOG.some((pack) => pack.id === safeId) || Object.hasOwn(packRecords(db), safeId)
  if (!exists) {
    const error = new Error('Pack de créditos no encontrado.')
    error.status = 404
    throw error
  }
  db.aiCreditPacks = { ...packRecords(db), [safeId]: { ...packRecords(db)[safeId], deleted: true, updatedAt: now } }
  return { id: safeId, deleted: true }
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
    .filter((model) => effectivePlanId === 'mcp' ? planPwaMetadata('mcp').allowedModels.includes(model.id) : model.availablePlanIds.includes(effectivePlanId))
    .map(publicModel)
}

/** Return only public credit-pack facts; configured marks whether a checkout can be created. */
export function getPwaCreditPackCatalog({ env = process.env, db } = {}) {
  return getPwaCreditPackDefinitions({ db }).map((pack) => publicCreditPack(pack, env))
}

/** Public Stripe capability map. It intentionally excludes keys, price IDs and webhook secrets. */
export function getPwaStripeConfig({ env = process.env, db } = {}) {
  const planIds = [...Object.keys(PLAN_PRICE_ENV)]
  if (db?.plans?.some((plan) => plan.id === 'mcp')) planIds.push('mcp')
  const plans = Object.fromEntries(planIds.map((planId) => [planId, Boolean(planPriceId(planId, env, db))]))
  const creditPacks = Object.fromEntries(
    getPwaCreditPackDefinitions({ db }).map((pack) => [pack.id, Boolean(creditPackPriceId(pack, env))])
  )
  const secretConfigured = Boolean(text(env?.STRIPE_SECRET_KEY))
  return {
    enabled: secretConfigured && (Object.values(plans).some(Boolean) || Object.values(creditPacks).some(Boolean)),
    checkoutEnabled: secretConfigured,
    portalEnabled: secretConfigured,
    plans,
    creditPacks,
    testCreditsEnabled: isBillingTestCreditsEnabled(db)
  }
}

/**
 * A combined PWA snapshot. It does not increment draft, publishing or AI consumption.
 *
 * AI storage contract (additive):
 *   db.aiUsage[site][YYYY-MM] = { inputTokens, outputTokens, totalTokens, creditsUsed }
 *   db.aiCredits[site] = { balance } or { purchased, spent }
 */
export function getPwaBillingSnapshot(site, { db, siteConfig, auth, env = process.env, monthKey = utcMonthKey() } = {}) {
  if (!db || typeof db !== 'object') throw new TypeError('db is required for a PWA billing snapshot')
  const config = siteConfig || loadSiteConfig(site) || {}
  const baseQuota = getQuotaSnapshot(site, { db, siteConfig: config, userId: auth?.userId || '' })
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
    cmsAiAllowed: auth?.role !== 'client_mcp',
    models: auth?.role === 'client_mcp' ? [] : getPwaModelCatalog(plan.id),
    creditPacks: auth?.role === 'client_mcp' ? [] : getPwaCreditPackCatalog({ env, db }),
    ai: auth?.role === 'client_mcp' ? {
      monthKey,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, creditsUsed: 0 },
      tokenCredits: { monthlyIncluded: 0, monthlyRemaining: 0, purchasedBalance: 0, available: 0 }
    } : {
      monthKey,
      usage: { inputTokens, outputTokens, totalTokens, creditsUsed },
      tokenCredits: {
        monthlyIncluded,
        monthlyRemaining,
        purchasedBalance,
        available: monthlyRemaining + purchasedBalance
      }
    },
    stripe: auth?.role === 'client_mcp'
      ? { enabled: false, checkoutEnabled: Boolean(env?.STRIPE_SECRET_KEY), portalEnabled: Boolean(env?.STRIPE_SECRET_KEY), plans: { mcp: Boolean(planPriceId('mcp', env, db)) }, creditPacks: {}, testCreditsEnabled: false }
      : getPwaStripeConfig({ env, db })
  }
}

/** Resolve an env-configured Stripe Price ID without exposing any secret. */
export function resolvePwaStripePrice({ kind, planId, packId } = {}, { env = process.env, db } = {}) {
  if (kind === 'membership') {
    const effectivePlanId = planPwaMetadata(planId).id
    return {
      kind,
      planId: effectivePlanId,
      priceId: planPriceId(effectivePlanId, env, db) || null,
      trialDays: planTrialDays(effectivePlanId, db)
    }
  }
  if (kind === 'credits') {
    const pack = getPwaCreditPackDefinitions({ db }).find((item) => item.id === packId)
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
    if (price.trialDays > 0) {
      params.set('subscription_data[trial_period_days]', String(price.trialDays))
      params.set('subscription_data[trial_settings][end_behavior][missing_payment_method]', 'cancel')
    }
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
export async function createPwaCheckoutSession(input = {}, { env = process.env, db, fetchImpl = globalThis.fetch } = {}) {
  const site = text(input.site)
  const kind = text(input.kind)
  const secret = text(env?.STRIPE_SECRET_KEY)
  const price = resolvePwaStripePrice(input, { env, db })
  if (!secret) return { configured: false, reason: 'stripe_not_configured', url: null, price }
  if (!price.priceId) return { configured: false, reason: 'price_not_configured', url: null, price }
  if (!site) return { configured: false, reason: 'site_required', url: null, price }
  if (!['membership', 'credits'].includes(kind)) return { configured: false, reason: 'unsupported_checkout_kind', url: null, price }
  if (typeof fetchImpl !== 'function') return { configured: false, reason: 'fetch_unavailable', url: null, price }

  if (kind === 'membership') {
    const membership = db?.memberships?.[site]
    if (membership?.subscriptionId && !['canceled', 'incomplete_expired'].includes(membership.status)) {
      return { configured: false, reason: 'subscription_exists_use_portal', url: null }
    }
    const checkout = db?.membershipCheckouts?.[site]
    if (checkout?.expiresAt > Date.now() && checkout.planId === price.planId) return { configured: true, sessionId: checkout.id, url: checkout.url, price }
  }

  const response = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded'
      , ...(kind === 'membership' ? { 'Idempotency-Key': `membership-${site}-${price.priceId}-${Math.floor(Date.now() / 86400000)}` } : {})
    },
    body: checkoutParams({ ...input, site, kind, customerId: db?.memberships?.[site]?.customerId || db?.aiCredits?.[site]?.stripeCustomerId }, price).toString()
  })
  const session = await stripeJson(response)
  if (kind === 'membership' && session.id && session.url) {
    const latest = readDb()
    latest.membershipCheckouts = { ...latest.membershipCheckouts, [site]: { id: session.id, url: session.url, planId: price.planId, expiresAt: Number(session.expires_at || 0) * 1000 } }
    writeDb(latest)
  }
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
