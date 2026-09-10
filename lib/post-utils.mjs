const RESERVED_SLUGS = new Set(['blog', 'page', 'admin', 'new', 'index'])

export function todayIso() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Normaliza a YYYY-MM-DD o lanza si la fecha no es válida. */
export function parsePublishAt(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const day = raw.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error('publishAt debe ser YYYY-MM-DD.')
  }
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    throw new Error(`publishAt inválido: ${day}`)
  }
  return day
}

export function isFuturePublishAt(publishAt, today = todayIso()) {
  const day = parsePublishAt(publishAt)
  return Boolean(day && day > today)
}

export const SCHEDULE_STATUSES = ['pending_schedule', 'scheduled']
export const CALENDAR_STATUSES = ['pending_schedule', 'scheduled', 'published']
/** Post lifecycle statuses including agency feedback. */
export const POST_STATUSES = [
  'draft',
  'review',
  'changes_requested',
  'pending_schedule',
  'scheduled',
  'published'
]

export const CONTENT_SOURCES = ['agency', 'client']

export function normalizeContentSource(value, fallback = 'agency') {
  const raw = String(value || '').trim().toLowerCase()
  if (CONTENT_SOURCES.includes(raw)) return raw
  return fallback
}

export function toSlug(text) {
  return String(text)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function normalizeAuthor(value, allowed = ['Charly', 'Silvia']) {
  const key = String(value || 'Silvia').trim().toLowerCase()
  if (['silvia', 'silvia molina'].includes(key)) return 'Silvia'
  if (['charly', 'carlos', 'brugiafredo'].includes(key)) return 'Charly'
  if (allowed.includes(value)) return value
  throw new Error(`Autor inválido. Usa ${allowed.join(' o ')}.`)
}

export function pickRelated(slugs, nextSlug, count = 3) {
  return slugs.filter((slug) => slug !== nextSlug).slice(0, count)
}

export function validateSlug(slug) {
  if (!slug) throw new Error('Slug vacío.')
  if (RESERVED_SLUGS.has(slug)) throw new Error(`Slug reservado: ${slug}`)
}

export function buildDraftPost({ site, slug, title, author, date, domain, relatedSlugs = [], contentSource = 'agency', ownerId = '', assistantConversationId = '' }) {
  return {
    slug,
    site,
    ...(ownerId ? { ownerId } : {}),
    ...(assistantConversationId ? { assistantConversationId } : {}),
    status: 'draft',
    contentSource: normalizeContentSource(contentSource),
    title,
    metaTitle: { es: `${title} | Escarlet`, en: `${title} | Escarlet` },
    metaDescription: {
      es: 'Escribe aquí la meta description en español. Hasta 155 caracteres. Una idea.',
      en: 'Write the English meta description here. Keep it under 155 characters.'
    },
    datePublished: date,
    dateModified: date,
    imageUrl: '',
    imageAlt: '',
    substackUrl: 'https://brugiafredo.substack.com',
    authorName: author,
    excerptEs: 'Escribe aquí el lead del listado. Una frase. Directa.',
    relatedSlugs,
    // Social copy is generated only in the final publishing flow. Keeping it
    // empty here prevents draft rows from exposing a misleading Social Pack
    // action before the server has actually generated it.
    socialPack: null,
    bodyHtml: `<p>Escribe aquí la apertura. Una idea por párrafo.</p>
<h2>Desarrolla la idea</h2>
<p>Sustituye este bloque por el cuerpo del artículo.</p>
<h2>Cierra con esto</h2>
<p>Deja una salida clara. Qué puede hacer la persona ahora.</p>`
  }
}

export function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function countWords(html) {
  const text = stripHtml(html)
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}
