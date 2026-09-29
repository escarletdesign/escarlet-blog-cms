import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir } from './db.mjs'
import { isProductRestructureV1 } from './product-flags.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sitesDir = join(root, 'config', 'sites')
const runtimeSiteDir = join(dataDir, 'site-config')

const RUNTIME_FIELDS = [
  'domain',
  'rebuildWebhookUrl',
  'coolifyApiToken',
  'requiresHumanApproval',
  'requiresPublishConfirmation',
  'approverRole',
  'contentMode',
  'blogEnabled',
  'name',
  'authors',
  'socialPackChannels',
  'reviewMode',
  'planId',
  'entitlements'
]

export const DEFAULT_PLAN_ID = 'standard'

export const DEFAULT_ENTITLEMENTS = {
  membership: 'active',
  hosting: false
}

export const SOCIAL_PACK_CHANNEL_KEYS = [
  'substack',
  'linkedin',
  'x',
  'videoScript',
  'instagramCarousel',
  'instagramStory'
]

export const DEFAULT_SOCIAL_PACK_CHANNELS = {
  substack: true,
  linkedin: true,
  x: true,
  videoScript: true,
  instagramCarousel: true,
  instagramStory: true
}

const DEFAULT_SITE_CONFIG = {
  handle: 'escarlet',
  name: 'Escarlet',
  domain: 'https://escarlet.design',
  adapter: 'json-api',
  requiresHumanApproval: true,
  requiresPublishConfirmation: true,
  approverRole: 'super_admin',
  contentMode: 'blog',
  blogEnabled: true,
  reviewMode: 'agency_gate',
  planId: DEFAULT_PLAN_ID,
  entitlements: { ...DEFAULT_ENTITLEMENTS },
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

/**
 * Legacy `requiresHumanApproval` maps to reviewMode when reviewMode is unset.
 * @param {{ reviewMode?: string, requiresHumanApproval?: boolean }} raw
 * @returns {'direct'|'agency_gate'}
 */
export function resolveReviewMode(raw) {
  const mode = String(raw?.reviewMode || '').trim()
  if (mode === 'direct' || mode === 'agency_gate') return mode
  return raw?.requiresHumanApproval === false ? 'direct' : 'agency_gate'
}

export function normalizeEntitlements(raw) {
  const membership =
    raw?.membership === 'suspended' ? 'suspended' : DEFAULT_ENTITLEMENTS.membership
  return {
    membership,
    hosting: Boolean(raw?.hosting)
  }
}

/** Agency gate holds live publish until approval. */
export function isAgencyGate(siteConfig) {
  if (isProductRestructureV1()) {
    return resolveReviewMode(siteConfig) === 'agency_gate'
  }
  return Boolean(siteConfig?.requiresHumanApproval)
}

/**
 * Who may press "Publicar en vivo" after human approval is on.
 * @returns {'super_admin'|'agency_editor'|'site_client'}
 */
export function resolveApproverRole(siteConfig) {
  const role = String(siteConfig?.approverRole || 'super_admin').trim()
  if (role === 'agency_editor' || role === 'site_client') return role
  return 'super_admin'
}

/**
 * @param {{ role?: string } | null | undefined} auth
 * @param {object} siteConfig
 */
export function canApproveLivePublish(auth, siteConfig) {
  const role = auth?.role || ''
  if (role === 'review_link') return true
  const needed = resolveApproverRole(siteConfig)
  if (needed === 'site_client') {
    return ['admin', 'owner', 'agency_admin', 'editor', 'client'].includes(role)
  }
  if (needed === 'agency_editor') {
    return ['admin', 'owner', 'agency_admin', 'editor'].includes(role)
  }
  return ['admin', 'owner', 'editor'].includes(role)
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
  if (siteConfig.contentMode === 'socialmedia') return false
  return siteConfig.blogEnabled !== false
}

export function isSocialMediaOnlySite(siteConfig) {
  return siteConfig?.contentMode === 'socialmedia'
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
      if (key === 'socialPackChannels') {
        next[key] = normalizeSocialPackChannels({
          ...(current.socialPackChannels || {}),
          ...partial.socialPackChannels
        })
        continue
      }
      if (key === 'entitlements') {
        next[key] = normalizeEntitlements({
          ...(current.entitlements || {}),
          ...(partial.entitlements || {})
        })
        continue
      }
      if (key === 'reviewMode') {
        const mode = String(partial[key] || '').trim()
        if (mode === 'direct' || mode === 'agency_gate') next[key] = mode
        continue
      }
      if (key === 'contentMode') {
        const mode = String(partial[key] || '').trim()
        if (mode === 'blog' || mode === 'socialmedia') next[key] = mode
        continue
      }
      if (key === 'planId') {
        const id = String(partial[key] || '').trim()
        if (id) next[key] = id
        continue
      }
      if (key === 'approverRole') {
        const role = String(partial[key] || '').trim()
        if (['super_admin', 'agency_editor', 'site_client'].includes(role)) next[key] = role
        continue
      }
      if (
        key === 'blogEnabled' ||
        key === 'requiresHumanApproval' ||
        key === 'requiresPublishConfirmation'
      ) {
        next[key] = Boolean(partial[key])
        continue
      }
      next[key] = partial[key]
    }
  }
  if (next.contentMode === 'socialmedia') next.blogEnabled = false
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
  const merged = {
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
    contentMode: runtime.contentMode === 'socialmedia' || seed.contentMode === 'socialmedia' ? 'socialmedia' : 'blog',
    blogEnabled: isPublicBlogEnabled({
      contentMode: runtime.contentMode !== undefined ? runtime.contentMode : seed.contentMode,
      blogEnabled:
        runtime.blogEnabled !== undefined
          ? runtime.blogEnabled
          : seed.blogEnabled !== undefined
            ? seed.blogEnabled
            : true
    }),
    entitlements: normalizeEntitlements({
      ...DEFAULT_ENTITLEMENTS,
      ...(seed.entitlements || {}),
      ...(runtime.entitlements || {})
    })
  }
  merged.reviewMode = resolveReviewMode(merged)
  if (!merged.planId) merged.planId = DEFAULT_PLAN_ID
  // Keep legacy bool aligned when V1 maps reviewMode.
  if (isProductRestructureV1()) {
    merged.requiresHumanApproval = merged.reviewMode === 'agency_gate'
  }
  return merged
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
    if (partial.clearCoolifyApiToken) delete runtime.coolifyApiToken
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
  const { siteAccessToken: _revokedSiteToken, agencyAccessToken: _revokedAgencyToken, ...safeConfig } = siteConfig
  return {
    ...safeConfig,
    coolifyApiToken: undefined,
    hasCoolifyApiToken: Boolean(token),
    coolifyApiTokenHint: token ? `…${token.slice(-4)}` : ''
  }
}

/** Public directory fields for unauthenticated site discovery. */
export function publicSiteDirectoryEntry(siteConfig) {
  if (!siteConfig) return null
  return {
    id: siteConfig.id || siteConfig.handle,
    handle: siteConfig.handle || siteConfig.id,
    name: siteConfig.name || siteConfig.handle || siteConfig.id,
    domain: siteConfig.domain || '',
    contentMode: siteConfig.contentMode || 'blog',
    blogEnabled: siteConfig.blogEnabled !== false,
    socialPackChannels: normalizeSocialPackChannels(siteConfig.socialPackChannels)
  }
}
