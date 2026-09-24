function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function blogPublicationUrl(variant) {
  const domain = String(variant?.site_domain || '').trim().replace(/\/$/, '')
  const body = variant?.blog_body && typeof variant.blog_body === 'object' ? variant.blog_body : {}
  const slug = String(body.slug || body.slug_es || '').trim() || slugify(body.title || variant?.topic)
  return domain && slug ? `${domain}/blog/${slug}` : ''
}

export async function blogPublicationIsLive(url, fetchImpl = fetch) {
  if (!url) return false
  const response = await fetchImpl(url, { method: 'GET', redirect: 'follow' })
  return response.ok
}
