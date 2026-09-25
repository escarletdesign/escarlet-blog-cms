import { privateAddress } from './remote-fetch.mjs'

const DEFAULT_API_ORIGIN = 'https://api.planable.io/api/v1'

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max)
}

function planableError(status, message = 'Planable rechazó la solicitud.', code = 'planable_request_failed') {
  const error = new Error(message)
  error.status = Number(status) || 502
  error.code = error.status === 401
    ? 'planable_unauthorized'
    : error.status === 403
      ? 'planable_forbidden'
      : error.status === 429
        ? 'planable_rate_limited'
        : code
  return error
}

function apiOrigin(apiBaseUrl = DEFAULT_API_ORIGIN) {
  const value = clean(apiBaseUrl, 500) || DEFAULT_API_ORIGIN
  let parsed
  try { parsed = new URL(value) } catch { throw Object.assign(new Error('La URL de API de Planable no es válida.'), { status: 400, code: 'planable_invalid_api_url' }) }
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  const allowLocalhost = process.env.NODE_ENV !== 'production' && local
  if (!['https:', 'http:'].includes(parsed.protocol) || (parsed.protocol === 'http:' && !allowLocalhost) || (privateAddress(parsed.hostname) && !allowLocalhost)) {
    throw Object.assign(new Error('La URL de API de Planable debe usar HTTPS.'), { status: 400, code: 'planable_invalid_api_url' })
  }
  return parsed.toString().replace(/\/$/, '')
}

async function request(path, { apiToken, apiBaseUrl, idempotencyKey, fetchImpl = globalThis.fetch, method = 'GET', body } = {}) {
  if (typeof fetchImpl !== 'function') throw Object.assign(new Error('fetch no está disponible.'), { status: 503, code: 'fetch_unavailable' })
  const token = clean(apiToken, 4096)
  if (!token) throw planableError(401, 'Falta la credencial de Planable.', 'planable_credential_missing')
  const url = new URL(`${apiOrigin(apiBaseUrl)}${path.startsWith('/') ? path : `/${path}`}`)
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(idempotencyKey ? { 'Idempotency-Key': clean(idempotencyKey, 300) } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(Math.max(1_000, Number(process.env.PROVIDER_TIMEOUT_MS) || 30_000))
  })
  let payload = null
  try { payload = await response.json() } catch { payload = null }
  if (!response?.ok) {
    const message = payload?.error?.message || payload?.message || 'Planable rechazó la solicitud.'
    throw planableError(response?.status, message, payload?.error?.code || 'planable_request_failed')
  }
  return payload || {}
}

export async function listPlanableWorkspaces({ apiToken, apiBaseUrl, fetchImpl } = {}) {
  const response = await request('/workspaces', { apiToken, apiBaseUrl, fetchImpl })
  return Array.isArray(response?.data) ? response.data : []
}

/**
 * Performs a low-cost authenticated health check. `/ping` requires only the
 * read scope, so read-only Planable tokens can be connected safely.
 */
export async function testPlanableConnection({ apiToken, workspaceId, apiBaseUrl, fetchImpl } = {}) {
  try {
    const requestedWorkspace = clean(workspaceId, 200)
    if (requestedWorkspace) {
      const workspaces = await listPlanableWorkspaces({ apiToken, apiBaseUrl, fetchImpl })
      const workspace = workspaces.find((entry) => entry?.id === requestedWorkspace) || null
      if (!workspace) return { ok: false, status: 404, code: 'planable_workspace_not_found' }
      return { ok: true, provider: 'planable', workspaceId: workspace.id, workspaceName: workspace.name || null, companyId: null }
    }
    const ping = await request('/ping', { apiToken, apiBaseUrl, fetchImpl })
    return { ok: true, provider: 'planable', workspaceId: null, workspaceName: null, companyId: ping?.companyId || null }
  } catch (error) {
    return { ok: false, status: error.status || 502, code: error.code || 'planable_request_failed', message: error.message }
  }
}

function publicMedia(media = []) {
  return (Array.isArray(media) ? media : [])
    .map((asset) => typeof asset === 'string' ? asset : asset?.url)
    .filter((url) => {
      try {
        const parsed = new URL(url)
        return ['http:', 'https:'].includes(parsed.protocol) && !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) && !privateAddress(parsed.hostname)
      } catch { return false }
    })
    .slice(0, 20)
}

function pageIds({ pageId, pageIds } = {}) {
  const ids = [...new Set((Array.isArray(pageIds) ? pageIds : String(pageIds || '').split(',')).concat(pageId || []).map((value) => clean(value, 200)).filter(Boolean))]
  if (!ids.length) throw Object.assign(new Error('Planable requiere al menos una página configurada.'), { status: 400, code: 'planable_page_required' })
  return ids
}

export async function schedulePlanablePost({ apiToken, workspaceId, pageId, pageIds: configuredPageIds, publicationDate, text = '', media = [], idempotencyKey, apiBaseUrl, fetchImpl, notify = false, approved = false } = {}) {
  const workspace = clean(workspaceId, 200)
  if (!workspace) throw Object.assign(new Error('Planable requiere workspaceId.'), { status: 400, code: 'planable_workspace_required' })
  const date = new Date(publicationDate)
  if (!Number.isFinite(date.getTime())) throw Object.assign(new Error('publicationDate inválida.'), { status: 400, code: 'publication_date_invalid' })
  const ids = pageIds({ pageId, pageIds: configuredPageIds })
  const body = {
    workspaceId: workspace,
    ...(ids.length === 1 ? { pageId: ids[0] } : { pageIds: ids }),
    text: clean(text, 25_000),
    scheduledAt: date.toISOString(),
    media: publicMedia(media),
    approved: Boolean(approved),
    publishAtScheduledDate: false,
    notify: Boolean(notify)
  }
  return request('/posts', { apiToken, apiBaseUrl, idempotencyKey, fetchImpl, method: 'POST', body })
}

export async function syncPlanablePost({ apiToken, providerPostId, apiBaseUrl, fetchImpl } = {}) {
  const postId = clean(providerPostId, 200)
  if (!postId) throw Object.assign(new Error('providerPostId es obligatorio.'), { status: 400, code: 'planable_post_required' })
  return request(`/posts/${encodeURIComponent(postId)}`, { apiToken, apiBaseUrl, fetchImpl })
}

export function planableStatus(response = {}) {
  return String(response?.status || response?.data?.status || response?.posts?.[0]?.status || '').toLowerCase()
}

export const PLANABLE_API_ORIGIN = DEFAULT_API_ORIGIN
