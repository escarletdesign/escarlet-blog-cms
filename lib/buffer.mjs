const DEFAULT_API_ORIGIN = 'https://api.buffer.com'

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max)
}

function bufferError(status, message = 'Buffer rechazó la solicitud.', code = 'buffer_request_failed') {
  const error = new Error(message)
  error.status = Number(status) || 502
  error.code = error.status === 401
    ? 'buffer_unauthorized'
    : error.status === 403
      ? 'buffer_forbidden'
      : error.status === 429
        ? 'buffer_rate_limited'
        : code
  return error
}

function apiOrigin(apiBaseUrl = DEFAULT_API_ORIGIN) {
  const value = clean(apiBaseUrl, 500) || DEFAULT_API_ORIGIN
  let parsed
  try { parsed = new URL(value) } catch { throw Object.assign(new Error('La URL de API de Buffer no es válida.'), { status: 400, code: 'buffer_invalid_api_url' }) }
  if (!['https:', 'http:'].includes(parsed.protocol) || (parsed.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw Object.assign(new Error('La URL de API de Buffer debe usar HTTPS.'), { status: 400, code: 'buffer_invalid_api_url' })
  }
  return parsed.toString().replace(/\/$/, '')
}

async function request({ apiToken, apiBaseUrl, query, variables = {}, fetchImpl = globalThis.fetch, idempotencyKey } = {}) {
  if (typeof fetchImpl !== 'function') throw Object.assign(new Error('fetch no está disponible.'), { status: 503, code: 'fetch_unavailable' })
  const token = clean(apiToken, 4096)
  if (!token) throw bufferError(401, 'Falta la API key de Buffer.', 'buffer_credential_missing')
  const response = await fetchImpl(apiOrigin(apiBaseUrl), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(idempotencyKey ? { 'Idempotency-Key': clean(idempotencyKey, 300) } : {})
    },
    body: JSON.stringify({ query, variables })
  })
  let payload = null
  try { payload = await response.json() } catch { payload = null }
  if (!response?.ok) {
    const message = payload?.errors?.[0]?.message || payload?.message || 'Buffer rechazó la solicitud.'
    throw bufferError(response?.status, message)
  }
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    const first = payload.errors[0]
    throw bufferError(response?.status || 502, first?.message || 'Buffer devolvió un error GraphQL.', first?.extensions?.code || 'buffer_graphql_error')
  }
  return payload?.data || {}
}

const ORGANIZATIONS_QUERY = `query BufferOrganizations {
  account { organizations { id name channelCount } }
}`

const CHANNELS_QUERY = `query BufferChannels($organizationId: OrganizationId!) {
  channels(input: { organizationId: $organizationId }) {
    id descriptor displayName name service externalLink organizationId isDisconnected isLocked
  }
}`

const POST_QUERY = `query BufferPost($postId: PostId!) {
  post(input: { id: $postId }) {
    id status dueAt channelId text sentAt shareMode schedulingType
  }
}`

const CREATE_POST_MUTATION = `mutation BufferCreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id status dueAt channelId text sentAt shareMode schedulingType } }
    ... on MutationError { message }
  }
}`

export async function listBufferOrganizations({ apiToken, apiBaseUrl, fetchImpl } = {}) {
  const data = await request({ apiToken, apiBaseUrl, fetchImpl, query: ORGANIZATIONS_QUERY })
  return Array.isArray(data?.account?.organizations) ? data.account.organizations : []
}

export async function listBufferChannels({ apiToken, apiBaseUrl, organizationId, fetchImpl } = {}) {
  const org = clean(organizationId, 300)
  if (!org) throw Object.assign(new Error('Buffer requiere organizationId.'), { status: 400, code: 'buffer_organization_required' })
  const data = await request({ apiToken, apiBaseUrl, fetchImpl, query: CHANNELS_QUERY, variables: { organizationId: org } })
  return Array.isArray(data?.channels) ? data.channels : []
}

export async function testBufferConnection({ apiToken, apiBaseUrl, organizationId, channelId, fetchImpl } = {}) {
  try {
    const organizations = await listBufferOrganizations({ apiToken, apiBaseUrl, fetchImpl })
    const requestedOrganization = clean(organizationId, 300)
    const organization = requestedOrganization
      ? organizations.find((entry) => String(entry?.id || '') === requestedOrganization)
      : organizations[0]
    if (requestedOrganization && !organization) return { ok: false, status: 404, code: 'buffer_organization_not_found' }
    const channels = organization ? await listBufferChannels({ apiToken, apiBaseUrl, organizationId: organization.id, fetchImpl }) : []
    const requestedChannel = clean(channelId, 300)
    const channel = requestedChannel ? channels.find((entry) => String(entry?.id || '') === requestedChannel) : null
    if (requestedChannel && !channel) return { ok: false, status: 404, code: 'buffer_channel_not_found' }
    return {
      ok: true,
      provider: 'buffer',
      organizationId: organization?.id || requestedOrganization || null,
      organizationName: organization?.name || null,
      channelId: channel?.id || requestedChannel || null,
      channelName: channel?.displayName || channel?.name || channel?.descriptor || null,
      channels: channels.length
    }
  } catch (error) {
    return { ok: false, status: error.status || 502, code: error.code || 'buffer_request_failed', message: error.message }
  }
}

function publicUrl(value) {
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol) || ['localhost', '127.0.0.1'].includes(parsed.hostname)) return null
    return parsed.toString()
  } catch { return null }
}

function normalizeAssets(media = []) {
  return (Array.isArray(media) ? media : []).slice(0, 20).map((asset) => {
    const url = publicUrl(typeof asset === 'string' ? asset : asset?.url)
    if (!url) return null
    const metadata = asset && typeof asset === 'object' && asset.metadata && typeof asset.metadata === 'object' ? asset.metadata : {}
    const mimeType = String(asset?.mimeType || metadata.mimeType || metadata.mime_type || '').toLowerCase()
    const type = mimeType.startsWith('video/') ? 'video' : 'image'
    return type === 'video' ? { video: { url } } : { image: { url } }
  }).filter(Boolean)
}

export async function scheduleBufferPost({ apiToken, apiBaseUrl, organizationId, channelId, publicationDate, text = '', media = [], idempotencyKey, fetchImpl, postType = 'schedule', service = '', linkUrl = '' } = {}) {
  const channel = clean(channelId, 300)
  if (!channel) throw Object.assign(new Error('Buffer requiere channelId.'), { status: 400, code: 'buffer_channel_required' })
  const date = publicationDate ? new Date(publicationDate) : null
  if (publicationDate && !Number.isFinite(date?.getTime())) throw Object.assign(new Error('publicationDate inválida.'), { status: 400, code: 'publication_date_invalid' })
  const draft = String(postType || '').toLowerCase() === 'draft'
  const story = String(service || '').toLowerCase() === 'instagram_story'
  const storyLink = story ? publicUrl(linkUrl) : null
  const assets = normalizeAssets(media)
  if (story && !storyLink) throw Object.assign(new Error('Instagram Story requiere la URL pública del artículo.'), { status: 400, code: 'buffer_story_link_required' })
  const input = {
    channelId: channel,
    text: clean(text, 30_000),
    assets,
    mode: date && !draft ? 'customScheduled' : 'addToQueue',
    schedulingType: story ? 'notification' : 'automatic',
    needsApproval: false,
    ...(story
      ? { metadata: { instagram: { type: 'story', shouldShareToFeed: false, stickerFields: { other: `Añade el sticker de enlace en Instagram: ${storyLink}` } } } }
      : String(service).toLowerCase() === 'instagram'
        ? { metadata: { instagram: { type: 'post', shouldShareToFeed: true } } }
        : {}),
    ...(date && !draft ? { dueAt: date.toISOString() } : {}),
    ...(draft ? { saveToDraft: true } : {})
  }
  const data = await request({ apiToken, apiBaseUrl, fetchImpl, idempotencyKey, query: CREATE_POST_MUTATION, variables: { input } })
  const result = data?.createPost || data
  if (result?.message && !result?.post && !result?.id) throw bufferError(422, result.message, 'buffer_mutation_error')
  return result
}

export async function syncBufferPost({ apiToken, apiBaseUrl, providerPostId, fetchImpl } = {}) {
  const postId = clean(providerPostId, 300)
  if (!postId) throw Object.assign(new Error('providerPostId es obligatorio.'), { status: 400, code: 'buffer_post_required' })
  const data = await request({ apiToken, apiBaseUrl, fetchImpl, query: POST_QUERY, variables: { postId } })
  return data?.post || { id: postId, status: 'scheduled' }
}

export function bufferPostId(response = {}) {
  const post = response?.post || response?.data?.post || response?.createPost?.post || response?.data?.createPost?.post || response
  return clean(post?.id || response?.createPost?.id || response?.data?.createPost?.id || response?.id || response?.postId, 300) || null
}

export function bufferStatus(response = {}) {
  const post = response?.post || response?.data?.post || response?.createPost?.post || response?.data?.createPost?.post || response
  const value = clean(post?.status || response?.createPost?.status || response?.data?.createPost?.status || response?.status, 80).toLowerCase()
  if (['sent', 'published'].includes(value)) return 'published'
  if (['error', 'failed', 'rejected'].includes(value)) return 'failed'
  if (['draft'].includes(value)) return 'draft'
  if (['scheduled', 'sending', 'buffer'].includes(value)) return 'scheduled'
  return 'syncing'
}

export const BUFFER_API_ORIGIN = DEFAULT_API_ORIGIN
