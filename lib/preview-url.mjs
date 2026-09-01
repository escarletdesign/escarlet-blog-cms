import { isLocalhostBase } from './media-url.mjs'

function cmsPublicBase() {
  return (process.env.CMS_PUBLIC_URL || '').replace(/\/$/, '')
}

function adminToken() {
  return process.env.ADMIN_TOKEN || ''
}

export function draftPreviewUrl(site, slug) {
  const encoded = encodeURIComponent(slug)
  const path = `/preview/${site}/${encoded}`
  const token = adminToken()
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  const base = cmsPublicBase()
  if (base && !isLocalhostBase(base)) return `${base}${path}${query}`
  return `${path}${query}`
}

export function dashboardUrl() {
  const base = cmsPublicBase()
  if (base && !isLocalhostBase(base)) return `${base}/admin`
  return '/admin'
}

export function withPostLinks(payload, site, slug) {
  if (!site || !slug) return payload
  return {
    ...payload,
    previewUrl: draftPreviewUrl(site, slug),
    dashboardUrl: dashboardUrl(),
    reviewHint:
      'Comparte previewUrl con quien revise el borrador. Abre el enlace en el navegador para ver el post como draft antes de publicar.'
  }
}
