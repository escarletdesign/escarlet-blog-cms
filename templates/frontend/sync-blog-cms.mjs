/**
 * Sync genérico. Posts published del CMS → archivo JS del frontend.
 *
 * Copia este archivo a scripts/sync-blog-cms.mjs de tu proyecto web.
 * Env.
 *   BLOG_CMS_URL   https://blog-cms.escarlet.cc
 *   BLOG_CMS_SITE  handle del site (ej. escarlet, mares24)
 *   BLOG_SITE_URL  https://tu-dominio.com
 *   BLOG_OUT_FILE  ruta relativa al root (default src/data/blog.generated.js)
 *   BLOG_FALLBACK  ruta relativa opcional a un módulo fallback
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

function ensureOutDir() {
  mkdirSync(dirname(outFile), { recursive: true })
}

function emptyModule(reason, channels = defaultChannels()) {
  ensureOutDir()
  writeFileSync(
    outFile,
    `/** Generado por sync-blog-cms.mjs (${reason}). Sin posts. */\nexport function getAllBlogPosts() { return [] }\nexport function getPostBySlug() { return null }\nexport function getBlogIndex() { return [] }\nexport function getPostCanonicalUrl(slug) { return \`${SITE}/blog/\${slug}\` }\nexport const BLOG_SITE_URL = ${JSON.stringify(SITE)}\nexport const SOCIAL_PACK_CHANNELS = ${JSON.stringify(channels)}\n`
  )
  console.log(`[sync-blog-cms] Vacío (${reason}) → ${OUT_REL}`)
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

async function mergePosts(cmsPosts) {
  const bySlug = new Map()
  for (const post of await loadFallbackPosts()) {
    if (post?.slug) bySlug.set(post.slug, post)
  }
  let cmsCount = 0
  for (const post of cmsPosts) {
    if (!post?.slug) continue
    cmsCount += 1
    bySlug.set(post.slug, {
      ...post,
      imageUrl: normalizeCmsImageUrl(post.imageUrl),
      socialPack: normalizeSocialPack(post.socialPack) || post.socialPack || null
    })
  }
  const merged = [...bySlug.values()].sort((a, b) =>
    String(b.datePublished || '').localeCompare(String(a.datePublished || ''))
  )
  return { merged, cmsCount }
}

function formatPost(post) {
  return [
    '  {',
    `    slug: ${JSON.stringify(post.slug)},`,
    `    title: ${JSON.stringify(post.title)},`,
    `    metaTitle: ${JSON.stringify(post.metaTitle || { es: post.title })},`,
    `    metaDescription: ${JSON.stringify(post.metaDescription || { es: post.excerptEs || post.title })},`,
    `    datePublished: ${JSON.stringify(post.datePublished)},`,
    `    dateModified: ${JSON.stringify(post.dateModified || post.datePublished)},`,
    `    imageUrl: ${JSON.stringify(post.imageUrl || '')},`,
    `    imageAlt: ${JSON.stringify(post.imageAlt || post.title)},`,
    `    authorName: ${JSON.stringify(post.authorName || '')},`,
    `    excerptEs: ${JSON.stringify(post.excerptEs || '')},`,
    post.socialPack ? `    socialPack: ${JSON.stringify(post.socialPack)},` : null,
    `    relatedSlugs: ${JSON.stringify(post.relatedSlugs || [])},`,
    `    bodyHtml: ${JSON.stringify(post.bodyHtml || '')}`,
    '  }'
  ]
    .filter(Boolean)
    .join('\n')
}

function buildModule(posts, sourceLabel, channels = defaultChannels()) {
  return `/**
 * Generado por scripts/sync-blog-cms.mjs — no editar a mano.
 * Fuente: ${sourceLabel}
 */
const posts = [
${posts.map(formatPost).join(',\n')}
]

const bySlug = new Map(posts.map((p) => [p.slug, p]))

export function getPostBySlug(slug) {
  if (!slug) return null
  return bySlug.get(String(slug).replace(/\\/$/, '')) || null
}

export function getAllBlogPosts() {
  return [...posts].sort((a, b) =>
    String(b.datePublished).localeCompare(String(a.datePublished))
  )
}

export function getBlogIndex() {
  return getAllBlogPosts().map((p) => ({
    slug: p.slug,
    title: p.title,
    excerpt: p.excerptEs,
    datePublished: p.datePublished,
    dateModified: p.dateModified,
    authorName: p.authorName,
    imageUrl: p.imageUrl,
    imageAlt: p.imageAlt
  }))
}

export function getPostCanonicalUrl(slug) {
  return \`${SITE}/blog/\${slug}\`
}

export const BLOG_SITE_URL = ${JSON.stringify(SITE)}
export const SOCIAL_PACK_CHANNELS = ${JSON.stringify(channels)}
`
}

async function main() {
  if (!CMS_URL) {
    useFallback('BLOG_CMS_URL no definido')
    return
  }

  try {
    const res = await fetch(`${CMS_URL}/api/sites/${CMS_SITE}/posts`, {
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const cmsPosts = data.posts || []
    const channels = data.socialPackChannels || defaultChannels()
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
    console.log(
      `[sync-blog-cms] canales pack: ${Object.entries(channels)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ')}`
    )
  } catch (error) {
    useFallback(error.message)
  }
}

main()
