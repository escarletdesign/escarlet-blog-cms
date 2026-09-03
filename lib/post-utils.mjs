const RESERVED_SLUGS = new Set(['blog', 'page', 'admin', 'new', 'index'])

export function todayIso() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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

export function buildDraftPost({ site, slug, title, author, date, domain, relatedSlugs = [] }) {
  const canonical = `${domain.replace(/\/$/, '')}/blog/${slug}`
  return {
    slug,
    site,
    status: 'draft',
    title,
    metaTitle: { es: `${title} | Escarlet`, en: `${title} | Escarlet` },
    metaDescription: {
      es: 'Escribe aquí la meta description en español. Hasta 155 caracteres. Una idea.',
      en: 'Write the English meta description here. Keep it under 155 characters.'
    },
    datePublished: date,
    dateModified: date,
    imageUrl: `/images/blog/${slug}.webp`,
    imageAlt: 'Describe lo que se ve en la foto. Palabra clave si encaja.',
    substackUrl: 'https://brugiafredo.substack.com',
    authorName: author,
    excerptEs: 'Escribe aquí el lead del listado. Una frase. Directa.',
    relatedSlugs,
    socialPack: {
      substackTitle: title,
      substackBody: `Escribe aquí el resumen para Substack. Cuatro a ocho párrafos cortos. Distinto del artículo.

Cierra con el enlace.

${canonical}`,
      linkedin: `Escribe aquí el post de LinkedIn.

Frases cortas.

${canonical}`,
      x: `Escribe aquí el tuit. Gancho, idea y enlace.

${canonical}`,
      videoScript: '',
      instagramCaption: `Escribe aquí el caption de Instagram.

${canonical}`,
      instagramSlides: []
    },
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
