/**
 * Public CMS URLs used by the v2 runtime.
 *
 * Keeping this in one place prevents a stale deployment variable or a copied
 * template from advertising the retired MCP host to an agent client.
 */
export const CANONICAL_CMS_URL = 'https://cms.escarlet.design'
export const DEPRECATED_CMS_HOSTS = Object.freeze(['blog-cms.escarlet.cc'])

function trimUrl(value) {
  return String(value || '').trim().replace(/\/$/, '')
}

/**
 * Normalize a configured public URL while preserving local development URLs.
 * The retired public host is intentionally mapped to the canonical v2 host so
 * OAuth metadata, media links and previews cannot keep a legacy MCP address
 * alive after a redeploy with stale environment variables.
 */
export function normalizeCmsPublicUrl(value, { fallback = CANONICAL_CMS_URL } = {}) {
  const raw = trimUrl(value)
  if (!raw) return trimUrl(fallback) || CANONICAL_CMS_URL

  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return raw
  }

  const hostname = String(parsed.hostname || '').toLowerCase()
  if (DEPRECATED_CMS_HOSTS.includes(hostname)) return trimUrl(fallback) || CANONICAL_CMS_URL
  return parsed.toString().replace(/\/$/, '')
}

export function canonicalCmsPublicUrl(value, { allowLocalhost = true } = {}) {
  const raw = trimUrl(value)
  if (!raw) return CANONICAL_CMS_URL
  if (allowLocalhost && /https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(raw)) return raw
  return normalizeCmsPublicUrl(raw)
}
