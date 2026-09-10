import { readDb, writeDb } from './db.mjs'
import { loadSiteConfig, saveSiteConfig } from './site-config.mjs'
import { recordStripeEvent, recordStripePayment } from './stripe-ledger.mjs'
import { CmsError } from './cms-ops-errors.mjs'

const idOf = (v) => typeof v === 'string' ? v : v?.id
let queue = Promise.resolve()
// Serialize webhook application in this server (the supported JSON-backed
// deployment). Read the current subscription from Stripe, not stale event
// snapshots: retries/out-of-order deliveries converge on the same state.
export function applyMembershipEvent(event, options = {}) {
  const next = queue.then(() => apply(event, options))
  queue = next.catch(() => {})
  return next
}
async function apply(event, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const object = event.data?.object || {}
  const subscriptionId = event.type.startsWith('customer.subscription.') ? object.id
    : idOf(object.subscription) || idOf(object.parent?.subscription_details?.subscription)
  if (!subscriptionId) return { applied: false, ignored: true }
  if (!env.STRIPE_SECRET_KEY) throw new CmsError(503, 'Stripe no está configurado para verificar la membresía.')
  const response = await fetchImpl(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=latest_invoice`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
  })
  if (!response.ok) throw new CmsError(502, 'No se pudo verificar la suscripción en Stripe; se reintentará el evento.')
  const subscription = await response.json()
  const site = subscription.metadata?.site
  if (subscription.metadata?.kind !== 'membership' || !site) return { applied: false, ignored: true }
  const config = loadSiteConfig(site)
  if (!config) throw new CmsError(404, 'Sitio de la suscripción no encontrado.')
  const db = readDb()
  const previous = db.memberships?.[site]
  if (previous?.subscriptionId && previous.subscriptionId !== subscriptionId && !['canceled', 'incomplete_expired'].includes(previous.status)) {
    throw new CmsError(409, 'El sitio ya tiene otra suscripción. Revisa Stripe antes de cambiarla.')
  }
  const planId = subscription.metadata?.planId || config.planId
  if (!(db.plans || []).some((p) => p.id === planId)) throw new CmsError(400, 'Plan de membresía desconocido.')
  const invoice = subscription.latest_invoice
  const paid = invoice && typeof invoice === 'object'
    ? (invoice.status === 'paid' || invoice.paid === true)
    : Boolean(previous?.paidThrough && Number(previous.paidThrough) * 1000 > Date.now())
  const periodEnd = Number(subscription.current_period_end || subscription.items?.data?.[0]?.current_period_end || invoice?.lines?.data?.[0]?.period?.end || 0)
  const paidThrough = paid ? periodEnd : Number(previous?.paidThrough || 0)
  const active = subscription.status === 'active' && paid && paidThrough * 1000 > Date.now()
  const record = { subscriptionId, customerId: idOf(subscription.customer), planId, status: active ? 'active' : subscription.status === 'active' ? 'unpaid' : subscription.status,
    paidThrough, cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end), updatedAt: new Date().toISOString() }
  // This write is absolute, not an increment. Replaying after a ledger or
  // config write failure is safe; only mark the event after effects succeed.
  db.memberships = { ...db.memberships, [site]: record }
  writeDb(db)
  saveSiteConfig(site, { planId, entitlements: { ...config.entitlements, membership: active ? 'active' : 'suspended' } })
  await recordStripePayment({ eventId: event.id, site, kind: 'membership', planId, amountTotal: object.amount_paid ?? object.amount_total, currency: object.currency })
  const result = await recordStripeEvent({ eventId: event.id, type: event.type, site, kind: 'membership', payload: { subscriptionId, status: record.status } })
  return { applied: true, duplicate: result.duplicate, site, kind: 'membership', status: record.status }
}
