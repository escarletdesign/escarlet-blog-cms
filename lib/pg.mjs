/**
 * Optional Postgres pool (Coolify DATABASE_URL). When unset, callers use file ledger.
 */
import { isProductRestructureV1 } from './product-flags.mjs'

let pool = null
let schemaReady = false

export function isPostgresConfigured() {
  return Boolean(String(process.env.DATABASE_URL || '').trim())
}

export async function getPgPool() {
  if (!isPostgresConfigured()) return null
  if (pool) return pool
  const { default: pg } = await import('pg')
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX || 5)
  })
  return pool
}

export async function ensureStripeLedgerSchema() {
  if (!isProductRestructureV1() || !isPostgresConfigured()) return false
  if (schemaReady) return true
  const p = await getPgPool()
  if (!p) return false
  await p.query(`
    CREATE TABLE IF NOT EXISTS stripe_events (
      event_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      site TEXT,
      kind TEXT,
      payload JSONB,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS stripe_payments (
      id BIGSERIAL PRIMARY KEY,
      event_id TEXT UNIQUE REFERENCES stripe_events(event_id),
      site TEXT NOT NULL,
      kind TEXT NOT NULL,
      plan_id TEXT,
      amount_total INTEGER,
      currency TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  schemaReady = true
  return true
}

export async function closePgPool() {
  if (pool) {
    await pool.end()
    pool = null
    schemaReady = false
  }
}
