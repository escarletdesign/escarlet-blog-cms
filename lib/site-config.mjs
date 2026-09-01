import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sitesDir = join(root, 'config', 'sites')

const DEFAULT_SITE_CONFIG = {
  handle: 'escarlet',
  name: 'Escarlet',
  domain: 'https://escarlet.design',
  adapter: 'json-api',
  requiresHumanApproval: false,
  seo: {
    minWords: 1500,
    metaTitleMin: 30,
    metaTitleMax: 60,
    metaDescriptionMin: 120,
    metaDescriptionMax: 160,
    internalLinksMin: 5,
    internalLinksMax: 10,
    relatedSlugsCount: 3
  },
  authors: ['Charly', 'Silvia'],
  copyRules: { noColonsSemicolons: true }
}

export function getSitesRoot() {
  return sitesDir
}

export function listSiteHandles() {
  if (!existsSync(sitesDir)) return []
  return readdirSync(sitesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

export function loadSiteConfig(handle) {
  const configPath = join(sitesDir, handle, 'site.json')
  if (!existsSync(configPath)) {
    if (handle === 'escarlet') return { ...DEFAULT_SITE_CONFIG }
    return null
  }
  const raw = JSON.parse(readFileSync(configPath, 'utf8'))
  return {
    ...DEFAULT_SITE_CONFIG,
    ...raw,
    seo: { ...DEFAULT_SITE_CONFIG.seo, ...(raw.seo || {}) },
    copyRules: { ...DEFAULT_SITE_CONFIG.copyRules, ...(raw.copyRules || {}) }
  }
}

export function getCanonicalUrl(siteConfig, slug) {
  const pattern = siteConfig?.seo?.canonicalPattern || '{domain}/blog/{slug}'
  return pattern
    .replace('{domain}', siteConfig.domain.replace(/\/$/, ''))
    .replace('{slug}', slug)
}
