/**
 * Sync. Posts published del CMS → archivo JS del frontend.
 * El CMS sirve este archivo en /runtime/v1/sync-blog-cms.mjs.
 * Las landings lo bajan con scripts/escarlet-blog.mjs. No lo copies a mano.
 *
 * Env.
 *   BLOG_CMS_URL   https://blog-cms.escarlet.cc
 *   BLOG_CMS_SITE  handle del site (ej. escarlet, mares24)
 *   BLOG_SITE_URL  https://tu-dominio.com
 *   BLOG_ENABLED   false fuerza apagado local. El interruptor del CMS manda en producción.
 *   BLOG_OUT_FILE  ruta relativa al root (default src/data/blog.generated.js)
 *   BLOG_FALLBACK  ruta relativa opcional a un módulo fallback
 *
 * Este archivo vive en .escarlet-blog-runtime/ o en scripts/.
 * El root del proyecto es siempre el directorio padre.
 */
import { writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const CMS_URL = (process.env.BLOG_CMS_URL || '').replace(/\/$/, '')
const CMS_SITE = process.env.BLOG_CMS_SITE || 'escarlet'
const SITE = process.env.BLOG_SITE_URL || 'https://example.com'
const OUT_REL = process.env.BLOG_OUT_FILE || 'src/data/blog.generated.js'
const FALLBACK_REL = process.env.BLOG_FALLBACK || 'src/data/blog-articles.fallback.js'
const outFile = join(root, OUT_REL)
const fallbackFile = join(root, FALLBACK_REL)

function isBlogEnabled(raw = process.env.BLOG_ENABLED) {
  if (raw == null || String(raw).trim() === '') return true
  return !['0', 'false', 'no', 'off', 'disabled'].includes(String(raw).trim().toLowerCase())
}

function ensureOutDir() {
  mkdirSync(dirname(outFile), { recursive: true })
}

function defaultChannels() {
  return {
    substack: true,
    linkedin: true,
    x: true,
    videoScript: true,
    instagramCarousel: true
  }
}

function emptyModule(reason, channels = defaultChannels()) {
  ensureOutDir()
  writeFileSync(
    outFile,
    `/** Generado por sync-blog-cms.mjs (${reason}). Sin posts. */
export function getAllBlogPosts() { return [] }
export function getPostBySlug() { return null }
export function getBlogIndex() { return [] }
export function getBlogPagination() {
  return { posts: [], page: 1, totalPages: 1, totalPosts: 0, perPage: 10 }
}
export function getBlogPagePath(page) {
  const n = Math.max(1, Number.parseInt(String(page), 10) || 1)
  return n <= 1 ? '/blog' : '/blog/page/' + n
}
export function getPostCanonicalUrl(slug) { return \`${SITE}/blog/\${slug}\` }
export function getRelatedSlugsMap() { return {} }
export const BLOG_POSTS_PER_PAGE = 10
export const BLOG_ENABLED = false
export const BLOG_SITE_URL = ${JSON.stringify(SITE)}
export const SOCIAL_PACK_CHANNELS = ${JSON.stringify(channels)}
`
  )
  console.log(`[sync-blog-cms] Vacío (${reason}) → ${OUT_REL}`)
}

function useFallback(reason) {
  if (!existsSync(fallbackFile)) {
    emptyModule(reason)
    return
  }
  ensureOutDir()
  copyFileSync(fallbackFile, outFile)
  console.log(`[sync-blog-cms] Fallback (${reason}) → ${OUT_REL}`)
}

function normalizeCmsImageUrl(imageUrl) {
  const raw = String(imageUrl || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('/media/') && CMS_URL) return `${CMS_URL}${raw}`
  return raw
}

function normalizeSocialPack(socialPack) {
  if (!socialPack || typeof socialPack !== 'object') return null
  const slides = Array.isArray(socialPack.instagramSlides)
    ? socialPack.instagramSlides.map((slide) => ({
        ...slide,
        imageUrl: normalizeCmsImageUrl(slide?.imageUrl)
      }))
    : socialPack.instagramSlides
  return {
    ...socialPack,
    instagramSlides: slides
  }
}

async function loadFallbackPosts() {
  if (!existsSync(fallbackFile)) return []
  try {
    const mod = await import(pathToFileURL(fallbackFile).href)
    if (typeof mod.getAllBlogPosts === 'function') return mod.getAllBlogPosts() || []
  } catch {
    /* fallback opcional */
  }
  return []
}

async function loadRelatedMap() {
  if (!existsSync(fallbackFile)) return {}
  try {
    const mod = await import(pathToFileURL(fallbackFile).href)
    if (typeof mod.getRelatedSlugsMap === 'function') return mod.getRelatedSlugsMap() || {}
  } catch {
    /* mapa opcional */
  }
  return {}
}

async function mergePosts(cmsPosts) {
  const relatedMap = await loadRelatedMap()
  const bySlug = new Map()
  for (const post of await loadFallbackPosts()) {
    if (!post?.slug) continue
    bySlug.set(post.slug, {
      ...post,
      relatedSlugs: relatedMap[post.slug] || post.relatedSlugs || []
    })
  }
  let cmsCount = 0
  for (const post of cmsPosts) {
    if (!post?.slug) continue
    cmsCount += 1
    bySlug.set(post.slug, {
      ...post,
      imageUrl: normalizeCmsImageUrl(post.imageUrl),
      socialPack: normalizeSocialPack(post.socialPack) || post.socialPack || null,
      relatedSlugs: Array.isArray(post.relatedSlugs) ? post.relatedSlugs : relatedMap[post.slug] || []
    })
  }
  const merged = [...bySlug.values()].sort((a, b) =>
    String(b.datePublished || '').localeCompare(String(a.datePublished || ''))
  )
  return { merged, cmsCount }
}

function formatPost(post) {
  const lines = [
    '  {',
    `    slug: ${JSON.stringify(post.slug)},`,
    `    title: ${JSON.stringify(post.title)},`,
    `    metaTitle: ${JSON.stringify(post.metaTitle || { es: post.title })},`,
    `    metaDescription: ${JSON.stringify(post.metaDescription || { es: post.excerptEs || post.title })},`,
    `    datePublished: ${JSON.stringify(post.datePublished)},`,
    `    dateModified: ${JSON.stringify(post.dateModified || post.datePublished)},`,
    `    imageUrl: ${JSON.stringify(post.imageUrl || '')},`,
    `    imageAlt: ${JSON.stringify(post.imageAlt || post.title)},`
  ]
  if (post.imagePosition) lines.push(`    imagePosition: ${JSON.stringify(post.imagePosition)},`)
  if (post.substackUrl) lines.push(`    substackUrl: ${JSON.stringify(post.substackUrl)},`)
  lines.push(
    `    authorName: ${JSON.stringify(post.authorName || '')},`,
    `    excerptEs: ${JSON.stringify(post.excerptEs || '')},`
  )
  if (post.socialPack) {
    lines.push(`    socialPack: ${JSON.stringify(post.socialPack)},`)
  }
  lines.push(`    relatedSlugs: ${JSON.stringify(post.relatedSlugs || [])},`)
  lines.push(`    bodyHtml: ${JSON.stringify(post.bodyHtml || '')}`, '  }')
  return lines.join('\n')
}

function buildRelatedMap(posts) {
  const entries = posts
    .filter((p) => Array.isArray(p.relatedSlugs) && p.relatedSlugs.length)
    .map((p) => `  ${JSON.stringify(p.slug)}: ${JSON.stringify(p.relatedSlugs)}`)
  return entries.join(',\n')
}

function buildModule(posts, sourceLabel, channels = defaultChannels()) {
  const postBlocks = posts.map(formatPost).join(',\n')
  const relatedBlock = buildRelatedMap(posts)
  return `/**
 * Generado por sync-blog-cms.mjs — no editar a mano.
 * Fuente: ${sourceLabel}
 */
const SITE = ${JSON.stringify(SITE)}

const posts = [
${postBlocks}
]

const bySlug = new Map(posts.map((p) => [p.slug, p]))

const relatedPostSlugs = {
${relatedBlock}
}

function withRelatedLinks(post) {
  const related = relatedPostSlugs[post.slug]
  if (!related?.length) return post

  const links = related
    .map((slug) => bySlug.get(slug))
    .filter(Boolean)
    .map((p) => \`<li><a href="/blog/\${p.slug}">\${p.title}</a></li>\`)
    .join('')

  if (!links) return post

  return {
    ...post,
    bodyHtml: \`\${post.bodyHtml}
<h2>Lecturas relacionadas</h2>
<ul>\${links}</ul>\`
  }
}

export function getPostBySlug(slug) {
  if (!slug) return null
  const key = String(slug).replace(/\\/$/, '')
  const post = bySlug.get(key)
  if (!post) return null
  return withRelatedLinks(post)
}

export function getAllBlogPosts() {
  return [...posts].sort((a, b) =>
    String(b.datePublished).localeCompare(String(a.datePublished))
  )
}

export const BLOG_POSTS_PER_PAGE = 10

export function getBlogIndex() {
  return getAllBlogPosts().map((p) => ({
    slug: p.slug,
    title: p.title,
    excerpt: p.excerptEs,
    datePublished: p.datePublished,
    dateModified: p.dateModified,
    authorName: p.authorName,
    imageUrl: p.imageUrl,
    imageAlt: p.imageAlt,
    imagePosition: p.imagePosition,
    substackUrl: p.substackUrl
  }))
}

export function getBlogPagePath(page) {
  const n = Math.max(1, Number.parseInt(String(page), 10) || 1)
  return n <= 1 ? '/blog' : \`/blog/page/\${n}\`
}

export function getBlogPagination(page = 1) {
  const all = getBlogIndex()
  const totalPosts = all.length
  const totalPages = Math.max(1, Math.ceil(totalPosts / BLOG_POSTS_PER_PAGE))
  const requested = Math.max(1, Number.parseInt(String(page), 10) || 1)
  const safePage = Math.min(requested, totalPages)
  const start = (safePage - 1) * BLOG_POSTS_PER_PAGE

  return {
    posts: all.slice(start, start + BLOG_POSTS_PER_PAGE),
    page: safePage,
    totalPages,
    totalPosts,
    perPage: BLOG_POSTS_PER_PAGE
  }
}

export function getPostCanonicalUrl(slug) {
  return \`\${SITE}/blog/\${slug}\`
}

export function getRelatedSlugsMap() {
  return { ...relatedPostSlugs }
}

export { SITE as BLOG_SITE_URL }
export const BLOG_ENABLED = true
export const SOCIAL_PACK_CHANNELS = ${JSON.stringify(channels)}
`
}

async function fetchPublishedPosts() {
  const url = `${CMS_URL}/api/sites/${CMS_SITE}/posts`
  let lastError = null
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20000)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return {
        posts: data.posts || [],
        channels: data.socialPackChannels || null,
        blogEnabled: data.blogEnabled !== false
      }
    } catch (error) {
      lastError = error
      console.warn(`[sync-blog-cms] Intento ${attempt}/4 falló: ${error.message}`)
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
    }
  }
  throw lastError
}

async function main() {
  if (!isBlogEnabled()) {
    emptyModule('BLOG_ENABLED=false local')
    console.log('[sync-blog-cms] omitido (BLOG_ENABLED=false)')
    return
  }
  if (!CMS_URL) {
    useFallback('BLOG_CMS_URL no definido')
    return
  }

  try {
    const { posts: cmsPosts, channels: fetchedChannels, blogEnabled } = await fetchPublishedPosts()
    const channels = fetchedChannels || defaultChannels()
    if (blogEnabled === false) {
      emptyModule('blog apagado en el CMS', channels)
      console.log('[sync-blog-cms] blog apagado en el CMS. La web pública no publicará /blog.')
      return
    }
    const { merged, cmsCount } = await mergePosts(cmsPosts)
    if (!merged.length) {
      useFallback('CMS y fallback sin posts')
      return
    }
    ensureOutDir()
    writeFileSync(
      outFile,
      buildModule(
        merged,
        `${CMS_URL}/api/sites/${CMS_SITE}/posts (${cmsCount} CMS, ${merged.length} total)`,
        channels
      )
    )
    console.log(`[sync-blog-cms] ${cmsCount} CMS → ${merged.length} posts → ${OUT_REL}`)
    console.log(`[sync-blog-cms] CMS slugs: ${cmsPosts.map((p) => p.slug).filter(Boolean).join(', ')}`)
    console.log(
      `[sync-blog-cms] canales pack: ${Object.entries(channels)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ')}`
    )
  } catch (error) {
    console.error(`[sync-blog-cms] CMS no disponible. El build se detiene. ${error.message}`)
    process.exit(1)
  }
}

main()
