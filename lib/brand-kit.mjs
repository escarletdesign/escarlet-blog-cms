import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { mediaDir, readDb, writeDb } from './db.mjs'
import { mediaForClient } from './media-url.mjs'
import { loadSiteConfig, getSocialPackChannels } from './site-config.mjs'
import { MEDIA_UPLOAD_CONTRACT, withMediaUploadContract } from './media-upload-contract.mjs'
import { SHARED_EDITORIAL_POLICY } from './human-writing.mjs'
import { CANONICAL_CMS_URL, canonicalCmsPublicUrl } from './cms-url.mjs'
import { fetchRemote } from './remote-fetch.mjs'
import { workspaceRoleForAuth } from './auth.mjs'

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

// These two JSON files are part of the canonical kit. They used to be treated
// as import-only content-system data, which allowed the MCP endpoints to drift.
export const CANONICAL_BRAND_JSON_FILES = ['brand-core.json', 'reference-library.json']
export const BRAND_ALL_FILES = [...new Set([...BRAND_FILES, ...BRAND_DATA_FILES, ...CONTENT_SYSTEM_DATA_FILES])]

/** Solo owner/admin. Voz, estilo e image-spec son fuentes privadas de Escarlet. */
export const SECRET_BRAND_FILES = [
  'voice.md',
  'visual-style.md',
  'image-guide.md',
  'image-spec.json',
  'brand-core.json',
  'reference-library.json'
]

/** Recursos legados de lectura básica. El MCP usa el contexto normalizado. */
export const CLIENT_BRAND_FILES = ['AGENT.md', 'keywords.md']

/** Normalized resources an editor may use without receiving private source files. */
export const VISUAL_BRAND_RESOURCES = Object.freeze([
  'brand-core',
  'visual-system',
  'image-archetypes',
  'reference-library',
  'social-templates',
  'visualStyle',
  'imageGuide',
  'imageSpec',
  'referenceImages'
])

// Server-owned policy shared by every brand. Brand kits can refine the visual
// direction, but they cannot relax the final social asset contract.
export const GLOBAL_IMAGE_GENERATION_POLICY = Object.freeze({
  blogCover: Object.freeze({
    assetTypes: ['blog_cover'],
    requiresText: false,
    allowedAspectRatios: ['3:2'],
    defaultDimensions: '1536x1024'
  }),
  social: Object.freeze({
    assetTypes: ['social_image'],
    requiresText: true,
    textSource: 'ChatGPT',
    allowedAspectRatios: ['4:5'],
    allowedDimensions: ['1080x1350'],
    defaultAspectRatio: '4:5',
    defaultDimensions: '1080x1350'
  }),
  story: Object.freeze({
    assetTypes: ['instagram_story'],
    requiresText: true,
    textSource: 'ChatGPT',
    allowedAspectRatios: ['9:16'],
    allowedDimensions: ['1080x1920'],
    defaultAspectRatio: '9:16',
    defaultDimensions: '1080x1920'
  })
})

const VISUAL_ACCESS_ROLES = new Set(['agency_admin', 'owner', 'admin', 'editor', 'author', 'client', 'viewer'])

const CANONICAL_ESCARLET_PALETTE = Object.freeze({
  primary: '#47A4E7',
  cyan: '#12B8D6',
  teal: '#12B8D6',
  greenSoft: '#62B38A',
  gold: '#E8B73A',
  charcoal: '#1E1E1E',
  gray: '#6D6D6D',
  white: '#FFFFFF'
})

const CANONICAL_ESCARLET_REFERENCES = Object.freeze([
  {
    id: 'esc-style-board',
    role: 'visual-authority',
    required: true,
    filename: '05-tablero-visual.png',
    mediaId: 'media-1789658372305-0',
    alt: 'Tablero visual canónico de Escarlet'
  },
  {
    id: 'esc-background',
    role: 'background-authority',
    required: true,
    filename: 'fondo-escarlet.jpg',
    mediaId: 'media-1789662894828',
    alt: 'Fondo Escarlet con formas orgánicas estratificadas'
  },
  {
    id: 'esc-scene-work',
    role: 'scene-reference',
    required: false,
    filename: 'reference-blog-example.png',
    mediaId: 'media-1789658372371-1',
    alt: 'Referencia de trabajo, diseño y colaboración'
  },
  {
    id: 'esc-scene-tense',
    role: 'scene-reference',
    required: false,
    filename: 'reference-visual-style-01.png',
    mediaId: 'media-1789658372405-2',
    alt: 'Referencia de tensión e introspección'
  },
  {
    id: 'esc-scene-positive',
    role: 'scene-reference',
    required: false,
    filename: 'reference-visual-style-02.png',
    mediaId: 'media-1789658372446-3',
    alt: 'Referencia de crecimiento e inspiración'
  },
  {
    id: 'esc-carousel-listen',
    role: 'carousel-reference',
    required: false,
    filename: 'carousel-reference-01-listen.jpg',
    mediaId: 'media-1790016336592',
    alt: 'Referencia de carrusel con texto grande, fondo claro y logo'
  },
  {
    id: 'esc-carousel-logo',
    role: 'carousel-reference',
    required: false,
    filename: 'carousel-reference-02-before-logo.jpg',
    mediaId: 'media-1790016375507',
    alt: 'Referencia de carrusel con logo y jerarquía editorial'
  },
  {
    id: 'esc-carousel-branding',
    role: 'carousel-reference',
    required: false,
    filename: 'carousel-reference-03-branding-local.jpg',
    mediaId: 'media-1790016379923',
    alt: 'Referencia de portada de carrusel con color de marca'
  },
  {
    id: 'esc-carousel-coherent',
    role: 'carousel-reference',
    required: false,
    filename: 'carousel-reference-04-bonito-coherente.jpg',
    mediaId: 'media-1790016382792',
    alt: 'Referencia de carrusel con tipografía grande y fondo claro'
  },
  {
    id: 'esc-carousel-message',
    role: 'carousel-reference',
    required: false,
    filename: 'carousel-reference-05-problema-canva.jpg',
    mediaId: 'media-1790016385295',
    alt: 'Referencia de carrusel con mensaje breve y composición editorial'
  }
])

const IMAGE_ROUTE_POLICY = Object.freeze({
  mode: 'deterministic',
  assistantMayChoose: false,
  assistantMaySubstitute: false,
  priority: ['abstract_or_background', 'introspective_or_tense', 'human_or_work', 'positive_or_inspirational'],
  routes: Object.freeze({
    human_or_work: ['05-tablero-visual.png', 'fondo-escarlet.jpg', 'reference-blog-example.png'],
    introspective_or_tense: ['05-tablero-visual.png', 'fondo-escarlet.jpg', 'reference-visual-style-01.png'],
    positive_or_inspirational: ['05-tablero-visual.png', 'fondo-escarlet.jpg', 'reference-visual-style-02.png'],
    abstract_or_background: ['05-tablero-visual.png', 'fondo-escarlet.jpg']
  })
})

const canonicalSnapshotCache = new Map()
const BRAND_STATE_FILE = '.brand-kit-state.json'

const ESCARLET_LEGACY_COLOR_MAP = Object.freeze({
  '#F4F1EA': '#FFFFFF',
  '#E8E0D3': '#FFFFFF',
  '#1F4D3A': '#47A4E7',
  '#15352A': '#1E1E1E',
  '#1B211D': '#1E1E1E',
  '#C8674B': '#E8B73A',
  '#6C746F': '#6D6D6D'
})

function canonicalizeEscarletLegacyColors(value) {
  if (typeof value === 'string') {
    return Object.entries(ESCARLET_LEGACY_COLOR_MAP).reduce((text, [oldColor, newColor]) => text.replaceAll(oldColor, newColor), value)
  }
  if (Array.isArray(value)) return value.map(canonicalizeEscarletLegacyColors)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, canonicalizeEscarletLegacyColors(item)]))
}

/**
 * Distinguishes membership-derived access from the resources actually delivered.
 * Brand context access is no longer controlled by a stored brand capability.
 */
export function resolveBrandAccess(auth, { brandCapabilities = null } = {}) {
  const role = auth?.role || 'internal'
  const declared = role === 'admin' || VISUAL_ACCESS_ROLES.has(role)
  const siteEnabled = true
  if (role === 'admin' || !auth) {
    return { level: 'full', declared: true, effective: true, siteEnabled: true, role }
  }
  if (VISUAL_ACCESS_ROLES.has(role) && declared && siteEnabled) {
    return { level: 'sanitized', declared: true, effective: true, siteEnabled, role }
  }
  if (role === 'public') return { level: 'none', declared: false, effective: false, siteEnabled, role }
  return { level: 'none', declared, effective: false, siteEnabled, role }
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function normalizeGenerationGuidance(value) {
  if (typeof value === 'string') {
    return value
      .replace(/brand_(?:complete_image_generation|register(?:_image)?_generation)/g, 'content_upload_media')
      .replace(/generationReceiptId/g, 'preparationId')
      .replace(/content-system\/instagram-renderer/g, 'ChatGPT')
  }
  if (Array.isArray(value)) return value.map(normalizeGenerationGuidance)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeGenerationGuidance(item)]))
}

function brandStatePath(site) {
  return join(getBrandKitDir(site), BRAND_STATE_FILE)
}

function readBrandState(site) {
  const path = brandStatePath(site)
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function atomicWrite(path, content) {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, content, 'utf8')
  renameSync(temp, path)
}

function nextBrandState(site, snapshot = null) {
  const current = readBrandState(site)
  const sourceVersion = String(snapshot?.version || '1').replace(/[^a-zA-Z0-9._-]/g, '-')
  const revision = Math.max(1, Number(current.revision) || 1)
  const sameVersion = current.version === sourceVersion
  return {
    revision,
    version: sourceVersion,
    brandKitVersionId: sameVersion && current.brandKitVersionId
      ? current.brandKitVersionId
      : `brand-${site}-version-${sourceVersion}-r${revision}`,
    snapshotHash: snapshot?.snapshotHash || current.snapshotHash || null
  }
}

function snapshotHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function canonicalPalette(site, brandCore) {
  if (String(site).toLowerCase() === 'escarlet') return { ...CANONICAL_ESCARLET_PALETTE }
  const palette = objectOrEmpty(objectOrEmpty(objectOrEmpty(brandCore).fixed).palette)
  return Object.fromEntries(Object.entries(palette).filter(([, value]) => isColorValue(value)))
}

function canonicalReferencePath(site, filename) {
  const path = join(mediaDir, site, 'reference', filename)
  return existsSync(path) ? path : ''
}

function canonicalReferenceImages(site) {
  if (String(site).toLowerCase() !== 'escarlet') return []
  return CANONICAL_ESCARLET_REFERENCES.map((definition) => {
    const path = canonicalReferencePath(site, definition.filename)
    if (!path) return { ...definition, path: `/media/${site}/reference/${definition.filename}`, url: '', thumbUrl: '' }
    const publicPath = `/media/${site}/reference/${definition.filename}`
    const publicBase = canonicalCmsPublicUrl(process.env.CMS_PUBLIC_URL || CANONICAL_CMS_URL)
    const client = mediaForClient({
      id: definition.mediaId,
      mediaId: definition.mediaId,
      site,
      filename: definition.filename,
      path: publicPath,
      url: publicPath,
      thumbPath: publicPath,
      thumbUrl: publicPath,
      kind: 'reference',
      alt: definition.alt
    }, { absolute: true })
    return {
      ...definition,
      site,
      kind: 'reference',
      path: client.path || publicPath,
      url: `${publicBase}${publicPath}`,
      thumbUrl: `${publicBase}${publicPath}`,
      available: true
    }
  })
}

function normalizeCanonicalReferenceLibrary(site, source) {
  if (String(site).toLowerCase() !== 'escarlet') return objectOrEmpty(source)
  const references = CANONICAL_ESCARLET_REFERENCES.map((item, index) => ({
    id: item.id,
    type: item.role,
    category: item.role === 'scene-reference' ? 'escenas' : 'autoridad visual',
    tags: item.role === 'background-authority' ? ['fondo', 'textura', 'montañas'] : ['Escarlet', 'referencia aprobada'],
    description: item.alt,
    recommendedUse: [],
    prohibitedUse: ['sustituir o reinterpretar la referencia'],
    priority: index + 1,
    filename: item.filename,
    mediaId: item.mediaId,
    approved: true
  }))
  return { site: 'escarlet', version: '2.2.0', selection: IMAGE_ROUTE_POLICY, references }
}

function referenceSelectionPolicyForBrand(site, referenceLibrary, references) {
  if (String(site).toLowerCase() === 'escarlet') return IMAGE_ROUTE_POLICY
  const declared = objectOrEmpty(referenceLibrary?.selection || referenceLibrary?.selectionPolicy)
  const declaredRoutes = objectOrEmpty(declared.routes)
  const known = new Set((references || []).map((reference) => reference.filename))
  const cleanRoutes = Object.fromEntries(Object.entries(declaredRoutes)
    .map(([route, filenames]) => [route, Array.isArray(filenames) ? filenames.map(String).filter((filename) => known.has(filename)) : []])
    .filter(([, filenames]) => filenames.length > 0))
  if (Object.keys(cleanRoutes).length) {
    return {
      mode: 'deterministic',
      assistantMayChoose: false,
      assistantMaySubstitute: false,
      priority: ['abstract_or_background', 'introspective_or_tense', 'human_or_work', 'positive_or_inspirational'],
      routes: cleanRoutes
    }
  }
  const libraryReferences = Array.isArray(referenceLibrary?.references) ? referenceLibrary.references : []
  const metadata = new Map(libraryReferences.map((reference) => [String(reference.filename || ''), reference]))
  const anchors = (references || []).filter((reference) => {
    const role = String(metadata.get(reference.filename)?.role || reference.role || '').toLowerCase()
    return metadata.get(reference.filename)?.required === true || /authority|background|visual|material/.test(role)
  }).map((reference) => reference.filename)
  const fallbackAnchors = anchors.length ? anchors.slice(0, 2) : (references || []).slice(0, 2).map((reference) => reference.filename)
  const scenes = (references || []).map((reference) => reference.filename).filter((filename) => !fallbackAnchors.includes(filename))
  const route = (scene) => [...new Set([...fallbackAnchors, ...(scene ? [scene] : [])])]
  const routes = {
    abstract_or_background: route(),
    introspective_or_tense: route(scenes[0]),
    human_or_work: route(scenes[1] || scenes[0]),
    positive_or_inspirational: route(scenes[2] || scenes[1] || scenes[0])
  }
  return {
    mode: 'deterministic',
    assistantMayChoose: false,
    assistantMaySubstitute: false,
    priority: ['abstract_or_background', 'introspective_or_tense', 'human_or_work', 'positive_or_inspirational'],
    routes: Object.fromEntries(Object.entries(routes).filter(([, filenames]) => filenames.length > 0))
  }
}

/**
 * Loads the only brand snapshot used by all brand MCP tools. Callers receive
 * cloned data so a response cannot mutate the process cache.
 */
export function loadCanonicalBrandKit(site, { forceReload = false } = {}) {
  const handle = String(site || '').trim().toLowerCase()
  if (!handle) throw new Error('site es obligatorio')
  ensureBrandKit(handle)
  const cached = canonicalSnapshotCache.get(handle)
  if (cached && !forceReload) return structuredClone(cached)

  const rawFiles = Object.fromEntries(BRAND_ALL_FILES.map((name) => [name, readBrandFile(handle, name)]))
  const files = String(handle).toLowerCase() === 'escarlet'
    ? Object.fromEntries(Object.entries(rawFiles).map(([name, value]) => [name, canonicalizeEscarletLegacyColors(value)]))
    : rawFiles
  const brandCoreRaw = manifestJson({ 'brand-core': files['brand-core.json'] }, 'brand-core', readContentSystemJson(handle, 'brand-core'))
  const brandCore = String(handle).toLowerCase() === 'escarlet'
    ? { ...canonicalizeEscarletLegacyColors(brandCoreRaw || {}), version: '2.2.0', fixed: { ...objectOrEmpty(brandCoreRaw?.fixed), palette: { ...CANONICAL_ESCARLET_PALETTE } } }
    : brandCoreRaw
  const referenceLibrary = normalizeCanonicalReferenceLibrary(handle, manifestJson({ 'reference-library': files['reference-library.json'] }, 'reference-library', readContentSystemJson(handle, 'reference-library')))
  const imageSpecRaw = parseImageSpec(files['image-spec.json']) || readContentSystemJson(handle, 'image-spec') || {}
  const imageSpec = String(handle).toLowerCase() === 'escarlet' ? canonicalizeEscarletLegacyColors(imageSpecRaw) : imageSpecRaw
  const visualSystem = String(handle).toLowerCase() === 'escarlet' ? canonicalizeEscarletLegacyColors(readContentSystemJson(handle, 'visual-system')) : readContentSystemJson(handle, 'visual-system')
  const imageArchetypes = String(handle).toLowerCase() === 'escarlet' ? canonicalizeEscarletLegacyColors(readContentSystemJson(handle, 'image-archetypes')) : readContentSystemJson(handle, 'image-archetypes')
  const socialTemplates = String(handle).toLowerCase() === 'escarlet' ? canonicalizeEscarletLegacyColors(readContentSystemJson(handle, 'social-templates')) : readContentSystemJson(handle, 'social-templates')
  const listedReferences = String(handle).toLowerCase() === 'escarlet' ? canonicalReferenceImages(handle) : listReferenceImages(handle)
  const referenceMetadata = new Map((Array.isArray(referenceLibrary?.references) ? referenceLibrary.references : []).map((reference) => [String(reference.filename || ''), reference]))
  const references = listedReferences.map((reference) => ({ ...objectOrEmpty(referenceMetadata.get(reference.filename)), ...reference }))
  const referenceSelectionPolicy = referenceSelectionPolicyForBrand(handle, referenceLibrary, references)
  const palette = canonicalPalette(handle, brandCore)
  const sourceVersion = String(handle).toLowerCase() === 'escarlet'
    ? '2.2.0'
    : String(imageSpec.schema_version || imageSpec.version || brandCore?.version || referenceLibrary?.version || '1')
  const normalized = {
    site: handle,
    version: sourceVersion,
    palette,
    brandCore,
    referenceLibrary,
    imageSpec,
    visualSystem,
    imageArchetypes,
    socialTemplates,
    references,
    files,
    referenceSelectionPolicy,
    backgroundDirective: {
      required: true,
      filename: 'fondo-escarlet.jpg',
      texture: 'organic layered mountain forms',
      flow: 'cyan-left, soft-green-center, warm-gold-right'
    }
  }
  const hash = snapshotHash(normalized)
  const state = nextBrandState(handle, { version: sourceVersion, snapshotHash: hash })
  const snapshot = { ...normalized, ...state, snapshotHash: hash }
  canonicalSnapshotCache.set(handle, snapshot)
  return structuredClone(snapshot)
}

export function loadActiveBrandKitSnapshot(site, { manifest = {}, assets = [], brandKitVersionId, version } = {}) {
  const handle = String(site || '').trim().toLowerCase()
  if (!handle) throw new Error('site es obligatorio')
  const source = objectOrEmpty(manifest)
  const files = Object.fromEntries(BRAND_ALL_FILES.map((name) => {
    const value = source[name]
    const normalized = normalizeGenerationGuidance(value)
    const text = typeof normalized === 'string' ? normalized : normalized && typeof normalized === 'object' ? JSON.stringify(normalized, null, 2) : ''
    return [name, handle === 'escarlet' ? canonicalizeEscarletLegacyColors(text) : text]
  }))
  const brandCoreRaw = normalizeGenerationGuidance(manifestJson({ ...source, 'brand-core': files['brand-core.json'] }, 'brand-core', {}))
  const brandCore = handle === 'escarlet'
    ? { ...canonicalizeEscarletLegacyColors(brandCoreRaw), version: '2.2.0', fixed: { ...objectOrEmpty(brandCoreRaw?.fixed), palette: { ...CANONICAL_ESCARLET_PALETTE } } }
    : brandCoreRaw
  const referenceLibrary = normalizeCanonicalReferenceLibrary(handle, normalizeGenerationGuidance(manifestJson({ ...source, 'reference-library': files['reference-library.json'] }, 'reference-library', {})))
  const imageSpec = normalizeGenerationGuidance(manifestJson({ ...source, 'image-spec': files['image-spec.json'] }, 'image-spec', {}))
  const visualSystem = normalizeGenerationGuidance(manifestJson({ ...source, 'visual-system': files['visual-system.json'] }, 'visual-system', {}))
  const imageArchetypes = normalizeGenerationGuidance(manifestJson({ ...source, 'image-archetypes': files['image-archetypes.json'] }, 'image-archetypes', {}))
  const socialTemplates = normalizeGenerationGuidance(manifestJson({ ...source, 'social-templates': files['social-templates.json'] }, 'social-templates', {}))
  const metadata = new Map((Array.isArray(referenceLibrary.references) ? referenceLibrary.references : []).map((reference) => [String(reference.filename || ''), reference]))
  const references = (Array.isArray(assets) ? assets : []).map((asset, index) => {
    const rawFilename = String(asset.name || asset.filename || asset.storageKey || asset.path || '').trim()
    const filename = rawFilename.split(/[\\/]/).pop()
    const details = objectOrEmpty(asset.metadata)
    const library = objectOrEmpty(metadata.get(filename))
    let path = String(asset.storageKey || asset.path || '').trim()
    if (path.startsWith(`${mediaDir}/`)) path = `/media/${path.slice(mediaDir.length + 1)}`
    else if (path.startsWith('media/')) path = `/${path}`
    return {
      ...library,
      id: asset.id || library.id || `brand-asset-${index + 1}`,
      mediaId: asset.id || library.mediaId || null,
      filename,
      role: details.role || library.role || (index < 2 ? 'visual-authority' : 'scene-reference'),
      required: details.required === true || library.required === true,
      alt: details.alt || library.description || filename,
      path,
      storageKey: asset.storageKey || null,
      url: asset.publicUrl || asset.url || path,
      thumbUrl: asset.publicUrl || asset.url || path,
      sha256: asset.sha256 || null,
      available: Boolean(path || asset.publicUrl || asset.url)
    }
  }).filter((reference) => reference.filename)
  const palette = canonicalPalette(handle, brandCore)
  const normalized = {
    site: handle,
    version: String(version || imageSpec.schema_version || imageSpec.version || brandCore.version || '1'),
    brandKitVersionId: String(brandKitVersionId || ''),
    palette,
    brandCore,
    referenceLibrary,
    imageSpec,
    visualSystem,
    imageArchetypes,
    socialTemplates,
    references,
    files,
    referenceSelectionPolicy: referenceSelectionPolicyForBrand(handle, referenceLibrary, references),
    backgroundDirective: objectOrEmpty(imageSpec.backgroundDirective)
  }
  return { ...normalized, snapshotHash: snapshotHash(normalized) }
}

export function invalidateBrandKitCache(site) {
  canonicalSnapshotCache.delete(String(site || '').trim().toLowerCase())
}

const PRIVATE_VISUAL_KEYS = /token|secret|password|credential|cipher|storage.?key|api.?key|private.?key|url|path/i
const CREDENTIAL_ASSIGNMENT = /(\b(?:[a-z0-9]+[_ -])*(?:key|token|secret|password|credential|ciphertext)\b\s*[:=]\s*)([^\s,;]+)/gi

function redactSensitiveText(value) {
  return String(value ?? '')
    .replace(CREDENTIAL_ASSIGNMENT, '$1[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
}

function redactBrandDocumentText(value) {
  return redactSensitiveText(value)
    .split(/\r?\n/)
    .filter((line) => !/\bapi\s+key\b|\btoken\s+(?:pat|secret)\b|\b(?:password|credential|secret)\s*[:=]/i.test(line))
    .join('\n')
}

function sanitizeVisualObject(value, depth = 0) {
  if (depth > 8 || value == null) return value
  if (typeof value === 'string') return redactSensitiveText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeVisualObject(item, depth + 1))
  if (typeof value !== 'object') return undefined
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_VISUAL_KEYS.test(key))
      .map(([key, item]) => [key, sanitizeVisualObject(item, depth + 1)])
  )
}

function isColorValue(value) {
  return typeof value === 'string' && (/^#[0-9a-f]{3,8}$/i.test(value.trim()) || /^(rgb|hsl)a?\(/i.test(value.trim()))
}

function stringArray(value, limit = 30) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, limit) : []
}

function safeImageSpec(spec) {
  const source = objectOrEmpty(spec)
  const global = objectOrEmpty(source.global)
  const fixedIdentity = objectOrEmpty(global.fixedIdentity)
  const referenceSelection = objectOrEmpty(global.referenceSelection)
  const blogSource = objectOrEmpty(source.blogCover)
  const carouselSource = objectOrEmpty(source.instagramCarousel)
  const blogCover = {
    allowText: blogSource.allowText === true,
    aspectRatio: String(blogSource.aspectRatio || ''),
    recentPostsToInspect: Number(blogSource.recentPostsToInspect) || 0,
    maxConsecutiveArchetype: Number(blogSource.maxConsecutiveArchetype) || 0,
    forceDifferentTopicSimilarity: Number(blogSource.forceDifferentTopicSimilarity) || 0,
    metadataRequired: stringArray(blogSource.metadataRequired)
  }
  const carouselSlides = objectOrEmpty(carouselSource.slides)
  const readability = objectOrEmpty(carouselSource.mobileReadability)
  const backgroundGeneration = objectOrEmpty(carouselSource.backgroundGeneration)
  const slideSpec = (section) => {
    const sourceSection = objectOrEmpty(carouselSource[section])
    return {
      background: String(sourceSection.background || ''),
      allowGradients: sourceSection.allowGradients === true,
      avoidSaturatedColors: sourceSection.avoidSaturatedColors === true,
      overlay: String(sourceSection.overlay || ''),
      textColor: String(sourceSection.textColor || ''),
      logo: String(sourceSection.logo || '')
    }
  }
  const textLayout = objectOrEmpty(carouselSource.textLayout)
  const logo = objectOrEmpty(carouselSource.logo)
  const instagramCarousel = {
    slides: {
      min: Number(carouselSlides.min) || 0,
      max: Number(carouselSlides.max) || 0,
      default: Number(carouselSlides.default) || 0
    },
    dimensions: String(carouselSource.dimensions || ''),
    allowText: carouselSource.allowText === true,
    textSource: String(carouselSource.textSource || ''),
    textGuidance: String(carouselSource.textGuidance || ''),
    textLayout: {
      maxLinesPerBlock: Number(textLayout.maxLinesPerBlock) || 3,
      headlineMinFontSize: Number(textLayout.headlineMinFontSize) || 86,
      bodyMinFontSize: Number(textLayout.bodyMinFontSize) || 34,
      splitWhenOverflow: textLayout.splitWhenOverflow !== false,
      mobileFirstRead: textLayout.mobileFirstRead !== false
    },
    logo: {
      asset: String(logo.asset || ''),
      requiredOn: stringArray(logo.requiredOn, 4),
      placement: String(logo.placement || ''),
      doNotRedraw: logo.doNotRedraw !== false
    },
    mobileReadability: {
      required: readability.required === true,
      firstRead: readability.firstRead === true,
      allowFontShrinkingToFit: readability.allowFontShrinkingToFit === true,
      overflowAction: String(readability.overflowAction || ''),
      decorativeDashes: readability.decorativeDashes === true,
      textBorder: readability.textBorder === true,
      textOutline: readability.textOutline === true,
      textStroke: readability.textStroke === true
    },
    backgroundGeneration: {
      allowText: backgroundGeneration.allowText === true,
      role: String(backgroundGeneration.role || '')
    },
    templates: stringArray(carouselSource.templates),
    firstSlide: slideSpec('firstSlide'),
    middleSlides: slideSpec('middleSlides'),
    lastSlide: slideSpec('lastSlide')
  }
  return sanitizeVisualObject({
    ...(source.version ? { version: source.version } : {}),
    global: {
      avoidEmbeddedText: Boolean(global.avoidEmbeddedText),
      referenceFidelity: String(global.referenceFidelity || ''),
      altText: String(global.altText || ''),
      fixedIdentity: {
        palette: Array.isArray(fixedIdentity.palette) ? fixedIdentity.palette.filter(isColorValue).slice(0, 24) : [],
        typography: String(fixedIdentity.typography || ''),
        coverHasText: fixedIdentity.coverHasText === true
      },
      referenceSelection: {
        approvedOnly: referenceSelection.approvedOnly !== false,
        mustConsultForAnyImage: referenceSelection.mustConsultForAnyImage !== false,
        passToGenerator: referenceSelection.passToGenerator !== false,
        coverCountAutomatic: Number(referenceSelection.coverCountAutomatic) || (referenceSelection.coverCountAutomatic === 'route' ? 'route' : 0),
        coverCountExploration: Number(referenceSelection.coverCountExploration) || 0,
        socialCount: Number(referenceSelection.socialCount) || 0
      }
    },
    blogCover,
    instagramCarousel
  })
}

function buildSanitizedVisualContext({ brandCore, visualSystem, imageArchetypes, referenceLibrary, socialTemplates, imageSpec }) {
  const core = objectOrEmpty(brandCore)
  const identity = objectOrEmpty(core.identity)
  const fixed = objectOrEmpty(core.fixed)
  const palette = objectOrEmpty(fixed.palette)
  const typography = objectOrEmpty(fixed.typography)
  const visual = objectOrEmpty(visualSystem)
  const approvedReferences = Array.isArray(referenceLibrary?.references)
    ? referenceLibrary.references
      .filter((reference) => reference && reference.approved !== false)
      .map((reference) => sanitizeVisualObject({
        id: String(reference.id || ''),
        type: String(reference.type || ''),
        category: String(reference.category || ''),
        tags: stringArray(reference.tags),
        description: String(reference.description || ''),
        recommendedUse: stringArray(reference.recommendedUse),
        prohibitedUse: stringArray(reference.prohibitedUse),
        priority: Number(reference.priority) || 0
      }))
    : []
  const imageRules = Array.isArray(fixed.imageRules) ? fixed.imageRules.map(String).filter(Boolean) : []
  const negativeRules = imageRules.filter((rule) => /\b(no|evitar|nunca|prohibid)/i.test(rule))
  const positiveRules = imageRules.filter((rule) => !negativeRules.includes(rule))
  const safeSpec = safeImageSpec(imageSpec)
  const paletteValues = Object.values(palette).filter(isColorValue)
  const typographyValues = Object.fromEntries(Object.entries(typography).filter(([key, value]) => ['heading', 'body', 'label'].includes(key) && typeof value === 'string' && value.trim()))
  const templateFonts = Array.isArray(socialTemplates?.templates)
    ? socialTemplates.templates.map((template) => objectOrEmpty(template?.font))
    : []
  const typographyWeights = [...new Set(templateFonts.flatMap((font) => [font.headlineWeight, font.bodyWeight].map(Number).filter(Number.isFinite)))]
  const typographyContext = {
    ...typographyValues,
    weights: typographyWeights,
    uses: {
      heading: 'titulares y titulares de portada',
      body: 'texto editorial y captions',
      label: 'etiquetas, metadatos y UI'
    }
  }
  const safeComposition = sanitizeVisualObject(visual.cover || safeSpec.blogCover || {})
  const safeSocialComposition = sanitizeVisualObject(visual.social || safeSpec.instagramCarousel || {})
  const visualStyle = {
    tone: String(identity.visualTone || ''),
    photography: String(identity.photography || ''),
    people: String(identity.people || ''),
    palette: paletteValues,
    typography: typographyContext,
    composition: safeComposition,
    treatment: Array.isArray(visual.cover?.treatment) ? visual.cover.treatment.map(String).slice(0, 30) : [],
    positiveRules,
    negativeRules,
    referencesRequired: safeSpec.global.referenceSelection.mustConsultForAnyImage
  }
  const imageGuide = {
    altText: safeSpec.global.altText,
    filenameConvention: 'minúsculas y kebab-case',
    referenceUsage: 'Usar referencias aprobadas para orientar materia, luz y encuadre sin copiar literalmente.',
    uploadKind: 'reference'
  }
  return {
    version: core.version || visual.version || safeSpec.version || null,
    identity: {
      name: String(identity.name || ''),
      visualTone: String(identity.visualTone || ''),
      contrast: String(identity.contrast || ''),
      photography: String(identity.photography || ''),
      people: String(identity.people || ''),
      embeddedText: identity.embeddedText === true
    },
    palette: paletteValues,
    typography: typographyContext,
    composition: safeComposition,
    socialComposition: safeSocialComposition,
    positiveRules,
    negativeRules,
    backgrounds: Array.isArray(visual.cover?.treatment) ? visual.cover.treatment.map(String).slice(0, 30) : [],
    textures: ['papel', 'madera', 'cerámica', 'tela', 'materia real'],
    objects: ['objeto de oficio', 'material editorial', 'detalle de marca'],
    visualStyle,
    imageGuide,
    imageSpec: safeSpec,
    brandCore: {
      id: core.id || null,
      version: core.version || null,
      identity: {
        visualTone: String(identity.visualTone || ''),
        contrast: String(identity.contrast || ''),
        photography: String(identity.photography || ''),
        people: String(identity.people || ''),
        embeddedText: identity.embeddedText === true
      },
      fixed: {
        palette: Object.fromEntries(Object.entries(palette).filter(([, value]) => isColorValue(value))),
        typography: Object.fromEntries(Object.entries(typography).filter(([key, value]) => ['heading', 'body', 'label'].includes(key) && typeof value === 'string' && value.trim())),
        spacing: sanitizeVisualObject(fixed.spacing || {}),
        imageRules
      }
    },
    visualSystem: sanitizeVisualObject(visual),
    imageArchetypes: Array.isArray(imageArchetypes?.archetypes) ? imageArchetypes.archetypes.map((item) => sanitizeVisualObject(item)) : [],
    archetypes: Array.isArray(imageArchetypes?.archetypes) ? imageArchetypes.archetypes.map((item) => sanitizeVisualObject(item)) : [],
    referenceLibrary: sanitizeVisualObject({ ...objectOrEmpty(referenceLibrary), references: approvedReferences }),
    references: approvedReferences,
    socialTemplates: Array.isArray(socialTemplates?.templates) ? socialTemplates.templates.map((item) => sanitizeVisualObject(item)) : []
  }
}

function manifestJson(manifest, filename, fallback = null) {
  const value = manifest?.[filename] ?? manifest?.[`${filename}.json`]
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return fallback
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

export const BRAND_FILE_LABELS = {
  'voice.md': 'Voz de marca',
  'visual-style.md': 'Estilo de imágenes',
  'image-guide.md': 'Nombres y alt SEO',
  'keywords.md': 'Keywords',
  'AGENT.md': 'Reglas del agente (AGENT.md)',
  'image-spec.json': 'Spec de imágenes (JSON)',
  'brand-core.json': 'Brand core canónico (JSON)',
  'reference-library.json': 'Biblioteca de referencias canónica (JSON)'
}

const FILE_ALIASES = {
  'agent-rules.md': 'AGENT.md',
  'agent.md': 'AGENT.md'
}

function resolveFilename(filename) {
  const name = basenameSafe(filename)
  return FILE_ALIASES[name] || name
}

const V2_AGENT_TOOL_REPLACEMENTS = Object.freeze({
  blog_get_brand_context: 'brand_get_context',
  blog_get_workflow: 'content_list_plans',
  blog_list_posts: 'content_list_items',
  blog_get_post: 'content_get_batch',
  blog_create_draft: 'content_create_batch',
  blog_update_post: 'content_update_item',
  blog_publish: 'content_approve',
  blog_request_changes: 'content_update_item',
  blog_schedule_post: 'content_schedule',
  blog_cancel_schedule: 'content_cancel',
  blog_list_calendar: 'content_list_calendar',
  blog_unpublish: 'content_cancel',
  blog_delete_post: 'content_cancel',
  social_save_pack: 'content_create_batch',
  social_list_packs: 'content_list_items',
  social_get_pack: 'content_get_batch',
  blog_save_social_pack: 'content_update_item',
  blog_update_brand_file: 'la gestión del brand kit en la app v2',
  blog_import_brand_zip: 'la importación del brand kit desde la app v2',
  blog_upload_media_file: 'content_upload_media',
  blog_upload_media: 'content_upload_media',
  blog_open_image_drop: 'content_upload_media',
  blog_import_remote_image: 'content_upload_media'
})

function normalizeAgentRulesForV2(content) {
  let text = String(content || '')
  for (const [legacy, replacement] of Object.entries(V2_AGENT_TOOL_REPLACEMENTS)) {
    text = text.replaceAll(legacy, replacement)
  }
  if (/content_list_items|content_create_batch|brand_get_context/.test(text) && !/Contrato MCP v2/.test(text)) {
    text = `${text.trim()}\n\n## Contrato MCP v2\n\nSi tienes acceso a varias marcas, llama brand_list y pregunta cuál quiere usar. Incluye el site elegido en cada llamada. El contenido vive en Postgres y se consulta con content_list_plans, content_list_items, content_get_batch y content_list_calendar. La gestión usa content_update_item, content_approve, content_schedule y content_cancel.`
  }
  return text ? `${text}\n` : text
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
  const raw = String(filename || '')
  if (raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
    const err = new Error('Nombre de archivo de brand kit no permitido.')
    err.status = 400
    throw err
  }
  const name = resolveFilename(filename)
  if (!BRAND_ALL_FILES.includes(name)) {
    const err = new Error(`Archivo de brand kit no permitido. ${name}`)
    err.status = 400
    throw err
  }
  const role = workspaceRoleForAuth(auth)
  if (isSecretBrandFile(name) && !['admin', 'owner'].includes(role)) {
    const currentRole = auth?.role || role || 'desconocido'
    const err = new Error(
      write
        ? `Solo owner/admin puede editar este archivo del brand kit. Tu rol actual es ${currentRole}.`
        : `Este archivo del brand kit es privado. Solo owner/admin puede leerlo. Tu rol actual es ${currentRole}.`
    )
    err.status = 403
    err.code = 'brand_kit_write_forbidden'
    err.extra = { code: 'brand_kit_write_forbidden', file: name, currentRole, requiredRoles: ['owner', 'admin'] }
    throw err
  }
  return name
}

export function brandKitWriteAccess(auth) {
  const workspaceRole = workspaceRoleForAuth(auth)
  const currentRole = auth?.role || workspaceRole || null
  const writesBrandKit = workspaceRole === 'admin' || workspaceRole === 'owner'
  return {
    writesBrandKit,
    currentRole,
    workspaceRole,
    requiredRoles: ['owner', 'admin'],
    writableFiles: writesBrandKit ? brandFilesForAuth(auth) : [],
    writeDeniedReason: writesBrandKit
      ? null
      : `No puedes modificar el brand kit con el rol ${currentRole || 'actual'}. Hace falta owner o admin del espacio.`
  }
}

export function assertBrandKitWritable(auth) {
  const access = brandKitWriteAccess(auth)
  if (access.writesBrandKit) return access
  const err = new Error(access.writeDeniedReason)
  err.status = 403
  err.code = 'brand_kit_write_forbidden'
  err.extra = { code: 'brand_kit_write_forbidden', ...access }
  throw err
}

export function brandFilesForAuth(auth) {
  const role = workspaceRoleForAuth(auth)
  if (role === 'admin' || role === 'owner') return [...BRAND_ALL_FILES]
  if (role === 'viewer' || auth?.role === 'public') return []
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
  if (existsSync(runtimePath)) {
    const content = readFileSync(runtimePath, 'utf8')
    // Recover a known placeholder left by interrupted legacy imports without
    // overwriting a real user edit.
    if (content.trim().toLowerCase() === '# no') {
      const seedPath = join(getBrandSeedDir(site), name)
      if (existsSync(seedPath)) return readFileSync(seedPath, 'utf8')
    }
    return name === 'AGENT.md' ? normalizeAgentRulesForV2(content) : content
  }
  const seedPath = join(getBrandSeedDir(site), name)
  if (existsSync(seedPath)) {
    const content = readFileSync(seedPath, 'utf8')
    return name === 'AGENT.md' ? normalizeAgentRulesForV2(content) : content
  }
  if (name === 'AGENT.md') {
    const legacy = join(getBrandSeedDir(site), 'agent-rules.md')
    if (existsSync(legacy)) return normalizeAgentRulesForV2(readFileSync(legacy, 'utf8'))
  }
  return ''
}

export function writeBrandFile(site, filename, content) {
  const raw = String(filename || '')
  if (raw.includes('/') || raw.includes('\\') || raw.includes('..')) throw new Error('Nombre de archivo de brand kit no permitido.')
  const name = resolveFilename(filename)
  if (!BRAND_ALL_FILES.includes(name)) {
    throw new Error(`Archivo de brand kit no permitido. ${name}`)
  }
  let text = String(content ?? '')
  text = normalizeBrandFileContent(name, text)
  ensureBrandKit(site)
  const path = join(getBrandKitDir(site), name)
  if (existsSync(path)) {
    const historyDir = join(getBrandKitDir(site), '.history')
    mkdirSync(historyDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    copyFileSync(path, join(historyDir, `${stamp}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`))
  }
  atomicWrite(path, text)
  invalidateBrandKitCache(site)
  bumpBrandKitState(site)
  return path
}

function normalizeBrandFileContent(name, content) {
  if (name === 'image-spec.json') return normalizeImageSpecJson(content)
  if (!CANONICAL_BRAND_JSON_FILES.includes(name)) return String(content ?? '')
  let parsed
  try {
    parsed = JSON.parse(String(content ?? '').trim())
  } catch {
    throw new Error(`${name} no es JSON válido`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${name} debe ser un objeto JSON`)
  if (name === 'brand-core.json') {
    if (parsed.id !== undefined && !/^[a-z0-9-]+$/i.test(String(parsed.id))) throw new Error('brand-core.json.id no es válido')
    if (!parsed.fixed || typeof parsed.fixed !== 'object') throw new Error('brand-core.json requiere fixed')
    if (!parsed.fixed.palette || typeof parsed.fixed.palette !== 'object') throw new Error('brand-core.json requiere fixed.palette')
  }
  if (name === 'reference-library.json') {
    if (!Array.isArray(parsed.references)) throw new Error('reference-library.json requiere references')
    if (parsed.site && typeof parsed.site !== 'string') throw new Error('reference-library.json.site no es válido')
  }
  return `${JSON.stringify(parsed, null, 2)}\n`
}

function bumpBrandKitState(site) {
  const handle = String(site || '').trim().toLowerCase()
  const current = readBrandState(handle)
  const snapshot = loadCanonicalBrandKit(handle, { forceReload: true })
  const revision = Math.max(1, Number(current.revision) || 1) + 1
  const version = snapshot.version || '1'
  const state = {
    revision,
    version,
    brandKitVersionId: `brand-${handle}-version-${version.replace(/[^a-zA-Z0-9._-]/g, '-')}-r${revision}`,
    snapshotHash: snapshot.snapshotHash
  }
  atomicWrite(brandStatePath(handle), `${JSON.stringify(state, null, 2)}\n`)
  canonicalSnapshotCache.set(handle, { ...snapshot, ...state })
  return state
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
  atomicWrite(path, `${JSON.stringify(parsed, null, 2)}\n`)
  invalidateBrandKitCache(site)
  bumpBrandKitState(site)
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
  const canonical = canonicalReferenceImages(site)
  if (canonical.length) return canonical
  const db = readDb()
  const items = (db.media || []).filter((m) => m.site === site && m.kind === 'reference' && m.approved !== false)
  const dir = join(mediaDir, site, 'reference')
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (!/\.(webp|jpg|jpeg|png|gif)$/i.test(name)) continue
      if (/_thumb\.(webp|jpg|jpeg|png|gif)$/i.test(name)) continue
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
  }
  return items.map((item) => {
    const client = mediaForClient(item, { absolute: true })
    const safe = {
      site,
      id: client.id || client.mediaId || null,
      filename: client.filename || basenameSafe(client.path || client.url),
      kind: 'reference',
      alt: String(client.alt || ''),
      mediaId: client.mediaId || client.id || null,
      path: client.path || '',
      url: client.url || '',
      ...(client.thumbPath ? { thumbPath: client.thumbPath } : {}),
      ...(client.thumbUrl ? { thumbUrl: client.thumbUrl } : {})
    }
    for (const key of ['version', 'sha256', 'hash']) {
      if (client[key]) safe[key] = client[key]
    }
    return safe
  })
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
  if (channels.instagramStory) {
    fields.push(
      field(
        'socialPack.instagramStory',
        'recommended',
        '¿Copy breve e imagen vertical para Instagram Story? El servidor añadirá la URL canónica del artículo para el link sticker de Buffer.',
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
    'brand_get_context para cargar las reglas y referencias permitidas del sitio',
    'Aplica sharedEditorialPolicy como política editorial común, junto con la voz, audiencia y restricciones del sitio',
    'Si hay varias marcas, llama brand_list y pregunta al humano cuál quiere usar. Incluye el site elegido en cada llamada',
    'Antes de generar cualquier imagen, llama brand_prepare_image_generation. Recibe un ImageContent por llamada y repite con preparationId y referenceIndex hasta completar todas las referencias. Conserva el orden, no uses Pillow ni sustituyas referencias y detén la generación solo si generationBlocked es true.',
    'ChatGPT genera título, cuerpo, resumen, meta y todos los píxeles finales. MCP no llama APIs de IA. Crea el draft con content_create_batch y sube cada imagen con preparationId, channels y assetIndex, incluyendo itemId solo si ya existe.',
    'Cuando todas las variantes y medios estén completos, llama content_update_item con readyForReview=true y deja la revisión humana en la app v2.',
    'content_upload_media calcula el hash, conserva el archivo recibido sin recomponerlo y lo asocia al item en la misma llamada.',
    'Si editas, localiza la publicación con content_list_items o content_get_batch y actualiza el itemId existente con content_update_item. Nunca crees otra campaña para editar.'
  ]
  if (channels.instagramCarousel) {
    steps.push(
      'Para Instagram, genera en ChatGPT cada slide final a 1080 × 1350 con headline, body y alt. No uses guiones decorativos ni borde, contorno, halo o sombra pegada al texto.'
    )
  }
  if (channels.instagramStory) {
    steps.push(
      'Para Instagram Story, genera en ChatGPT una imagen final de 1080 × 1920. Conserva la URL canónica del Blog en socialPack.instagramStory.linkUrl. Buffer la enviará como notificación para completar el link sticker en Instagram.'
    )
  }
  steps.push(
    'Tras la confirmación humana, usa content_approve. Para una fecha futura usa content_schedule con publicationDate y timezone.',
    'Para regenerar una portada, ChatGPT crea la imagen, la sube y actualiza la variante con content_update_item.',
    'Para detener una publicación o campaña todavía no publicada usa content_cancel.'
  )
  return steps
}

export function buildEditRules() {
  return [
    'Lista content_list_plans antes de crear y usa content_create_batch. title es el título de la campaña; items[].title es el título breve del post; items[].brief es el contexto editorial. Si hay campañas activas, pregunta cuál se reutiliza con batchId o si se crea otra con createNewCampaign=true. Nunca crees una campaña nueva sin esa decisión ni uses un brief largo como título visible.',
    'Para editar, usa content_list_items o content_get_batch y actualiza el itemId existente con content_update_item.',
    'Mantén la misma identidad del item y sus variantes. La revisión y los cambios de estado ocurren en la app v2.',
    'Para aprobar usa content_approve.',
    'Para detener una publicación o campaña todavía no publicada usa content_cancel.',
    'Lee postFields y pregunta al humano cada askHuman que aún no tengas. Comparte solo rutas de /app.'
  ]
}

export function getBrandContext(site, options = {}) {
  const canonical = options.canonicalManifest
    ? loadActiveBrandKitSnapshot(site, { manifest: options.canonicalManifest, assets: options.canonicalAssets, brandKitVersionId: options.brandKitVersionId, version: options.brandKitVersion?.version })
    : loadCanonicalBrandKit(site)
  const siteConfig = loadSiteConfig(site) || {}
  const auth = options.auth || null
  const access = resolveBrandAccess(auth, { brandCapabilities: options.brandCapabilities })
  const fullAccess = access.level === 'full'
  const sanitizedAccess = access.level === 'sanitized'
  // Postgres callers pass the active manifest and assets so app and MCP read
  // exactly the same versioned snapshot.
  const voiceSource = canonical.files['voice.md'] || ''
  const voice = fullAccess ? voiceSource : sanitizedAccess ? redactBrandDocumentText(voiceSource) : ''
  const visualStyleRaw = fullAccess ? canonical.files['visual-style.md'] || '' : ''
  const imageGuideRaw = fullAccess ? normalizeAgentRulesForV2(canonical.files['image-guide.md'] || '') : ''
  const keywordsSource = canonical.files['keywords.md'] || ''
  const agentRulesSource = canonical.files['AGENT.md'] || ''
  const keywords = fullAccess ? keywordsSource : redactBrandDocumentText(keywordsSource)
  const agentRules = withMediaUploadContract(fullAccess ? agentRulesSource : redactBrandDocumentText(agentRulesSource))
  const imageSpecRaw = fullAccess ? canonical.files['image-spec.json'] || '' : ''
  const imageSpec = fullAccess ? parseImageSpec(imageSpecRaw) : null
  // Read canonical sources server-side so editors receive a visual projection,
  // never a private source document assembled from another directory.
  const visualSourceSpec = fullAccess || sanitizedAccess ? canonical.imageSpec : null
  const brandCoreSource = fullAccess || sanitizedAccess ? canonical.brandCore : null
  const visualSystemSource = fullAccess || sanitizedAccess ? canonical.visualSystem : null
  const imageArchetypesSource = fullAccess || sanitizedAccess ? canonical.imageArchetypes : null
  const socialTemplatesSource = fullAccess || sanitizedAccess ? canonical.socialTemplates : null
  const referenceLibrarySource = fullAccess || sanitizedAccess ? canonical.referenceLibrary : null
  const sanitizedVisual = sanitizedAccess
    ? buildSanitizedVisualContext({
        brandCore: brandCoreSource,
        visualSystem: visualSystemSource,
        imageArchetypes: imageArchetypesSource,
        referenceLibrary: referenceLibrarySource,
        socialTemplates: socialTemplatesSource,
        imageSpec: visualSourceSpec
      })
    : null
  const visualStyle = fullAccess ? visualStyleRaw : sanitizedVisual?.visualStyle
  const imageGuide = fullAccess ? imageGuideRaw : sanitizedVisual?.imageGuide
  const referenceImages = access.level === 'none' ? [] : canonical.references

  const files = fullAccess
    ? {
        'voice.md': voice,
        'visual-style.md': visualStyleRaw,
        'image-guide.md': imageGuideRaw,
        'keywords.md': keywords,
        'AGENT.md': agentRules,
        'image-spec.json': imageSpecRaw,
        'brand-core.json': canonical.files['brand-core.json'] || '',
        'reference-library.json': canonical.files['reference-library.json'] || ''
      }
    : {
        'keywords.md': keywords,
        'AGENT.md': agentRules
      }

  const missingBrand = Object.entries(fullAccess ? {
    ...files,
    'AGENT.md': agentRulesSource
  } : {
    'keywords.md': keywordsSource,
    'AGENT.md': agentRulesSource
  })
    .filter(([name, content]) => {
      if (sanitizedAccess) return false
      if (name === 'image-spec.json') return false
      return !String(content || '').trim()
    })
    .map(([name]) => name)

  const base = {
    site,
    brandContextContract: 'normalized-v1',
    schemaVersion: '1.0.0',
    brandKitSnapshotHash: canonical.snapshotHash,
    keywords,
    agentRules,
    // This policy is server-owned and applies to every site. Site-specific
    // voice and workflow rules remain in the brand kit and are layered on top.
    sharedEditorialPolicy: SHARED_EDITORIAL_POLICY,
    referenceImages,
    authors: siteConfig.authors || ['Charly', 'Silvia'],
    seoLimits: siteConfig.seo || {},
    requiresHumanApproval: Boolean(siteConfig.requiresHumanApproval),
    requiresPublishConfirmation: siteConfig.requiresPublishConfirmation !== false,
    blogEnabled: siteConfig.blogEnabled !== false,
    socialPackChannels: getSocialPackChannels(siteConfig),
    postFields: buildPostFields(site),
    workflow: buildAgentWorkflow(site),
    mediaUpload: MEDIA_UPLOAD_CONTRACT,
    imageGenerationPolicy: GLOBAL_IMAGE_GENERATION_POLICY,
    editRules: buildEditRules(),
    missingBrand: sanitizedAccess
      ? [
          !String(keywordsSource || '').trim() ? 'keywords.md' : '',
          !String(agentRulesSource || '').trim() ? 'AGENT.md' : '',
          !(brandCoreSource || visualSystemSource || visualSourceSpec) ? 'normalized-brand-context' : ''
        ].filter(Boolean)
      : missingBrand,
    brandAccess: fullAccess ? 'full' : sanitizedAccess ? 'sanitized' : access.level === 'none' ? 'none' : 'client',
    brandAccessLevel: fullAccess ? 'full' : sanitizedAccess ? 'sanitized' : access.level,
    brandCapabilityDeclared: access.declared,
    brandCapabilityEffective: access.effective,
    grantedBrandResources: fullAccess
      ? [...BRAND_ALL_FILES, ...CONTENT_SYSTEM_DATA_FILES, 'referenceImages']
      : sanitizedAccess
        ? [...VISUAL_BRAND_RESOURCES]
        : access.level === 'limited'
          ? [...CLIENT_BRAND_FILES, 'referenceImages']
          : [],
    deniedBrandResources: fullAccess
      ? []
      : sanitizedAccess
        ? []
        : access.level === 'limited'
          ? [...SECRET_BRAND_FILES, ...CONTENT_SYSTEM_DATA_FILES]
          : [...BRAND_ALL_FILES, ...CONTENT_SYSTEM_DATA_FILES, 'referenceImages'],
    denialReasons: fullAccess
      ? {}
      : sanitizedAccess
        ? { sourceFiles: 'private_normalized_projection_only' }
        : access.siteEnabled === false
          ? { brandKit: 'site_brand_capability_disabled' }
          : access.declared === false
            ? { brandKit: 'membership_required' }
            : { brandKit: 'role_not_allowed' },
    brandKitVersionId: canonical.brandKitVersionId,
    brandKitVersion: canonical.version,
    canonicalPalette: canonical.palette,
    backgroundDirective: canonical.backgroundDirective,
    referenceSelectionPolicy: canonical.referenceSelectionPolicy,
    allowedBrandFiles: access.level === 'full'
      ? brandFilesForAuth(auth || { role: 'admin' })
      : access.level === 'none'
        ? []
        : [...CLIENT_BRAND_FILES],
    reminder: 'ChatGPT genera todos los textos y píxeles finales. Usa brand_prepare_image_generation una vez por referencia, repite con preparationId y referenceIndex, entrega todos los ImageContent al generador y sube con content_upload_media pasando preparationId, channels y assetIndex. Incluye itemId si ya existe; si no, conserva mediaAssetId para asociarlo al crear o actualizar el item. El CMS registra las referencias entregadas, conserva el archivo y exige aprobación humana.'
  }

  if (fullAccess) {
    return {
      ...base,
      voice,
      visualStyle,
      imageGuide,
      imageSpec,
      brandCore: brandCoreSource,
      visualSystem: visualSystemSource,
      imageArchetypes: imageArchetypesSource,
      socialTemplates: socialTemplatesSource,
      referenceLibrary: referenceLibrarySource,
      files
    }
  }

  if (sanitizedAccess) {
    const visualContext = { ...sanitizedVisual, voice, keywords, agentRules, referenceImages }
    return {
      ...base,
      voice,
      visualContext,
      visualStyle,
      imageGuide,
      imageSpec: visualContext.imageSpec,
      brandCore: visualContext.brandCore,
      visualSystem: visualContext.visualSystem,
      imageArchetypes: { archetypes: visualContext.archetypes },
      socialTemplates: { templates: visualContext.socialTemplates },
      referenceLibrary: visualContext.referenceLibrary,
      files
    }
  }

  return { ...base, files }
}

function briefText(input = {}) {
  return [input.assetType, input.title, input.summary, input.topic, input.tone, input.channel]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(' ')
}

export function classifyImageRoute(input = {}) {
  const text = briefText(input)
  const has = (terms) => terms.some((term) => text.includes(term))
  // Priority is intentionally explicit. The first matching rule wins, so the
  // assistant never has to score or choose between two visual directions.
  if (has(['abstract', 'background', 'fondo', 'texture', 'textura']) || input.assetType === 'instagram_background') return 'abstract_or_background'
  if (has(['introspect', 'tens', 'tension', 'tensión', 'doubt', 'duda', 'conflict', 'conflicto', 'pause', 'pausa', 'uncertain', 'incertidumbre', 'problema', 'riesgo', 'friccion', 'fricción', 'paradoja', 'ventaja'])) return 'introspective_or_tense'
  if (has(['human', 'people', 'persona', 'work', 'trabajo', 'design', 'diseño', 'collaboration', 'colaboración', 'team', 'equipo'])) return 'human_or_work'
  return 'positive_or_inspirational'
}

function archetypeForRoute(route) {
  return {
    human_or_work: 'escena-humana-parcial',
    introspective_or_tense: 'metafora-visual-conceptual',
    positive_or_inspirational: 'entorno-espacio',
    abstract_or_background: 'editorial-abstracta'
  }[route]
}

export function compositionForAssetType(assetType) {
  const type = String(assetType || 'blog_cover')
  if (type === 'instagram_story') return { aspectRatio: '9:16', dimensions: '1080x1920', allowedAspectRatios: ['9:16'], allowedDimensions: ['1080x1920'], requiresText: true, textSource: 'ChatGPT', subjectPlacement: 'right-third', negativeSpaceMinimum: '25%' }
  if (type === 'presentation') return { aspectRatio: '16:9', dimensions: '1920x1080', subjectPlacement: 'right-third', negativeSpaceMinimum: '25%' }
  if (type === 'social_image') return { aspectRatio: '4:5', dimensions: '1080x1350', allowedAspectRatios: ['4:5'], allowedDimensions: ['1080x1350'], requiresText: true, textSource: 'ChatGPT', subjectPlacement: 'right-third', negativeSpaceMinimum: '25%' }
  return { aspectRatio: '3:2', dimensions: '1536x1024', subjectPlacement: 'right-third', negativeSpaceMinimum: '25%' }
}

const IMAGE_PREPARATION_ASSET_TYPES = Object.freeze([
  'blog_cover',
  'social_image',
  'instagram_story',
  'presentation',
  'generic'
])

function imagePreparationFingerprint({ site, brandKitVersionId, brandKitSnapshotHash, route, assetType, resolvedReferences, expectedAssetCount = 1, itemId = '', batchId = '', channel = '' }) {
  const cardinality = Math.max(1, Math.min(20, Number(expectedAssetCount) || 1))
  return createHash('sha256')
    .update(JSON.stringify({
      version: '1.0.0',
      site,
      brandKitVersionId,
      brandKitSnapshotHash,
      route,
      assetType,
      ...(cardinality > 1 || itemId || batchId || channel ? { expectedAssetCount: cardinality, itemId: String(itemId || ''), batchId: String(batchId || ''), channel: String(channel || '') } : {}),
      references: (resolvedReferences || []).map((reference) => ({
        id: reference.id,
        mediaId: reference.mediaId,
        filename: reference.filename,
        attachmentIndex: reference.attachmentIndex
      }))
    }))
    .digest('hex')
}

export function prepareImageGeneration(site, input = {}, options = {}) {
  const canonical = options.canonicalSnapshot || loadCanonicalBrandKit(site, { forceReload: true })
  const referencePolicy = canonical.referenceSelectionPolicy || referenceSelectionPolicyForBrand(site, canonical.referenceLibrary, canonical.references)
  const route = classifyImageRoute(input)
  const composition = compositionForAssetType(input.assetType)
  const assetType = String(input.assetType || 'blog_cover')
  const expectedAssetCount = Math.max(1, Math.min(20, Number(input.expectedAssetCount) || 1))
  const isSocial = ['social_image', 'instagram_story'].includes(assetType)
  const filenames = referencePolicy.routes?.[route] || []
  const byFilename = new Map((canonical.references || []).map((reference) => [reference.filename, reference]))
  const missingReferences = []
  const resolvedReferences = filenames.map((filename, index) => {
    const reference = byFilename.get(filename)
    const available = Boolean(reference?.available !== false && (reference?.path || reference?.storageKey || reference?.url))
    if (!available) missingReferences.push(filename)
    return {
      order: index + 1,
      site,
      id: reference?.id || `missing-${filename}`,
      role: reference?.role || (index === 0 ? 'visual-authority' : 'background-authority'),
      required: filename === '05-tablero-visual.png' || filename === 'fondo-escarlet.jpg',
      filename,
      mediaId: reference?.mediaId || null,
      path: reference?.path || '',
      storageKey: reference?.storageKey || '',
      url: reference?.url || '',
      thumbUrl: reference?.thumbUrl || reference?.url || '',
      sha256: reference?.sha256 || '',
      attachmentIndex: index + 1,
      available
    }
  })
  const blocked = missingReferences.length > 0 || filenames.length === 0
  const title = String(input.title || 'Escarlet visual brief').trim()
  const topic = String(input.topic || input.summary || 'editorial contemporáneo').trim()
  const palette = Object.entries(canonical.palette || {}).map(([name, value]) => `${name} ${value}`).join(', ')
  const socialTextRule = isSocial
    ? `This is a final social asset. Generate the complete image in ChatGPT with the requested readable headline and body already included at ${composition.dimensions}. For carousels, the first and last slides use pure brand colors, high-contrast text and the official supplied logo only when present in the references; middle slides use clear light backgrounds with dark text. Keep every text block to one, two or three lines and split overflow into another slide.`
    : 'No text, letters, numbers, logos or watermarks.'
  const backgroundInstruction = canonical.backgroundDirective?.flow
    ? `Preserve the declared background flow: ${canonical.backgroundDirective.flow}.`
    : ''
  const generationPrompt = blocked
    ? ''
    : `Create exactly one ${site} editorial image for "${title}". Topic: ${topic}. Route: ${route}. Archetype: ${archetypeForRoute(route)}. Use every attached ImageContent as mandatory visual grounding for this brand's palette, materials, lighting, composition and emotional tone. Do not invent a new visual direction, choose a different reference or substitute any attachment. Preserve the active brand palette ${palette || 'from the supplied brand kit'}. ${backgroundInstruction} Use a ${composition.aspectRatio} composition at ${composition.dimensions}, place the subject in the right third and leave at least 25% clean negative space. Keep people anonymous and editorial when a person is needed. Do not create variants, contact sheets or galleries. ${socialTextRule}`
  const brandPreparation = {
    version: '1.0.0',
    preparationId: imagePreparationFingerprint({
      site,
      brandKitVersionId: canonical.brandKitVersionId,
      brandKitSnapshotHash: canonical.snapshotHash,
      route,
      assetType,
      resolvedReferences,
      expectedAssetCount,
      itemId: input.itemId,
      batchId: input.batchId,
      channel: input.channel
    }),
    site,
    brandKitVersionId: canonical.brandKitVersionId,
    brandKitSnapshotHash: canonical.snapshotHash,
    route,
    assetType,
    finalAssetRequiresText: isSocial,
    finalTextRenderer: isSocial ? 'ChatGPT' : null,
    expectedAssetCount,
    exactReferenceFilenames: resolvedReferences.map((reference) => reference.filename),
    exactReferenceMediaIds: resolvedReferences.map((reference) => reference.mediaId).filter(Boolean)
  }
  return {
    schemaVersion: '1.0.0',
    brandKitVersionId: canonical.brandKitVersionId,
    brandKitSnapshotHash: canonical.snapshotHash,
    site,
    generationBlocked: blocked,
    missingReferences,
    referenceSelectionPolicy: referencePolicy,
    canonicalPalette: canonical.palette,
    backgroundDirective: canonical.backgroundDirective,
    imageGenerationPolicy: GLOBAL_IMAGE_GENERATION_POLICY,
    route,
    archetype: archetypeForRoute(route),
    composition,
    generationCardinality: {
      defaultImageCount: expectedAssetCount,
      maxImageCount: expectedAssetCount,
      unit: 'final_image',
      rule: expectedAssetCount > 1
        ? `La preparación autoriza ${expectedAssetCount} imágenes finales relacionadas con el mismo conjunto exacto de referencias.`
        : 'Una petición singular genera una sola imagen final. Para varias piezas, el usuario debe pedir explícitamente la cantidad y el formato.'
    },
    brandPreparation,
    resolvedReferences,
    negativeRules: [
      ...(isSocial ? ['no unreadable text', 'no text outline, halo or decorative dash'] : ['no text, letters, numbers, logos or watermarks']),
      'no generic corporate stock scene',
      'no substitution or reinterpretation of mandatory references'
    ],
    generationPrompt
  }
}

/**
 * Verifies that an upload was prepared against the current canonical v2 kit.
 * The fingerprint is deliberately derived from the current snapshot and the
 * closed reference policy, so a token from another brand, route or old kit is
 * rejected instead of silently accepting an ungrounded image.
 */
export function validateImagePreparation(site, preparationId, { assetType, route, expectedAssetCount = 1, itemId = '', batchId = '', channel = '' } = {}) {
  const token = String(preparationId || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(token)) return { ok: false, code: 'BRAND_GROUNDING_REQUIRED' }
  const candidates = route ? [String(route)] : Object.keys(IMAGE_ROUTE_POLICY.routes)
  const assetTypes = assetType ? [String(assetType)] : IMAGE_PREPARATION_ASSET_TYPES
  const canonical = loadCanonicalBrandKit(site, { forceReload: true })
  const referencePolicy = canonical.referenceSelectionPolicy || referenceSelectionPolicyForBrand(site, canonical.referenceLibrary, canonical.references)
  const byFilename = new Map((canonical.references || []).map((reference) => [reference.filename, reference]))
  for (const candidateRoute of candidates) {
    const filenames = referencePolicy.routes?.[candidateRoute]
    if (!filenames) continue
    const resolvedReferences = filenames.map((filename, index) => {
      const reference = byFilename.get(filename)
      return {
        id: reference?.id || `missing-${filename}`,
        mediaId: reference?.mediaId || null,
        filename,
        attachmentIndex: index + 1
      }
    })
    if (resolvedReferences.some((reference) => !byFilename.get(reference.filename)?.url || !referenceDiskPathForBrand(site, byFilename.get(reference.filename)))) continue
    for (const candidateAssetType of assetTypes) {
      const expected = imagePreparationFingerprint({
        site,
        brandKitVersionId: canonical.brandKitVersionId,
        brandKitSnapshotHash: canonical.snapshotHash,
        route: candidateRoute,
        assetType: candidateAssetType,
        resolvedReferences,
        expectedAssetCount,
        itemId,
        batchId,
        channel
      })
      if (expected === token) {
        return {
          ok: true,
          preparation: {
            version: '1.0.0',
            preparationId: token,
            site,
            brandKitVersionId: canonical.brandKitVersionId,
            brandKitSnapshotHash: canonical.snapshotHash,
            route: candidateRoute,
            assetType: candidateAssetType,
            exactReferenceFilenames: resolvedReferences.map((reference) => reference.filename),
            exactReferenceMediaIds: resolvedReferences.map((reference) => reference.mediaId).filter(Boolean)
          }
        }
      }
    }
  }
  return { ok: false, code: 'BRAND_GROUNDING_STALE', brandKitVersionId: canonical.brandKitVersionId, brandKitSnapshotHash: canonical.snapshotHash }
}

function referenceDiskPathForBrand(site, reference) {
  const raw = String(reference?.path || '').trim()
  if (!raw.startsWith('/media/')) return ''
  const relative = raw.slice('/media/'.length)
  if (!relative || relative.includes('..')) return ''
  const candidate = join(mediaDir, relative)
  return existsSync(candidate) ? candidate : ''
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
    const { response: res, body } = await fetchRemote(url, { maxBytes: 25 * 1024 * 1024, timeoutMs: 20_000 })
    if (!res.ok) throw new Error(`No se pudo descargar el ZIP (HTTP ${res.status})`)
    return body
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
