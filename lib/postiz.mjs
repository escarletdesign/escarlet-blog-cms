const DEFAULT_API_ORIGIN = 'https://api.postiz.com/public/v1'

const CHANNEL_PROVIDER_MAP = Object.freeze({
  blog: 'wordpress',
  instagram: 'instagram',
  linkedin: 'linkedin',
  x: 'x',
  video: 'youtube',
  substack: 'substack'
})

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max)
}

function providerDefaults(providerType, text) {
  const provider = clean(providerType, 80).toLowerCase()
  if (provider === 'instagram' || provider === 'instagram-standalone') {
    // The Instagram provider requires this discriminator even for a regular
    // feed post. Keep the optional fields explicit so Postiz can safely merge
    // them with settings supplied by a connection in the future.
    return { post_type: 'post', is_trial_reel: false, collaborators: [] }
  }
  if (provider === 'youtube') {
    // YouTube requires a title and visibility. Derive a useful title from the
    // first line of the generated content while keeping it within YouTube's
    // API limit. Callers may override any of these defaults.
    const title = clean(String(text || '').split(/\r?\n/)[0], 100) || 'Escarlet'
    return { title: title.slice(0, 100), type: 'public', selfDeclaredMadeForKids: 'no', tags: [] }
  }
  if (provider === 'wordpress') {
    // WordPress integrations require a title and post type. The Escarlet
    // approval gate runs before this request, so `publish` lets Postiz honor
    // the scheduled date instead of leaving the entry as a permanent draft.
    const title = clean(String(text || '').split(/\r?\n/)[0], 200) || 'Publicación de Escarlet'
    return { title: title.slice(0, 200), type: 'post', status: 'publish', tags: [] }
  }
  return {}
}

function postizError(status, message = 'Postiz rechazó la solicitud.', code = 'postiz_request_failed') {
  const error = new Error(message)
  error.status = Number(status) || 502
  error.code = error.status === 401
    ? 'postiz_unauthorized'
    : error.status === 403
      ? 'postiz_forbidden'
      : error.status === 429
        ? 'postiz_rate_limited'
        : code
  return error
}

function apiOrigin(apiBaseUrl = process.env.POSTIZ_API_BASE_URL || DEFAULT_API_ORIGIN) {
  const value = clean(apiBaseUrl, 500) || clean(process.env.POSTIZ_API_BASE_URL, 500) || DEFAULT_API_ORIGIN
  let parsed
  try { parsed = new URL(value) } catch { throw Object.assign(new Error('La URL de API de Postiz no es válida.'), { status: 400, code: 'postiz_invalid_api_url' }) }
  if (!['https:', 'http:'].includes(parsed.protocol) || (parsed.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw Object.assign(new Error('La URL de API de Postiz debe usar HTTPS.'), { status: 400, code: 'postiz_invalid_api_url' })
  }
  const pathname = parsed.pathname.replace(/\/+$/, '')
  if (!pathname.endsWith('/public/v1')) parsed.pathname = `${pathname}/public/v1`
  return parsed.toString().replace(/\/$/, '')
}

async function request(path, { apiToken, apiBaseUrl, idempotencyKey, fetchImpl = globalThis.fetch, method = 'GET', body, query } = {}) {
  if (typeof fetchImpl !== 'function') throw Object.assign(new Error('fetch no está disponible.'), { status: 503, code: 'fetch_unavailable' })
  const token = clean(apiToken, 4096)
  if (!token) throw postizError(401, 'Falta la credencial de Postiz.', 'postiz_credential_missing')
  const url = new URL(`${apiOrigin(apiBaseUrl)}${path.startsWith('/') ? path : `/${path}`}`)
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && String(value) !== '') url.searchParams.set(key, String(value))
  }
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: 'application/json',
      // Postiz expects the API key/OAuth token as-is, without a Bearer prefix.
      Authorization: token,
      ...(idempotencyKey ? { 'Idempotency-Key': clean(idempotencyKey, 300) } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  let payload = null
  try { payload = await response.json() } catch { payload = null }
  if (!response?.ok) {
    const message = payload?.error?.message || payload?.message || payload?.error || 'Postiz rechazó la solicitud.'
    throw postizError(response?.status, message, payload?.error?.code || 'postiz_request_failed')
  }
  return payload || {}
}

function publicUrl(value) {
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol) || ['localhost', '127.0.0.1'].includes(parsed.hostname)) return null
    return parsed.toString()
  } catch { return null }
}

async function uploadPostizMedia({ apiToken, apiBaseUrl, url, fetchImpl = globalThis.fetch } = {}) {
  const sourceUrl = publicUrl(url)
  if (!sourceUrl) throw Object.assign(new Error('La media de Postiz debe tener una URL pública.'), { status: 400, code: 'postiz_media_url_invalid' })
  // Postiz fetches and stores the public URL itself. This keeps the worker
  // small and follows the provider's SSRF-safe upload endpoint.
  return request('/upload-from-url', { apiToken, apiBaseUrl, fetchImpl, method: 'POST', body: { url: sourceUrl } })
}

async function normalizeMedia(media = [], credentials = {}) {
  const output = []
  for (const asset of Array.isArray(media) ? media.slice(0, 20) : []) {
    const metadata = asset && typeof asset === 'object' && asset.metadata && typeof asset.metadata === 'object' ? asset.metadata : {}
    const mediaId = clean(asset && typeof asset === 'object' ? (asset.mediaId || asset.id || metadata.postizMediaId || metadata.postiz_media_id) : '', 300)
    const url = publicUrl(typeof asset === 'string' ? asset : asset?.url)
    if (mediaId) {
      output.push({ id: mediaId, ...(url ? { path: url } : {}) })
      continue
    }
    if (!url) continue
    const uploaded = await uploadPostizMedia({ ...credentials, url })
    const id = clean(uploaded?.id || uploaded?.mediaId || uploaded?.data?.id, 300)
    if (!id) throw Object.assign(new Error('Postiz no devolvió un identificador de media.'), { status: 502, code: 'postiz_media_id_missing' })
    output.push({ id, path: uploaded?.path || uploaded?.url || uploaded?.data?.path || url })
  }
  return output
}

export function postizProviderForChannel(channel, override) {
  const configured = clean(override, 80).toLowerCase()
  if (configured) return configured
  return CHANNEL_PROVIDER_MAP[clean(channel, 50).toLowerCase()] || clean(channel, 50).toLowerCase()
}

export async function listPostizIntegrations({ apiToken, apiBaseUrl, fetchImpl } = {}) {
  const response = await request('/integrations', { apiToken, apiBaseUrl, fetchImpl })
  if (Array.isArray(response)) return response
  if (Array.isArray(response?.data)) return response.data
  if (Array.isArray(response?.integrations)) return response.integrations
  return []
}

export async function testPostizConnection({ apiToken, apiBaseUrl, integrationId, fetchImpl } = {}) {
  try {
    const integrations = await listPostizIntegrations({ apiToken, apiBaseUrl, fetchImpl })
    const id = clean(integrationId, 300)
    const integration = id ? integrations.find((entry) => String(entry?.id || '') === id) : null
    if (id && !integration) return { ok: false, status: 404, code: 'postiz_integration_not_found' }
    return {
      ok: true,
      provider: 'postiz',
      integrationId: integration?.id || id || null,
      integrationName: integration?.name || null,
      identifier: integration?.identifier || null,
      integrations: integrations.length
    }
  } catch (error) {
    return { ok: false, status: error.status || 502, code: error.code || 'postiz_request_failed', message: error.message }
  }
}

export async function schedulePostizPost({ apiToken, apiBaseUrl, integrationId, publicationDate, timezone = 'UTC', text = '', channel, providerType, providerSettings = {}, media = [], idempotencyKey, fetchImpl, postType } = {}) {
  const integration = clean(integrationId, 300)
  if (!integration) throw Object.assign(new Error('Postiz requiere integrationId.'), { status: 400, code: 'postiz_integration_required' })
  const date = new Date(publicationDate)
  if (!Number.isFinite(date.getTime())) throw Object.assign(new Error('publicationDate inválida.'), { status: 400, code: 'publication_date_invalid' })
  const type = clean(postType, 20).toLowerCase() || 'schedule'
  if (!['draft', 'schedule', 'now'].includes(type)) throw Object.assign(new Error('postType inválido para Postiz.'), { status: 400, code: 'postiz_post_type_invalid' })
  const images = await normalizeMedia(media, { apiToken, apiBaseUrl, fetchImpl })
  const provider = postizProviderForChannel(channel, providerType)
  const suppliedSettings = providerSettings && typeof providerSettings === 'object' && !Array.isArray(providerSettings) ? providerSettings : {}
  const settings = { ...providerDefaults(provider, text), ...suppliedSettings, __type: provider }
  return request('/posts', {
    apiToken,
    apiBaseUrl,
    idempotencyKey,
    fetchImpl,
    method: 'POST',
    body: {
      type,
      date: date.toISOString(),
      shortLink: false,
      tags: [],
      posts: [{
        integration: { id: integration },
        value: [{ content: clean(text, 30_000), image: images }],
        settings
      }]
    }
  })
}

export function postizPostId(response = {}) {
  const entry = Array.isArray(response) ? response[0] : response
  return clean(entry?.postId || entry?.id || entry?.data?.postId || entry?.data?.id || entry?.posts?.[0]?.postId || entry?.posts?.[0]?.id, 300) || null
}

export function postizStatus(response = {}) {
  const entry = Array.isArray(response) ? response[0] : response
  const post = entry?.posts?.[0] || entry?.post || entry?.data?.post || entry?.data || entry
  const value = clean(post?.status || post?.state || entry?.status || entry?.state, 80).toLowerCase()
  if (['published', 'publish', 'released', 'sent', 'success', 'completed', 'done'].includes(value) || post?.releaseURL || post?.releaseUrl) return 'published'
  if (['failed', 'error', 'rejected', 'failure'].includes(value)) return 'failed'
  if (['canceled', 'cancelled'].includes(value)) return 'canceled'
  if (['draft', 'idea'].includes(value)) return 'draft'
  if (['scheduled', 'schedule'].includes(value)) return 'scheduled'
  if (post?.publishDate && new Date(post.publishDate).getTime() > Date.now()) return 'scheduled'
  return 'syncing'
}

export async function listPostizPosts({ apiToken, apiBaseUrl, startDate, endDate, fetchImpl } = {}) {
  const start = new Date(startDate || Date.now() - 180 * 86400000)
  const end = new Date(endDate || Date.now() + 365 * 86400000)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw Object.assign(new Error('Rango de fechas inválido.'), { status: 400, code: 'postiz_date_range_invalid' })
  const response = await request('/posts', { apiToken, apiBaseUrl, fetchImpl, query: { startDate: start.toISOString(), endDate: end.toISOString() } })
  if (Array.isArray(response)) return response
  if (Array.isArray(response?.posts)) return response.posts
  if (Array.isArray(response?.data)) return response.data
  return []
}

export async function syncPostizPost({ apiToken, apiBaseUrl, providerPostId, fetchImpl } = {}) {
  const postId = clean(providerPostId, 300)
  if (!postId) throw Object.assign(new Error('providerPostId es obligatorio.'), { status: 400, code: 'postiz_post_required' })
  const posts = await listPostizPosts({ apiToken, apiBaseUrl, fetchImpl })
  const match = posts.find((post) => String(post?.id || post?.postId || '') === postId)
  return match ? { ...match, postId: postId } : { id: postId, postId, status: 'syncing' }
}

export const POSTIZ_API_ORIGIN = DEFAULT_API_ORIGIN
