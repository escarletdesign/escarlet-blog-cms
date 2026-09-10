/** Durable, site-scoped assistant conversations for the PWA. */

const MAX_THREADS_PER_OWNER = 50
const MAX_MESSAGES_PER_THREAD = 100
const MAX_TEXT_CHARS = 12_000
const MAX_TITLE_CHARS = 120

function text(value, max = MAX_TEXT_CHARS) {
  return String(value ?? '').trim().slice(0, max)
}

function safeSite(site) {
  const value = text(site, 64)
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)) throw Object.assign(new Error('Identificador de sitio inválido'), { status: 400 })
  return value
}

function safeId(id) {
  const value = text(id, 128)
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(value)) throw Object.assign(new Error('Identificador de conversación inválido'), { status: 400 })
  return value
}

export function conversationOwner(auth) {
  const userId = text(auth?.userId, 160)
  if (userId) return `user:${userId}`
  return `role:${text(auth?.role, 40) || 'unknown'}`
}

function normalizeMessage(message) {
  const role = message?.role === 'user' ? 'user' : 'assistant'
  const content = text(message?.text ?? message?.content)
  return content ? { role, text: content } : null
}

function normalizeConversation(input, { site, ownerId } = {}) {
  const messages = Array.isArray(input?.messages)
    ? input.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES_PER_THREAD)
    : []
  const firstUser = messages.find((message) => message.role === 'user')?.text || ''
  return {
    id: safeId(input?.id),
    site: safeSite(site || input?.site),
    ownerId: text(ownerId, 180),
    title: text(input?.title || firstUser || 'Nueva conversación', MAX_TITLE_CHARS),
    messages,
    updatedAt: text(input?.updatedAt, 40) || new Date().toISOString(),
    ...(input?.archivedAt ? { archivedAt: text(input.archivedAt, 40) } : {}),
    ...(input?.publishedSlug ? { publishedSlug: text(input.publishedSlug, 128) } : {})
  }
}

function records(db) {
  if (!db.aiConversations || typeof db.aiConversations !== 'object' || Array.isArray(db.aiConversations)) db.aiConversations = {}
  return db.aiConversations
}

function key(site, ownerId, id) {
  return `${safeSite(site)}:${text(ownerId, 180)}:${safeId(id)}`
}

export function publicConversation(conversation, { includeMessages = true } = {}) {
  if (!conversation) return null
  return {
    id: conversation.id,
    site: conversation.site,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    messageCount: Array.isArray(conversation.messages) ? conversation.messages.length : 0,
    ...(conversation.archivedAt ? { archivedAt: conversation.archivedAt } : {}),
    ...(conversation.publishedSlug ? { publishedSlug: conversation.publishedSlug } : {}),
    ...(includeMessages ? { messages: conversation.messages || [] } : {})
  }
}

export function listConversations({ db, site, ownerId } = {}) {
  const handle = safeSite(site)
  const owner = text(ownerId, 180)
  return Object.values(records(db))
    .filter((conversation) => conversation?.site === handle && conversation?.ownerId === owner && !conversation?.archivedAt)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, MAX_THREADS_PER_OWNER)
    .map((conversation) => publicConversation(conversation, { includeMessages: false }))
}

export function getConversation({ db, site, ownerId, id } = {}) {
  const conversation = records(db)[key(site, ownerId, id)]
  if (!conversation || conversation.site !== safeSite(site) || conversation.ownerId !== text(ownerId, 180)) return null
  return publicConversation(conversation)
}

export function saveConversation({ db, site, ownerId, conversation } = {}) {
  if (!db || typeof db !== 'object') throw new TypeError('db is required')
  const owner = text(ownerId, 180)
  if (!owner) throw Object.assign(new Error('Propietario de conversación requerido'), { status: 400 })
  const normalized = normalizeConversation(conversation, { site, ownerId: owner })
  const store = records(db)
  const conversationKey = key(normalized.site, owner, normalized.id)
  store[conversationKey] = { ...normalized, ownerId: owner, updatedAt: new Date().toISOString() }

  const ownerRows = Object.entries(store)
    .filter(([, row]) => row?.site === normalized.site && row?.ownerId === owner)
    .sort(([, a], [, b]) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  for (const [staleKey] of ownerRows.slice(MAX_THREADS_PER_OWNER)) delete store[staleKey]
  return publicConversation(store[conversationKey])
}

export function deleteConversation({ db, site, ownerId, id } = {}) {
  const store = records(db)
  const conversationKey = key(site, ownerId, id)
  const conversation = store[conversationKey]
  if (!conversation || conversation.site !== safeSite(site) || conversation.ownerId !== text(ownerId, 180)) return false
  delete store[conversationKey]
  return true
}

/** Hide a conversation from recent history after its assistant flow produced a live post. */
export function archiveConversation({ db, site, ownerId, id, publishedSlug } = {}) {
  const store = records(db)
  const conversationKey = key(site, ownerId, id)
  const conversation = store[conversationKey]
  if (!conversation || conversation.site !== safeSite(site) || conversation.ownerId !== text(ownerId, 180)) return false
  conversation.archivedAt = new Date().toISOString()
  conversation.publishedSlug = text(publishedSlug, 128) || conversation.publishedSlug || ''
  conversation.updatedAt = conversation.archivedAt
  store[conversationKey] = conversation
  return true
}
