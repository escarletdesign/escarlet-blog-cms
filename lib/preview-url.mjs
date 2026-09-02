import { isLocalhostBase } from './media-url.mjs'

const PRODUCTION_CMS_FALLBACK = 'https://blog-cms.escarlet.cc'

function cmsPublicBase({ forceAbsolute = false } = {}) {
  const fromEnv = (process.env.CMS_PUBLIC_URL || '').replace(/\/$/, '')
  if (fromEnv && !isLocalhostBase(fromEnv)) return fromEnv

  const wantAbsolute =
    forceAbsolute ||
    process.env.FORCE_ABSOLUTE_PREVIEW === '1' ||
    process.env.NODE_ENV === 'production'

  if (wantAbsolute) {
    return (process.env.CMS_PUBLIC_URL_FALLBACK || PRODUCTION_CMS_FALLBACK).replace(/\/$/, '')
  }

  return ''
}

function adminToken() {
  return process.env.ADMIN_TOKEN || ''
}

export function draftPreviewUrl(site, slug) {
  const encoded = encodeURIComponent(slug)
  const path = `/preview/${site}/${encoded}`
  const token = adminToken()
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  // MCP / agentes siempre reciben URL absoluta clicable
  const base = cmsPublicBase({ forceAbsolute: true })
  return `${base}${path}${query}`
}

export function dashboardUrl() {
  const base = cmsPublicBase({ forceAbsolute: true })
  return `${base}/admin`
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
