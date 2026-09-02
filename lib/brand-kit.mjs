import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mediaDir, readDb } from './db.mjs'
import { mediaForClient } from './media-url.mjs'

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

export function getBrandContext(site) {
  ensureBrandKit(site)
  return {
    site,
    voice: readBrandFile(site, 'voice.md'),
    visualStyle: readBrandFile(site, 'visual-style.md'),
    imageGuide: readBrandFile(site, 'image-guide.md'),
    keywords: readBrandFile(site, 'keywords.md'),
    agentRules: readBrandFile(site, 'AGENT.md'),
    referenceImages: listReferenceImages(site),
    reminder:
      'Aplica voz, visual-style y AGENT.md. Para portadas: genera la imagen, pasa imageUrl http pública a blog_upload_media (evita base64). Usa referenceImages. El equipo puede corregir este kit en el dashboard.'
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
