import { CmsError } from './cms-ops-errors.mjs'

export const MCP_PLAN_ID = 'mcp'
const GRANT_KINDS = new Set(['complimentary', 'trial'])

function text(value, max = 240) {
  return String(value ?? '').trim().slice(0, max)
}

function isoDate(value, { required = false } = {}) {
  const raw = text(value, 40)
  if (!raw) {
    if (required) throw new CmsError(400, 'La fecha de acceso es obligatoria.')
    return null
  }
  const parsed = new Date(raw)
  if (!Number.isFinite(parsed.getTime())) throw new CmsError(400, 'La fecha de acceso no es válida.')
  return parsed.toISOString()
}

function grantStore(db) {
  if (!db.membershipGrants || typeof db.membershipGrants !== 'object' || Array.isArray(db.membershipGrants)) {
    db.membershipGrants = {}
  }
  return db.membershipGrants
}

function grantKey(site, userId) {
  const handle = text(site, 80)
  const recipient = text(userId, 120)
  return handle && recipient ? `${handle}:${recipient}` : ''
}

// Complimentary access is deliberately keyed by both dimensions. Stripe's
// subscription remains site-scoped, while an exception can never leak to the
// other users assigned to the same site.
export function getMembershipGrant(site, userId, db, now = Date.now()) {
  const handle = text(site, 80)
  const key = grantKey(handle, userId)
  if (!key) return null
  const raw = db?.membershipGrants?.[key]
  if (!raw || typeof raw !== 'object') return null
  const startsAt = isoDate(raw.startsAt) || new Date(0).toISOString()
  const activeUntil = isoDate(raw.activeUntil)
  const active = new Date(startsAt).getTime() <= now && (!activeUntil || new Date(activeUntil).getTime() > now) && raw.revokedAt == null
  return {
    site: handle,
    userId: text(userId, 120),
    kind: GRANT_KINDS.has(raw.kind) ? raw.kind : 'complimentary',
    startsAt,
    activeUntil,
    reason: text(raw.reason) || 'Acceso concedido por Escarlet.',
    grantedBy: text(raw.grantedBy, 120) || null,
    createdAt: isoDate(raw.createdAt) || startsAt,
    updatedAt: isoDate(raw.updatedAt) || isoDate(raw.createdAt) || startsAt,
    revokedAt: isoDate(raw.revokedAt),
    revokedBy: text(raw.revokedBy, 120) || null,
    active
  }
}

export function saveMembershipGrant(site, userId, input = {}, { db, actorId, now = new Date().toISOString() } = {}) {
  if (!db || typeof db !== 'object') throw new TypeError('db is required')
  const handle = text(site, 80)
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(handle)) throw new CmsError(400, 'Sitio inválido.')
  const recipient = text(userId, 120)
  if (!recipient) throw new CmsError(400, 'Selecciona el usuario que recibirá el acceso.')
  const key = grantKey(handle, recipient)
  const kind = text(input.kind, 30).toLowerCase() || 'complimentary'
  if (!GRANT_KINDS.has(kind)) throw new CmsError(400, 'Tipo de acceso gratuito no válido.')
  const startsAt = isoDate(input.startsAt) || new Date(now).toISOString()
  const activeUntil = isoDate(input.activeUntil)
  if (activeUntil && new Date(activeUntil).getTime() <= new Date(startsAt).getTime()) {
    throw new CmsError(400, 'La fecha de caducidad debe ser posterior al inicio.')
  }
  const reason = text(input.reason)
  if (!reason) throw new CmsError(400, 'Indica el motivo del acceso gratuito.')
  const timestamp = new Date(now).toISOString()
  const existing = grantStore(db)[key]
  grantStore(db)[key] = {
    ...existing,
    site: handle,
    userId: recipient,
    kind,
    startsAt,
    activeUntil,
    reason,
    grantedBy: text(actorId, 120) || existing?.grantedBy || null,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    revokedAt: null,
    revokedBy: null
  }
  return getMembershipGrant(handle, recipient, db, new Date(timestamp).getTime())
}

export function revokeMembershipGrant(site, userId, { db, actorId, now = new Date().toISOString() } = {}) {
  if (!db || typeof db !== 'object') throw new TypeError('db is required')
  const handle = text(site, 80)
  const recipient = text(userId, 120)
  const key = grantKey(handle, recipient)
  if (!key) throw new CmsError(400, 'Selecciona el usuario que recibirá el acceso.')
  const existing = grantStore(db)[key]
  if (!existing) return null
  const timestamp = new Date(now).toISOString()
  grantStore(db)[key] = { ...existing, revokedAt: timestamp, revokedBy: text(actorId, 120) || null, updatedAt: timestamp }
  return getMembershipGrant(handle, recipient, db, new Date(timestamp).getTime())
}

export function saveMcpPlan(input, db) {
  const draftLimit = Number(input.draftLimit)
  const publishLimitPerMonth = Number(input.publishLimitPerMonth)
  const priceId = String(input.priceId || '').trim()
  const trialDays = Number(input.trialDays || 0)
  if (!Number.isSafeInteger(draftLimit) || draftLimit < 1 || !Number.isSafeInteger(publishLimitPerMonth) || publishLimitPerMonth < 1 || !/^price_[A-Za-z0-9]+$/.test(priceId) || !Number.isSafeInteger(trialDays) || trialDays < 0 || trialDays > 365) {
    throw new CmsError(400, 'Configura un Price recurrente de Stripe y límites mensuales enteros positivos.')
  }
  const plan = { id: MCP_PLAN_ID, name: 'CMS con ChatGPT', draftLimit, publishLimitPerMonth, priceId, trialDays, enabled: input.enabled === true }
  db.plans = [...(db.plans || []).filter((p) => p.id !== MCP_PLAN_ID), plan]
  return plan
}
export function membershipState(site, db, config, now = Date.now(), userId = '') {
  const grant = getMembershipGrant(site, userId, db, now)
  if (grant?.active) {
    return {
      managed: true,
      active: true,
      status: grant.kind === 'trial' ? 'trialing' : 'complimentary',
      source: 'grant',
      accessUntil: grant.activeUntil ? Math.floor(new Date(grant.activeUntil).getTime() / 1000) : null,
      paidThrough: null,
      cancelAtPeriodEnd: false,
      grant: {
        kind: grant.kind,
        startsAt: grant.startsAt,
        activeUntil: grant.activeUntil,
        active: true
      }
      }
  }
  const record = db.memberships?.[site]
  if (!record && grant) {
    return {
      managed: true,
      active: false,
      status: grant.kind === 'trial' ? 'trial_expired' : 'complimentary_expired',
      source: 'grant',
      accessUntil: grant.activeUntil ? Math.floor(new Date(grant.activeUntil).getTime() / 1000) : null,
      paidThrough: null,
      cancelAtPeriodEnd: false,
      grant: {
        kind: grant.kind,
        startsAt: grant.startsAt,
        activeUntil: grant.activeUntil,
        active: false
      }
    }
  }
  if (!record && config?.planId !== MCP_PLAN_ID) return { managed: false, active: config?.entitlements?.membership !== 'suspended' }
  const paidThrough = Number(record?.paidThrough || 0)
  const accessUntil = Number(record?.accessUntil || paidThrough || 0)
  const status = text(record?.status, 40) || 'unpaid'
  const active = ['active', 'trialing'].includes(status) && accessUntil * 1000 > now && config?.entitlements?.membership !== 'suspended'
  return {
    managed: true,
    active,
    status,
    source: 'stripe',
    accessUntil: accessUntil || null,
    trialEndsAt: Number(record?.trialEndsAt || 0) || null,
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
