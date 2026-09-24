function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function blogPublicationSlug(variant) {
  const body = variant?.blog_body && typeof variant.blog_body === 'object' ? variant.blog_body : {}
  return String(body.slug || body.slug_es || '').trim() || slugify(blogPublicationTitle(variant))
}

export function blogPublicationTitle(variant) {
  const body = variant?.blog_body && typeof variant.blog_body === 'object' ? variant.blog_body : {}
  return String(variant?.content_title || variant?.topic || body.title || '').trim()
}

export function blogPublicationUrl(variant) {
  const domain = String(variant?.site_domain || '').trim().replace(/\/$/, '')
  const slug = blogPublicationSlug(variant)
  return domain && slug ? `${domain}/blog/${slug}` : ''
}

export async function blogPublicationIsLive(url, fetchImpl = fetch) {
  if (!url) return false
  const response = await fetchImpl(url, { method: 'GET', redirect: 'follow' })
  return response.ok
}
