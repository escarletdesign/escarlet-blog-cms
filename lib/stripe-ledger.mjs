/**
 * Idempotent Stripe event ledger: Postgres when DATABASE_URL is set, else JSON file.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './db.mjs'
import { ensureStripeLedgerSchema, getPgPool, isPostgresConfigured } from './pg.mjs'

const filePath = () => join(dataDir, 'stripe-ledger.json')

function readFileLedger() {
  if (!existsSync(filePath())) {
    return { events: {}, payments: [] }
  }
  return JSON.parse(readFileSync(filePath(), 'utf8'))
}

function writeFileLedger(ledger) {
  mkdirSync(dataDir, { recursive: true })
  const tmp = `${filePath()}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(ledger, null, 2))
  renameSync(tmp, filePath())
}

/**
 * @returns {{ inserted: boolean, duplicate: boolean }}
 */
export async function recordStripeEvent({ eventId, type, site, kind, payload }) {
  if (!eventId) throw new Error('eventId required')

  if (isPostgresConfigured()) {
    await ensureStripeLedgerSchema()
    const pool = await getPgPool()
    try {
      await pool.query(
        `INSERT INTO stripe_events (event_id, type, site, kind, payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [eventId, type || '', site || null, kind || null, payload || {}]
      )
      return { inserted: true, duplicate: false }
    } catch (err) {
      if (err && err.code === '23505') return { inserted: false, duplicate: true }
      throw err
    }
  }

  const ledger = readFileLedger()
  if (ledger.events[eventId]) return { inserted: false, duplicate: true }
  ledger.events[eventId] = {
    eventId,
    type,
    site,
    kind,
    payload,
    processedAt: new Date().toISOString()
  }
  writeFileLedger(ledger)
  return { inserted: true, duplicate: false }
}

export async function recordStripePayment({ eventId, site, kind, planId, amountTotal, currency }) {
  if (isPostgresConfigured()) {
    await ensureStripeLedgerSchema()
    const pool = await getPgPool()
    await pool.query(
      `INSERT INTO stripe_payments (event_id, site, kind, plan_id, amount_total, currency)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, site, kind, planId || null, amountTotal ?? null, currency || null]
    )
    return
  }
  const ledger = readFileLedger()
  if (!ledger.payments.some((p) => p.eventId === eventId)) {
    ledger.payments.push({
      eventId,
      site,
      kind,
      planId: planId || null,
      amountTotal: amountTotal ?? null,
      currency: currency || null,
      createdAt: new Date().toISOString()
    })
    writeFileLedger(ledger)
  }
}
