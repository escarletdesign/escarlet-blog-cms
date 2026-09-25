function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function normalizeBlogTitle(value) {
  const raw = String(value || '')
    .replace(/^\s*(?:título|title|brief|tema|enfoque|contexto|objetivo)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  const beforeDetail = raw.split(/\b(?:enfoque|contexto|objetivo|idea central|brief)\s*:/i)[0].trim()
  const sentence = (beforeDetail || raw).split(/[.!?]\s+/)[0].replace(/[.!?]+$/, '').trim()
  if (sentence.length <= 90) return sentence
  return `${sentence.slice(0, 87).replace(/\s+\S*$/, '').trim()}...`
}

export function blogPublicationSlug(variant) {
  const body = variant?.blog_body && typeof variant.blog_body === 'object' ? variant.blog_body : {}
  return String(body.slug || body.slug_es || '').trim() || slugify(variant?.content_title || variant?.topic || body.title)
}

export function blogPublicationTitle(variant) {
  const body = variant?.blog_body && typeof variant.blog_body === 'object' ? variant.blog_body : {}
  return normalizeBlogTitle(variant?.content_title || body.title || variant?.topic)
}

export function blogPublicationUrl(variant) {
  const domain = String(variant?.site_domain || '').trim().replace(/\/$/, '')
  const slug = blogPublicationSlug(variant)
  return domain && slug ? `${domain}/blog/${slug}` : ''
}

export async function blogPublicationIsLive(url, fetchImpl = fetch, expectedTitle = '') {
  if (!url) return false
  const response = await fetchImpl(url, { method: 'GET', redirect: 'follow' })
  if (!response.ok) return false
  return expectedTitle ? typeof response.text === 'function' && (await response.text()).includes(expectedTitle) : true
}
