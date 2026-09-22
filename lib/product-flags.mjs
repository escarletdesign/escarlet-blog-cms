import { CmsError } from './cms-ops-errors.mjs'

/**
 * Feature flag for product-restructure phases F0+.
 * Set PRODUCT_RESTRUCTURE_V1=1 (or true) to enable new fields, roles, and review links.
 */
export function isProductRestructureV1() {
  const raw = String(process.env.PRODUCT_RESTRUCTURE_V1 || '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

const CMS_AI_ENV_FLAG = 'CMS_AI_ENABLED'
const CMS_AI_DB_FLAG = 'cmsAiEnabled'

function parseBoolean(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null
  const raw = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  return null
}

function featureFlags(db) {
  return db?.featureFlags && typeof db.featureFlags === 'object' && !Array.isArray(db.featureFlags)
    ? db.featureFlags
    : {}
}

/**
 * CMS-owned generation is retired. Content and final pixels are generated in
 * ChatGPT and arrive through MCP; the CMS only stores, reviews and publishes.
 */
export function isCmsAiEnabled({ db, env = process.env } = {}) {
  void db
  void env
  return false
}

export function assertCmsAiEnabled(options = {}) {
  if (!isCmsAiEnabled(options)) {
    throw new CmsError(
      403,
      'La IA del CMS está desactivada. Usa ChatGPT mediante MCP o el modo manual.',
      { code: 'CMS_AI_DISABLED' }
    )
  }
}

export function setCmsAiEnabled({ db, enabled, actorId, now = new Date().toISOString() } = {}) {
  if (!db || typeof db !== 'object') throw new TypeError('db is required')
  void enabled
  const previous = featureFlags(db)
  db.featureFlags = {
    ...previous,
    [CMS_AI_DB_FLAG]: false,
    updatedAt: String(now || '').trim(),
    ...(String(actorId || '').trim() ? { updatedBy: String(actorId).trim().slice(0, 120) } : {})
  }
  return isCmsAiEnabled({ db })
}
