import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir } from './db.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sitesDir = join(root, 'config', 'sites')
const runtimeSiteDir = join(dataDir, 'site-config')

const RUNTIME_FIELDS = ['domain', 'rebuildWebhookUrl', 'coolifyApiToken', 'requiresHumanApproval', 'name']

const DEFAULT_SITE_CONFIG = {
  handle: 'escarlet',
  name: 'Escarlet',
  domain: 'https://escarlet.design',
  adapter: 'json-api',
  requiresHumanApproval: true,
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

function runtimeConfigPath(handle) {
  return join(runtimeSiteDir, `${handle}.json`)
}

function readRuntimeConfig(handle) {
  const path = runtimeConfigPath(handle)
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeRuntimeConfig(handle, partial) {
  mkdirSync(runtimeSiteDir, { recursive: true })
  const current = readRuntimeConfig(handle)
  const next = { ...current }
  for (const key of RUNTIME_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(partial, key)) {
      if (partial[key] === undefined) continue
      if (key === 'coolifyApiToken' && partial[key] === '') continue
      next[key] = partial[key]
    }
  }
  writeFileSync(runtimeConfigPath(handle), JSON.stringify(next, null, 2) + '\n')
  return next
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
  const runtime = readRuntimeConfig(handle)
  let seed = null
  if (existsSync(configPath)) {
    seed = JSON.parse(readFileSync(configPath, 'utf8'))
  } else if (handle === 'escarlet') {
    seed = { ...DEFAULT_SITE_CONFIG }
  } else if (Object.keys(runtime).length === 0) {
    return null
  } else {
    seed = { handle }
  }
  return {
    ...DEFAULT_SITE_CONFIG,
    ...seed,
    ...runtime,
    handle,
    seo: { ...DEFAULT_SITE_CONFIG.seo, ...(seed.seo || {}), ...(runtime.seo || {}) },
    copyRules: { ...DEFAULT_SITE_CONFIG.copyRules, ...(seed.copyRules || {}), ...(runtime.copyRules || {}) }
  }
}

export function getCanonicalUrl(siteConfig, slug) {
  const pattern = siteConfig?.seo?.canonicalPattern || '{domain}/blog/{slug}'
  return pattern
    .replace('{domain}', siteConfig.domain.replace(/\/$/, ''))
    .replace('{slug}', slug)
}

export function saveSiteConfig(handle, partial) {
  if (partial.clearCoolifyApiToken) {
    const runtime = readRuntimeConfig(handle)
    delete runtime.coolifyApiToken
    mkdirSync(runtimeSiteDir, { recursive: true })
    writeFileSync(runtimeConfigPath(handle), JSON.stringify(runtime, null, 2) + '\n')
  }
  const runtimePartial = {}
  for (const key of RUNTIME_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(partial, key)) runtimePartial[key] = partial[key]
  }
  if (Object.keys(runtimePartial).length) writeRuntimeConfig(handle, runtimePartial)
  return loadSiteConfig(handle) || { ...DEFAULT_SITE_CONFIG, handle, ...runtimePartial }
}

export function getRebuildWebhookUrl(siteConfig) {
  if (siteConfig?.rebuildWebhookUrl?.trim()) return siteConfig.rebuildWebhookUrl.trim()
  const envKey = siteConfig?.rebuildWebhookEnv || 'REBUILD_WEBHOOK_URL'
  return process.env[envKey] || process.env.REBUILD_WEBHOOK_URL || ''
}

export function getCoolifyApiToken(siteConfig) {
  if (siteConfig?.coolifyApiToken?.trim()) return siteConfig.coolifyApiToken.trim()
  return process.env.COOLIFY_API_TOKEN || ''
}

export function publicSiteConfig(siteConfig) {
  if (!siteConfig) return null
  const token = getCoolifyApiToken(siteConfig)
  return {
    ...siteConfig,
    coolifyApiToken: undefined,
    hasCoolifyApiToken: Boolean(token),
    coolifyApiTokenHint: token ? `…${token.slice(-4)}` : ''
  }
}
