/**
 * Plan catalog + UTC monthly usage + membership suspend checks (F3).
 * Enforced from cms-ops for MCP and REST alike.
 */
import { readDb, writeDb } from './db.mjs'
import { loadSiteConfig, DEFAULT_PLAN_ID, normalizeEntitlements } from './site-config.mjs'
import { isProductRestructureV1 } from './product-flags.mjs'
import { CmsError } from './cms-ops-errors.mjs'
import { membershipState } from './membership.mjs'

export const DEFAULT_PLANS = [
  { id: 'standard', name: 'Standard', draftLimit: 20, publishLimitPerMonth: 12 },
  { id: 'starter', name: 'Starter', draftLimit: 8, publishLimitPerMonth: 4 },
  { id: 'growth', name: 'Growth', draftLimit: 40, publishLimitPerMonth: 24 }
]

export function utcMonthKey(date = new Date()) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function monthResetAtIso(monthKey = utcMonthKey()) {
  const [y, m] = monthKey.split('-').map(Number)
  const next = new Date(Date.UTC(y, m, 1, 0, 0, 0))
  return next.toISOString()
}

export function ensurePlans(db) {
  if (!Array.isArray(db.plans) || !db.plans.length) {
    db.plans = DEFAULT_PLANS.map((p) => ({ ...p }))
  }
  if (!db.usage || typeof db.usage !== 'object') db.usage = {}
  return db
}

export function getPlan(db, planId) {
  ensurePlans(db)
  const id = String(planId || DEFAULT_PLAN_ID).trim() || DEFAULT_PLAN_ID
  const found = db.plans.find((p) => p && p.id === id)
  if (found) {
    return {
      id: found.id,
      name: found.name || found.id,
      draftLimit: Number(found.draftLimit) || 0,
      publishLimitPerMonth: Number(found.publishLimitPerMonth) || 0
    }
  }
  if (id === 'mcp') return { id: 'mcp', name: 'CMS con ChatGPT', draftLimit: 0, publishLimitPerMonth: 0 }
  const fallback = DEFAULT_PLANS.find((p) => p.id === DEFAULT_PLAN_ID) || DEFAULT_PLANS[0]
  return { ...fallback }
}

export function getUsageBucket(db, site, monthKey = utcMonthKey()) {
  ensurePlans(db)
  if (!db.usage[site] || typeof db.usage[site] !== 'object') db.usage[site] = {}
  if (!db.usage[site][monthKey] || typeof db.usage[site][monthKey] !== 'object') {
    db.usage[site][monthKey] = { draftsCreated: 0, publishes: 0 }
  }
  const bucket = db.usage[site][monthKey]
  return {
    draftsCreated: Number(bucket.draftsCreated) || 0,
    publishes: Number(bucket.publishes) || 0
  }
}

export function incrementUsage(db, site, metric, monthKey = utcMonthKey()) {
  const bucket = getUsageBucket(db, site, monthKey)
  if (metric === 'drafts') bucket.draftsCreated += 1
  else if (metric === 'publishes') bucket.publishes += 1
  db.usage[site][monthKey] = bucket
  return bucket
}

/**
 * Snapshot for UI / MCP (does not mutate).
 */
export function getQuotaSnapshot(site, { db: injectedDb, siteConfig: injectedConfig, userId = '' } = {}) {
  const db = injectedDb || readDb()
  ensurePlans(db)
  const siteConfig = injectedConfig || loadSiteConfig(site) || {}
  const plan = getPlan(db, siteConfig.planId)
  const monthKey = utcMonthKey()
  const usage = getUsageBucket(db, site, monthKey)
  const entitlements = normalizeEntitlements(siteConfig.entitlements)
  return {
    site,
    planId: plan.id,
    planName: plan.name,
    monthKey,
    resetAt: monthResetAtIso(monthKey),
    drafts: {
      used: usage.draftsCreated,
      limit: plan.draftLimit
    },
    publishes: {
      used: usage.publishes,
      limit: plan.publishLimitPerMonth
    },
    membership: membershipState(site, db, siteConfig, Date.now(), userId).active ? 'active' : 'suspended',
    subscription: membershipState(site, db, siteConfig, Date.now(), userId),
    hosting: entitlements.hosting,
    suspended: !membershipState(site, db, siteConfig, Date.now(), userId).active
  }
}

export function isMembershipSuspended(siteConfig) {
  return normalizeEntitlements(siteConfig?.entitlements).membership === 'suspended'
}

export function assertMembershipActive(site, { db: injectedDb, userId = '' } = {}) {
  const siteConfig = loadSiteConfig(site) || {}
  const state = membershipState(site, injectedDb || readDb(), siteConfig, Date.now(), userId)
  if (!state.managed && !isProductRestructureV1()) return
  if (!state.active) {
    throw new CmsError(403, 'La membresía de este sitio está suspendida. No se pueden crear ni publicar contenidos.', {
      code: 'MEMBERSHIP_SUSPENDED',
      membership: 'suspended'
    })
  }
}

/**
 * Throws CmsError when writes are blocked.
 * @param {'drafts'|'publishes'} metric
 */
export function assertEntitlementWrite(site, metric, { skipQuota = false, db: injectedDb, userId = '' } = {}) {
  assertMembershipActive(site, { db: injectedDb, userId })
  if (!isProductRestructureV1() && loadSiteConfig(site)?.planId !== 'mcp') return null

  const db = injectedDb || readDb()
  ensurePlans(db)
  const siteConfig = loadSiteConfig(site) || {}
  assertMembershipActive(site, { db, userId })

  if (skipQuota && siteConfig.planId !== 'mcp') return getQuotaSnapshot(site, { db, siteConfig, userId })

  const plan = getPlan(db, siteConfig.planId)
  const monthKey = utcMonthKey()
  const usage = getUsageBucket(db, site, monthKey)
  const resetAt = monthResetAtIso(monthKey)

  if (metric === 'drafts' && usage.draftsCreated >= plan.draftLimit) {
    throw new CmsError(
      429,
      `Límite de borradores del plan (${plan.draftLimit} este mes). Guarda menos borradores o contacta con Escarlet.`,
      {
        code: 'QUOTA_EXCEEDED',
        metric: 'drafts',
        limit: plan.draftLimit,
        used: usage.draftsCreated,
        resetAt,
        planId: plan.id
      }
    )
  }

  if (metric === 'publishes' && usage.publishes >= plan.publishLimitPerMonth) {
    throw new CmsError(
      429,
      `Límite de publicaciones del plan (${plan.publishLimitPerMonth} este mes). Pide revisión o contacta con Escarlet.`,
      {
        code: 'QUOTA_EXCEEDED',
        metric: 'publishes',
        limit: plan.publishLimitPerMonth,
        used: usage.publishes,
        resetAt,
        planId: plan.id
      }
    )
  }

  return getQuotaSnapshot(site, { db, siteConfig, userId })
}

/**
 * Persist usage increment after a successful draft create / live publish.
 */
export function recordUsage(site, metric, { db: injectedDb } = {}) {
  if (!isProductRestructureV1() && loadSiteConfig(site)?.planId !== 'mcp') return
  const db = injectedDb || readDb()
  ensurePlans(db)
  incrementUsage(db, site, metric)
  if (!injectedDb) writeDb(db)
}
