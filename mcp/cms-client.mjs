const CMS_URL = (process.env.CMS_URL || 'http://localhost:3040').replace(/\/$/, '')
const CMS_ADMIN_TOKEN = process.env.CMS_ADMIN_TOKEN || process.env.ADMIN_TOKEN || 'cambia-esto'

async function request(method, path, body) {
  const res = await fetch(`${CMS_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${CMS_ADMIN_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { message: text }
  }
  if (!res.ok) {
    const err = new Error(data.message || `HTTP ${res.status}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

export async function listSites() {
  return request('GET', '/api/admin/sites')
}

export async function getOnboarding(site) {
  const q = site ? `?site=${encodeURIComponent(site)}` : ''
  return request('GET', `/api/admin/onboarding${q}`)
}

export async function createSite(payload) {
  return request('POST', '/api/admin/sites', payload)
}

export async function listPosts(site, status) {
  const q = new URLSearchParams({ site })
  if (status) q.set('status', status)
  return request('GET', `/api/admin/posts?${q}`)
}

export async function getPost(site, slug) {
  const q = new URLSearchParams({ site })
  return request('GET', `/api/admin/posts/${encodeURIComponent(slug)}?${q}`)
}

export async function createDraft(payload) {
  return request('POST', '/api/admin/posts/create-draft', payload)
}

export async function updatePost(payload) {
  return request('POST', '/api/admin/posts', payload)
}

export async function validateSeo(site, slug, post) {
  return request('POST', '/api/admin/validate-seo', { site, slug, post })
}

export async function publishPost(site, slug) {
  return request('POST', '/api/admin/posts/publish', { site, slug })
}

export async function unpublishPost(site, slug) {
  return request('POST', '/api/admin/posts/unpublish', { site, slug })
}

export async function deletePost(site, slug) {
  const q = new URLSearchParams({ site })
  return request('DELETE', `/api/admin/posts/${encodeURIComponent(slug)}?${q}`)
}

export async function uploadMedia(payload) {
  return request('POST', '/api/admin/media/upload', payload)
}

export async function getBrandContext(site) {
  return request('GET', `/api/admin/brand-kit/${encodeURIComponent(site)}`)
}

export async function getBrandFile(site, file) {
  return request('GET', `/api/admin/brand-kit/${encodeURIComponent(site)}/${encodeURIComponent(file)}`)
}

export async function updateBrandFile(site, file, content) {
  return request('POST', `/api/admin/brand-kit/${encodeURIComponent(site)}/${encodeURIComponent(file)}`, {
    content
  })
}

export async function getSeoContext(site) {
  const brand = await getBrandContext(site)
  return {
    site,
    keywords: brand.keywords,
    agentRules: brand.agentRules
  }
}

export { CMS_URL }
