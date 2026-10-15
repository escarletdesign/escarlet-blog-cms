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

export function isCmsAiEnabled({ db, env = process.env } = {}) {
  const dbValue = parseBoolean(featureFlags(db)[CMS_AI_DB_FLAG])
  if (dbValue !== null) return dbValue
  return parseBoolean(env?.[CMS_AI_ENV_FLAG]) === true
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
  const nextEnabled = enabled === true
  const previous = featureFlags(db)
  db.featureFlags = {
    ...previous,
    [CMS_AI_DB_FLAG]: nextEnabled,
    updatedAt: String(now || '').trim(),
    ...(String(actorId || '').trim() ? { updatedBy: String(actorId).trim().slice(0, 120) } : {})
  }
  return isCmsAiEnabled({ db })
}
