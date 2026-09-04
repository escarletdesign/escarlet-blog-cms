import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir } from './db.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sitesDir = join(root, 'config', 'sites')
const runtimeSiteDir = join(dataDir, 'site-config')

const RUNTIME_FIELDS = [
  'domain',
  'rebuildWebhookUrl',
  'coolifyApiToken',
  'siteAccessToken',
  'requiresHumanApproval',
  'blogEnabled',
  'name',
  'authors',
  'socialPackChannels'
]

export const SOCIAL_PACK_CHANNEL_KEYS = [
  'substack',
  'linkedin',
  'x',
  'videoScript',
  'instagramCarousel'
]

export const DEFAULT_SOCIAL_PACK_CHANNELS = {
  substack: true,
  linkedin: true,
  x: true,
  videoScript: true,
  instagramCarousel: true
}

const DEFAULT_SITE_CONFIG = {
  handle: 'escarlet',
  name: 'Escarlet',
  domain: 'https://escarlet.design',
  adapter: 'json-api',
  requiresHumanApproval: true,
  blogEnabled: true,
  seo: {
    minWords: 400,
    metaTitleMin: 20,
    metaTitleMax: 70,
    metaDescriptionMin: 70,
    metaDescriptionMax: 180,
    internalLinksMin: 1,
    internalLinksMax: 8,
    relatedSlugsCount: 0
  },
  authors: ['Charly', 'Silvia'],
  copyRules: { noColonsSemicolons: true },
  socialPackChannels: { ...DEFAULT_SOCIAL_PACK_CHANNELS }
}

export function normalizeSocialPackChannels(raw) {
  const next = { ...DEFAULT_SOCIAL_PACK_CHANNELS }
  if (!raw || typeof raw !== 'object') return next
  for (const key of SOCIAL_PACK_CHANNEL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      next[key] = Boolean(raw[key])
    }
  }
  return next
}

export function getSocialPackChannels(siteConfig) {
  return normalizeSocialPackChannels(siteConfig?.socialPackChannels)
}

export function isSocialPackChannelEnabled(siteConfig, channel) {
  return Boolean(getSocialPackChannels(siteConfig)[channel])
}

export function isPublicBlogEnabled(siteConfig) {
  if (!siteConfig) return true
  return siteConfig.blogEnabled !== false
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
      if ((key === 'coolifyApiToken' || key === 'siteAccessToken') && partial[key] === '') continue
      if (key === 'socialPackChannels') {
        next[key] = normalizeSocialPackChannels({
          ...(current.socialPackChannels || {}),
          ...partial.socialPackChannels
        })
        continue
      }
      if (key === 'blogEnabled' || key === 'requiresHumanApproval') {
        next[key] = Boolean(partial[key])
        continue
      }
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
  const handles = new Set()
  if (existsSync(sitesDir)) {
    for (const entry of readdirSync(sitesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) handles.add(entry.name)
    }
  }
  if (existsSync(runtimeSiteDir)) {
    for (const name of readdirSync(runtimeSiteDir)) {
      if (name.endsWith('.json')) handles.add(name.replace(/\.json$/, ''))
    }
  }
  return [...handles].sort()
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
    copyRules: { ...DEFAULT_SITE_CONFIG.copyRules, ...(seed.copyRules || {}), ...(runtime.copyRules || {}) },
    socialPackChannels: normalizeSocialPackChannels({
      ...DEFAULT_SOCIAL_PACK_CHANNELS,
      ...(seed.socialPackChannels || {}),
      ...(runtime.socialPackChannels || {})
    }),
    blogEnabled: isPublicBlogEnabled({
      blogEnabled:
        runtime.blogEnabled !== undefined
          ? runtime.blogEnabled
          : seed.blogEnabled !== undefined
            ? seed.blogEnabled
            : true
    })
  }
}

export function getCanonicalUrl(siteConfig, slug) {
  const pattern = siteConfig?.seo?.canonicalPattern || '{domain}/blog/{slug}'
  return pattern
    .replace('{domain}', siteConfig.domain.replace(/\/$/, ''))
    .replace('{slug}', slug)
}

export function saveSiteConfig(handle, partial) {
  if (partial.clearCoolifyApiToken || partial.clearSiteAccessToken) {
    const runtime = readRuntimeConfig(handle)
    if (partial.clearCoolifyApiToken) delete runtime.coolifyApiToken
    if (partial.clearSiteAccessToken) delete runtime.siteAccessToken
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
  const raw = siteConfig?.rebuildWebhookUrl?.trim()
    ? siteConfig.rebuildWebhookUrl.trim()
    : process.env[siteConfig?.rebuildWebhookEnv || 'REBUILD_WEBHOOK_URL'] || process.env.REBUILD_WEBHOOK_URL || ''
  return normalizeCoolifyDeployUrl(raw)
}

/**
 * Coolify 4.1 trata `force=false` (string) como true y hace docker --no-cache.
 * El Redeploy manual y el git push usan caché. El webhook del CMS (publish,
 * interruptor) necesita force=true. Si no, Docker recicla el dist del commit
 * anterior y /blog no cambia.
 */
export function normalizeCoolifyDeployUrl(raw) {
  const url = String(raw || '').trim()
  if (!url) return ''
  try {
    const parsed = new URL(url)
    const force = String(parsed.searchParams.get('force') || '').toLowerCase()
    if (force === 'false' || force === '0') parsed.searchParams.delete('force')
    return parsed.toString()
  } catch {
    return url
  }
}

export function withCoolifyForceRebuild(raw) {
  const url = normalizeCoolifyDeployUrl(raw)
  if (!url) return ''
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('force', 'true')
    return parsed.toString()
  } catch {
    return url
  }
}

export function getCoolifyApiToken(siteConfig) {
  if (siteConfig?.coolifyApiToken?.trim()) return siteConfig.coolifyApiToken.trim()
  return process.env.COOLIFY_API_TOKEN || ''
}

export function publicSiteConfig(siteConfig) {
  if (!siteConfig) return null
  const token = getCoolifyApiToken(siteConfig)
  const siteToken = siteConfig.siteAccessToken
  return {
    ...siteConfig,
    coolifyApiToken: undefined,
    siteAccessToken: undefined,
    hasCoolifyApiToken: Boolean(token),
    coolifyApiTokenHint: token ? `…${token.slice(-4)}` : '',
    hasSiteAccessToken: Boolean(siteToken),
    siteAccessTokenHint: siteToken ? `…${String(siteToken).slice(-4)}` : ''
  }
}
