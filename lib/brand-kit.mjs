import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mediaDir, readDb, writeDb } from './db.mjs'
import { mediaForClient } from './media-url.mjs'
import { loadSiteConfig } from './site-config.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataBrandRoot = join(root, 'data', 'brand')

export const BRAND_FILES = [
  'voice.md',
  'visual-style.md',
  'image-guide.md',
  'keywords.md',
  'AGENT.md'
]

export const BRAND_FILE_LABELS = {
  'voice.md': 'Voz de marca',
  'visual-style.md': 'Estilo de imágenes',
  'image-guide.md': 'Nombres y alt SEO',
  'keywords.md': 'Keywords',
  'AGENT.md': 'Reglas del agente (AGENT.md)'
}

const FILE_ALIASES = {
  'agent-rules.md': 'AGENT.md',
  'agent.md': 'AGENT.md'
}

function resolveFilename(filename) {
  const name = basenameSafe(filename)
  return FILE_ALIASES[name] || name
}

function basenameSafe(filename) {
  return String(filename || '').replace(/\\/g, '/').split('/').pop()
}

export function getBrandKitDir(site) {
  return join(dataBrandRoot, site)
}

export function getBrandSeedDir(site) {
  return join(root, 'config', 'sites', site)
}

export function ensureBrandKit(site) {
  const dest = getBrandKitDir(site)
  const src = getBrandSeedDir(site)
  mkdirSync(dest, { recursive: true })
  mkdirSync(join(mediaDir, site, 'reference'), { recursive: true })

  for (const name of BRAND_FILES) {
    const destPath = join(dest, name)
    if (existsSync(destPath)) continue
    const seedPath = join(src, name)
    const legacy = name === 'AGENT.md' ? join(src, 'agent-rules.md') : null
    if (existsSync(seedPath)) copyFileSync(seedPath, destPath)
    else if (legacy && existsSync(legacy)) copyFileSync(legacy, destPath)
  }
}

export function readBrandFile(site, filename) {
  ensureBrandKit(site)
  const name = resolveFilename(filename)
  const runtimePath = join(getBrandKitDir(site), name)
  if (existsSync(runtimePath)) return readFileSync(runtimePath, 'utf8')
  const seedPath = join(getBrandSeedDir(site), name)
  if (existsSync(seedPath)) return readFileSync(seedPath, 'utf8')
  if (name === 'AGENT.md') {
    const legacy = join(getBrandSeedDir(site), 'agent-rules.md')
    if (existsSync(legacy)) return readFileSync(legacy, 'utf8')
  }
  return ''
}

export function writeBrandFile(site, filename, content) {
  const name = resolveFilename(filename)
  if (!BRAND_FILES.includes(name)) {
    throw new Error(`Archivo de brand kit no permitido. ${name}`)
  }
  ensureBrandKit(site)
  const path = join(getBrandKitDir(site), name)
  writeFileSync(path, content, 'utf8')
  return path
}

export function listBrandFiles(site) {
  ensureBrandKit(site)
  return BRAND_FILES.filter((name) => readBrandFile(site, name).trim().length > 0)
}

export function listReferenceImages(site) {
  const db = readDb()
  const items = (db.media || []).filter((m) => m.site === site && m.kind === 'reference')
  const dir = join(mediaDir, site, 'reference')
  if (!existsSync(dir)) return items
  for (const name of readdirSync(dir)) {
    if (!/\.(webp|jpg|jpeg|png|gif)$/i.test(name)) continue
    if (items.some((i) => i.filename === name)) continue
    items.push({
      site,
      filename: name,
      kind: 'reference',
      alt: '',
      path: `/media/${site}/reference/${name}`,
      url: `/media/${site}/reference/${name}`
    })
  }
  return items.map((item) => mediaForClient(item, { absolute: true }))
}

function field(key, level, askHuman, source = 'humano') {
  return {
    key,
    required: level === 'required',
    recommended: level === 'recommended',
    askHuman,
    source
  }
}

export function buildPostFields(site) {
  const siteConfig = loadSiteConfig(site) || {}
  const authors = siteConfig.authors || ['Charly', 'Silvia']
  const seo = siteConfig.seo || {}
  return [
    field('title', 'required', '¿Cuál es el título del artículo?'),
    field('slug', 'required', '¿Confirmas el slug (kebab-case) o lo derivo del título?', 'derivado'),
    field(
      'authorName',
      'required',
      `¿Quién firma el post? Opciones. ${authors.join(' o ')}.`
    ),
    field('excerptEs', 'recommended', '¿Cuál es el extracto corto para el listado del blog?'),
    field(
      'bodyHtml',
      'required',
      `¿Sobre qué idea principal escribimos? Objetivo ~${seo.minWords || 400} palabras.`
    ),
    field('metaTitle.es', 'recommended', '¿Meta title SEO (es) o lo derivo del título?', 'derivado'),
    field('metaDescription.es', 'recommended', '¿Meta description SEO en español (una idea, ~70-180 caracteres)?'),
    field('imageUrl', 'recommended', '¿Tienes foto de portada o la genero según visual-style?'),
    field('imageAlt', 'recommended', '¿Qué se ve en la portada (texto alt descriptivo)?'),
    field('relatedSlugs', 'recommended', '¿Quieres enlazar a posts concretos relacionados?', 'derivado'),
    field('socialPack.substackTitle', 'recommended', '¿Título para Substack o reutilizo el del post?', 'derivado'),
    field('socialPack.substackBody', 'recommended', '¿Resumen Substack (4-8 párrafos) o lo redacto yo?', 'derivado'),
    field('socialPack.linkedin', 'recommended', '¿Post LinkedIn o lo redacto yo con el canónico?', 'derivado'),
    field('socialPack.x', 'recommended', '¿Tuit o lo redacto yo con el canónico?', 'derivado'),
    field(
      'status',
      'required',
      'Estado. draft → review (agente) → published (humano). Para editar un publicado, usa el mismo slug.',
      'sistema'
    )
  ]
}

export function buildAgentWorkflow() {
  return [
    'blog_get_brand_context',
    'Si editas. blog_list_posts + blog_get_post con el slug existente. Nunca blog_create_draft para editar.',
    'Si es nuevo. pregunta lo que falte según postFields.askHuman, luego blog_create_draft',
    'blog_update_post (mismo slug o originalSlug si renombras)',
    'Portada. blog_upload_media con imageUrl http pública',
    'blog_validate_seo',
    'blog_publish (draft → review). Comparte previewUrl absoluto',
    'Despublicar. blog_unpublish. Eliminar. blog_delete_post con confirm true'
  ]
}

export function buildEditRules() {
  return [
    'Nunca llames blog_create_draft si el slug (o un post con el mismo tema) ya existe. Lista primero.',
    'Para editar. blog_get_post + blog_update_post con el mismo slug.',
    'Si renombras el slug. pasa originalSlug (slug actual) y slug (nuevo).',
    'Si el post está published y el site pide aprobación humana, blog_update_post lo baja a review hasta que un humano publique en vivo.',
    'Para quitarlo del blog sin borrar. blog_unpublish.',
    'Para borrarlo. blog_delete_post con confirm true.',
    'Lee postFields y pregunta al humano cada askHuman que aún no tengas.'
  ]
}

export function getBrandContext(site) {
  ensureBrandKit(site)
  const siteConfig = loadSiteConfig(site) || {}
  const voice = readBrandFile(site, 'voice.md')
  const visualStyle = readBrandFile(site, 'visual-style.md')
  const imageGuide = readBrandFile(site, 'image-guide.md')
  const keywords = readBrandFile(site, 'keywords.md')
  const agentRules = readBrandFile(site, 'AGENT.md')
  const files = {
    'voice.md': voice,
    'visual-style.md': visualStyle,
    'image-guide.md': imageGuide,
    'keywords.md': keywords,
    'AGENT.md': agentRules
  }
  const missingBrand = Object.entries(files)
    .filter(([, content]) => !String(content || '').trim())
    .map(([name]) => name)

  return {
    site,
    voice,
    visualStyle,
    imageGuide,
    keywords,
    agentRules,
    referenceImages: listReferenceImages(site),
    authors: siteConfig.authors || ['Charly', 'Silvia'],
    seoLimits: siteConfig.seo || {},
    requiresHumanApproval: Boolean(siteConfig.requiresHumanApproval),
    postFields: buildPostFields(site),
    workflow: buildAgentWorkflow(),
    editRules: buildEditRules(),
    missingBrand,
    reminder:
      'Lee postFields y editRules. Pregunta al humano lo que falte (askHuman). Aplica voz, visual-style y AGENT.md. Para editar un post existente usa el mismo slug (nunca create_draft). Portadas con imageUrl http a blog_upload_media. El equipo puede corregir este kit en el dashboard.'
  }
}

export function getSeoContext(site) {
  return {
    site,
    keywords: readBrandFile(site, 'keywords.md'),
    agentRules: readBrandFile(site, 'AGENT.md')
  }
}

export function seedAllBrandKits() {
  const sitesRoot = join(root, 'config', 'sites')
  if (!existsSync(sitesRoot)) return
  for (const name of readdirSync(sitesRoot, { withFileTypes: true })) {
    if (name.isDirectory()) ensureBrandKit(name.name)
  }
}

const IMAGE_EXT = /\.(webp|jpg|jpeg|png|gif)$/i
const MD_NAME_MAP = {
  'voice.md': 'voice.md',
  'voz.md': 'voice.md',
  'visual-style.md': 'visual-style.md',
  'visual.md': 'visual-style.md',
  'estilo.md': 'visual-style.md',
  'image-guide.md': 'image-guide.md',
  'images.md': 'image-guide.md',
  'imagenes.md': 'image-guide.md',
  'keywords.md': 'keywords.md',
  'agent.md': 'AGENT.md',
  'agent-rules.md': 'AGENT.md',
  'AGENT.md': 'AGENT.md'
}

function decodeZipBase64(contentBase64) {
  const raw = String(contentBase64 || '')
  const b64 = raw.includes(',') ? raw.split(',').pop() : raw
  return Buffer.from(b64, 'base64')
}

function safeImageName(name) {
  return basenameSafe(name)
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .toLowerCase() || `ref-${Date.now()}.png`
}

/**
 * Importa un ZIP de brand kit.
 * Acepta .md del kit (voice, visual-style, image-guide, keywords, AGENT)
 * e imágenes (webp/jpg/png/gif) como referencias de moodboard.
 */
export async function importBrandKitZip(site, { contentBase64, buffer } = {}) {
  const JSZip = (await import('jszip')).default
  const zipBuf = buffer || decodeZipBase64(contentBase64)
  if (!zipBuf?.length) throw new Error('ZIP vacío')
  if (zipBuf.length > 40 * 1024 * 1024) throw new Error('ZIP demasiado grande (máx. 40 MB)')

  let zip
  try {
    zip = await JSZip.loadAsync(zipBuf)
  } catch {
    throw new Error('No se pudo leer el ZIP. Comprueba que el archivo esté completo.')
  }

  ensureBrandKit(site)
  const importedMd = []
  const importedImages = []
  const skipped = []

  const entries = Object.values(zip.files).filter((f) => !f.dir)
  for (const entry of entries) {
    const rel = String(entry.name || '').replace(/\\/g, '/')
    if (!rel || rel.includes('..') || rel.startsWith('/')) {
      skipped.push(rel || '(ruta inválida)')
      continue
    }
    const base = basenameSafe(rel)
    if (!base || base.startsWith('.')) continue

    const lower = base.toLowerCase()
    const mdTarget = MD_NAME_MAP[base] || MD_NAME_MAP[lower]
    if (mdTarget) {
      const text = await entry.async('string')
      writeBrandFile(site, mdTarget, text)
      importedMd.push(mdTarget)
      continue
    }

    if (IMAGE_EXT.test(base)) {
      const bin = Buffer.from(await entry.async('uint8array'))
      if (bin.length < 32) {
        skipped.push(base)
        continue
      }
      const safeName = safeImageName(base)
      const dir = join(mediaDir, site, 'reference')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, safeName), bin)
      const urlPath = `/media/${site}/reference/${safeName}`
      const db = readDb()
      const item = mediaForClient({
        id: `media-${Date.now()}-${importedImages.length}`,
        site,
        path: urlPath,
        alt: base.replace(IMAGE_EXT, '').replace(/[-_]+/g, ' ').trim(),
        kind: 'reference',
        filename: safeName
      })
      db.media = db.media || []
      db.media.push(item)
      writeDb(db)
      importedImages.push(safeName)
      continue
    }

    skipped.push(rel)
  }

  return {
    ok: true,
    site,
    importedMd: [...new Set(importedMd)],
    importedImages,
    skipped,
    brand: getBrandContext(site)
  }
}
