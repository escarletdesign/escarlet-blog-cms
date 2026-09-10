import { CmsError } from './cms-ops-errors.mjs'

export const MCP_PLAN_ID = 'mcp'
export function saveMcpPlan(input, db) {
  const draftLimit = Number(input.draftLimit)
  const publishLimitPerMonth = Number(input.publishLimitPerMonth)
  const priceId = String(input.priceId || '').trim()
  if (!Number.isSafeInteger(draftLimit) || draftLimit < 1 || !Number.isSafeInteger(publishLimitPerMonth) || publishLimitPerMonth < 1 || !/^price_[A-Za-z0-9]+$/.test(priceId)) {
    throw new CmsError(400, 'Configura un Price recurrente de Stripe y límites mensuales enteros positivos.')
  }
  const plan = { id: MCP_PLAN_ID, name: 'CMS con ChatGPT', draftLimit, publishLimitPerMonth, priceId, enabled: input.enabled === true }
  db.plans = [...(db.plans || []).filter((p) => p.id !== MCP_PLAN_ID), plan]
  return plan
}
export function membershipState(site, db, config, now = Date.now()) {
  const record = db.memberships?.[site]
  if (!record && config?.planId !== MCP_PLAN_ID) return { managed: false, active: config?.entitlements?.membership !== 'suspended' }
  const paidThrough = Number(record?.paidThrough || 0)
  return {
    managed: true,
    active: record?.status === 'active' && paidThrough * 1000 > now && config?.entitlements?.membership !== 'suspended',
    status: record?.status || 'unpaid',
    paidThrough: paidThrough || null,
    cancelAtPeriodEnd: Boolean(record?.cancelAtPeriodEnd)
  }
}

// Publication history stays public. Expired jobs must not spring back to life
// after payment: the user chooses a new date explicitly.
export function holdScheduledPosts(db, site) {
  for (const post of db.posts || []) {
    if (post.site === site && ['scheduled', 'pending_schedule'].includes(post.status)) {
      post.status = 'draft'
      post.membershipHeldPublishAt = post.publishAt
      delete post.publishAt
    }
  }
}
