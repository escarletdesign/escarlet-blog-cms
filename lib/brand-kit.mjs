import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mediaDir, readDb, writeDb } from './db.mjs'
import { mediaForClient } from './media-url.mjs'
import { loadSiteConfig, getSocialPackChannels } from './site-config.mjs'
import { MEDIA_UPLOAD_CONTRACT, withMediaUploadContract } from './media-upload-contract.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataBrandRoot = join(root, 'data', 'brand')
const contentSystemBrandRoot = join(root, 'content-system', 'brand')

function readContentSystemJson(site, suffix) {
  const handle = String(site || '').toLowerCase()
  const candidates = [
    join(dataBrandRoot, handle, `${suffix}.json`),
    join(contentSystemBrandRoot, `${handle}-${suffix}.json`)
  ]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      return null
    }
  }
  return null
}

export const BRAND_FILES = [
  'voice.md',
  'visual-style.md',
  'image-guide.md',
  'keywords.md',
  'AGENT.md'
]

/** Datos estructurados del kit (no Markdown). No usan el hueco de MD ambiguos. */
export const BRAND_DATA_FILES = ['image-spec.json']

/** JSON privados del sistema visual v2, por sitio. */
export const CONTENT_SYSTEM_DATA_FILES = [
  'brand-core.json',
  'visual-system.json',
  'image-archetypes.json',
  'reference-library.json',
  'social-templates.json'
]

export const BRAND_ALL_FILES = [...BRAND_FILES, ...BRAND_DATA_FILES]

/** Solo super-admin. Voz, estilo e image-spec son secreto de Escarlet. */
export const SECRET_BRAND_FILES = [
  'voice.md',
  'visual-style.md',
  'image-guide.md',
  'image-spec.json'
]

/** Cliente / token de sitio. Reglas del agente y keywords. */
export const CLIENT_BRAND_FILES = ['AGENT.md', 'keywords.md']

export const BRAND_FILE_LABELS = {
  'voice.md': 'Voz de marca',
  'visual-style.md': 'Estilo de imágenes',
  'image-guide.md': 'Nombres y alt SEO',
  'keywords.md': 'Keywords',
  'AGENT.md': 'Reglas del agente (AGENT.md)',
  'image-spec.json': 'Spec de imágenes (JSON)'
}

const FILE_ALIASES = {
  'agent-rules.md': 'AGENT.md',
  'agent.md': 'AGENT.md'
}

function resolveFilename(filename) {
  const name = basenameSafe(filename)
  return FILE_ALIASES[name] || name
}

export function isSecretBrandFile(filename) {
  const name = resolveFilename(filename)
  return SECRET_BRAND_FILES.includes(name)
}

export function isClientBrandFile(filename) {
  const name = resolveFilename(filename)
  return CLIENT_BRAND_FILES.includes(name)
}

export function assertBrandFileAccess(auth, filename, { write = false } = {}) {
  if (write && auth?.role === 'client_mcp') throw Object.assign(new Error('El brand kit es de solo lectura.'), { status: 403 })
  const name = resolveFilename(filename)
  if (!BRAND_ALL_FILES.includes(name)) {
    const err = new Error(`Archivo de brand kit no permitido. ${name}`)
    err.status = 400
    throw err
  }
  if (isSecretBrandFile(name) && auth?.role !== 'admin' && !(auth?.role === 'client_mcp' && !write)) {
    const err = new Error(
      write
        ? 'Solo el super-admin puede editar este archivo del brand kit.'
        : 'Este archivo del brand kit es privado. Solo el super-admin puede leerlo.'
    )
    err.status = 403
    throw err
  }
  return name
}

export function brandFilesForAuth(auth) {
  if (auth?.role === 'admin' || auth?.role === 'client_mcp') return [...BRAND_ALL_FILES]
  return [...CLIENT_BRAND_FILES]
}

export function brandLabelsForAuth(auth) {
  const files = brandFilesForAuth(auth)
  const labels = {}
  for (const file of files) labels[file] = BRAND_FILE_LABELS[file] || file
  return labels
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
  if (!BRAND_ALL_FILES.includes(name)) {
    throw new Error(`Archivo de brand kit no permitido. ${name}`)
  }
  let text = String(content ?? '')
  if (name === 'image-spec.json') {
    text = normalizeImageSpecJson(text)
  }
  ensureBrandKit(site)
  const path = join(getBrandKitDir(site), name)
  writeFileSync(path, text, 'utf8')
  return path
}

/** Guarda un JSON visual v2 en data/brand/{site}; solo lo usa la importación admin. */
export function writeContentSystemJson(site, filename, content) {
  const name = basenameSafe(filename)
  if (!CONTENT_SYSTEM_DATA_FILES.includes(name)) {
    throw new Error(`Archivo JSON visual no permitido. ${name}`)
  }
  let parsed
  try {
    parsed = JSON.parse(String(content ?? '').trim())
  } catch {
    throw new Error(`${name} no es JSON válido`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} debe ser un objeto JSON`)
  }
  const dir = join(dataBrandRoot, String(site || '').toLowerCase())
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  return path
}

/** Valida y formatea image-spec.json. Cadena vacía → objeto vacío. */
export function normalizeImageSpecJson(raw) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return '{}\n'
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error('image-spec.json no es JSON válido')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('image-spec.json debe ser un objeto JSON')
  }
  return `${JSON.stringify(parsed, null, 2)}\n`
}

export function parseImageSpec(raw) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    /* ignore */
  }
  return null
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
  const channels = getSocialPackChannels(siteConfig)
  const fields = [
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
    field('relatedSlugs', 'recommended', '¿Quieres enlazar a posts concretos relacionados?', 'derivado')
  ]
  if (channels.substack) {
    fields.push(
      field('socialPack.substackTitle', 'recommended', '¿Título para Substack o reutilizo el del post?', 'derivado'),
      field('socialPack.substackBody', 'recommended', '¿Resumen Substack (4-8 párrafos) o lo redacto yo?', 'derivado')
    )
  }
  if (channels.linkedin) {
    fields.push(
      field('socialPack.linkedin', 'recommended', '¿Post LinkedIn o lo redacto yo con el canónico?', 'derivado')
    )
  }
  if (channels.x) {
    fields.push(field('socialPack.x', 'recommended', '¿Tuit o lo redacto yo con el canónico?', 'derivado'))
  }
  if (channels.videoScript) {
    fields.push(
      field(
        'socialPack.videoScript',
        'recommended',
        '¿Guion oral 45–60 s (~100–140 palabras) o lo redacto yo?',
        'derivado'
      )
    )
  }
  if (channels.instagramCarousel) {
    fields.push(
      field(
        'socialPack.instagramCaption',
        'recommended',
        '¿Caption de Instagram (con canónico) o lo redacto yo?',
        'derivado'
      ),
      field(
        'socialPack.instagramSlides',
        'recommended',
        '¿Carrusel IG (4–7 slides)? Sube cada imagen (mediaUpload A→B→C, kind social). Guarda imageUrl+alt+headline en el array.',
        'derivado'
      )
    )
  }
  fields.push(
    field(
      'visualBrief',
      'recommended',
      'Metadata visual v2. Arquetipo, composición, referencias y decisión. Se deriva del historial reciente.',
      'derivado'
    ),
    field(
      'status',
      'required',
      'Estado. draft → published o scheduled según la acción confirmada. Para editar un publicado, usa el mismo slug.',
      'sistema'
    )
  )
  return fields
}

export function buildAgentWorkflow(site) {
  const channels = getSocialPackChannels(loadSiteConfig(site) || {})
  const steps = [
    'blog_get_brand_context para cargar las reglas y referencias permitidas del sitio',
    'blog_get_workflow y pregunta al humano si prefiere easy (ChatGPT genera todo) o guided (revisión en /app)',
    'Inspecciona los últimos seis posts y construye visualBrief con un arquetipo no repetido, referencias aprobadas y reglas negativas. La portada no lleva texto.',
    'ChatGPT genera título, cuerpo, resumen, meta y portada sin texto con el brand kit. MCP no llama APIs de IA del CMS. Guarda con blog_create_draft y blog_update_post.',
    'En guided. comparte appPreviewUrl de /app y espera correcciones o confirmación. En easy. muestra un resumen y pide confirmación.',
    'Para adjuntar imágenes conserva el contrato mediaUpload A→B→C (archivo, descarga y confirmación) y deja que el servidor persista la galería.',
    'Si editas. blog_list_posts + blog_get_post con el slug existente. Nunca blog_create_draft para editar.',
    'blog_update_post (mismo slug o originalSlug si renombras)'
  ]
  if (channels.instagramCarousel) {
    steps.push(
      'Solo si el usuario solicita Social Pack: genera copy y fondos sin texto, renderiza las slides con un template editorial o impact y usa blog_save_social_pack.'
    )
  }
  steps.push(
    'blog_publish con direct=true después de la confirmación o blog_schedule_post con direct=true y publishAt YYYY-MM-DD',
    'Para regenerar una portada: ChatGPT crea la imagen, la sube y actualiza imageUrl e imageAlt con blog_update_post.',
    'Despublicar. blog_unpublish. Cancelar programación. blog_cancel_schedule. Eliminar. blog_delete_post con confirm true'
  )
  return steps
}

export function buildEditRules() {
  return [
    'Nunca llames blog_create_draft si el slug (o un post con el mismo tema) ya existe. Lista primero.',
    'Para editar. blog_get_post + blog_update_post con el mismo slug.',
    'Si renombras el slug. pasa originalSlug (slug actual) y slug (nuevo).',
    'Si el post está published, blog_update_post debe conservar el mismo slug y keepPublished cuando la edición sea una actualización en vivo.',
    'Para quitarlo del blog sin borrar. blog_unpublish.',
    'Para borrarlo. blog_delete_post con confirm true.',
    'Lee postFields y pregunta al humano cada askHuman que aún no tengas. Comparte solo rutas de /app.'
  ]
}

export function getBrandContext(site, options = {}) {
  ensureBrandKit(site)
  const siteConfig = loadSiteConfig(site) || {}
  const auth = options.auth || null
  const fullAccess = !auth || auth.role === 'admin' || auth.role === 'client_mcp'

  const voice = fullAccess ? readBrandFile(site, 'voice.md') : ''
  const visualStyle = fullAccess ? readBrandFile(site, 'visual-style.md') : ''
  const imageGuide = fullAccess ? readBrandFile(site, 'image-guide.md') : ''
  const keywords = readBrandFile(site, 'keywords.md')
  const agentRules = withMediaUploadContract(readBrandFile(site, 'AGENT.md'))
  const imageSpecRaw = fullAccess ? readBrandFile(site, 'image-spec.json') : ''
  const imageSpec = fullAccess ? parseImageSpec(imageSpecRaw) : null
  const brandCore = fullAccess ? readContentSystemJson(site, 'brand-core') : null
  const visualSystem = fullAccess ? readContentSystemJson(site, 'visual-system') : null
  const imageArchetypes = fullAccess ? readContentSystemJson(site, 'image-archetypes') : null
  const socialTemplates = fullAccess ? readContentSystemJson(site, 'social-templates') : null
  const referenceLibrary = fullAccess ? readContentSystemJson(site, 'reference-library') : null

  const files = fullAccess
    ? {
        'voice.md': voice,
        'visual-style.md': visualStyle,
        'image-guide.md': imageGuide,
        'keywords.md': keywords,
        'AGENT.md': agentRules,
        'image-spec.json': imageSpecRaw
      }
    : {
        'keywords.md': keywords,
        'AGENT.md': agentRules
      }

  const missingBrand = Object.entries(files)
    .filter(([name, content]) => {
      if (name === 'image-spec.json') return false
      return !String(content || '').trim()
    })
    .map(([name]) => name)

  const base = {
    site,
    keywords,
    agentRules,
    referenceImages: listReferenceImages(site),
    authors: siteConfig.authors || ['Charly', 'Silvia'],
    seoLimits: siteConfig.seo || {},
    requiresHumanApproval: Boolean(siteConfig.requiresHumanApproval),
    requiresPublishConfirmation: siteConfig.requiresPublishConfirmation !== false,
    blogEnabled: siteConfig.blogEnabled !== false,
    socialPackChannels: getSocialPackChannels(siteConfig),
    postFields: buildPostFields(site),
    workflow: buildAgentWorkflow(site),
    mediaUpload: MEDIA_UPLOAD_CONTRACT,
    editRules: buildEditRules(),
    missingBrand,
    brandAccess: fullAccess ? 'full' : 'client',
    allowedBrandFiles: brandFilesForAuth(auth || { role: 'site' }),
    reminder: fullAccess
      ? 'ChatGPT genera todos los textos e imágenes. MCP nunca llama APIs de IA del CMS. Consulta blog_get_workflow, aplica voice, visual-style e image-spec. Guarda con blog_create_draft, blog_upload_media_file y blog_update_post. Sigue mediaUpload A→B→C. Si no puedes transferir una imagen, conserva el borrador y ofrece carga manual. Solo enlaces de revisión /app.'
      : 'Sigue mediaUpload A→B→C y AGENT.md. Fotos de referencia en referenceImages. Keywords en keywords. No pidas voz de marca ni image-spec (son privados). Usa /app para revisión y blog_schedule_post para fechas futuras.'
  }

  if (fullAccess) {
    return {
      ...base,
      voice,
      visualStyle,
      imageGuide,
      imageSpec,
      brandCore,
      visualSystem,
      imageArchetypes,
      socialTemplates,
      referenceLibrary,
      files
    }
  }

  return { ...base, files }
}

export function getSeoContext(site) {
  return {
    site,
    keywords: readBrandFile(site, 'keywords.md'),
    agentRules: withMediaUploadContract(readBrandFile(site, 'AGENT.md'))
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
  'estilo-visual.md': 'visual-style.md',
  'image-guide.md': 'image-guide.md',
  'images.md': 'image-guide.md',
  'imagenes.md': 'image-guide.md',
  'guia-imagenes.md': 'image-guide.md',
  'keywords.md': 'keywords.md',
  'keyword.md': 'keywords.md',
  'palabras-clave.md': 'keywords.md',
  'agent.md': 'AGENT.md',
  'agent-rules.md': 'AGENT.md',
  'AGENT.md': 'AGENT.md',
  'reglas.md': 'AGENT.md',
  'reglas-agente.md': 'AGENT.md'
}

const JSON_NAME_MAP = {
  'image-spec.json': 'image-spec.json',
  'brand-spec.json': 'image-spec.json',
  'imagenes-brand-spec.json': 'image-spec.json',
  'images-brand-spec.json': 'image-spec.json',
  'image-brand-spec.json': 'image-spec.json',
  'brand-core.json': 'brand-core.json',
  'visual-system.json': 'visual-system.json',
  'image-archetypes.json': 'image-archetypes.json',
  'reference-library.json': 'reference-library.json',
  'social-templates.json': 'social-templates.json'
}

const MD_HINTS = [
  { re: /(voice|voz|tono|identidad.?verbal)/i, file: 'voice.md' },
  { re: /(visual.?style|estilo.?visual|moodboard|paleta|estilo)/i, file: 'visual-style.md' },
  { re: /(image.?guide|guia.?imagen|alt.?seo|nombres.?imagen)/i, file: 'image-guide.md' },
  { re: /(keyword|keywords|palabras.?clave|seo.?keys)/i, file: 'keywords.md' },
  { re: /(agent|agente|reglas|playbook|workflow)/i, file: 'AGENT.md' }
]

const JSON_HINTS = [
  { re: /(brand.?spec|image.?spec|imagenes?.?brand.?spec|imagenes.?spec|spec.?imagen|images?.?spec)/i, file: 'image-spec.json' },
  { re: /(brand.?core|core.?brand|brand.?identity)/i, file: 'brand-core.json' },
  { re: /(visual.?system|sistema.?visual)/i, file: 'visual-system.json' },
  { re: /(image.?archetypes|arquetipos|archetypes)/i, file: 'image-archetypes.json' },
  { re: /(reference.?library|biblioteca.?referencias|referencias)/i, file: 'reference-library.json' },
  { re: /(social.?templates|plantillas.?social|templates)/i, file: 'social-templates.json' }
]

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

function classifyMarkdownTarget(relPath, base) {
  const lower = base.toLowerCase()
  const exact = MD_NAME_MAP[base] || MD_NAME_MAP[lower]
  if (exact) return exact
  const haystack = `${relPath} ${base}`
  for (const hint of MD_HINTS) {
    if (hint.re.test(haystack)) return hint.file
  }
  return null
}

function classifyJsonTarget(relPath, base) {
  if (!/\.json$/i.test(base)) return null
  const lower = base.toLowerCase()
  const exact = JSON_NAME_MAP[base] || JSON_NAME_MAP[lower]
  if (exact) return exact
  const haystack = `${relPath} ${base}`
  for (const hint of JSON_HINTS) if (hint.re.test(haystack)) return hint.file
  return null
}

async function resolveZipBuffer({ contentBase64, buffer, zipUrl }) {
  if (buffer?.length) return Buffer.from(buffer)
  if (contentBase64) return decodeZipBase64(contentBase64)
  if (zipUrl) {
    const url = String(zipUrl).trim()
    if (!/^https?:\/\//i.test(url)) throw new Error('zipUrl debe ser http(s)')
    const res = await fetch(url)
    if (!res.ok) throw new Error(`No se pudo descargar el ZIP (HTTP ${res.status})`)
    const ab = await res.arrayBuffer()
    return Buffer.from(ab)
  }
  throw new Error('Pasa zipUrl (preferido) o contentBase64 del ZIP')
}

/**
 * Importa un ZIP de brand kit sin exigir una estructura fija.
 * Clasifica .md por nombre/ruta/hints, image-spec y JSON visuales v2 por
 * nombre, e imágenes raster como referencias.
 * Preferido para MCP. zipUrl http(s). contentBase64 como alternativa.
 */
export async function importBrandKitZip(site, { contentBase64, buffer, zipUrl } = {}) {
  const JSZip = (await import('jszip')).default
  const zipBuf = await resolveZipBuffer({ contentBase64, buffer, zipUrl })
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
  const importedData = []
  const importedImages = []
  const skipped = []
  const unmatchedMd = []
  const filled = new Set()

  const entries = Object.values(zip.files).filter((f) => !f.dir)
  // Primero MD con match claro, luego JSON del kit, luego imágenes, luego MD ambiguos
  const mdEntries = []
  const jsonEntries = []
  const imageEntries = []
  const otherEntries = []

  for (const entry of entries) {
    const rel = String(entry.name || '').replace(/\\/g, '/')
    if (!rel || rel.includes('..')) {
      skipped.push(rel || '(ruta inválida)')
      continue
    }
    const base = basenameSafe(rel)
    if (!base || base.startsWith('.') || base === '__MACOSX') continue
    if (rel.includes('__MACOSX/')) continue

    if (/\.md$/i.test(base)) mdEntries.push({ entry, rel, base })
    else if (/\.json$/i.test(base)) {
      const target = classifyJsonTarget(rel, base)
      if (target) jsonEntries.push({ entry, rel, base, target })
      else otherEntries.push(rel)
    } else if (IMAGE_EXT.test(base)) imageEntries.push({ entry, rel, base })
    else otherEntries.push(rel)
  }

  for (const { entry, rel, base } of mdEntries) {
    const target = classifyMarkdownTarget(rel, base)
    if (!target) {
      unmatchedMd.push({ entry, rel, base })
      continue
    }
    if (filled.has(target)) {
      // Si ya hay uno, el más específico (nombre exacto) gana; este se omite
      skipped.push(`${rel} (duplicado de ${target})`)
      continue
    }
    const text = await entry.async('string')
    writeBrandFile(site, target, text)
    importedMd.push(target)
    filled.add(target)
  }

  // MD sin nombre claro → asignar al primer slot vacío del kit, en orden
  for (const { entry, rel } of unmatchedMd) {
    const nextSlot = BRAND_FILES.find((f) => !filled.has(f))
    if (!nextSlot) {
      skipped.push(`${rel} (sin hueco de brand kit)`)
      continue
    }
    const text = await entry.async('string')
    writeBrandFile(site, nextSlot, text)
    importedMd.push(nextSlot)
    filled.add(nextSlot)
  }

  for (const { entry, rel, target } of jsonEntries) {
    if (filled.has(target)) {
      skipped.push(`${rel} (duplicado de ${target})`)
      continue
    }
    const text = await entry.async('string')
    try {
      if (target === 'image-spec.json') writeBrandFile(site, target, text)
      else writeContentSystemJson(site, target, text)
      importedData.push(target)
      filled.add(target)
    } catch (err) {
      skipped.push(`${rel} (${err.message || 'JSON inválido'})`)
    }
  }

  for (const { entry, base } of imageEntries) {
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
  }

  skipped.push(...otherEntries)

  return {
    ok: true,
    site,
    importedMd: [...new Set(importedMd)],
    importedData: [...new Set(importedData)],
    importedImages,
    skipped: [...new Set(skipped)].filter(Boolean),
    hint:
      'Preferido. pasa zipUrl http(s) pública. Los .md se mapean a voice/visual-style/image-guide/keywords/AGENT por nombre o pista. image-spec y JSON visuales v2 se guardan por sitio. Cualquier imagen raster entra como referencia.',
    brand: getBrandContext(site)
  }
}
