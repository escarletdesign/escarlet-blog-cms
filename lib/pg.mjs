/**
 * Postgres pool for the canonical workspace/content runtime. Legacy callers may
 * still use the JSON ledger when DATABASE_URL is unset during migration.
 */
import { isProductRestructureV1 } from './product-flags.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pool = null
let schemaReady = false
let coreSchemaReady = false

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

/**
 * Apply the repository-owned SQL migrations. This intentionally stays tiny:
 * Postgres is the source of truth and the migration table makes startup
 * idempotent across API and worker processes.
 */
export async function runCoreMigrations({ directory = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations') } = {}) {
  if (!isPostgresConfigured()) return false
  if (coreSchemaReady) return true
  const p = await getPgPool()
  if (!p) return false
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  const client = await p.connect()
  try {
    await client.query('BEGIN')
    // Prevent API and worker processes from applying the same migration at
    // once when a deployment starts both containers together.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('escarlet_core_migrations'))")
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())')
    for (const file of files) {
      const version = file.replace(/\.sql$/i, '')
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [version])
      if (applied.rowCount) continue
      await client.query(readFileSync(join(directory, file), 'utf8'))
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  coreSchemaReady = true
  return true
}

export async function withPgTransaction(clientOrPool, callback) {
  const client = typeof clientOrPool?.connect === 'function' ? await clientOrPool.connect() : clientOrPool
  const ownsClient = client !== clientOrPool
  try {
    await client.query('BEGIN')
    const value = await callback(client)
    await client.query('COMMIT')
    return value
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* preserve original error */ }
    throw error
  } finally {
    if (ownsClient) client.release()
  }
}

export async function closePgPool() {
  if (pool) {
    await pool.end()
    pool = null
    schemaReady = false
    coreSchemaReady = false
  }
}
