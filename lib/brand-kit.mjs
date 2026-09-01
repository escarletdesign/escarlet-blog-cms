import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const BRAND_FILES = ['voice.md', 'keywords.md', 'image-guide.md', 'agent-rules.md']

export function getBrandKitDir(site) {
  return join(root, 'config', 'sites', site)
}

export function readBrandFile(site, filename) {
  const path = join(getBrandKitDir(site), filename)
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf8')
}

export function writeBrandFile(site, filename, content) {
  const dir = getBrandKitDir(site)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, filename)
  writeFileSync(path, content, 'utf8')
  return path
}

export function listBrandFiles(site) {
  const dir = getBrandKitDir(site)
  if (!existsSync(dir)) return []
  return BRAND_FILES.filter((name) => existsSync(join(dir, name)))
}

export function getBrandContext(site) {
  const dir = getBrandKitDir(site)
  const refDir = join(dir, 'reference-images')
  const referenceImages = existsSync(refDir)
    ? readdirSync(refDir).filter((f) => /\.(webp|jpg|jpeg|png|gif)$/i.test(f))
    : []

  return {
    site,
    voice: readBrandFile(site, 'voice.md'),
    keywords: readBrandFile(site, 'keywords.md'),
    imageGuide: readBrandFile(site, 'image-guide.md'),
    agentRules: readBrandFile(site, 'agent-rules.md'),
    referenceImages: referenceImages.map((name) => `/media/${site}/reference/${name}`)
  }
}

export function getSeoContext(site) {
  const keywords = readBrandFile(site, 'keywords.md')
  const agentRules = readBrandFile(site, 'agent-rules.md')
  return { site, keywords, agentRules }
}

export { BRAND_FILES }
