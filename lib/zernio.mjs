import { privateAddress } from './remote-fetch.mjs'

const DEFAULT_API_ORIGIN = 'https://zernio.com/api/v1'

const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max)

function zernioError(status, message = 'Zernio rechazó la solicitud.', code = 'zernio_request_failed') {
  const error = new Error(message)
  error.status = Number(status) || 502
  error.code = error.status === 401 ? 'zernio_unauthorized' : error.status === 403 ? 'zernio_forbidden' : error.status === 429 ? 'zernio_rate_limited' : code
  return error
}

function apiOrigin(apiBaseUrl = DEFAULT_API_ORIGIN) {
  const value = clean(apiBaseUrl, 500) || DEFAULT_API_ORIGIN
  let parsed
  try { parsed = new URL(value) } catch { throw Object.assign(new Error('La URL de API de Zernio no es válida.'), { status: 400, code: 'zernio_invalid_api_url' }) }
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  const allowLocalhost = process.env.NODE_ENV !== 'production' && local
  if (!['https:', 'http:'].includes(parsed.protocol) || (parsed.protocol === 'http:' && !allowLocalhost) || (privateAddress(parsed.hostname) && !allowLocalhost)) {
    throw Object.assign(new Error('La URL de API de Zernio debe usar HTTPS.'), { status: 400, code: 'zernio_invalid_api_url' })
  }
  return parsed.toString().replace(/\/$/, '')
}

async function request({ apiToken, apiBaseUrl, path, method = 'GET', body, idempotencyKey, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw Object.assign(new Error('fetch no está disponible.'), { status: 503, code: 'fetch_unavailable' })
  const token = clean(apiToken, 4096)
  if (!token) throw zernioError(401, 'Falta la API key de Zernio.', 'zernio_credential_missing')
  const response = await fetchImpl(`${apiOrigin(apiBaseUrl)}${path.startsWith('/') ? path : `/${path}`}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`,
      ...(idempotencyKey ? { 'Idempotency-Key': clean(idempotencyKey, 300), 'X-Request-Id': clean(idempotencyKey, 300) } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(Math.max(1_000, Number(process.env.PROVIDER_TIMEOUT_MS) || 30_000))
  })
  let payload = null
  try { payload = await response.json() } catch { payload = null }
  if (!response?.ok) {
    const error = zernioError(response?.status, payload?.error || payload?.message || 'Zernio rechazó la solicitud.', payload?.code || 'zernio_request_failed')
    error.details = payload?.details || null
    throw error
  }
  return payload || {}
}

export function zernioPlatformForChannel(channel) {
  const value = clean(channel, 80).toLowerCase()
  if (['instagram_reel', 'instagram_story', 'instagram_post', 'instagram', 'video'].includes(value)) return 'instagram'
  if (['youtube_video', 'youtube_short', 'youtube', 'shorts', 'youtube_shorts'].includes(value)) return 'youtube'
  if (['tiktok_video', 'tiktok'].includes(value)) return 'tiktok'
  if (['linkedin_post', 'linkedin'].includes(value)) return 'linkedin'
  if (['x_post', 'x', 'twitter'].includes(value)) return 'twitter'
  return value
}

export async function listZernioAccounts({ apiToken, apiBaseUrl, fetchImpl } = {}) {
  const payload = await request({ apiToken, apiBaseUrl, path: '/accounts', fetchImpl })
  return Array.isArray(payload?.accounts) ? payload.accounts : []
}

export async function testZernioConnection({ apiToken, apiBaseUrl, accountId, platform, fetchImpl } = {}) {
  try {
    const accounts = await listZernioAccounts({ apiToken, apiBaseUrl, fetchImpl })
    const requestedId = clean(accountId, 300)
    const account = requestedId ? accounts.find((entry) => String(entry?._id || entry?.id || '') === requestedId) : null
    if (requestedId && !account) return { ok: false, status: 404, code: 'zernio_account_not_found', accounts: accounts.length }
    const expectedPlatform = clean(platform, 80).toLowerCase()
    if (expectedPlatform && account && zernioPlatformForChannel(account.platform) !== zernioPlatformForChannel(expectedPlatform)) {
      return { ok: false, status: 422, code: 'zernio_platform_mismatch', accounts: accounts.length }
    }
    return {
      ok: true,
      provider: 'zernio',
      accountId: account?._id || account?.id || requestedId || null,
      platform: account?.platform || expectedPlatform || null,
      username: account?.username || account?.name || null,
      accounts: accounts.length
    }
  } catch (error) {
    return { ok: false, status: error.status || 502, code: error.code || 'zernio_request_failed', message: error.message }
  }
}

function publicMediaUrl(value) {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || privateAddress(parsed.hostname)) return null
    return parsed.toString()
  } catch { return null }
}

function normalizeMedia(media = []) {
  return (Array.isArray(media) ? media : []).slice(0, 20).map((asset) => {
    const url = publicMediaUrl(typeof asset === 'string' ? asset : asset?.url)
    if (!url) return null
    const mimeType = String(asset?.mimeType || asset?.contentType || asset?.metadata?.mimeType || '').toLowerCase()
    return { type: mimeType.startsWith('video/') ? 'video' : 'image', url }
  }).filter(Boolean)
}

export async function scheduleZernioPost({ apiToken, apiBaseUrl, accountId, platform, publicationDate, timezone = 'UTC', text = '', media = [], idempotencyKey, fetchImpl, postType = 'schedule', channel = '', platformSettings = {} } = {}) {
  const targetAccount = clean(accountId, 300)
  if (!targetAccount) throw Object.assign(new Error('Zernio requiere accountId.'), { status: 400, code: 'zernio_account_required' })
  const targetPlatform = zernioPlatformForChannel(platform || channel)
  if (!targetPlatform) throw Object.assign(new Error('Zernio requiere platform.'), { status: 400, code: 'zernio_platform_required' })
  const assets = normalizeMedia(media)
  if (!assets.length) throw Object.assign(new Error('Zernio requiere al menos un media público.'), { status: 400, code: 'zernio_media_required' })
  const date = publicationDate ? new Date(publicationDate) : null
  if (publicationDate && !Number.isFinite(date?.getTime())) throw Object.assign(new Error('publicationDate inválida.'), { status: 400, code: 'publication_date_invalid' })
  const body = {
    content: clean(text, 100_000),
    mediaItems: assets,
    platforms: [{ platform: targetPlatform, accountId: targetAccount, ...(Object.keys(platformSettings || {}).length ? { platformSpecificData: platformSettings } : {}) }],
    ...(String(postType).toLowerCase() === 'draft' ? {} : date && date.getTime() > Date.now() ? { scheduledFor: date.toISOString(), timezone: clean(timezone, 120) || 'UTC' } : { publishNow: true }),
    ...(targetPlatform === 'tiktok' ? {
      tiktokSettings: {
        privacy_level: 'PUBLIC_TO_EVERYONE',
        allow_comment: true,
        allow_duet: true,
        allow_stitch: true,
        content_preview_confirmed: true,
        express_consent_given: true
      }
    } : {})
  }
  const payload = await request({ apiToken, apiBaseUrl, path: '/posts', method: 'POST', body, idempotencyKey, fetchImpl })
  return payload?.post ? payload : { ...payload, post: payload?.data?.post || payload?.data || payload?.post }
}

export async function syncZernioPost({ apiToken, apiBaseUrl, providerPostId, fetchImpl } = {}) {
  const postId = clean(providerPostId, 300)
  if (!postId) throw Object.assign(new Error('providerPostId es obligatorio.'), { status: 400, code: 'zernio_post_required' })
  return request({ apiToken, apiBaseUrl, path: `/posts/${encodeURIComponent(postId)}`, fetchImpl })
}

export function zernioPostId(response = {}) {
  const post = response?.post || response?.data?.post || response?.data || response
  return clean(post?._id || post?.id || response?.postId, 300) || null
}

export function zernioStatus(response = {}) {
  const post = response?.post || response?.data?.post || response?.data || response
  const value = clean(post?.status || response?.status, 80).toLowerCase()
  if (value === 'published') return 'published'
  if (['failed', 'error', 'rejected'].includes(value)) return 'failed'
  if (value === 'draft') return 'draft'
  if (['scheduled', 'publishing', 'partial'].includes(value)) return value === 'publishing' ? 'syncing' : 'scheduled'
  if (['canceled', 'cancelled'].includes(value)) return 'canceled'
  return 'syncing'
}

export const ZERNIO_API_ORIGIN = DEFAULT_API_ORIGIN
