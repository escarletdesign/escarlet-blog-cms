import { isLocalhostBase } from './media-url.mjs'
import { CANONICAL_CMS_URL, canonicalCmsPublicUrl } from './cms-url.mjs'

const PRODUCTION_CMS_FALLBACK = CANONICAL_CMS_URL

function cmsPublicBase({ forceAbsolute = false } = {}) {
  const fromEnv = (process.env.CMS_PUBLIC_URL || '').replace(/\/$/, '')
  if (fromEnv && !isLocalhostBase(fromEnv)) return fromEnv

  const wantAbsolute =
    forceAbsolute ||
    process.env.FORCE_ABSOLUTE_PREVIEW === '1' ||
    process.env.NODE_ENV === 'production'

  if (wantAbsolute) {
    return canonicalCmsPublicUrl(process.env.CMS_PUBLIC_URL_FALLBACK || PRODUCTION_CMS_FALLBACK)
  }

  return ''
}

export function draftPreviewUrl(site, slug) {
  const encoded = encodeURIComponent(slug)
  const path = `/app/preview/${encoded}`
  const query = site ? `?site=${encodeURIComponent(site)}` : ''
  // MCP / agentes siempre reciben URL absoluta clicable
  const base = cmsPublicBase({ forceAbsolute: true })
  return `${base}${path}${query}`
}

export function cmsPublicUrl() {
  return cmsPublicBase({ forceAbsolute: true })
}

export function dashboardUrl() {
  const base = cmsPublicBase({ forceAbsolute: true })
  return `${base}/app`
}

export function contentPostUrl(itemId, site = '', channel = '') {
  const id = String(itemId || '').trim()
  if (!id) return null
  const params = new URLSearchParams()
  if (site) params.set('site', String(site))
  const normalizedChannel = String(channel || '').trim().toLowerCase()
  if (normalizedChannel && normalizedChannel !== 'blog') params.set('channel', normalizedChannel)
  const query = params.toString()
  return `${cmsPublicBase({ forceAbsolute: true })}/app/content/${encodeURIComponent(id)}${query ? `?${query}` : ''}`
}

/** PWA content pack preview (agents must share this when readyForReview). */
export function contentItemPreviewUrl(itemId, batchId = '') {
  const id = String(itemId || '').trim()
  if (!id) return ''
  const base = cmsPublicBase({ forceAbsolute: true })
  const params = new URLSearchParams()
  if (batchId) params.set('batchId', String(batchId))
  const query = params.toString()
  return `${base}/app/plans/${encodeURIComponent(id)}/preview${query ? `?${query}` : ''}`
}

export function absoluteMediaUrl(pathOrUrl) {
  const raw = String(pathOrUrl || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw) && !isLocalhostBase(raw)) return raw
  const path = raw.startsWith('/') ? raw : `/${raw}`
  const base = cmsPublicBase({ forceAbsolute: true })
  return `${base}${path}`
}

export function withPostLinks(payload, site, slug) {
  if (!site || !slug) return payload
  const previewUrl = draftPreviewUrl(site, slug)
  const dash = dashboardUrl()
  return {
    ...payload,
    previewUrl,
    dashboardUrl: dash,
    reviewHint:
      `Comparte este enlace completo con el humano (listo para hacer click): ${previewUrl}`
  }
}
