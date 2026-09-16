const API_ORIGIN = 'https://app.metricool.com/api'

function clean(value, max = 500) { return String(value ?? '').trim().slice(0, max) }
function metricoolError(status, message = 'Metricool rechazó la solicitud.') {
  const error = new Error(message)
  error.status = Number(status) || 502
  error.code = error.status === 401 ? 'metricool_unauthorized' : error.status === 403 ? 'metricool_forbidden' : error.status === 429 ? 'metricool_rate_limited' : 'metricool_request_failed'
  return error
}
function providerForChannel(channel) {
  return ({ instagram: 'instagram', linkedin: 'linkedin', x: 'twitter', video: 'youtube', substack: 'linkedin', blog: 'blog' })[channel] || channel
}
function assertPublicUrl(url) {
  let parsed
  try { parsed = new URL(url) } catch { throw Object.assign(new Error('La media de Metricool debe tener una URL pública.'), { status: 400 }) }
  if (!['http:', 'https:'].includes(parsed.protocol) || ['localhost', '127.0.0.1'].includes(parsed.hostname)) throw Object.assign(new Error('La media de Metricool debe tener una URL pública.'), { status: 400 })
  return parsed.toString()
}

async function request(path, { userToken, userId, blogId, idempotencyKey, fetchImpl = globalThis.fetch, method = 'GET', body } = {}) {
  if (typeof fetchImpl !== 'function') throw Object.assign(new Error('fetch no está disponible.'), { status: 503 })
  if (!clean(userToken, 4096)) throw metricoolError(401, 'Falta la credencial de Metricool.')
  const url = new URL(`${API_ORIGIN}${path}`)
  if (userId) url.searchParams.set('userId', clean(userId, 120))
  if (blogId) url.searchParams.set('blogId', clean(blogId, 120))
  const response = await fetchImpl(url, {
    method,
    headers: { 'X-Mc-Auth': clean(userToken, 4096), ...(idempotencyKey ? { 'Idempotency-Key': clean(idempotencyKey, 300) } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!response?.ok) throw metricoolError(response?.status)
  let payload = null
  try { payload = await response.json() } catch { payload = {} }
  return payload
}

export function metricoolProviderForChannel(channel) { return providerForChannel(clean(channel, 50).toLowerCase()) }

export async function normalizeMetricoolMedia(url, credentials = {}) {
  const publicUrl = assertPublicUrl(url)
  return request(`/actions/normalize/image/url?url=${encodeURIComponent(publicUrl)}`, credentials)
}

export async function scheduleMetricoolPost({ userToken, userId, blogId, publicationDate, timezone = 'UTC', text, channel, media = [], autoPublish = false, draft = true, saveExternalMediaFiles = true, idempotencyKey, fetchImpl } = {}) {
  const date = new Date(publicationDate)
  if (!Number.isFinite(date.getTime())) throw Object.assign(new Error('publicationDate inválida.'), { status: 400 })
  const providers = [metricoolProviderForChannel(channel)].filter((provider) => provider !== 'blog')
  if (!providers.length) throw Object.assign(new Error('El canal blog no se publica mediante Metricool.'), { status: 400 })
  const mediaIds = []
  for (const asset of Array.isArray(media) ? media : []) {
    if (asset?.mediaId) mediaIds.push(asset.mediaId)
    else if (asset?.url) {
      const normalized = await normalizeMetricoolMedia(asset.url, { userToken, userId, blogId, fetchImpl })
      const mediaId = normalized?.mediaId || normalized?.id || normalized?.data?.mediaId
      if (!mediaId) throw Object.assign(new Error('Metricool no devolvió mediaId.'), { status: 502 })
      mediaIds.push(mediaId)
    }
  }
  return request('/v2/scheduler/posts', {
    userToken, userId, blogId, idempotencyKey, fetchImpl, method: 'POST', body: {
      publicationDate: { dateTime: date.toISOString(), timezone: clean(timezone, 80) || 'UTC' },
      text: clean(text, 30_000), providers,
      ...(mediaIds.length ? { media: mediaIds.map((mediaId) => ({ mediaId })) } : {}),
      autoPublish: Boolean(autoPublish), draft: Boolean(draft), saveExternalMediaFiles: Boolean(saveExternalMediaFiles)
    }
  })
}

export async function testMetricoolConnection(credentials = {}) {
  try {
    await request('/v1/settings', credentials)
    return { ok: true }
  } catch (error) {
    return { ok: false, status: error.status || 502, code: error.code || 'metricool_request_failed' }
  }
}

export async function syncMetricoolPost({ providerPostId, ...credentials } = {}) {
  if (!providerPostId) throw Object.assign(new Error('providerPostId es obligatorio.'), { status: 400 })
  return request(`/v2/scheduler/posts/${encodeURIComponent(clean(providerPostId, 200))}`, credentials)
}
