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
 * Global switch for the CMS-owned AI API and provider integrations.
 * An explicit environment value always wins over the persisted admin flag;
 * this lets a deployment kill-switch remain authoritative. Existing installs
 * stay enabled until the flag is explicitly set to false.
 */
export function isCmsAiEnabled({ db, env = process.env } = {}) {
  const fromEnv = parseBoolean(env?.[CMS_AI_ENV_FLAG])
  if (fromEnv !== null) return fromEnv
  const fromDb = parseBoolean(featureFlags(db)[CMS_AI_DB_FLAG])
  return fromDb === null ? true : fromDb
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
  const previous = featureFlags(db)
  const nextEnabled = typeof enabled === 'boolean'
    ? enabled
    : typeof previous[CMS_AI_DB_FLAG] === 'boolean'
      ? previous[CMS_AI_DB_FLAG]
      : true
  db.featureFlags = {
    ...previous,
    [CMS_AI_DB_FLAG]: nextEnabled,
    updatedAt: String(now || '').trim(),
    ...(String(actorId || '').trim() ? { updatedBy: String(actorId).trim().slice(0, 120) } : {})
  }
  return isCmsAiEnabled({ db })
}
