import { createServer } from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import { createReadStream, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, extname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readDb,
  writeDb,
  publicPost,
  findPost,
  upsertPost,
  mediaDir,
  dataDir,
  getPersistenceStatus,
  markPersistent,
  checkDataWritable
} from './lib/db.mjs'
import {
  loadSiteConfig,
  listSiteHandles,
  saveSiteConfig,
  publicSiteConfig,
  getSocialPackChannels,
  isPublicBlogEnabled,
  isSocialMediaOnlySite,
  isAgencyGate,
  canApproveLivePublish,
  resolveApproverRole,
  publicSiteDirectoryEntry
} from './lib/site-config.mjs'
import {
  getBrandContext,
  getSeoContext,
  readBrandFile,
  writeBrandFile,
  seedAllBrandKits,
  importBrandKitZip,
  BRAND_ALL_FILES,
  BRAND_FILE_LABELS,
  assertBrandFileAccess,
  brandFilesForAuth,
  brandLabelsForAuth
} from './lib/brand-kit.mjs'
import { validatePostSeo } from './lib/seo-validator.mjs'
import { isApprovedBrandAsset } from './lib/brand-asset-policy.mjs'
import {
  resolveRequestAuth,
  resolveAuth,
  publicAuthSession,
  assertSiteAccess,
  assertSuperAdmin,
  assertAgencyOps,
  allowedSiteHandles,
  canAccessSite,
  isSuperAdmin,
  isAgencyOrAdmin,
  isSiteScopedRole,
  publicSiteConfigForAuth,
  extractBearerOrCookie,
  resolveRequestAuthAsync,
  workspaceRoleForAuth,
  isLocalDevAutoLogin
} from './lib/auth.mjs'
import {
  createEmbedSession,
  consumeEmbedSession,
  sanitizeNext
} from './lib/embed-session.mjs'
import {
  createMagicToken,
  consumeMagicToken,
  createSessionBearer,
  createReviewToken,
  consumeReviewToken
} from './lib/access-tokens.mjs'
import { sendMagicLinkEmail } from './lib/magic-email.mjs'
import {
  isProductRestructureV1,
  isCmsAiEnabled,
  assertCmsAiEnabled,
  setCmsAiEnabled
} from './lib/product-flags.mjs'
import {
  verifyStripeSignature,
  handleStripeEvent,
  buildPaymentLinkHints
} from './lib/stripe-webhook.mjs'
import {
  getPwaBillingSnapshot,
  getPwaCreditPackCatalog,
  getBillingTestFlags,
  setBillingTestFlags,
  isBillingTestCreditsEnabled,
  grantPwaTestCredits,
  savePwaCreditPack,
  deletePwaCreditPack,
  createPwaCheckoutSession,
  createPwaPortalSession
} from './lib/pwa-billing.mjs'
import {
  listPublicAiProviderConnectors,
  saveAiProviderConnector,
  testAiProviderConnector,
  getAiProviderConnector
} from './lib/ai-admin.mjs'
import {
  isPasswordAuthEnabled,
  registerPasswordUser,
  syncLegacyUsersToPostgres,
  loginPasswordUser,
  listPasswordUsers,
  deletePasswordUser,
  googleAuthStatus,
  updatePasswordUser,
  mintUserLoginToken,
  mintUserLoginTokenAsync,
  revokeUserLoginToken,
  revokeUserLoginTokenAsync,
  setUserPassword,
  getPasswordUserByEmail,
  getPasswordUserById,
  userSites,
  updateUserProfile,
  listPublishingDelegates,
  setPublishingDelegate,
  listSiteAuthors,
  mintAuthorInvite,
  consumeAuthorInvite,
  assertAuthorAllowed,
  canViewOwnedDraft
} from './lib/human-auth.mjs'
import {
  notifyRebuild,
  uploadMedia,
  saveUploadedMedia,
  saveUploadedVideoMedia,
  receiveImageDrop,
  publishPost as cmsPublishPost,
  validateSeo as cmsValidateSeo,
  deleteMedia as cmsDeleteMedia,
  updateMediaAlt as cmsUpdateMediaAlt,
  updateMediaDetails as cmsUpdateMediaDetails,
  updatePost as cmsUpdatePost,
  unpublishPost as cmsUnpublishPost,
  deletePost as cmsDeletePost,
  createSiteRecord,
  getOnboarding,
  schedulePostForDate as cmsSchedulePost,
  confirmSchedule as cmsConfirmSchedule,
  cancelSchedule as cmsCancelSchedule,
  listCalendarPosts as cmsListCalendar,
  promoteDueScheduledPosts,
  requestPostChanges as cmsRequestPostChanges,
  applyReviewLinkAction as cmsApplyReviewLinkAction,
  createDraft as cmsCreateDraft,
  getQuotaSnapshot as cmsGetQuotaSnapshot
} from './lib/cms-ops.mjs'
import { mediaForClient, findMediaForClient, repairMediaInDb, repairPostsInDb, resolveImageSrc, resolvePostImageSrc, inspectImageBuffer } from './lib/media-url.mjs'
import { deleteCanonicalMedia, listCanonicalMedia, unlockCanonicalMedia, updateCanonicalMedia } from './lib/media-admin.mjs'
import { recordPublicationMemory, runChat, runGenerateOperation, splitSseChunks } from './lib/ai-gateway.mjs'
import { assertCmsAiAllowed } from './lib/generation-policy.mjs'
import { disconnectChatGpt, getChatGptConnection, saveChatGptConnection } from './lib/chatgpt-siwc.mjs'
import { canReadPost, canEditPost, safePostFields, assertPostAccess } from './lib/post-access.mjs'
import { assertMembershipActive } from './lib/plans.mjs'
import { archiveConversation, conversationOwner, deleteConversation, getConversation, listConversations, saveConversation } from './lib/ai-conversations.mjs'
import { assertInAppAssistantEnabled, getWorkflowFlags, setWorkflowFlags } from './lib/workflow-flags.mjs'
import { generateThumbBuffer } from './lib/media-optimize.mjs'
import { parseMultipart, isMultipartRequest } from './lib/multipart.mjs'
import { blogPublicationSlug, blogPublicationTitle } from './lib/blog-publication.mjs'
import { withPostLinks } from './lib/preview-url.mjs'
import { escapeHtml } from './lib/content-render.mjs'
import { sendMcpCors } from './mcp/http-handler.mjs'
import { handleMcpV3Http, sendMcpV3Cors } from './mcp/v3/http-handler.mjs'
import { invokeMcpToolV3 } from './mcp/v3/server.mjs'
import { applyCors } from './lib/cors.mjs'
import { buildToolList, invokeMcpTool } from './mcp/create-mcp-server.mjs'
import {
  aiRateLimitKey,
  assertAiRateLimit,
  isChatToolAllowedName
} from './lib/ai-security.mjs'
import { MCP_SERVER_VERSION } from './lib/media-upload-contract.mjs'
import {
  RUNTIME_CHANNEL,
  getRuntimeManifest,
  getRuntimeFile
} from './lib/frontend-runtime.mjs'
import {
  isCmsSocialPackHostEnabled,
  buildSocialPackPayload,
  listSocialPackSummaries
} from './lib/social-pack-host.mjs'
import {
  getMcpConnectionInfo,
  prepareSiteAgentIcon,
  readSiteAgentIcon
} from './lib/favicon.mjs'
import {
  authorizationServerMetadata,
  getAuth0Config,
  handleAuthorizeGet,
  handleAuthorizePost,
  handleRegister,
  handleToken,
  isValidAccessToken,
  parseFormBody,
  protectedResourceMetadata,
  wwwAuthenticateHeader
} from './lib/oauth-mcp.mjs'
import {
  auth0LogoutUrl,
  auth0TransactionCookie,
  auth0UiStatus,
  completeAuth0Login,
  createAuth0Login,
  getAuth0UiConfig
} from './lib/auth0-ui.mjs'
import {
  buildDraftPost,
  normalizeAuthor,
  pickRelated,
  toSlug,
  todayIso,
  validateSlug
} from './lib/post-utils.mjs'
import {
  resolveWorkspaceContext,
  createWorkspace,
  getWorkspaceFeatureFlags,
  setWorkspaceFeatureFlags,
  listSiteChannels,
  initializeBrandConfiguration,
  listBrandCapabilities,
  setBrandCapabilities,
  updateBrandChannels,
  getBrand,
  listBrands,
  createBrand,
  updateBrand,
  listMetricoolIntegrations,
  listBrandConnections,
  upsertBrandConnection,
  disconnectBrandConnection,
  listWorkspaceMembers,
  visibleMemberRole,
  addWorkspaceMember,
  updateWorkspaceMember,
  listScheduledContent,
  archiveContentItem,
  CHANNEL_CATALOG,
  BRAND_CAPABILITIES,
  createContentBatch,
  getContentBatch,
  getContentItem,
  listContentItems,
  listContentPlans,
  updateContentItem,
  approveContentItem,
  rejectContentItem,
  approveContentBatch,
  rejectContentBatch,
  scheduleContentItem,
  rescheduleContentItem,
  markContentChannelPublished,
  reconcileContentItemScheduled,
  clearPublishedContentErrors,
  reopenUnsentPublishedChannel,
  publishContentItemViaBuffer,
  scheduleContentBatch,
  cancelContentItem,
  cancelContentChannel,
  cancelContentBatch,
  usageSnapshot,
  connectMetricool,
  getMetricoolIntegration,
  createBrandKitVersion,
  publishBrandKitVersion,
  getActiveBrandKit,
  cleanupBrandKitAssets,
  updateBrandAsset,
  removeBrandAsset,
  enqueueJob,
  enqueueRemotePublicationStatusSync,
  assertWorkspaceRole,
  registerBrandAssets,
  registerContentMedia,
  attachContentMedia
} from './lib/workspace-domain.mjs'
import {
  createVideoJob,
  ensureVideoJobForContentItem,
  getVideoJob,
  listVideoJobs,
  updateVideoJob
} from './lib/video-jobs.mjs'
import { isPostgresConfigured, getPgPool, runCoreMigrations } from './lib/pg.mjs'
import { encryptSecret, decryptSecret } from './lib/secret-crypto.mjs'
import { testMetricoolConnection, scheduleMetricoolPost, syncMetricoolPost } from './lib/metricool.mjs'
import { testPlanableConnection } from './lib/planable.mjs'
import { listPostizIntegrations, testPostizConnection, postizProviderForChannel } from './lib/postiz.mjs'
import { listBufferOrganizations, listBufferChannels, testBufferConnection } from './lib/buffer.mjs'
import { CANONICAL_CMS_URL, DEPRECATED_CMS_HOSTS, canonicalCmsPublicUrl } from './lib/cms-url.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = __dirname

function loadEnv() {
  const envPath = join(root, '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const idx = trimmed.indexOf('=')
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnv()

// Both API and worker share the same repository-owned SQL migrations. Do not
// make startup depend on a JSON fallback when Postgres is configured.
let coreMigrationError = null
const coreMigrationPromise = isPostgresConfigured() ? runCoreMigrations().then((ready) => {
  if (!ready) coreMigrationError = Object.assign(new Error('Las migraciones de Postgres no están listas.'), { code: 'migrations_unavailable', status: 503 })
  return ready
}).catch((error) => {
  coreMigrationError = Object.assign(error, { code: error.code || 'migrations_failed', status: error.status || 503 })
  console.error('[postgres] migration failed:', error.message)
  return false
}) : Promise.resolve(false)
if (isPostgresConfigured()) coreMigrationPromise.then((ready) => ready && syncLegacyUsersToPostgres().catch((error) => console.warn('[postgres] user migration skipped:', error.message)))

const PORT = Number(process.env.PORT || 3040)
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '').trim()
const DEFAULT_SITE = process.env.DEFAULT_SITE || 'escarlet'
const CMS_PUBLIC_URL = canonicalCmsPublicUrl(process.env.CMS_PUBLIC_URL || `http://localhost:${PORT}`)
// Token logins are the durable login method used by the PWA. Keep the
// browser cookie across app/browser restarts; /api/logout explicitly clears it.
const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

function json(res, status, payload) {
  const responsePayload = status >= 400 && payload && typeof payload === 'object' && !Array.isArray(payload)
    ? { ...payload, code: payload.code || 'request_failed', requestId: payload.requestId || res._requestId || undefined }
    : payload
  const body = JSON.stringify(responsePayload)
  applyCors(res, res._request)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Request-Id': res._requestId || responsePayload?.requestId || randomUUID()
  })
  res.end(body)
}

function cookieAttributes({ clear = false, persistent = false } = {}) {
  const secure = process.env.NODE_ENV === 'production' || CMS_PUBLIC_URL.startsWith('https:') ? '; Secure' : ''
  return clear
    ? `Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure}`
    : `Path=/;${persistent ? ` Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS};` : ''} HttpOnly; SameSite=Lax${secure}`
}

function authCookie(token, options = {}) {
  return `escarlet_cms=${token ? encodeURIComponent(token) : ''}; ${cookieAttributes({ ...options, clear: !token || options.clear })}`
}

function requestCookie(req, name) {
  const cookieHeader = String(req.headers.cookie || '')
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ''
}

function html(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Robots-Tag': 'noindex, nofollow',
    ...extraHeaders
  })
  res.end(body)
}

function requestHostname(req) {
  const forwarded = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim()
  const host = forwarded || String(req.headers.host || '').trim()
  return host.replace(/^\[|\]$/g, '').split(':')[0].toLowerCase()
}

function rejectDeprecatedMcpHost(req, res) {
  if (!DEPRECATED_CMS_HOSTS.includes(requestHostname(req))) return false
  json(res, 410, {
    code: 'deprecated_mcp_host',
    message: 'Este endpoint MCP fue retirado. Reconecta usando el MCP v3 canónico.',
    canonicalUrl: `${CANONICAL_CMS_URL}/mcp/v3`,
    reconnect: true
  })
  return true
}

function requireAuth(req, url, res) {
  const auth = resolveRequestAuth(req, url)
  if (!auth) {
    json(res, 401, { message: 'No autorizado' })
    return null
  }
  if (url.pathname.startsWith('/api/ai/')) {
    try {
      assertCmsAiEnabled({ db: readDb() })
      assertCmsAiAllowed(auth)
    } catch (error) {
      json(res, 403, { message: error.message, ...(error.extra || {}) })
      return null
    }
  }
  return auth
}

async function requireAuthAsync(req, url, res) {
  let auth
  try {
    auth = await resolveRequestAuthAsync(req, url)
  } catch (error) {
    json(res, error.status || 503, { message: error.message || 'No se pudo resolver la identidad.' })
    return null
  }
  if (!auth) {
    json(res, 401, { message: 'No autorizado' })
    return null
  }
  if (url.pathname.startsWith('/api/ai/')) {
    try {
      assertCmsAiEnabled({ db: readDb() })
      assertCmsAiAllowed(auth)
    } catch (error) {
      json(res, 403, { message: error.message, ...(error.extra || {}) })
      return null
    }
  }
  return auth
}

function siteFrom(auth, preferred) {
  const requested = String(preferred || '').trim()
  if (isSiteScopedRole(auth.role)) {
    // Multi-site client and agency users can switch between the sites assigned
    // to their account. Keep the fallback scoped to their first assigned site
    // so a missing or stale selector can never broaden access.
    if (requested && canAccessSite(auth, requested)) return requested
    return auth.site || (Array.isArray(auth.sites) ? auth.sites[0] : '') || DEFAULT_SITE
  }
  return requested || DEFAULT_SITE
}

async function appBrandContext(site, auth) {
  if (!isPostgresConfigured()) return getBrandContext(site, { auth })
  const workspace = await resolveWorkspaceContext({ userId: auth?.userId || undefined, siteHandle: site, role: auth?.role === 'admin' ? 'admin' : undefined })
  const selected = workspace.sites.find((entry) => entry.handle === site) || workspace.sites[0]
  if (!selected) throw Object.assign(new Error('Sitio no migrado a Postgres.'), { status: 404, code: 'SITE_NOT_MIGRATED' })
  const [activeBrandKit, brandCapabilities] = await Promise.all([
    getActiveBrandKit({ workspaceId: workspace.workspaceId, siteId: selected.id }),
    listBrandCapabilities({ workspaceId: workspace.workspaceId, siteId: selected.id })
  ])
  if (!activeBrandKit) throw Object.assign(new Error('La marca no tiene un brand kit activo en Postgres.'), { status: 503, code: 'BRAND_KIT_REQUIRED' })
  return getBrandContext(site, {
    auth,
    brandCapabilities,
    canonicalManifest: activeBrandKit.manifest,
    canonicalAssets: activeBrandKit.assets,
    brandKitVersionId: activeBrandKit.id,
    brandKitVersion: { version: activeBrandKit.version }
  })
}

const MAX_BODY_BYTES = 15 * 1024 * 1024

function readRawBuffer(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('aborted', onAborted)
      req.off('close', onClose)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      req.resume()
      reject(error)
    }
    const onData = (c) => {
      if (settled) return
      size += c.length
      if (size > maxBytes) {
        fail(Object.assign(new Error(`La subida supera ${Math.round(maxBytes / 1024 / 1024)} MB`), { status: 413, code: 'body_too_large' }))
        return
      }
      chunks.push(c)
    }
    const onEnd = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks))
    }
    const onError = (error) => fail(error)
    const onAborted = () => fail(Object.assign(new Error('El cliente cerró la conexión.'), { status: 499, code: 'client_disconnected' }))
    const onClose = () => { if (!req.complete) onAborted() }
    const declared = Number(req.headers['content-length'] || 0)
    if (Number.isFinite(declared) && declared > maxBytes) {
      fail(Object.assign(new Error(`La subida supera ${Math.round(maxBytes / 1024 / 1024)} MB`), { status: 413, code: 'body_too_large' }))
      return
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
    req.on('aborted', onAborted)
    req.on('close', onClose)
  })
}

function parseBody(req, maxBytes = MAX_BODY_BYTES) {
  return readRawBuffer(req, maxBytes).then((buf) => {
    if (!buf.length) return {}
    if (isMultipartRequest(req)) {
      let parsed
      try { parsed = parseMultipart(buf, req.headers['content-type']) } catch (error) {
        throw Object.assign(new Error(error.message || 'Multipart inválido'), { status: 400, code: 'invalid_multipart' })
      }
      return {
        ...parsed.fields,
        filename: parsed.fields.filename || parsed.file?.filename,
        buffer: parsed.file?.buffer
      }
    }
    const raw = buf.toString('utf8')
    const type = String(req.headers['content-type'] || '')
    if (type.includes('application/x-www-form-urlencoded')) return parseFormBody(raw)
    try {
      return JSON.parse(raw)
    } catch {
      throw Object.assign(new Error('JSON inválido'), { status: 400, code: 'invalid_json' })
    }
  })
}

function requestIp(req) {
  // Use the socket address instead of trusting a user-controlled forwarding
  // header. A reverse proxy can still rate-limit upstream before this layer.
  return req.socket?.remoteAddress || 'unknown'
}

function serveStaticFile(
  res,
  filePath,
  contentType,
  method = 'GET',
  cacheControl = 'public, max-age=3600',
  extraHeaders = {}
) {
  if (!existsSync(filePath)) {
    json(res, 404, { message: 'No encontrado' })
    return
  }
  const data = readFileSync(filePath)
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': data.length,
    'Cache-Control': cacheControl,
    ...extraHeaders
  })
  if (method === 'HEAD') {
    res.end()
    return
  }
  res.end(data)
}

function serveMediaFile(res, filePath, contentType, req, filename) {
  const resolvedPath = resolvePath(filePath)
  const resolvedMediaDir = resolvePath(mediaDir)
  if (resolvedPath !== resolvedMediaDir && !resolvedPath.startsWith(`${resolvedMediaDir}/`)) {
    json(res, 404, { message: 'No encontrado' })
    return
  }

  let stat
  try {
    stat = statSync(resolvedPath)
  } catch {
    json(res, 404, { message: 'No encontrado' })
    return
  }

  const etag = `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`
  const lastModifiedMs = Math.floor(stat.mtimeMs / 1000) * 1000
  const lastModified = new Date(lastModifiedMs).toUTCString()
  const requestEtag = String(req.headers['if-none-match'] || '')
  const requestDate = Date.parse(String(req.headers['if-modified-since'] || ''))
  const versioned = new URL(req.url || '/', 'http://local').searchParams.has('v')
  const derivative = /(?:^|[_-])(thumb|preview)$/i.test(String(filename || '').replace(/\.[^.]+$/, ''))
  const cacheControl = versioned || derivative
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=3600'
  if (requestEtag === etag || (!Number.isNaN(requestDate) && requestDate >= lastModifiedMs)) {
    res.writeHead(304, { ETag: etag, 'Last-Modified': lastModified, 'Cache-Control': cacheControl })
    res.end()
    return
  }

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
    ETag: etag,
    'Last-Modified': lastModified
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(resolvedPath).on('error', () => {
    if (!res.headersSent) json(res, 404, { message: 'No encontrado' })
    else res.destroy()
  }).pipe(res)
}

// The Vite bundle is optional during development before `npm run build`. Only paths below
// /app (and the root SPA entry) reach here.
const pwaDist = join(root, 'apps', 'pwa', 'dist')
const pwaTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8'
}

function pwaSiteAlias(path, req) {
  const match = path.match(/^\/app\/([^/]+)(?:\/(.*))?$/)
  if (!match) {
    if (path !== '/' && path !== '/app') return null
    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim()
    if (!forwardedHost) return null
    let hostname = ''
    try {
      hostname = new URL(`http://${forwardedHost}`).hostname.toLowerCase().replace(/^www\./, '')
    } catch {
      return null
    }
    if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') return null
    for (const handle of listSiteHandles()) {
      const config = loadSiteConfig(handle)
      try {
        const domainHost = new URL(String(config?.domain || '')).hostname.toLowerCase().replace(/^www\./, '')
        if (domainHost && (hostname === domainHost || hostname === `app.${domainHost}`)) {
          return { site: handle, rest: '' }
        }
      } catch {
        // A malformed optional domain should not prevent the PWA from loading.
      }
    }
    return null
  }
  let raw
  try {
    raw = decodeURIComponent(match[1]).trim().toLowerCase()
  } catch {
    return null
  }
  if (!raw || raw === 'magic' || raw === 'assets') return null
  const withoutProtocol = raw.replace(/^https?:\/\//, '').replace(/^www\./, '')
  const candidates = new Set([raw, withoutProtocol, withoutProtocol.split('.')[0]])
  for (const handle of listSiteHandles()) {
    const config = loadSiteConfig(handle)
    const aliases = new Set([String(handle).toLowerCase()])
    try {
      const host = new URL(String(config?.domain || '')).hostname.toLowerCase().replace(/^www\./, '')
      if (host) {
        aliases.add(host)
        aliases.add(host.split('.')[0])
      }
    } catch {
      // A malformed optional domain should not prevent the PWA from loading.
    }
    if ([...candidates].some((candidate) => aliases.has(candidate))) {
      return { site: handle, rest: match[2] || '' }
    }
  }
  return null
}

function redirectPwaSiteAlias(req, res, path) {
  const alias = pwaSiteAlias(path, req)
  if (!alias) return false
  const query = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
  query.searchParams.set('site', alias.site)
  const targetPath = alias.rest ? `/app/${alias.rest}` : '/app/'
  const location = `${targetPath}?${query.searchParams.toString()}`
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' })
  res.end()
  return true
}

function servePwa(req, res, path) {
  const isAppPath = path === '/' || path === '/app' || path.startsWith('/app/')
  const isServerPath = path === '/mcp' || path.startsWith('/mcp/') || path === '/runtime' || path.startsWith('/runtime/') || path === '/api' || path.startsWith('/api/') || path === '/media' || path.startsWith('/media/') || path === '/oauth' || path.startsWith('/oauth/') || path === '/.well-known' || path.startsWith('/.well-known/')
  const isAssetPath = Boolean(extname(path))
  // React Router owns extensionless browser routes such as /calendar and
  // /plans. Serve the same entrypoint on direct navigation so a reload does
  // not fall through to the JSON API 404 handler.
  if (!existsSync(pwaDist) || (!isAppPath && (isServerPath || isAssetPath))) return false
  if (redirectPwaSiteAlias(req, res, path)) return true
  // Magic consumption is a server route, not an SPA route.
  if (path === '/app/magic/consume') return false
  let suffix = ''
  try {
    suffix = isAppPath && path !== '/' && path !== '/app' ? decodeURIComponent(path.slice('/app/'.length)) : ''
  } catch {
    json(res, 400, { message: 'Ruta inválida' })
    return true
  }
  const requested = suffix || 'index.html'
  const filePath = resolvePath(pwaDist, requested)
  const distPrefix = `${resolvePath(pwaDist)}/`
  if (filePath !== resolvePath(pwaDist) && !filePath.startsWith(distPrefix)) {
    json(res, 400, { message: 'Ruta inválida' })
    return true
  }
  const hasExtension = Boolean(extname(requested))
  if (existsSync(filePath) && hasExtension) {
    const cache = requested === 'index.html' || requested.endsWith('.webmanifest') ? 'no-cache' : 'public, max-age=31536000, immutable'
    serveStaticFile(res, filePath, pwaTypes[extname(requested)] || 'application/octet-stream', req.method, cache)
    return true
  }
  if (hasExtension) {
    json(res, 404, { message: 'Archivo PWA no encontrado' })
    return true
  }
  serveStaticFile(res, join(pwaDist, 'index.html'), 'text/html; charset=utf-8', req.method, 'no-cache')
  return true
}

function redirectLegacySurface(req, res, path) {
  const legacy = path === '/admin' || path === '/admin/' || path === '/plans' || path === '/plans/' ||
    path === '/posts' || path.startsWith('/posts/') || path === '/preview' || path.startsWith('/preview/') ||
    path === '/social-pack' || path.startsWith('/social-pack/') || path === '/manual' || path.startsWith('/manual/') ||
    path === '/schedule' || path.startsWith('/schedule/') || path === '/publish' || path.startsWith('/publish/') ||
    path === '/quick-create' || path.startsWith('/quick-create/') || path === '/admin/blog-packs' || path.startsWith('/admin/blog-packs/')
  if (!legacy) return false
  json(res, 410, {
    code: 'legacy_route_removed',
    message: 'Esta ruta pertenece al runtime legacy y fue retirada. Usa /app/content o /mcp/v3.'
  })
  return true
}

function pwaMagicBootstrapHtml({ next } = {}) {
  const safeNext = JSON.stringify(sanitizeNext(next))
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Entrando a Escarlet…</title></head><body><p>Entrando a Escarlet…</p><script>location.replace('/app' + ${safeNext})</script></body></html>`
}

function absoluteCmsOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() || 'http'
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`)
    .split(',')[0]
    .trim()
  return `${proto}://${host}`
}

function embedBootstrapHtml({ next }) {
  const safeNext = JSON.stringify(sanitizeNext(next))
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Entrando al CMS…</title>
</head>
<body>
  <p>Abriendo el panel Escarlet…</p>
  <script>
    (function () {
      var next = ${safeNext};
      location.replace('/app' + (next || '/'));
    })();
  </script>
</body>
</html>`
}

function servePublic(res, filePath, contentType, cacheControl = 'public, max-age=3600') {
  serveStaticFile(res, join(root, 'public', filePath), contentType, 'GET', cacheControl)
}

function normalizePostForClient(post) {
  if (!post) return post
  const site = post.site || 'escarlet'
  const imageUrl = resolvePostImageSrc(post.imageUrl, site) || resolveImageSrc(post.imageUrl)
  const media = findMediaForClient(imageUrl || post.imageUrl, site)
  if (!media) return { ...post, imageUrl }
  return {
    ...post,
    imageUrl,
    imagePreviewUrl: media.previewUrl || media.previewPath || imageUrl,
    imageThumbUrl: media.thumbUrl || media.thumbPath || media.previewUrl || media.previewPath || imageUrl,
    ...(media.width ? { imageWidth: media.width } : {}),
    ...(media.height ? { imageHeight: media.height } : {}),
    ...(media.originalBytes ? { imageOriginalBytes: media.originalBytes } : {}),
    ...(media.storedBytes ? { imageStoredBytes: media.storedBytes } : {}),
    ...(media.previewBytes ? { imagePreviewBytes: media.previewBytes } : {}),
    ...(media.thumbBytes ? { imageThumbBytes: media.thumbBytes } : {})
  }
}

function normalizePostsForClient(posts) {
  return (posts || []).map(normalizePostForClient)
}

async function readV2PublicBlogPosts(siteHandle) {
  if (!isPostgresConfigured()) return null
  try {
    const pool = await getPgPool()
    if (!pool) return null
    await coreMigrationPromise
    const result = await pool.query(`SELECT ci.id AS item_id,ci.topic,ci.metadata->>'contentTitle' AS content_title,ci.status,cv.body,ci.created_at,cover.url AS cover_url,cover.metadata AS cover_metadata FROM content_items ci JOIN content_variants cv ON cv.item_id=ci.id JOIN sites s ON s.id=ci.site_id LEFT JOIN LATERAL (SELECT ma.public_url AS url,ma.metadata FROM content_variant_media cvm JOIN media_assets ma ON ma.id=cvm.media_asset_id WHERE cvm.variant_id=cv.id ORDER BY cvm.sort_order ASC LIMIT 1) cover ON TRUE WHERE s.handle=$1 AND cv.channel='blog' AND cv.status IN ('syncing','published') ORDER BY COALESCE(NULLIF(cv.body->>'datePublished','')::date,ci.created_at::date) DESC`, [siteHandle])
    // A Postgres deployment may be running before the one-time JSON import. In
    // that window an empty canonical feed must not hide the legacy public feed.
    if (!result.rows.length) return null
    const itemIds = result.rows.map((row) => row.item_id).filter(Boolean)
    const socialResult = itemIds.length ? await pool.query(`SELECT cv.item_id,cv.channel,cv.body,COALESCE(json_agg(json_build_object('url',ma.public_url,'thumbUrl',ma.metadata->>'thumbUrl','previewUrl',ma.metadata->>'previewUrl','width',ma.metadata->>'width','height',ma.metadata->>'height') ORDER BY cvm.sort_order) FILTER (WHERE ma.id IS NOT NULL),'[]'::json) AS media FROM content_variants cv LEFT JOIN content_variant_media cvm ON cvm.variant_id=cv.id LEFT JOIN media_assets ma ON ma.id=cvm.media_asset_id WHERE cv.item_id=ANY($1::text[]) AND cv.channel IN ('instagram','instagram_story') AND cv.status='published' GROUP BY cv.item_id,cv.channel,cv.body`, [itemIds]) : { rows: [] }
    const socialByItem = new Map()
    for (const row of socialResult.rows) {
      const channels = socialByItem.get(row.item_id) || {}
      channels[row.channel] = row
      socialByItem.set(row.item_id, channels)
    }
    return result.rows.map((row) => {
      const body = row.body && typeof row.body === 'object' ? row.body : {}
      const socialRows = socialByItem.get(row.item_id) || {}
      const socialRow = socialRows.instagram
      const storyRow = socialRows.instagram_story
      const socialBody = socialRow?.body && typeof socialRow.body === 'object' ? socialRow.body : {}
      const storyBody = storyRow?.body && typeof storyRow.body === 'object' ? storyRow.body : {}
      const socialPack = socialBody.socialPack && typeof socialBody.socialPack === 'object' ? { ...socialBody.socialPack } : {}
      if (socialPack && Array.isArray(socialPack.instagramSlides)) {
        const media = Array.isArray(socialRow.media) ? socialRow.media : []
        socialPack.instagramSlides = socialPack.instagramSlides.map((slide, index) => ({
          ...slide,
          imageUrl: slide?.imageUrl || slide?.url || slide?.image || media[index]?.url || '',
          previewUrl: slide?.previewUrl || slide?.imagePreviewUrl || media[index]?.previewUrl || '',
          thumbUrl: slide?.thumbUrl || slide?.imageThumbUrl || media[index]?.thumbUrl || ''
        }))
      }
      const storyPack = storyBody.socialPack?.instagramStory
      if (storyPack && typeof storyPack === 'object') {
        const storyMedia = Array.isArray(storyRow?.media) ? storyRow.media : []
        const socialMedia = Array.isArray(socialRow?.media) ? socialRow.media : []
        const storyFrames = Array.isArray(storyPack.frames) ? storyPack.frames : []
        const frameCount = storyFrames.length || (storyMedia.length > 1 ? storyMedia.length : socialMedia.length || (storyPack.imageUrl || storyPack.url ? 1 : 0))
        socialPack.instagramStory = {
          ...storyPack,
          imageUrl: storyPack.imageUrl || storyPack.url || storyMedia[0]?.url || '',
          previewUrl: storyPack.previewUrl || storyPack.imagePreviewUrl || storyMedia[0]?.previewUrl || '',
          thumbUrl: storyPack.thumbUrl || storyPack.imageThumbUrl || storyMedia[0]?.thumbUrl || '',
          frames: Array.from({ length: frameCount }, (_, index) => {
            const frame = storyFrames[index] || {}
            const media = storyMedia[index] || socialMedia[index] || {}
            const fallback = socialPack.instagramSlides?.[index] || {}
            return {
              ...fallback,
              ...media,
              ...(index === 0 ? storyPack : {}),
              ...frame,
              imageUrl: frame.imageUrl || frame.url || frame.image || media.url || fallback.imageUrl || fallback.url || fallback.image || '',
              previewUrl: frame.previewUrl || frame.imagePreviewUrl || media.previewUrl || fallback.previewUrl || '',
              thumbUrl: frame.thumbUrl || frame.imageThumbUrl || media.thumbUrl || fallback.thumbUrl || ''
            }
          })
        }
      }
      return {
        slug: blogPublicationSlug({ content_title: row.content_title, topic: row.topic, blog_body: body }),
        site: siteHandle,
        title: blogPublicationTitle({ content_title: row.content_title, topic: row.topic, blog_body: body }),
        status: 'published',
        bodyHtml: body.bodyHtml || body.body || '',
        excerptEs: body.excerpt || body.excerptEs || '',
        metaTitle: body.metaTitle || {},
        metaDescription: body.metaDescription || {},
        imageUrl: body.imageUrl || row.cover_url || '',
        imagePreviewUrl: body.imagePreviewUrl || row.cover_metadata?.previewUrl || row.cover_metadata?.previewPath || '',
        imageThumbUrl: body.imageThumbUrl || row.cover_metadata?.thumbUrl || row.cover_metadata?.thumbPath || row.cover_metadata?.previewUrl || '',
        ...(row.cover_metadata?.width ? { imageWidth: Number(row.cover_metadata.width) } : {}),
        ...(row.cover_metadata?.height ? { imageHeight: Number(row.cover_metadata.height) } : {}),
        imageAlt: body.imageAlt || '',
        datePublished: body.datePublished || row.created_at,
        dateModified: body.dateModified || row.created_at,
        socialPack: Object.keys(socialPack).length ? socialPack : null
      }
    }).filter((post) => post.slug)
  } catch {
    return null
  }
}

function canViewPostForAuth(post, auth, site) {
  return canReadPost(post, auth, site)
}

function canMutatePostForAuth(post, auth, site) {
  return canEditPost(post, auth, site)
}

function assertBlogSite(site) {
  if (isSocialMediaOnlySite(loadSiteConfig(site))) {
    throw Object.assign(new Error('Este sitio está configurado como solo Social Media.'), { status: 404 })
  }
}

async function requireV2Context(req, url, res, body = {}) {
  let auth
  try {
    auth = await resolveRequestAuthAsync(req, url)
  } catch (error) {
    json(res, error.status || 503, { message: error.message || 'No se pudo resolver la identidad.' })
    return null
  }
  if (!auth) {
    json(res, 401, { message: 'No autorizado' })
    return null
  }
  if (!isPostgresConfigured()) {
    json(res, 503, { message: 'La API v2 requiere Postgres.', code: 'postgres_required' })
    return null
  }
  try {
    const rateSite = String(body.siteId || body.site || url.searchParams.get('siteId') || url.searchParams.get('site') || auth.site || '').trim()
    assertAiRateLimit(aiRateLimitKey(auth, rateSite, requestIp(req)), { limit: 120 })
    const migrationsReady = await coreMigrationPromise
    if (!migrationsReady) throw (coreMigrationError || Object.assign(new Error('Las migraciones de Postgres no están listas.'), { status: 503, code: 'migrations_unavailable' }))
    const requestedWorkspace = String(body.workspaceId || url.searchParams.get('workspaceId') || '').trim()
    const requestedSite = String(body.siteId || body.site || url.searchParams.get('siteId') || url.searchParams.get('site') || auth.site || (Array.isArray(auth.sites) && auth.sites.length === 1 ? auth.sites[0] : '')).trim()
    if (auth.role !== 'admin' && !auth.userId && auth.site && requestedSite && requestedSite !== auth.site) throw Object.assign(new Error('Este token solo gestiona el sitio autorizado.'), { status: 403 })
    const common = { userId: auth.userId || undefined, workspaceId: requestedWorkspace || undefined }
    let context
    try {
      context = await resolveWorkspaceContext({ ...common, ...(requestedSite ? { siteId: requestedSite } : {}) })
    } catch (error) {
      if (!requestedSite) throw error
      context = await resolveWorkspaceContext({ ...common, siteHandle: requestedSite })
    }
    if (auth.role !== 'admin' && !auth.userId) throw Object.assign(new Error('Se requiere un token personal de usuario.'), { status: 401 })
    const role = auth.role === 'admin' ? 'admin' : context.role || workspaceRoleForAuth(auth)
    const site = requestedSite ? context.sites.find((entry) => entry.id === requestedSite || entry.handle === requestedSite) : context.sites[0]
    if (requestedSite && !site) throw Object.assign(new Error('Sin acceso al sitio.'), { status: 403 })
    return { auth, context: { ...context, role, siteId: site?.id || null, siteHandle: site?.handle || null }, workspaceId: context.workspaceId, siteId: site?.id || null }
  } catch (error) {
    json(res, error.status || 500, { message: error.message || 'No se pudo resolver el workspace.' })
    return null
  }
}

function v2Topics(body) {
  if (Array.isArray(body?.topics)) return body.topics
  if (Array.isArray(body?.items)) return body.items.map((item) => typeof item === 'string' ? item : item?.topic)
  return []
}

function assertV2Approver(scope) {
  const roles = [scope?.auth?.role, scope?.context?.workspaceRole, scope?.context?.role]
    .map((value) => String(value || '').toLowerCase())
  if (!roles.some((role) => ['owner', 'admin', 'approver'].includes(role))) {
    throw Object.assign(new Error('Solo un aprobador o administrador puede aprobar y publicar.'), { status: 403, code: 'approver_required' })
  }
}

async function metricoolCredentialsFor(scope) {
  const integration = await getMetricoolIntegration({ workspaceId: scope.workspaceId, siteId: scope.siteId })
  const userToken = decryptSecret(integration.user_token_ciphertext)
  if (!userToken) throw Object.assign(new Error('No se puede descifrar la credencial Metricool.'), { status: 503, code: 'metricool_credential_unavailable' })
  return { integration, credentials: { userToken, userId: integration.metricool_user_id, blogId: integration.blog_id, timezone: integration.timezone } }
}

async function connectionCredentialsFor(scope, connectionId) {
  const pool = await getPgPool()
  if (!pool) throw Object.assign(new Error('Postgres no está configurado.'), { status: 503, code: 'postgres_required' })
  const result = await pool.query('SELECT * FROM channel_connections WHERE id=$1 AND workspace_id=$2 AND site_id=$3', [connectionId, scope.workspaceId, scope.siteId])
  if (!result.rowCount) throw Object.assign(new Error('Conexión no encontrada.'), { status: 404 })
  const row = result.rows[0]
  const userToken = decryptSecret(row.credentials_ciphertext)
  return {
    row,
    credentials: {
      userToken,
      apiToken: userToken,
      userId: row.external_account_id,
      blogId: row.config?.blogId || row.config?.blog_id || '',
      workspaceId: row.config?.workspaceId || row.config?.workspace_id || '',
      pageId: row.config?.pageId || row.config?.page_id || row.external_account_id || '',
      pageIds: row.config?.pageIds || row.config?.page_ids || [],
      integrationId: row.config?.integrationId || row.config?.integration_id || row.external_account_id || '',
      organizationId: row.config?.organizationId || row.config?.organization_id || '',
      channelId: row.config?.channelId || row.config?.channel_id || row.external_account_id || '',
      providerType: row.config?.providerType || row.config?.provider_type || '',
      apiBaseUrl: row.config?.apiBaseUrl || row.config?.api_base_url || '',
      timezone: row.config?.timezone || 'UTC'
    }
  }
}

function creationUiGlobalKillSwitch() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.CREATION_UI_KILL_SWITCH || '').trim().toLowerCase())
}

function sanitizeV2BrandKit(kit, auth, { canonicalReferences = [] } = {}) {
  if (!kit) return kit
  const allowed = new Set(brandFilesForAuth(auth))
  const manifest = kit.manifest && typeof kit.manifest === 'object'
    ? Object.fromEntries(Object.entries(kit.manifest).filter(([name]) => allowed.has(name)))
    : {}
  const fullAccess = auth?.role === 'admin' || auth?.role === 'owner'
  const existingNames = new Set((Array.isArray(kit.assets) ? kit.assets : []).map((asset) => String(asset?.name || '').trim()).filter(Boolean))
  const projectedReferences = (Array.isArray(canonicalReferences) ? canonicalReferences : [])
    .filter((reference) => reference?.filename && !existingNames.has(reference.filename))
    .map((reference) => ({
      id: reference.mediaId || reference.id,
      name: reference.filename,
      publicUrl: reference.url || reference.path || null,
      contentType: String(reference.filename).toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/*',
      sizeBytes: null,
      sha256: reference.sha256 || null,
      visibility: 'role_limited',
      metadata: {
        source: 'canonical-reference',
        alt: reference.alt || reference.filename,
        usage: reference.role === 'logo' ? 'logo' : reference.role === 'style-board' ? 'style_board' : reference.usage === 'character' ? 'character' : 'reference',
        ...(reference.characterId ? { characterId: reference.characterId } : {})
      }
    }))
  const assets = [...(Array.isArray(kit.assets) ? kit.assets : []), ...projectedReferences]
    .filter((asset) => fullAccess || asset.visibility === 'public' || (asset.visibility === 'role_limited' && ['owner', 'admin', 'editor'].includes(auth?.role)))
    .map((asset) => ({
        id: asset.id,
        name: asset.name,
        publicUrl: asset.publicUrl || null,
        contentType: asset.contentType || null,
        sizeBytes: asset.sizeBytes || null,
        sha256: asset.sha256 || null,
        visibility: asset.visibility || 'private',
        metadata: asset.metadata && typeof asset.metadata === 'object'
          ? {
              alt: String(asset.metadata.alt || ''),
              ...(asset.metadata.source ? { source: String(asset.metadata.source) } : {}),
              ...(asset.metadata.usage ? { usage: String(asset.metadata.usage) } : {}),
              ...(asset.metadata.characterId ? { characterId: String(asset.metadata.characterId) } : {})
            }
          : {}
      }))
  return { ...kit, manifest, assets }
}

// New v2 brands live in Postgres and may not have a legacy data/site-config
// file yet. Expose a minimal validated config so a personal PAT or OAuth
// grant can address the brand without requiring a legacy /admin record.
async function siteConfigForMcp(handle, auth) {
  const legacy = loadSiteConfig(handle)
  if (legacy) return legacy
  if (!isPostgresConfigured()) return null
  try {
    const context = await resolveWorkspaceContext({ userId: auth?.userId || undefined, siteHandle: handle })
    const brand = context.sites.find((site) => site.handle === handle)
    if (!brand) return null
    return { handle: brand.handle, name: brand.name, domain: brand.domain || '' }
  } catch {
    return null
  }
}

async function publicSessionForAuth(auth) {
  const session = publicAuthSession(auth)
  if (!session || !isPostgresConfigured()) return session
  try {
    const context = await resolveWorkspaceContext({ userId: auth.userId || undefined, ...(auth.userId ? {} : auth.site ? { siteHandle: auth.site } : {}) })
    const workspaceRole = auth.role === 'admin' ? 'admin' : context.role || workspaceRoleForAuth(auth)
    const contextSites = [...new Set((context.sites || []).map((site) => String(site.handle || '').trim()).filter(Boolean))]
    const sessionSites = [...new Set((session.sites || []).map((site) => String(site || '').trim()).filter(Boolean))]
    // Super-admins can see legacy and canonical brands during the migration;
    // merge both sources while collapsing duplicate handles.
    const sites = auth.role === 'admin' ? [...new Set([...sessionSites, ...contextSites])] : contextSites
    return {
      ...session,
      workspaceId: context.workspaceId,
      workspaceRole,
      sites,
      brandRoles: auth.role === 'admin' ? {} : (context.brandRoles || auth.brandRoles || {}),
      site: session.site || sites[0] || null
    }
  } catch {
    return session
  }
}

const connectionDiscoveryCache = new Map()
const CONNECTION_DISCOVERY_TTL_MS = 30 * 1000

function connectionDiscoveryKey(provider, token, apiBaseUrl = '', organizationId = '') {
  return createHash('sha256').update([provider, token, apiBaseUrl, organizationId].join('\0')).digest('hex')
}

async function cachedConnectionDiscovery(key, loader) {
  const now = Date.now()
  const cached = connectionDiscoveryCache.get(key)
  if (cached?.expiresAt > now) return cached.value
  const value = await loader()
  connectionDiscoveryCache.set(key, { value, expiresAt: now + CONNECTION_DISCOVERY_TTL_MS })
  for (const [entryKey, entry] of connectionDiscoveryCache) if (entry.expiresAt <= now) connectionDiscoveryCache.delete(entryKey)
  return value
}

async function handleRequest(req, res) {
  res._request = req
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'

  const legacyPreview = path.match(/^\/app\/preview\/([^/]+)$/)
  if (req.method === 'GET' && legacyPreview && DEPRECATED_CMS_HOSTS.includes(requestHostname(req))) {
    const slug = encodeURIComponent(decodeURIComponent(legacyPreview[1]))
    res.writeHead(308, { Location: `${CANONICAL_CMS_URL}/app/preview/${slug}?site=escarlet`, 'Cache-Control': 'no-store' })
    res.end()
    return
  }

  if (req.method === 'OPTIONS') {
    applyCors(res, req, { credentials: true })
    sendMcpCors(res, req)
    res.writeHead(204, {
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, Idempotency-Key, X-Request-Id, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-Id, Stripe-Signature',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    })
    res.end()
    return
  }

  // Stripe needs the raw body for signature verification (before JSON parse).
  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/stripe/webhook') {
    try {
      const rawBuf = await readRawBuffer(req)
      const rawBody = rawBuf.toString('utf8')
      const secret = process.env.STRIPE_WEBHOOK_SECRET || ''
      verifyStripeSignature(rawBody, req.headers['stripe-signature'], secret)
      const event = JSON.parse(rawBody)
      const result = await handleStripeEvent(event)
      json(res, 200, { ok: true, ...result })
    } catch (err) {
      json(res, err.status || 400, { message: err.message, ...(err.extra || {}) })
    }
    return
  }

  if (
    path === '/.well-known/oauth-protected-resource' ||
    path === '/.well-known/oauth-protected-resource/mcp' ||
    path === '/.well-known/oauth-protected-resource/mcp/v3'
  ) {
    if (rejectDeprecatedMcpHost(req, res)) return
    json(res, 200, protectedResourceMetadata({ resourcePath: '/mcp/v3' }))
    return
  }

  if (
    path === '/.well-known/oauth-authorization-server' ||
    path === '/.well-known/openid-configuration'
  ) {
    if (rejectDeprecatedMcpHost(req, res)) return
    json(res, 200, authorizationServerMetadata())
    return
  }

  if (path === '/oauth/authorize') {
    if (req.method === 'GET') {
      const result = await handleAuthorizeGet(url)
      html(res, result.status, result.html)
      return
    }
    if (req.method === 'POST') {
      try {
        const body = await parseBody(req)
        const result = await handleAuthorizePost(body)
        if (result.location) {
          res.writeHead(result.status, { Location: result.location })
          res.end()
          return
        }
        html(res, result.status, result.html)
      } catch (error) {
        html(res, 400, `<pre>${error.message}</pre>`)
      }
      return
    }
  }

  if (req.method === 'POST' && path === '/oauth/token') {
    try {
      const body = await parseBody(req)
      const result = await handleToken(body)
      json(res, result.status, result.json)
    } catch (error) {
      json(res, 400, { error: 'invalid_request', error_description: error.message })
    }
    return
  }

  if (req.method === 'POST' && path === '/oauth/register') {
    try {
      const body = await parseBody(req)
      const result = await handleRegister(body)
      json(res, result.status, result.json)
    } catch (error) {
      json(res, 400, { error: 'invalid_client_metadata', error_description: error.message })
    }
    return
  }

  if (req.method === 'GET' && path === '/api/auth0/status') {
    json(res, 200, auth0UiStatus())
    return
  }

  if (req.method === 'GET' && path === '/api/auth0/login') {
    try {
      const result = await createAuth0Login({ next: url.searchParams.get('next') || '/app' })
      res.writeHead(302, {
        Location: result.url.href,
        'Cache-Control': 'no-store',
        'Set-Cookie': auth0TransactionCookie(result.state)
      })
      res.end()
    } catch (error) {
      json(res, error.status || 503, { message: error.message, code: 'auth0_ui_unavailable' })
    }
    return
  }

  if (req.method === 'GET' && path === '/api/auth0/callback') {
    const config = getAuth0UiConfig()
    try {
      const callbackUrl = new URL(`${config.callbackUrl}${url.search}`)
      const result = await completeAuth0Login({ callbackUrl: callbackUrl.toString(), stateCookie: requestCookie(req, 'auth0_tx') })
      const user = result.userId ? getPasswordUserById(result.userId) : getPasswordUserByEmail(result.email)
      if (!user || user.disabled) {
        const error = new Error('Tu usuario de Auth0 todavía no está invitado a Escarlet.')
        error.status = 403
        throw error
      }
      const sites = userSites(user)
      const browserSession = createSessionBearer({
        site: sites[0],
        sites,
        role: user.role,
        userId: user.id,
        mustSetPassword: user.mustSetPassword,
        ttlMs: 8 * 60 * 60 * 1000
      })
      const next = result.next || '/app'
      res.writeHead(302, {
        Location: next,
        'Cache-Control': 'no-store',
        'Set-Cookie': [authCookie(browserSession.token, { persistent: true }), auth0TransactionCookie('', { clear: true })]
      })
      res.end()
    } catch (error) {
      const code = error.status === 403 ? 'auth0_not_invited' : 'auth0_callback_failed'
      const target = `/app?auth0_error=${encodeURIComponent(code)}`
      res.writeHead(302, {
        Location: target,
        'Cache-Control': 'no-store',
        'Set-Cookie': auth0TransactionCookie('', { clear: true })
      })
      res.end()
    }
    return
  }

  if (req.method === 'GET' && path === '/api/auth0/logout') {
    res.writeHead(302, {
      Location: auth0LogoutUrl(),
      'Cache-Control': 'no-store',
      'Set-Cookie': authCookie('', { clear: true })
    })
    res.end()
    return
  }

  if (path === '/mcp/v3') {
    if (rejectDeprecatedMcpHost(req, res)) return
    let auth
    try {
      auth = await resolveRequestAuthAsync(req, url)
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 503, { message: error.message || 'No se pudo resolver la identidad.' })
      return
    }
    if (!auth) {
      sendMcpV3Cors(res, req)
      res.writeHead(401, {
        'Content-Type': 'application/json; charset=utf-8',
        'WWW-Authenticate': wwwAuthenticateHeader(),
        'Access-Control-Allow-Headers':
          'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-Id',
        'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate'
      })
      res.end(JSON.stringify({ message: 'No autorizado. Usa Bearer con tu PAT personal u OAuth.' }))
      return
    }
    try {
      assertAiRateLimit(aiRateLimitKey(auth, url.searchParams.get('site') || '', requestIp(req)), { limit: 120 })
      const parsedBody = req.method === 'POST' ? await parseBody(req) : undefined
      await handleMcpV3Http(req, res, parsedBody, auth)
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 400, { message: error.message })
    }
    return
  }

  if (path === '/mcp') {
    sendMcpCors(res, req)
    res.writeHead(410, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({
      error: 'mcp_v3_required',
      message: 'El contrato MCP anterior fue retirado. Conecta con /mcp/v3 y usa tools namespaced.'
    }))
    return
  }

  if (req.method === 'GET' && path === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('User-agent: *\nDisallow: /\n')
    return
  }

  if (req.method === 'GET' && (path === '/runtime' || path === `/runtime/${RUNTIME_CHANNEL}`)) {
    json(res, 200, getRuntimeManifest())
    return
  }

  const runtimeMatch = path.match(/^\/runtime\/(v\d+)\/(.+)$/)
  if (req.method === 'GET' && runtimeMatch) {
    const [, channel, fileName] = runtimeMatch
    if (channel !== RUNTIME_CHANNEL) {
      json(res, 404, { message: `Canal runtime ${channel} no disponible. Usa ${RUNTIME_CHANNEL}.` })
      return
    }
    if (fileName === 'manifest.json') {
      json(res, 200, getRuntimeManifest())
      return
    }
    const file = getRuntimeFile(fileName)
    if (!file) {
      json(res, 404, { message: 'Archivo runtime no encontrado' })
      return
    }
    applyCors(res, req)
    res.writeHead(200, {
      'Content-Type': file.contentType,
      'Content-Length': file.body.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    })
    res.end(file.body)
    return
  }

  if (redirectLegacySurface(req, res, path)) return

  if ((req.method === 'GET' || req.method === 'HEAD') && servePwa(req, res, path)) {
    return
  }

  if (req.method === 'POST' && path === '/api/embed/session') {
    try {
      const auth = resolveRequestAuth(req, url)
      if (!auth) {
        json(res, 401, { message: 'No autorizado' })
        return
      }
      const body = await parseBody(req)
      const rawToken = extractBearerOrCookie(req, url)
      const next = sanitizeNext(body.next || body.path || '')
      const session = createEmbedSession({
        token: rawToken,
        site: isSiteScopedRole(auth.role) ? auth.site : body.site || null,
        next
      })
      const origin = absoluteCmsOrigin(req)
      const consumeUrl = `${origin}/api/embed/consume?code=${encodeURIComponent(session.code)}`
      json(res, 200, {
        ok: true,
        consumeUrl,
        expiresAt: new Date(session.expiresAt).toISOString(),
        next: session.next
      })
    } catch (error) {
      json(res, error.status || 400, { message: error.message })
    }
    return
  }

  if (req.method === 'GET' && path === '/api/embed/consume') {
    const code = url.searchParams.get('code') || ''
    const session = consumeEmbedSession(code)
    if (!session) {
      html(res, 400, '<!doctype html><p>El enlace de acceso ha caducado. Vuelve a WordPress y ábrelo otra vez.</p>')
      return
    }
    const cookie = authCookie(session.token)
    html(res, 200, embedBootstrapHtml({ next: session.next }), {
      'Set-Cookie': cookie,
      'Cache-Control': 'no-store'
    })
    return
  }

  // --- Product restructure V1: magic + review links ---
  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/magic/send') {
    try {
      const auth = requireAuth(req, url, res)
      if (!auth) return
      assertAgencyOps(auth)
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      assertSiteAccess(auth, site)
      const email = String(body.email || '').trim()
      const role = body.role === 'agency_admin' ? 'agency_admin' : 'client'
      const invitedUser = email ? getPasswordUserByEmail(email) : null
      const minted = createMagicToken({
        site,
        sites: invitedUser ? userSites(invitedUser) : [site],
        role,
        email,
        userId: invitedUser?.id,
        next: sanitizeNext(body.next)
      })
      const origin = absoluteCmsOrigin(req)
      const link = `${origin}/app/magic/consume?token=${encodeURIComponent(minted.token)}`
      const delivery = await sendMagicLinkEmail({ to: email, link, site })
      json(res, 200, {
        ok: true,
        expiresAt: new Date(minted.expiresAt).toISOString(),
        transport: delivery.transport,
        // Ops paste when Resend is unset
        link: delivery.transport === 'console' ? link : undefined
      })
    } catch (error) {
      json(res, error.status || 400, { message: error.message })
    }
    return
  }

  if (isProductRestructureV1() && req.method === 'GET' && (path === '/api/magic/consume' || path === '/app/magic/consume')) {
    const token = url.searchParams.get('token') || ''
    const result = consumeMagicToken(token, {
      origin: req.headers.origin,
      host: req.headers.host
    })
    if (!result.ok) {
      html(
        res,
        result.status || 410,
        `<!doctype html><p>${escapeHtml(result.message || 'Enlace mágico no válido o caducado.')}</p>`
      )
      return
    }
    const bearer = createSessionBearer({
      site: result.session.site,
      sites: result.session.sites,
      role: result.session.role,
      userId: result.session.userId,
      mustSetPassword: result.session.purpose === 'invite' || result.session.purpose === 'reset'
    })
    const cookie = authCookie(bearer.token)
    const next = result.session.next || '/'
    html(
      res,
      200,
      path === '/app/magic/consume'
        ? pwaMagicBootstrapHtml({ next })
        : embedBootstrapHtml({ next }),
      { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' }
    )
    return
  }

  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/review/token') {
    try {
      const auth = requireAuth(req, url, res)
      if (!auth) return
      assertAgencyOps(auth)
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      assertSiteAccess(auth, site)
      const slug = String(body.slug || '').trim()
      if (!slug) {
        json(res, 400, { message: 'Falta slug' })
        return
      }
      const minted = createReviewToken({
        site,
        slug,
        actions: body.actions
      })
      const origin = absoluteCmsOrigin(req)
      json(res, 200, {
        ok: true,
        token: minted.token,
        expiresAt: new Date(minted.expiresAt).toISOString(),
        consumeUrl: `${origin}/api/review/consume`
      })
    } catch (error) {
      json(res, error.status || 400, { message: error.message })
    }
    return
  }

  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/review/consume') {
    try {
      const body = await parseBody(req)
      const consumed = consumeReviewToken(body.token, {
        action: body.action,
        rejectReason: body.rejectReason,
        expectedSlug: body.slug,
        origin: req.headers.origin,
        host: req.headers.host
      })
      if (!consumed.ok) {
        json(res, consumed.status || 401, { message: consumed.message || 'Review token denied' })
        return
      }
      const result = await cmsApplyReviewLinkAction(consumed.site, consumed.slug, {
        action: consumed.action,
        rejectReason: consumed.rejectReason,
        actor: consumed.actor
      })
      json(res, 200, result)
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
    return
  }

  if (req.method === 'GET' && path === '/favicon.svg') {
    servePublic(res, 'escarlet-icon.png', 'image/png')
    return
  }

  if (req.method === 'GET' && path === '/favicon.ico') {
    servePublic(res, 'escarlet-icon.png', 'image/png')
    return
  }

  const mediaMatch = path.match(/^\/media\/([^/]+)(?:\/reference)?\/([^/]+)$/)
  if ((req.method === 'GET' || req.method === 'HEAD') && mediaMatch) {
    const [, site, filename] = mediaMatch
    const isRef = path.includes('/reference/')
    const filePath = join(mediaDir, isRef ? join(site, 'reference') : site, filename)
    const ext = extname(filename).toLowerCase()
    const types = {
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webm': 'video/webm',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.m4v': 'video/x-m4v'
    }
    serveMediaFile(res, filePath, types[ext] || 'application/octet-stream', req, filename)
    return
  }

  if (req.method === 'POST' && path === '/api/login') {
    try {
      const body = await parseBody(req)
      const auth = await resolveRequestAuthAsync(
        { headers: { authorization: `Bearer ${body.token || ''}` } },
        new URL('http://local/')
      )
      if (!auth) {
        json(res, 401, { message: 'Token incorrecto' })
        return
      }
      // Never use the personal PAT itself as the browser cookie. PATs are
      // deliberately revocable credentials for MCP clients, so regenerating
      // one must not unexpectedly sign the user out of the app that issued it.
      const browserSession = createSessionBearer({
        site: auth.site,
        sites: auth.sites,
        role: auth.role,
        userId: auth.userId,
        mustSetPassword: auth.mustSetPassword,
        ttlMs: 8 * 60 * 60 * 1000
      })
      const session = await publicSessionForAuth(auth)
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        // A persistent cookie is important for the installed PWA: session
        // cookies can disappear when the standalone app is closed.
        'Set-Cookie': authCookie(browserSession.token, { persistent: true })
      })
      res.end(JSON.stringify({ ok: true, ...session }))
    } catch (error) {
      json(res, 400, { message: error.message })
    }
    return
  }

  if (req.method === 'POST' && path === '/api/logout') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': authCookie('', { clear: true })
    })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (isProductRestructureV1() && req.method === 'GET' && path === '/api/auth/status') {
    json(res, 200, {
      passwordAuth: isPasswordAuthEnabled(),
      google: googleAuthStatus()
    })
    return
  }

  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/auth/login') {
    try {
      const body = await parseBody(req)
      const result = loginPasswordUser(body)
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': authCookie(result.token)
      })
      res.end(JSON.stringify({ ok: true, ...result, ...await publicSessionForAuth(resolveAuth(result.token)) }))
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
    return
  }

  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/auth/register') {
    const auth = await resolveRequestAuthAsync(req, url)
    if (!auth) {
      try {
        if (!isPostgresConfigured()) throw Object.assign(new Error('El registro requiere Postgres.'), { status: 503 })
        const body = await parseBody(req)
        const user = registerPasswordUser({ email: body.email, password: body.password, role: 'owner', allowNoSite: true })
        await syncLegacyUsersToPostgres()
        const workspace = await createWorkspace({ name: body.workspaceName || body.name || `${user.email} workspace`, slug: body.workspaceSlug || body.slug || user.email.split('@')[0], userId: user.id })
        const brand = await createBrand({ workspaceId: workspace.id, userId: user.id, role: 'owner', handle: body.brandHandle || workspace.slug, name: body.brandName || body.workspaceName || body.name || workspace.name, domain: body.domain || null })
        const login = loginPasswordUser({ email: body.email, password: body.password })
        const session = await publicSessionForAuth(resolveAuth(login.token))
        res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': authCookie(login.token) })
        res.end(JSON.stringify({ ok: true, user, workspace, brand, ...login, session }))
      } catch (error) {
        json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
      }
      return
    }
    try {
      assertAgencyOps(auth)
      const body = await parseBody(req)
      const allowed = allowedSiteHandles(auth)
      const requestedSites = Array.isArray(body.sites) ? body.sites : [body.site || DEFAULT_SITE]
      const sites = [...new Set(requestedSites.map((s) => String(s || '').trim()).filter((s) => allowed.includes(s)))]
      if (!sites.length) {
        json(res, 403, { message: 'No puedes asignar esos sitios' })
        return
      }
      sites.forEach((site) => assertSiteAccess(auth, site))
      const invite = body.invite === true || body.method === 'invite'
      const user = registerPasswordUser({
        email: body.email,
        password: body.password,
        role: body.role,
        site: sites[0],
        sites,
        invite
      })
      let inviteMail = null
      if (invite) {
        const minted = createMagicToken({
          site: user.site,
          sites: user.sites,
          role: user.role,
          email: user.email,
          userId: user.id,
          purpose: 'invite',
          next: '/'
        })
        const origin = absoluteCmsOrigin(req)
        const link = `${origin}/app/magic/consume?token=${encodeURIComponent(minted.token)}`
        inviteMail = await sendMagicLinkEmail({
          to: user.email,
          link,
          site: user.site,
          subject: `Activa tu acceso al CMS (${user.site})`,
          text: `Hola.\n\nCrea tu contraseña y entra al CMS Escarlet con este enlace (caduca en 15 minutos):\n\n${link}\n`
        })
      }
      json(res, 201, {
        ok: true,
        user,
        invite: invite
          ? {
              transport: inviteMail?.transport,
              link: inviteMail?.transport === 'console' ? inviteMail.link : undefined
            }
          : undefined
      })
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
    return
  }

  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/auth/forgot') {
    try {
      const body = await parseBody(req)
      const email = String(body.email || '').trim().toLowerCase()
      const user = email.includes('@') ? getPasswordUserByEmail(email) : null
      if (user) {
        const sites = userSites(user)
        const minted = createMagicToken({
          site: sites[0],
          sites,
          role: user.role,
          email: user.email,
          userId: user.id,
          purpose: 'reset',
          next: '/'
        })
        const origin = absoluteCmsOrigin(req)
        const link = `${origin}/app/magic/consume?token=${encodeURIComponent(minted.token)}`
        await sendMagicLinkEmail({
          to: user.email,
          link,
          site: sites[0],
          subject: 'Recupera tu contraseña del CMS Escarlet',
          text: `Hola.\n\nElige una contraseña nueva con este enlace (caduca en 15 minutos):\n\n${link}\n`
        })
      }
      json(res, 200, { ok: true })
    } catch (error) {
      json(res, 200, { ok: true })
    }
    return
  }

  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/auth/password') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    try {
      const body = await parseBody(req)
      if (!auth.userId && auth.role !== 'admin') {
        json(res, 403, { message: 'Esta sesión no puede cambiar la contraseña' })
        return
      }
      const targetId = auth.role === 'admin' && body.id ? body.id : auth.userId
      const user = setUserPassword({ id: targetId, password: body.password })
      await syncLegacyUsersToPostgres()
      json(res, 200, { ok: true, user })
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
    return
  }

  if (isProductRestructureV1() && (req.method === 'GET' || req.method === 'POST') && path === '/api/auth/profile') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    try {
      if (!auth.userId) {
        json(res, 403, { message: 'Esta sesión no tiene un perfil editable' })
        return
      }
      if (req.method === 'GET') {
        const user = listPasswordUsers().find((row) => row.id === auth.userId)
        if (!user) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 })
        json(res, 200, { profile: user })
        return
      }
      const body = await parseBody(req)
      const profile = updateUserProfile({
        id: auth.userId,
        displayName: body.displayName,
        bio: body.bio,
        avatarDataUrl: body.avatarDataUrl,
        allowPublishingAs: body.allowPublishingAs
      })
      await syncLegacyUsersToPostgres()
      json(res, 200, { ok: true, profile })
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
    return
  }

  // Each signed-in human user can mint and revoke their own durable login
  // token for external clients such as ChatGPT. The full token is returned
  // only from the mint operation; sessions expose only hasLoginToken and a
  // four-character hint.
  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/auth/profile/token') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    try {
      if (!auth.userId) throw Object.assign(new Error('Esta sesión no tiene un perfil de usuario'), { status: 403 })
      // Migrate browsers that logged in before PATs were separated from app
      // sessions. The cookie is replaced before the PAT is revoked below.
      const browserSession = createSessionBearer({
        site: auth.site,
        sites: auth.sites,
        role: auth.role,
        userId: auth.userId,
        mustSetPassword: auth.mustSetPassword,
        ttlMs: 8 * 60 * 60 * 1000
      })
      res.setHeader('Set-Cookie', authCookie(browserSession.token, { persistent: true }))
      const minted = await mintUserLoginTokenAsync({ id: auth.userId })
      const { token, ...profile } = minted
      json(res, 200, { ok: true, profile, token })
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
    return
  }

  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/auth/profile/token/revoke') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    try {
      if (!auth.userId) throw Object.assign(new Error('Esta sesión no tiene un perfil de usuario'), { status: 403 })
      const browserSession = createSessionBearer({
        site: auth.site,
        sites: auth.sites,
        role: auth.role,
        userId: auth.userId,
        mustSetPassword: auth.mustSetPassword,
        ttlMs: 8 * 60 * 60 * 1000
      })
      res.setHeader('Set-Cookie', authCookie(browserSession.token, { persistent: true }))
      const profile = await revokeUserLoginTokenAsync({ id: auth.userId })
      json(res, 200, { ok: true, profile })
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
    return
  }

  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/auth/profile/publishing-link') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    try {
      if (!auth.userId) throw Object.assign(new Error('Esta sesión no tiene un perfil de autor'), { status: 403 })
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      assertSiteAccess(auth, site)
      const invite = mintAuthorInvite({ ownerId: auth.userId, site })
      const origin = absoluteCmsOrigin(req)
      json(res, 200, {
        ok: true,
        site,
        expiresAt: new Date(invite.expiresAt).toISOString(),
        token: invite.token,
        link: `${origin}/app/author-invite?token=${encodeURIComponent(invite.token)}`
      })
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
    return
  }

  if (isProductRestructureV1() && (req.method === 'GET' || req.method === 'POST') && path === '/api/auth/profile/delegates') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    try {
      if (!auth.userId) throw Object.assign(new Error('Esta sesión no tiene un perfil editable'), { status: 403 })
      const body = req.method === 'POST' ? await parseBody(req) : {}
      const site = siteFrom(auth, (req.method === 'GET' ? url.searchParams.get('site') : body.site) || DEFAULT_SITE)
      assertSiteAccess(auth, site)
      if (req.method === 'GET') {
        json(res, 200, { site, users: listPublishingDelegates({ ownerId: auth.userId, site }) })
        return
      }
      const result = setPublishingDelegate({
        ownerId: auth.userId,
        delegateId: body.delegateId,
        site,
        enabled: body.enabled !== false
      })
      json(res, 200, { ok: true, ...result })
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
    return
  }

  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/auth/profile/publishing-link/accept') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    try {
      if (!auth.userId) throw Object.assign(new Error('Esta sesión no tiene un perfil editable'), { status: 403 })
      const body = await parseBody(req)
      const result = consumeAuthorInvite({ token: body.token, userId: auth.userId })
      json(res, 200, result)
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
    return
  }

  if (isProductRestructureV1() && req.method === 'GET' && path === '/api/auth/users') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    try {
      assertAgencyOps(auth)
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      assertSiteAccess(auth, site)
      const users = auth.role === 'admin' && url.searchParams.get('all') === '1'
        ? listPasswordUsers()
        : listPasswordUsers({ site })
      const visibleUsers = ['admin', 'owner'].includes(auth.role)
        ? users
        : users.filter((user) => String(user.role || '').toLowerCase() !== 'owner')
      json(res, 200, { users: visibleUsers, site })
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
    return
  }

  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/auth/users/delete') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    try {
      assertAgencyOps(auth)
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      assertSiteAccess(auth, site)
      const rows = listPasswordUsers({ site })
      const target = rows.find((u) => u.id === body.id || u.email === String(body.email || '').toLowerCase())
      if (!target) throw Object.assign(new Error('Usuario no encontrado en este sitio'), { status: 404 })
      const result = deletePasswordUser({ id: target.id })
      json(res, 200, result)
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
    return
  }

  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/auth/users/token') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    try {
      if (!isSuperAdmin(auth)) {
        json(res, 403, { message: 'Solo el super-admin puede crear tokens de usuario' })
        return
      }
      const body = await parseBody(req)
      const minted = await mintUserLoginTokenAsync({ id: body.id })
      json(res, 200, { ok: true, user: minted, token: minted.token })
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
    return
  }

  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/auth/users/token/revoke') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    try {
      if (!isSuperAdmin(auth)) {
        json(res, 403, { message: 'Solo el super-admin puede revocar tokens de usuario' })
        return
      }
      const body = await parseBody(req)
      const user = await revokeUserLoginTokenAsync({ id: body.id })
      json(res, 200, { ok: true, user })
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
    return
  }

  if (isProductRestructureV1() && req.method === 'POST' && path === '/api/auth/users/update') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    try {
      assertAgencyOps(auth)
      const body = await parseBody(req)
      const allowed = allowedSiteHandles(auth)
      let sites
      if (Array.isArray(body.sites)) {
        sites = [...new Set(body.sites.map((s) => String(s || '').trim()).filter((s) => allowed.includes(s)))]
        if (!sites.length) {
          json(res, 403, { message: 'No puedes asignar esos sitios' })
          return
        }
        sites.forEach((site) => assertSiteAccess(auth, site))
      }
      const user = updatePasswordUser({ id: body.id, email: body.email, sites, role: body.role, allowPublishingAs: body.allowPublishingAs })
      await syncLegacyUsersToPostgres()
      json(res, 200, { ok: true, user })
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
    return
  }

  // Session bootstrap also understands canonical Postgres bearer/session
  // tokens, so the PWA does not need a second login contract during cutover.
  if (req.method === 'GET' && path === '/api/admin/session') {
    try {
      const auth = await resolveRequestAuthAsync(req, url)
      if (!auth) { json(res, 401, { message: 'No autorizado' }); return }
      json(res, 200, await publicSessionForAuth(auth))
    } catch (error) {
      json(res, error.status || 503, { message: error.message || 'No se pudo resolver la sesión.' })
    }
    return
  }

  if (path.startsWith('/api/v3/')) {
    json(res, 410, {
      code: 'legacy_rest_removed',
      message: 'Los endpoints REST v3 fueron retirados. Usa /api/v2 para la PWA y /mcp/v3 para agentes.'
    })
    return
  }

  if (req.method === 'GET' && path === '/api/v3/catalog') {
    try {
      const scope = await requireV2Context(req, url, res, { site: url.searchParams.get('site') || '' })
      if (!scope) return
      const auth = {
        ...scope.auth,
        workspaceId: scope.workspaceId,
        siteId: scope.siteId,
        site: scope.context.siteHandle,
        role: scope.context.role
      }
      const [guide, capabilities, recipes] = await Promise.all([
        invokeMcpToolV3('capability.guide', { goal: url.searchParams.get('goal') || '' }, auth),
        invokeMcpToolV3('capability.search', { type: 'primitive' }, auth),
        invokeMcpToolV3('recipe.list', {}, auth)
      ])
      const failed = [guide, capabilities, recipes].find((result) => result.isError)
      if (failed) {
        const error = failed.structuredContent?.error || {}
        json(res, Number(error.status) || 500, error)
        return
      }
      json(res, 200, {
        contractVersion: 'os.production.v1',
        guide: guide.structuredContent,
        capabilities: capabilities.structuredContent.capabilities,
        recipes: recipes.structuredContent.recipes
      })
    } catch (error) {
      json(res, error.status || 400, { message: error.message, code: error.code })
    }
    return
  }

  if (req.method === 'POST' && path === '/api/v3/recipes/run') {
    let body = {}
    try {
      body = await parseBody(req, MAX_BODY_BYTES)
      const scope = await requireV2Context(req, url, res, body)
      if (!scope) return
      const auth = {
        ...scope.auth,
        workspaceId: scope.workspaceId,
        siteId: scope.siteId,
        site: scope.context.siteHandle,
        role: scope.context.role
      }
      const result = await invokeMcpToolV3('recipe.run', {
        ...body,
        workspaceId: scope.workspaceId,
        siteId: scope.siteId,
        site: scope.context.siteHandle
      }, auth)
      if (result.isError) {
        const error = result.structuredContent?.error || {}
        json(res, Number(error.status) || 500, error)
        return
      }
      json(res, 202, result.structuredContent)
    } catch (error) {
      json(res, error.status || 400, { message: error.message, code: error.code })
    }
    return
  }

  if (req.method === 'POST' && path === '/api/v2/publication') {
    let body = {}
    try {
      body = await parseBody(req, MAX_BODY_BYTES)
      const scope = await requireV2Context(req, url, res, body)
      if (!scope) return
      const operation = String(body.operation || '').trim().toLowerCase()
      const operationName = {
        list: 'publication.destination.list',
        'destination.list': 'publication.destination.list',
        route: 'publication.route',
        prepare: 'publication.prepare',
        schedule: 'publication.schedule',
        publish: 'publication.publish',
        status: 'publication.status.get',
        'status.get': 'publication.status.get'
      }[operation]
      if (!operationName) {
        json(res, 422, { code: 'publication_operation_required', message: 'operation debe ser list, route, prepare, schedule, publish o status.get.' })
        return
      }
      const auth = { ...scope.auth, workspaceId: scope.workspaceId, siteId: scope.siteId, site: scope.context.siteHandle, role: scope.context.role }
      const connections = await listBrandConnections({ workspaceId: scope.workspaceId, siteId: scope.siteId })
      let assets = body.assets
      const assetIds = Array.isArray(body.assetIds) ? [...new Set(body.assetIds.map((value) => String(value || '').trim()).filter(Boolean))] : []
      if ((!Array.isArray(assets) || !assets.length) && assetIds.length) {
        const pool = await getPgPool()
        const assetRows = await pool.query('SELECT id,content_type AS "mimeType",sha256,metadata FROM media_assets WHERE workspace_id=$1 AND site_id=$2 AND id=ANY($3::text[])', [scope.workspaceId, scope.siteId, assetIds])
        if (assetRows.rowCount !== assetIds.length) {
          json(res, 404, { code: 'publication_asset_not_found', message: 'Uno de los assets no pertenece a esta marca.' })
          return
        }
        assets = assetRows.rows.map((asset) => ({ assetId: asset.id, mimeType: asset.mimeType, sha256: asset.sha256, metadata: asset.metadata }))
      }
      const result = await invokeMcpToolV3(operationName, {
        ...body,
        workspaceId: scope.workspaceId,
        siteId: scope.siteId,
        site: scope.context.siteHandle,
        connections,
        ...(assets ? { assets } : {})
      }, auth)
      if (result.isError) {
        const error = result.structuredContent?.error || {}
        json(res, Number(error.status) || 500, error)
        return
      }
      json(res, 200, result.structuredContent)
    } catch (error) {
      json(res, error.status || 400, { message: error.message, code: error.code })
    }
    return
  }

  // Canonical multi-tenant content API for the PWA and internal control plane.
  if (path.startsWith('/api/v2/')) {
    let body = {}
    const videoUploadRequest = req.method === 'POST' && /^\/api\/v2\/content\/items\/[^/]+\/video$/.test(path)
    const brandKitImportRequest = req.method === 'POST' && /^\/api\/v2\/brands\/[^/]+\/brand-kit\/import$/.test(path)
    const productionAssetUploadRequest = req.method === 'POST' && path === '/api/v2/assets/upload'
    try { if (req.method !== 'GET') body = await parseBody(req, videoUploadRequest || brandKitImportRequest || productionAssetUploadRequest ? 60 * 1024 * 1024 : MAX_BODY_BYTES) } catch (error) {
      json(res, error.status || 400, { message: error.message })
      return
    }
    const batchMatch = path.match(/^\/api\/v2\/content\/batches\/([^/]+)$/)
    const itemMatch = path.match(/^\/api\/v2\/content\/items\/([^/]+)$/)
    const videoUploadMatch = path.match(/^\/api\/v2\/content\/items\/([^/]+)\/video$/)
    const videoJobMatch = path.match(/^\/api\/v2\/video\/jobs\/([^/]+)$/)
    const itemActionMatch = path.match(/^\/api\/v2\/content\/items\/([^/]+)\/(approve|reject|schedule|reschedule|publish-buffer|cancel|cancel-channel|archive|restore-archive|mark-published|reconcile-scheduled|clear-published-errors|reopen-unsent-channel)$/)
    const batchActionMatch = path.match(/^\/api\/v2\/content\/batches\/([^/]+)\/(schedule|cancel)$/)
    const batchReviewMatch = path.match(/^\/api\/v2\/content\/batches\/([^/]+)\/(approve|reject)$/)
    const brandMatch = path.match(/^\/api\/v2\/brands\/([^/]+)$/)
    const brandKitImportMatch = path.match(/^\/api\/v2\/brands\/([^/]+)\/brand-kit\/import$/)
    const brandKitLegacyCleanupMatch = path.match(/^\/api\/v2\/brands\/([^/]+)\/brand-kit\/cleanup-legacy-media$/)
    const brandAssetMatch = path.match(/^\/api\/v2\/brands\/([^/]+)\/brand-kit\/assets\/([^/]+)$/)
    const brandChannelsMatch = path.match(/^\/api\/v2\/brands\/([^/]+)\/channels$/)
    const brandCapabilitiesMatch = path.match(/^\/api\/v2\/brands\/([^/]+)\/capabilities$/)
    const brandConnectionsMatch = path.match(/^\/api\/v2\/brands\/([^/]+)\/connections$/)
    const postizIntegrationsMatch = path.match(/^\/api\/v2\/brands\/([^/]+)\/connections\/postiz\/integrations$/)
    const bufferChannelsMatch = path.match(/^\/api\/v2\/brands\/([^/]+)\/connections\/buffer\/channels$/)
    const connectionActionMatch = path.match(/^\/api\/v2\/connections\/([^/]+)\/(test|disconnect)$/)
    try {
      if (req.method === 'GET' && path === '/api/v2/assets') {
        const scope = await requireV2Context(req, url, res)
        if (!scope) return
        const pool = await getPgPool()
        const result = await pool.query(`
          SELECT id, storage_key AS "path", public_url AS "url", content_type AS "mimeType",
                 size_bytes AS "storedBytes", sha256, metadata, created_at AS "createdAt"
          FROM media_assets
          WHERE workspace_id=$1 AND site_id=$2
            AND (content_type LIKE 'image/%' OR metadata->>'kind' IN ('reference','post','social'))
          ORDER BY created_at DESC
          LIMIT 100
        `, [scope.workspaceId, scope.siteId])
        const assets = result.rows.map((asset) => ({
          ...asset,
          url: asset.url || (asset.path ? `/${String(asset.path).replace(/^\//, '')}` : ''),
          path: asset.path ? `/${String(asset.path).replace(/^\//, '')}` : '',
          filename: asset.metadata?.filename || asset.metadata?.fileName || asset.id,
          alt: asset.metadata?.alt || '',
          ...Object.fromEntries(['thumbUrl', 'thumbPath', 'previewUrl', 'previewPath', 'width', 'height', 'thumbWidth', 'thumbHeight', 'previewWidth', 'previewHeight', 'originalBytes', 'storedBytes', 'thumbBytes', 'previewBytes'].filter((key) => asset.metadata?.[key] !== undefined).map((key) => [key, asset.metadata[key]])),
          metadata: asset.metadata || {}
        }))
        json(res, 200, { assets })
        return
      }
      if (req.method === 'GET' && path === '/api/v2/assets/manage') {
        const scope = await requireV2Context(req, url, res)
        if (!scope) return
        const result = await listCanonicalMedia({
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
          mode: url.searchParams.get('mode') === 'standalone' ? 'standalone' : '',
          temporaryOnly: url.searchParams.get('temporaryOnly') === '1' || url.searchParams.get('mode') === 'temporary',
          includeProtected: url.searchParams.get('includeProtected') === '1',
          linked: url.searchParams.get('linked') || '',
          published: url.searchParams.get('published') || '',
          assetIds: String(url.searchParams.get('assetIds') || '').split(',').map((value) => value.trim()).filter(Boolean),
          limit: url.searchParams.get('limit')
        })
        json(res, 200, result)
        return
      }
      if (req.method === 'POST' && path === '/api/v2/assets/update') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        json(res, 200, await updateCanonicalMedia({
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
          userId: scope.auth.userId,
          role: scope.context.role,
          assetIds: body.assetIds,
          filename: body.filename,
          alt: body.alt,
          usage: body.usage
        }))
        return
      }
      if (req.method === 'POST' && path === '/api/v2/assets/delete') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        json(res, 200, await deleteCanonicalMedia({
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
          userId: scope.auth.userId,
          role: scope.context.role,
          mode: body.mode,
          assetIds: body.assetIds,
          confirm: body.confirm,
          force: body.force === true,
          idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey
        }))
        return
      }
      if (req.method === 'POST' && path === '/api/v2/assets/unlock') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        json(res, 200, await unlockCanonicalMedia({
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
          userId: scope.auth.userId,
          role: scope.context.role,
          assetIds: body.assetIds,
          confirm: body.confirm
        }))
        return
      }
      if (req.method === 'POST' && path === '/api/v2/assets/upload') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        assertWorkspaceRole(scope.context.role, ['owner', 'admin', 'editor', 'author'])
        const siteHandle = scope.context.siteHandle || scope.siteId
        const stored = await saveUploadedMedia({
          site: siteHandle,
          filename: body.filename || 'food-to-reel-image.jpg',
          contentBase64: body.contentBase64,
          imageUrl: body.imageUrl,
          filePath: body.filePath,
          alt: body.alt || '',
          kind: 'reference'
        })
        const asset = await registerContentMedia({
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
          userId: scope.auth.userId,
          role: scope.context.role,
          media: stored,
          idempotencyKey: body.idempotencyKey || '',
          idempotencyFingerprint: `${body.filename || ''}:${stored.sha256 || ''}`
        })
        json(res, 201, {
          asset,
          media: { ...stored, id: asset.id, url: asset.publicUrl || stored.url, path: asset.storageKey ? `/${String(asset.storageKey).replace(/^\//, '')}` : stored.path }
        })
        return
      }
      if (req.method === 'GET' && path === '/api/v2/brands') {
        const scope = await requireV2Context(req, url, res)
        if (!scope) return
        let allBrands = await listBrands({ workspaceId: scope.workspaceId })
        const brands = scope.auth.role === 'admin'
          ? allBrands
          : allBrands.filter((brand) => (scope.context.siteIds || []).includes(brand.id))
        json(res, 200, { brands })
        return
      }
      if (req.method === 'POST' && path === '/api/v2/brands') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        json(res, 201, { brand: await createBrand({ workspaceId: scope.workspaceId, userId: scope.auth.userId, role: scope.context.workspaceRole || scope.context.role, handle: body.handle, name: body.name, domain: body.domain }) })
        return
      }
      if (req.method === 'GET' && brandMatch) {
        const brandId = decodeURIComponent(brandMatch[1])
        const scope = await requireV2Context(req, url, res, { ...body, siteId: brandId })
        if (!scope) return
        json(res, 200, { brand: await getBrand({ workspaceId: scope.workspaceId, siteId: scope.siteId }) })
        return
      }
      if (req.method === 'PATCH' && brandMatch) {
        const brandId = decodeURIComponent(brandMatch[1])
        const scope = await requireV2Context(req, url, res, { ...body, siteId: brandId })
        if (!scope) return
        json(res, 200, { brand: await updateBrand({ workspaceId: scope.workspaceId, siteId: scope.siteId, userId: scope.auth.userId, role: scope.context.role, name: body.name, domain: body.domain }) })
        return
      }
      if (req.method === 'GET' && brandChannelsMatch) {
        const scope = await requireV2Context(req, url, res, { ...body, siteId: decodeURIComponent(brandChannelsMatch[1]) })
        if (!scope) return
        json(res, 200, { channels: await listSiteChannels({ workspaceId: scope.workspaceId, siteId: scope.siteId }), catalog: CHANNEL_CATALOG })
        return
      }
      if (req.method === 'PATCH' && brandChannelsMatch) {
        const scope = await requireV2Context(req, url, res, { ...body, siteId: decodeURIComponent(brandChannelsMatch[1]) })
        if (!scope) return
        json(res, 200, { channels: await updateBrandChannels({ workspaceId: scope.workspaceId, siteId: scope.siteId, userId: scope.auth.userId, role: scope.context.role, channels: body.channels || body }) })
        return
      }
      if (req.method === 'GET' && brandCapabilitiesMatch) {
        const scope = await requireV2Context(req, url, res, { ...body, siteId: decodeURIComponent(brandCapabilitiesMatch[1]) })
        if (!scope) return
        json(res, 200, { capabilities: await listBrandCapabilities({ workspaceId: scope.workspaceId, siteId: scope.siteId }), catalog: BRAND_CAPABILITIES })
        return
      }
      if (req.method === 'PATCH' && brandCapabilitiesMatch) {
        const scope = await requireV2Context(req, url, res, { ...body, siteId: decodeURIComponent(brandCapabilitiesMatch[1]) })
        if (!scope) return
        json(res, 200, { capabilities: await setBrandCapabilities({ workspaceId: scope.workspaceId, siteId: scope.siteId, userId: scope.auth.userId, role: scope.context.role, capabilities: body.capabilities || body }) })
        return
      }
      if (req.method === 'GET' && brandConnectionsMatch) {
        const scope = await requireV2Context(req, url, res, { ...body, siteId: decodeURIComponent(brandConnectionsMatch[1]) })
        if (!scope) return
        json(res, 200, { connections: await listBrandConnections({ workspaceId: scope.workspaceId, siteId: scope.siteId }) })
        return
      }
      if (req.method === 'POST' && postizIntegrationsMatch) {
        const scope = await requireV2Context(req, url, res, { ...body, siteId: decodeURIComponent(postizIntegrationsMatch[1]) })
        if (!scope) return
        assertWorkspaceRole(scope.context.role, ['owner', 'admin'])
        const token = body.apiToken || body.token || body.userToken || body.credentials?.apiToken || body.credentials?.token
        if (!token) throw Object.assign(new Error('apiToken es obligatorio para consultar Postiz.'), { status: 400 })
        const apiBaseUrl = body.apiBaseUrl || body.config?.apiBaseUrl || body.config?.api_base_url || ''
        const integrations = await cachedConnectionDiscovery(connectionDiscoveryKey('postiz', token, apiBaseUrl), () => listPostizIntegrations({ apiToken: token, apiBaseUrl }))
        json(res, 200, { integrations: integrations.map((integration) => ({ id: integration.id, name: integration.name, identifier: integration.identifier, profile: integration.profile, picture: integration.picture, disabled: Boolean(integration.disabled) })) })
        return
      }
      if (req.method === 'POST' && bufferChannelsMatch) {
        const scope = await requireV2Context(req, url, res, { ...body, siteId: decodeURIComponent(bufferChannelsMatch[1]) })
        if (!scope) return
        assertWorkspaceRole(scope.context.role, ['owner', 'admin'])
        const token = body.apiToken || body.token || body.userToken || body.credentials?.apiToken || body.credentials?.token
        if (!token) throw Object.assign(new Error('apiToken es obligatorio para consultar Buffer.'), { status: 400 })
        const apiBaseUrl = body.apiBaseUrl || body.config?.apiBaseUrl || body.config?.api_base_url || ''
        const requestedOrganizationId = String(body.organizationId || body.config?.organizationId || body.config?.organization_id || '').trim()
        const discovery = await cachedConnectionDiscovery(connectionDiscoveryKey('buffer', token, apiBaseUrl, requestedOrganizationId), async () => {
          const organizations = requestedOrganizationId ? [] : await listBufferOrganizations({ apiToken: token, apiBaseUrl })
          const selectedOrganization = requestedOrganizationId ? null : organizations[0]
          const channels = requestedOrganizationId || selectedOrganization
            ? await listBufferChannels({ apiToken: token, organizationId: requestedOrganizationId || selectedOrganization.id, apiBaseUrl })
            : []
          return { organizations, organizationId: selectedOrganization?.id || requestedOrganizationId || null, channels }
        })
        json(res, 200, { organizations: discovery.organizations.map((organization) => ({ id: organization.id, name: organization.name, channelCount: organization.channelCount })), organizationId: discovery.organizationId, channels: discovery.channels.map((channel) => ({ id: channel.id, name: channel.name, displayName: channel.displayName, descriptor: channel.descriptor, service: channel.service, externalLink: channel.externalLink, organizationId: channel.organizationId, isDisconnected: Boolean(channel.isDisconnected), isLocked: Boolean(channel.isLocked) })) })
        return
      }
      if (req.method === 'POST' && brandConnectionsMatch) {
        const scope = await requireV2Context(req, url, res, { ...body, siteId: decodeURIComponent(brandConnectionsMatch[1]) })
        if (!scope) return
        const provider = String(body.provider || '').trim().toLowerCase()
        const channel = String(body.channel || '').trim().toLowerCase()
        if (!provider || !channel) throw Object.assign(new Error('provider y channel son obligatorios.'), { status: 400 })
        let legacy = null
        if (provider === 'metricool') {
          const token = body.userToken || body.token || body.credentials?.userToken
          if (!token) throw Object.assign(new Error('userToken es obligatorio.'), { status: 400 })
          const encrypted = encryptSecret(token)
          legacy = await connectMetricool({ workspaceId: scope.workspaceId, siteId: scope.siteId, userId: scope.auth.userId, role: scope.context.role, userTokenCiphertext: encrypted, metricoolUserId: body.userId || body.metricoolUserId, blogId: body.blogId || body.config?.blogId || 'default', timezone: body.timezone, capabilities: body.capabilities, channel })
          await upsertBrandConnection({ workspaceId: scope.workspaceId, siteId: scope.siteId, userId: scope.auth.userId, role: scope.context.role, channel, provider, externalAccountId: body.userId || body.metricoolUserId, credentialsCiphertext: encrypted, config: { ...(body.config || {}), blogId: body.blogId || body.config?.blogId || 'default', timezone: body.timezone || 'UTC' }, capabilities: body.capabilities, status: 'connected' })
        } else if (provider === 'planable') {
          const token = body.apiToken || body.token || body.userToken || body.credentials?.apiToken || body.credentials?.token
          if (!token) throw Object.assign(new Error('apiToken es obligatorio para Planable.'), { status: 400 })
          const workspaceId = body.workspaceId || body.config?.workspaceId
          const pageId = body.pageId || body.externalAccountId || body.config?.pageId
          const pageIds = Array.isArray(body.pageIds || body.config?.pageIds) ? (body.pageIds || body.config?.pageIds).filter(Boolean) : []
          if (!workspaceId) throw Object.assign(new Error('workspaceId es obligatorio para Planable.'), { status: 400 })
          if (!pageId && !pageIds.length) throw Object.assign(new Error('pageId es obligatorio para Planable.'), { status: 400 })
          const encrypted = encryptSecret(token)
          legacy = await upsertBrandConnection({
            workspaceId: scope.workspaceId,
            siteId: scope.siteId,
            userId: scope.auth.userId,
            role: scope.context.role,
            channel,
            provider,
            externalAccountId: pageId,
            credentialsCiphertext: encrypted,
            config: { ...(body.config || {}), workspaceId, ...(pageId ? { pageId } : { pageIds }), timezone: body.timezone || body.config?.timezone || 'UTC' },
            capabilities: body.capabilities || { drafts: true, scheduling: true, media: true },
            status: body.status || 'connected'
          })
        } else if (provider === 'postiz') {
          const token = body.apiToken || body.token || body.userToken || body.credentials?.apiToken || body.credentials?.token
          if (!token) throw Object.assign(new Error('apiToken es obligatorio para Postiz.'), { status: 400 })
          const integrationId = body.integrationId || body.externalAccountId || body.config?.integrationId || body.config?.integration_id
          if (!integrationId) throw Object.assign(new Error('integrationId es obligatorio para Postiz.'), { status: 400 })
          const apiBaseUrl = body.apiBaseUrl || body.config?.apiBaseUrl || body.config?.api_base_url || ''
          const providerType = body.providerType || body.config?.providerType || body.config?.provider_type || postizProviderForChannel(channel)
          const encrypted = encryptSecret(token)
          legacy = await upsertBrandConnection({
            workspaceId: scope.workspaceId,
            siteId: scope.siteId,
            userId: scope.auth.userId,
            role: scope.context.role,
            channel,
            provider,
            externalAccountId: integrationId,
            credentialsCiphertext: encrypted,
            config: { ...(body.config || {}), apiBaseUrl, integrationId, providerType, timezone: body.timezone || body.config?.timezone || 'UTC' },
            capabilities: body.capabilities || { drafts: true, scheduling: true, media: true, integrations: true },
            status: body.status || 'connected'
          })
        } else if (provider === 'buffer') {
          const token = body.apiToken || body.token || body.userToken || body.credentials?.apiToken || body.credentials?.token
          if (!token) throw Object.assign(new Error('apiToken es obligatorio para Buffer.'), { status: 400 })
          const organizationId = body.organizationId || body.config?.organizationId || body.config?.organization_id
          const channelId = body.channelId || body.externalAccountId || body.config?.channelId || body.config?.channel_id
          if (!organizationId) throw Object.assign(new Error('organizationId es obligatorio para Buffer.'), { status: 400 })
          const sourceChannelIds = body.channelIds || body.config?.channelIds || body.config?.channel_ids || {}
          const channelIds = sourceChannelIds && typeof sourceChannelIds === 'object' && !Array.isArray(sourceChannelIds)
            ? Object.fromEntries(Object.entries(sourceChannelIds).map(([key, value]) => [String(key).toLowerCase(), String(value || '').trim()]).filter(([key, value]) => ['instagram', 'instagram_story', 'linkedin', 'x', 'video'].includes(key) && value))
            : {}
          if (channelId && !Object.keys(channelIds).length) channelIds[channel] = String(channelId).trim()
          if (!Object.keys(channelIds).length) throw Object.assign(new Error('Selecciona al menos un canal de Buffer.'), { status: 400 })
          const encrypted = encryptSecret(token)
          legacy = await upsertBrandConnection({
            workspaceId: scope.workspaceId,
            siteId: scope.siteId,
            userId: scope.auth.userId,
            role: scope.context.role,
            channel: channel === 'buffer' ? 'buffer' : channel,
            provider,
            externalAccountId: channel === 'buffer' ? organizationId : channelId,
            credentialsCiphertext: encrypted,
            config: { ...(body.config || {}), organizationId, ...(channel === 'buffer' ? { channelIds } : { channelId }), timezone: body.timezone || body.config?.timezone || 'UTC' },
            capabilities: body.capabilities || { drafts: true, scheduling: true, media: true, channels: true },
            status: body.status || 'connected'
          })
        } else {
          const token = body.token || body.userToken || body.credentials?.token
          const encrypted = token ? encryptSecret(token) : null
          legacy = await upsertBrandConnection({ workspaceId: scope.workspaceId, siteId: scope.siteId, userId: scope.auth.userId, role: scope.context.role, channel, provider, externalAccountId: body.externalAccountId, credentialsCiphertext: encrypted, config: body.config || { domain: body.domain, rebuildWebhookUrl: body.rebuildWebhookUrl }, capabilities: body.capabilities, status: body.status || 'connected' })
        }
        json(res, 200, { connection: legacy })
        return
      }
      if (req.method === 'POST' && connectionActionMatch) {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        const connectionId = decodeURIComponent(connectionActionMatch[1])
        const action = connectionActionMatch[2]
        const { row, credentials } = await connectionCredentialsFor(scope, connectionId)
        if (action === 'disconnect') {
          json(res, 200, { connection: await disconnectBrandConnection({ workspaceId: scope.workspaceId, siteId: scope.siteId, connectionId, userId: scope.auth.userId, role: scope.context.role }) })
          return
        }
        let result
        if (row.provider === 'metricool') {
          if (!credentials.userToken) throw Object.assign(new Error('No se puede descifrar la credencial.'), { status: 503, code: 'credential_unavailable' })
          result = await testMetricoolConnection(credentials)
        } else if (row.provider === 'planable') {
          if (!credentials.apiToken) throw Object.assign(new Error('No se puede descifrar la credencial.'), { status: 503, code: 'credential_unavailable' })
          result = await testPlanableConnection(credentials)
        } else if (row.provider === 'postiz') {
          if (!credentials.apiToken) throw Object.assign(new Error('No se puede descifrar la credencial.'), { status: 503, code: 'credential_unavailable' })
          result = await testPostizConnection(credentials)
        } else if (row.provider === 'buffer') {
          if (!credentials.apiToken) throw Object.assign(new Error('No se puede descifrar la credencial.'), { status: 503, code: 'credential_unavailable' })
          const channelIds = row.config?.channelIds || row.config?.channel_ids || {}
          result = await testBufferConnection({ ...credentials, organizationId: credentials.organizationId || row.config?.organizationId, channelId: credentials.channelId || row.config?.channelId || channelIds.instagram || Object.values(channelIds)[0] })
        } else result = { ok: true, provider: row.provider, message: 'Conexión configurada correctamente.' }
        const pool = await getPgPool()
        if (result.ok) await pool.query('UPDATE channel_connections SET status=\'connected\',last_tested_at=NOW(),last_error=NULL,updated_at=NOW() WHERE id=$1 AND workspace_id=$2 AND site_id=$3', [connectionId, scope.workspaceId, scope.siteId])
        else {
          await pool.query('UPDATE channel_connections SET status=\'error\',last_tested_at=NOW(),last_error=$1,updated_at=NOW() WHERE id=$2 AND workspace_id=$3 AND site_id=$4', [result.code || 'connection_test_failed', connectionId, scope.workspaceId, scope.siteId])
          json(res, result.status || 502, result)
          return
        }
        json(res, 200, result)
        return
      }
      if (req.method === 'GET' && path === '/api/v2/brand-kits') {
        const scope = await requireV2Context(req, url, res)
        if (!scope) return
        const activeBrandKit = await getActiveBrandKit({ workspaceId: scope.workspaceId, siteId: scope.siteId })
        const brandContext = getBrandContext(scope.context.siteHandle || scope.siteId, {
          auth: scope.auth,
          canonicalManifest: activeBrandKit?.manifest,
          canonicalAssets: activeBrandKit?.assets,
          brandKitVersionId: activeBrandKit?.id,
          brandKitVersion: activeBrandKit ? { version: activeBrandKit.version } : undefined
        })
        json(res, 200, sanitizeV2BrandKit(activeBrandKit, scope.auth, { canonicalReferences: brandContext.referenceImages }))
        return
      }
      if (req.method === 'PATCH' && brandAssetMatch) {
        const scope = await requireV2Context(req, url, res, { ...body, siteId: decodeURIComponent(brandAssetMatch[1]) })
        if (!scope) return
        json(res, 200, { asset: await updateBrandAsset({ workspaceId: scope.workspaceId, siteId: scope.siteId, userId: scope.auth.userId, role: scope.context.role, assetId: decodeURIComponent(brandAssetMatch[2]), alt: body.alt, usage: body.usage, characterId: body.characterId }) })
        return
      }
      if (req.method === 'DELETE' && brandAssetMatch) {
        const scope = await requireV2Context(req, url, res, { ...body, siteId: decodeURIComponent(brandAssetMatch[1]) })
        if (!scope) return
        json(res, 200, await removeBrandAsset({ workspaceId: scope.workspaceId, siteId: scope.siteId, userId: scope.auth.userId, role: scope.context.role, assetId: decodeURIComponent(brandAssetMatch[2]) }))
        return
      }
      if (req.method === 'POST' && brandKitImportMatch) {
        const scope = await requireV2Context(req, url, res, { ...body, siteId: decodeURIComponent(brandKitImportMatch[1]) })
        if (!scope) return
        assertWorkspaceRole(scope.context.role, ['owner', 'admin'])
        if (!body.contentBase64 && !body.zipUrl && !body.buffer) {
          throw Object.assign(new Error('Falta el ZIP del brand kit.'), { status: 400 })
        }
        const siteHandle = scope.context.siteHandle || scope.siteId
        const imported = await importBrandKitZip(siteHandle, {
          contentBase64: body.contentBase64,
          zipUrl: body.zipUrl,
          buffer: body.buffer
        })
        const draft = await createBrandKitVersion({
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
          userId: scope.auth.userId,
          role: scope.context.role,
          manifest: imported.brand?.files || {},
          status: 'draft'
        })
        const origin = absoluteCmsOrigin(req)
        const assets = (imported.importedImages || []).map((name) => ({
          name,
          storageKey: `media/${siteHandle}/reference/${name}`,
          publicUrl: `${origin}/media/${siteHandle}/reference/${encodeURIComponent(name)}`,
          metadata: { source: 'brand-kit' },
          visibility: 'role_limited'
        }))
        await registerBrandAssets({
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
          brandKitVersionId: draft.id,
          userId: scope.auth.userId,
          role: scope.context.role,
          assets
        })
        const version = await publishBrandKitVersion({
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
          userId: scope.auth.userId,
          role: scope.context.role,
          versionId: draft.id,
          expectedActiveVersionId: draft.baseVersionId || null
        })
        json(res, 200, { ...imported, canonicalBrandKitVersionId: version.id, canonicalAssets: assets.length })
        return
      }
      if (req.method === 'POST' && brandKitLegacyCleanupMatch) {
        const scope = await requireV2Context(req, url, res, { ...body, siteId: decodeURIComponent(brandKitLegacyCleanupMatch[1]) })
        if (!scope) return
        assertWorkspaceRole(scope.context.role, ['owner', 'admin'])
        const cleaned = await cleanupBrandKitAssets({ workspaceId: scope.workspaceId, siteId: scope.siteId })
        const siteHandles = new Set([cleaned.site, scope.context.siteHandle, scope.siteId].filter(Boolean))
        const dbNow = readDb()
        const before = Array.isArray(dbNow.media) ? dbNow.media : []
        const removed = before.filter((media) => siteHandles.has(media?.site) && media?.kind === 'reference' && !isApprovedBrandAsset(cleaned.site, media.filename || media.path || media.url))
        if (removed.length) {
          const removedMedia = new Set(removed)
          dbNow.media = before.filter((media) => !removedMedia.has(media))
          // Keep the files on disk: post content and canonical v2 assets may
          // still point to the same storage key.
          writeDb(dbNow)
        }
        json(res, 200, { ...cleaned, removed: removed.length, filesPreserved: true })
        return
      }
      if (req.method === 'GET' && path === '/api/v2/context') {
        const scope = await requireV2Context(req, url, res)
        if (!scope) return
        let allBrands = await listBrands({ workspaceId: scope.workspaceId })
        const membershipContext = scope.auth.role === 'admin'
          ? scope.context
          : await resolveWorkspaceContext({ userId: scope.auth.userId, workspaceId: scope.workspaceId })
        const allowedBrandIds = new Set(membershipContext.siteIds || [])
        let brands = scope.auth.role === 'admin' ? allBrands : allBrands.filter((brand) => allowedBrandIds.has(brand.id))
        const selectedSiteId = scope.siteId || brands[0]?.id || null
        if (selectedSiteId) {
          const selectedBrand = brands.find((brand) => brand.id === selectedSiteId)
          try {
            const legacyConfig = selectedBrand ? loadSiteConfig(selectedBrand.handle) : null
            await initializeBrandConfiguration({ workspaceId: scope.workspaceId, siteId: selectedSiteId, legacy: legacyConfig ? {
              contentMode: legacyConfig.contentMode,
              blogEnabled: legacyConfig.blogEnabled,
              socialPackChannels: legacyConfig.socialPackChannels,
              domain: legacyConfig.domain,
              rebuildWebhookUrl: legacyConfig.rebuildWebhookUrl,
              coolifyApiTokenCiphertext: legacyConfig.coolifyApiToken ? encryptSecret(legacyConfig.coolifyApiToken) : null
            } : {} })
          } catch (error) {
            console.warn('[brand] initial configuration skipped:', error.message)
          }
        }
        // Initialization can seed channels/capabilities on first access; use
        // the refreshed summaries so activeBrand and the brand cards are
        // immediately consistent in the same response.
        allBrands = await listBrands({ workspaceId: scope.workspaceId })
        brands = scope.auth.role === 'admin' ? allBrands : allBrands.filter((brand) => allowedBrandIds.has(brand.id))
        const [flags, channels, integrations, usage] = await Promise.all([
          getWorkspaceFeatureFlags({ workspaceId: scope.workspaceId, siteId: selectedSiteId }),
          selectedSiteId ? listSiteChannels({ workspaceId: scope.workspaceId, siteId: selectedSiteId }) : [],
          selectedSiteId ? listBrandConnections({ workspaceId: scope.workspaceId, siteId: selectedSiteId }) : [],
          usageSnapshot({ workspaceId: scope.workspaceId })
        ])
        const brandCapabilities = selectedSiteId ? await listBrandCapabilities({ workspaceId: scope.workspaceId, siteId: selectedSiteId }) : {}
        if (creationUiGlobalKillSwitch()) {
          flags.creation_ui_enabled = false
          flags.manual_creation_enabled = false
        }
        const brandRoles = Object.fromEntries((membershipContext.sites || []).map((brand) => [brand.id, brand.role || membershipContext.workspaceRole || membershipContext.role]))
        const brandsWithRoles = brands.map((brand) => ({ ...brand, role: brandRoles[brand.id] || (scope.auth.role === 'admin' ? 'admin' : scope.context.role) }))
        json(res, 200, {
          workspace: { id: scope.workspaceId, name: scope.context.workspaceName || 'Espacio' },
          activeBrand: brandsWithRoles.find((brand) => brand.id === selectedSiteId) || brandsWithRoles[0] || null,
          brands: brandsWithRoles,
          role: scope.context.role,
          capabilities: scope.auth.capabilities || [],
          featureFlags: flags,
          brandCapabilities,
          channels,
          connections: integrations,
          usage
        })
        return
      }
      if (req.method === 'PATCH' && path === '/api/v2/feature-flags') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        const siteId = body.scope === 'workspace' ? null : body.siteId || scope.siteId || null
        json(res, 200, { flags: await setWorkspaceFeatureFlags({ workspaceId: scope.workspaceId, siteId, userId: scope.auth.userId, role: scope.context.role, flags: body.flags || body }) })
        return
      }
      if (req.method === 'POST' && path === '/api/v2/brand-kits/versions') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        json(res, 201, sanitizeV2BrandKit(await createBrandKitVersion({ workspaceId: scope.workspaceId, siteId: scope.siteId, userId: scope.auth.userId, role: scope.context.role, manifest: body.manifest, status: body.status }), scope.auth))
        return
      }
      if (req.method === 'POST' && path === '/api/v2/content/batches') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        if (String(req.headers['x-escarlet-client'] || '').toLowerCase() === 'pwa') {
          const flags = await getWorkspaceFeatureFlags({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined })
          if (creationUiGlobalKillSwitch() || !flags.creation_ui_enabled) throw Object.assign(new Error('La creación desde la aplicación está desactivada.'), { status: 403, code: 'creation_ui_disabled' })
        }
        const siteId = scope.siteId || scope.context.siteIds[0]
        if (!siteId) throw Object.assign(new Error('siteId es obligatorio.'), { status: 400 })
        const result = await createContentBatch({ workspaceId: scope.workspaceId, siteId, userId: scope.auth.userId || null, role: scope.context.role, title: body.title, topics: v2Topics(body), items: body.items, batchId: body.batchId, channels: body.channels, brandKitVersionId: body.brandKitVersionId, metadata: body.metadata, idempotencyKey: req.headers['idempotency-key'], quotaExempt: Boolean(scope.auth.systemAdmin) })
        json(res, 201, result)
        return
      }
      if (req.method === 'GET' && path === '/api/v2/content/plans') {
        const scope = await requireV2Context(req, url, res)
        if (!scope) return
        json(res, 200, { plans: await listContentPlans({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, status: url.searchParams.get('status') || undefined, channel: url.searchParams.get('channel') || undefined, query: url.searchParams.get('query') || undefined, limit: url.searchParams.get('limit') }) })
        return
      }
      if (req.method === 'GET' && path === '/api/v2/content/review') {
        const scope = await requireV2Context(req, url, res)
        if (!scope) return
        json(res, 200, { items: await listContentItems({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, status: url.searchParams.get('status') || undefined, channel: url.searchParams.get('channel') || undefined, query: url.searchParams.get('query') || undefined, archive: url.searchParams.get('archive') || 'active', limit: url.searchParams.get('limit') || 200 }) })
        return
      }
      if (req.method === 'GET' && path === '/api/v2/calendar') {
        const scope = await requireV2Context(req, url, res)
        if (!scope) return
        json(res, 200, { entries: await listScheduledContent({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, from: url.searchParams.get('from') || undefined, to: url.searchParams.get('to') || undefined, limit: url.searchParams.get('limit') || 300 }) })
        return
      }
      if (req.method === 'GET' && path === '/api/v2/team') {
        const scope = await requireV2Context(req, url, res)
        if (!scope) return
        const members = await listWorkspaceMembers({ workspaceId: scope.workspaceId })
        // Workspace membership is canonical in Postgres while profile details
        // still live in the password-auth store. Hydrate only public profile
        // fields so the v2 team view can show the name instead of the opaque
        // user id (and never leak password material).
        const hydratedMembers = members.map((member) => {
          let profile = null
          try { profile = getPasswordUserById(member.userId) } catch { /* auth store may be disabled during migration */ }
          const displayName = String(profile?.displayName || '').trim()
          const email = String(profile?.email || '').trim()
          return {
            ...member,
            workspaceRole: member.role,
            role: visibleMemberRole(member, { siteId: scope.siteId, siteHandle: scope.context.siteHandle }),
            email,
            displayName,
            name: displayName || email || (member.userId === 'system' ? 'Escarlet' : member.userId),
            reviewRequired: member.reviewRequired !== false,
            bio: String(profile?.bio || ''),
            avatarUrl: String(profile?.avatarDataUrl || profile?.avatarUrl || ''),
            profileComplete: Boolean(profile?.profileCompletedAt),
            allowPublishingAs: Boolean(profile?.allowPublishingAs),
            mustSetPassword: Boolean(profile?.mustSetPassword),
            hasLoginToken: Boolean(profile?.loginToken),
            loginTokenHint: String(profile?.loginTokenHint || '')
          }
        })
        const viewerWorkspaceRole = String(scope.context.workspaceRole || scope.context.role || '').toLowerCase()
        const canViewSuperAdmin = viewerWorkspaceRole === 'owner' || scope.auth?.role === 'admin'
        const visibleMembers = canViewSuperAdmin
          ? hydratedMembers
          : hydratedMembers.filter((member) => String(member.role || '').toLowerCase() !== 'owner')
        json(res, 200, { members: visibleMembers, canManage: ['owner', 'admin'].includes(scope.context.workspaceRole || scope.context.role) })
        return
      }
      const teamMemberMatch = path.match(/^\/api\/v2\/team\/members\/([^/]+)$/)
      if (req.method === 'PATCH' && teamMemberMatch) {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        if (!['owner', 'admin'].includes(scope.context.workspaceRole || scope.context.role)) throw Object.assign(new Error('No tienes permisos para editar miembros.'), { status: 403 })
        const userId = decodeURIComponent(teamMemberMatch[1])
        const catalog = scope.auth.role === 'admin' ? await listBrands({ workspaceId: scope.workspaceId }) : scope.context.sites
        const requestedSites = Array.isArray(body.brandIds) ? body.brandIds : undefined
        const siteIds = requestedSites
          ? [...new Set(requestedSites.map((value) => catalog.find((brand) => brand.id === value || brand.handle === value)?.id).filter(Boolean))]
          : undefined
        if (requestedSites && !siteIds.length) throw Object.assign(new Error('No puedes asignar esas marcas.'), { status: 403 })
        const brandRoles = body.brandRoles && typeof body.brandRoles === 'object'
          ? Object.fromEntries((catalog || []).flatMap((brand) => body.brandRoles[brand.id] || body.brandRoles[brand.handle] ? [[brand.id, body.brandRoles[brand.id] || body.brandRoles[brand.handle]]] : []))
          : {}
        const member = await updateWorkspaceMember({ workspaceId: scope.workspaceId, userId, role: String(body.role || 'viewer'), siteIds, brandRoles, reviewRequired: body.reviewRequired === undefined ? undefined : body.reviewRequired === true })
        json(res, 200, { member })
        return
      }
      if (req.method === 'POST' && path === '/api/v2/team/invitations') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        if (!['owner', 'admin'].includes(scope.context.workspaceRole || scope.context.role)) throw Object.assign(new Error('No tienes permisos para invitar miembros.'), { status: 403 })
        const email = String(body.email || '').trim().toLowerCase()
        if (!email || !email.includes('@')) throw Object.assign(new Error('email es obligatorio.'), { status: 400 })
        const role = String(body.role || 'viewer').trim().toLowerCase()
        const requestedBrandIds = Array.isArray(body.brandIds) ? body.brandIds : scope.siteId ? [scope.siteId] : scope.context.siteIds
        const allowedBrandIds = new Set(scope.context.siteIds || [])
        const brandIds = requestedBrandIds.map((value) => scope.context.sites.find((brand) => (brand.id === value || brand.handle === value) && (scope.auth.role === 'admin' || allowedBrandIds.has(brand.id)))?.id).filter(Boolean)
        if (!brandIds.length) throw Object.assign(new Error('Selecciona al menos una marca.'), { status: 400 })
        const brandRolesById = body.brandRoles && typeof body.brandRoles === 'object'
          ? Object.fromEntries((scope.context.sites || []).flatMap((brand) => body.brandRoles[brand.id] || body.brandRoles[brand.handle] ? [[brand.id, body.brandRoles[brand.id] || body.brandRoles[brand.handle]]] : []))
          : {}
        const user = registerPasswordUser({ email, role, sites: brandIds.map((idValue) => scope.context.sites.find((brand) => brand.id === idValue)?.handle).filter(Boolean), invite: true })
        await syncLegacyUsersToPostgres()
        await addWorkspaceMember({ workspaceId: scope.workspaceId, userId: user.id, role, siteIds: brandIds, brandRoles: brandRolesById })
        const minted = createMagicToken({ site: user.site, sites: user.sites, role, email: user.email, userId: user.id, purpose: 'invite', next: '/' })
        const origin = absoluteCmsOrigin(req)
        const link = `${origin}/app/magic/consume?token=${encodeURIComponent(minted.token)}`
        const delivery = await sendMagicLinkEmail({ to: email, link, site: user.site, subject: 'Activa tu acceso al CMS Escarlet', text: `Hola.\n\nActiva tu acceso con este enlace (caduca en 15 minutos):\n\n${link}\n` })
        json(res, 201, { member: user, invite: { transport: delivery.transport, link: delivery.transport === 'console' ? link : undefined } })
        return
      }
      if (req.method === 'GET' && batchMatch) {
        const scope = await requireV2Context(req, url, res, { siteId: url.searchParams.get('siteId') || undefined })
        if (!scope) return
        json(res, 200, await getContentBatch({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, batchId: decodeURIComponent(batchMatch[1]) }))
        return
      }
      if (req.method === 'GET' && path === '/api/v2/content/items') {
        const scope = await requireV2Context(req, url, res)
        if (!scope) return
        json(res, 200, { items: await listContentItems({ workspaceId: scope.workspaceId, batchId: url.searchParams.get('batchId'), siteId: scope.siteId || undefined, status: url.searchParams.get('status') || undefined, channel: url.searchParams.get('channel') || undefined, query: url.searchParams.get('query') || undefined, limit: url.searchParams.get('limit') }) })
        return
      }
      if (req.method === 'GET' && itemMatch) {
        const scope = await requireV2Context(req, url, res)
        if (!scope) return
        const item = await getContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, itemId: decodeURIComponent(itemMatch[1]) })
        json(res, 200, { item })
        return
      }
      if (req.method === 'POST' && videoUploadMatch) {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        assertWorkspaceRole(scope.context.role, ['owner', 'admin', 'editor', 'author'])
        const itemId = decodeURIComponent(videoUploadMatch[1])
        const siteHandle = scope.context.siteHandle || scope.siteId
        const format = body.format === 'landscape' ? 'landscape' : 'portrait'
        const video = await saveUploadedVideoMedia({
          site: siteHandle,
          filename: body.filename,
          buffer: body.buffer,
          mimeType: body.mimeType || 'video/webm',
          format,
          skipLegacyDb: true
        })
        const asset = await registerContentMedia({
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
          userId: scope.auth.userId,
          role: scope.context.role,
          media: video
        })
        const attachment = await attachContentMedia({
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
          itemId,
          userId: scope.auth.userId,
          role: scope.context.role,
          mediaAssetId: asset.id,
          channels: ['video'],
          assetIndex: format === 'landscape' ? 1 : 0,
          createMissingVariants: ['video'],
          removeReplacedAssets: true
        })
        for (const previous of attachment.removedMedia || []) {
          try {
            await cmsDeleteMedia(siteHandle, previous.id, previous.publicUrl || `/${previous.storageKey}`, { membershipUserId: scope.auth.userId || '' })
          } catch (error) {
            console.warn('[video] no se pudo borrar el archivo reemplazado', previous.id, error.message)
          }
        }
        const videoJob = await ensureVideoJobForContentItem({
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
          siteHandle,
          userId: scope.auth.userId,
          role: scope.context.role,
          contentItemId: itemId,
          sourceMediaId: asset.id,
          format: format === 'landscape' ? 'landscape' : 'reel'
        })
        json(res, 201, {
          itemId,
          format,
          media: { ...asset, url: asset.publicUrl || video.url, path: asset.storageKey || video.path },
          replacedPrevious: Boolean(attachment.removedMedia?.length),
          videoJobId: videoJob.job?.id || null
        })
        return
      }
      if (path === '/api/v2/video/jobs' && req.method === 'GET') {
        const scope = await requireV2Context(req, url, res)
        if (!scope) return
        const jobs = await listVideoJobs({
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
          status: url.searchParams.get('status') || undefined,
          limit: url.searchParams.get('limit') || undefined
        })
        const contentItemId = url.searchParams.get('contentItemId')
        json(res, 200, {
          jobs: contentItemId ? jobs.filter((job) => job.contentItemId === contentItemId) : jobs
        })
        return
      }
      if (path === '/api/v2/video/jobs' && req.method === 'POST') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        assertWorkspaceRole(scope.context.role, ['owner', 'admin', 'editor', 'author'])
        const siteHandle = scope.context.siteHandle || scope.siteId
        const result = await createVideoJob({
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
          siteHandle,
          userId: scope.auth.userId,
          role: scope.context.role,
          contentItemId: body.contentItemId,
          sourceMediaId: body.sourceMediaId,
          provider: body.provider,
          speaker: body.speaker,
          channel: body.channel,
          format: body.format,
          objective: body.objective,
          topic: body.topic,
          metadata: body.metadata,
          idempotencyKey: body.idempotencyKey,
          createContentIfMissing: body.createContentIfMissing === true
        })
        json(res, 201, result)
        return
      }
      if (videoJobMatch && req.method === 'GET') {
        const scope = await requireV2Context(req, url, res)
        if (!scope) return
        const job = await getVideoJob({
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
          siteHandle: scope.context.siteHandle,
          videoJobId: decodeURIComponent(videoJobMatch[1])
        })
        json(res, 200, { job })
        return
      }
      if (videoJobMatch && req.method === 'PATCH') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        assertWorkspaceRole(scope.context.role, ['owner', 'admin', 'editor', 'author'])
        const result = await updateVideoJob({
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
          videoJobId: decodeURIComponent(videoJobMatch[1]),
          userId: scope.auth.userId,
          role: scope.context.role,
          status: body.status,
          provider: body.provider,
          providerProjectId: body.providerProjectId,
          providerCompositionId: body.providerCompositionId,
          speaker: body.speaker,
          channel: body.channel,
          format: body.format,
          objective: body.objective,
          topic: body.topic,
          metadata: body.metadata,
          caption: body.caption,
          readyForReview: body.readyForReview === true,
          skipEdit: body.skipEdit === true
        })
        json(res, 200, result)
        return
      }
      if (req.method === 'PATCH' && itemMatch) {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        const reviewFlags = await getWorkspaceFeatureFlags({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined })
        const reviewRequired = !scope.auth.systemAdmin && reviewFlags.content_review_enabled !== false && scope.context.reviewRequired !== false
        const result = await updateContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, itemId: decodeURIComponent(itemMatch[1]), userId: scope.auth.userId, role: scope.context.role, topic: body.topic, contentTitle: body.contentTitle, body: body.body, channel: body.channel, visualBrief: body.visualBrief, mediaAssetIds: body.mediaAssetIds, readyForReview: body.readyForReview, reviewChannels: body.reviewChannels, keepPublished: body.keepPublished, quotaExempt: Boolean(scope.auth.systemAdmin), reviewRequired })
        json(res, 200, result)
        return
      }
      if (req.method === 'POST' && itemActionMatch) {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        const itemId = decodeURIComponent(itemActionMatch[1])
        const action = itemActionMatch[2]
        if (['schedule', 'reschedule', 'publish-buffer'].includes(action)) assertV2Approver(scope)
        if (action === 'approve') {
          assertV2Approver(scope)
          json(res, 200, await approveContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, itemId, userId: scope.auth.userId, role: scope.context.role, quotaExempt: Boolean(scope.auth.systemAdmin) }))
          return
        }
        if (action === 'reject') {
          assertV2Approver(scope)
          json(res, 200, await rejectContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, itemId, userId: scope.auth.userId, role: scope.context.role, comment: body.comment || body.reason }))
          return
        }
        if (action === 'cancel') {
          json(res, 200, await cancelContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, itemId, userId: scope.auth.userId, role: scope.context.role }))
          return
        }
        if (action === 'cancel-channel') {
          json(res, 200, await cancelContentChannel({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, itemId, userId: scope.auth.userId, role: scope.context.role, channel: body.channel }))
          return
        }
        if (action === 'archive' || action === 'restore-archive') {
          json(res, 200, await archiveContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, itemId, userId: scope.auth.userId, role: scope.context.role, archived: action === 'archive' }))
          return
        }
        if (action === 'reschedule') {
          json(res, 200, await rescheduleContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, itemId, userId: scope.auth.userId, role: scope.context.role, channels: body.channels, publicationDate: body.publicationDate, timezone: body.timezone, publishNow: body.publishNow === true, quotaExempt: Boolean(scope.auth.systemAdmin) }))
          return
        }
        if (action === 'mark-published') {
          json(res, 200, await markContentChannelPublished({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, itemId, userId: scope.auth.userId, role: scope.context.role, channel: body.channel }))
          return
        }
        if (action === 'reconcile-scheduled') {
          json(res, 200, await reconcileContentItemScheduled({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, itemId, userId: scope.auth.userId, role: scope.context.role, channels: body.channels, publicationDate: body.publicationDate, timezone: body.timezone }))
          return
        }
        if (action === 'clear-published-errors') {
          json(res, 200, await clearPublishedContentErrors({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, itemId, userId: scope.auth.userId, role: scope.context.role, channels: body.channels }))
          return
        }
        if (action === 'reopen-unsent-channel') {
          json(res, 200, await reopenUnsentPublishedChannel({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, itemId, userId: scope.auth.userId, role: scope.context.role, channel: body.channel }))
          return
        }
        if (action === 'publish-buffer') {
          json(res, 202, await publishContentItemViaBuffer({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, itemId, userId: scope.auth.userId, role: scope.context.role, channels: body.channels, copy: body.copy, quotaExempt: Boolean(scope.auth.systemAdmin) }))
          return
        }
        json(res, 200, await scheduleContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, itemId, userId: scope.auth.userId, role: scope.context.role, channels: body.channels, publicationDate: body.publicationDate, timezone: body.timezone, publishNow: body.publishNow === true, quotaExempt: Boolean(scope.auth.systemAdmin) }))
        return
      }
      if (req.method === 'POST' && batchActionMatch) {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        assertV2Approver(scope)
        const batchId = decodeURIComponent(batchActionMatch[1])
        json(res, 200, batchActionMatch[2] === 'cancel'
          ? await cancelContentBatch({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, batchId, userId: scope.auth.userId, role: scope.context.role })
          : await scheduleContentBatch({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, batchId, userId: scope.auth.userId, role: scope.context.role, channels: body.channels, publicationDate: body.publicationDate, timezone: body.timezone, quotaExempt: Boolean(scope.auth.systemAdmin) }))
        return
      }
      if (req.method === 'POST' && batchReviewMatch && batchReviewMatch[2] === 'approve') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        assertV2Approver(scope)
        json(res, 200, await approveContentBatch({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, batchId: decodeURIComponent(batchReviewMatch[1]), userId: scope.auth.userId, role: scope.context.role, quotaExempt: Boolean(scope.auth.systemAdmin) }))
        return
      }
      if (req.method === 'POST' && batchReviewMatch && batchReviewMatch[2] === 'reject') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        assertV2Approver(scope)
        json(res, 200, await rejectContentBatch({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined, batchId: decodeURIComponent(batchReviewMatch[1]), userId: scope.auth.userId, role: scope.context.role, comment: body.comment || body.reason }))
        return
      }
      if (req.method === 'GET' && path === '/api/v2/usage') {
        const scope = await requireV2Context(req, url, res)
        if (!scope) return
        json(res, 200, await usageSnapshot({ workspaceId: scope.workspaceId, period: url.searchParams.get('period') || undefined }))
        return
      }
      if (req.method === 'POST' && path === '/api/v2/integrations/metricool/connect') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        const siteId = scope.siteId || body.siteId || null
        const encrypted = encryptSecret(body.userToken)
        const result = await connectMetricool({ workspaceId: scope.workspaceId, siteId, userId: scope.auth.userId, role: scope.context.role, userTokenCiphertext: encrypted, metricoolUserId: body.userId || body.metricoolUserId, blogId: body.blogId, timezone: body.timezone, capabilities: body.capabilities, channel: body.channel })
        json(res, 200, result)
        return
      }
      if (req.method === 'GET' && path === '/api/v2/integrations/metricool') {
        const scope = await requireV2Context(req, url, res)
        if (!scope) return
        json(res, 200, { connections: await listMetricoolIntegrations({ workspaceId: scope.workspaceId, siteId: scope.siteId || undefined }) })
        return
      }
      if (req.method === 'POST' && path === '/api/v2/integrations/metricool/test') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        const { credentials } = await metricoolCredentialsFor(scope)
        json(res, 200, await testMetricoolConnection(credentials))
        return
      }
      if (req.method === 'POST' && path === '/api/v2/integrations/metricool/sync') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        const { credentials } = await metricoolCredentialsFor(scope)
        if (body.providerPostId) json(res, 200, await syncMetricoolPost({ ...credentials, providerPostId: body.providerPostId }))
        else json(res, 202, await enqueueJob({ workspaceId: scope.workspaceId, type: 'metricool.sync', payload: { siteId: scope.siteId, quotaExempt: Boolean(scope.auth.systemAdmin) }, idempotencyKey: `metricool:sync:${scope.workspaceId}:${scope.siteId || 'workspace'}:${new Date().toISOString().slice(0, 13)}` }))
        return
      }
      if (req.method === 'POST' && path === '/api/v2/content/sync-remote-status') {
        const scope = await requireV2Context(req, url, res, body)
        if (!scope) return
        json(res, 202, await enqueueRemotePublicationStatusSync({ workspaceId: scope.workspaceId, siteId: scope.siteId || null, quotaExempt: Boolean(scope.auth.systemAdmin), force: true }))
        return
      }
      json(res, 404, { message: 'Contrato v2 no encontrado.' })
    } catch (error) {
      json(res, error.status || 400, {
        message: error.message,
        code: error.code,
        ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
        ...(Array.isArray(error.rateLimits) ? { rateLimits: error.rateLimits } : {})
      })
    }
    return
  }

  if (req.method === 'GET' && (path === '/api/health' || path === '/api/health/live' || path === '/api/health/ready')) {
    if (path === '/api/health/live') {
      json(res, 200, {
        ok: true,
        live: true,
        ready: null,
        requestId: res._requestId,
        version: MCP_SERVER_VERSION
      })
      return
    }
    const persistence = getPersistenceStatus()
    const migrationsReady = !isPostgresConfigured() || await coreMigrationPromise
    const live = true
    const ready = persistence.writable && migrationsReady
    const auth0 = getAuth0Config()
    json(res, ready ? 200 : 503, {
      ok: ready,
      live,
      ready,
      migrationsReady,
      requestId: res._requestId,
      version: MCP_SERVER_VERSION,
      mcpServerName: 'escarlet-os',
      mcp: '/mcp/v3',
      mcpContract: 'os.production.v1',
      deploymentTrack: 'v3',
      canonicalMcpUrl: `${CANONICAL_CMS_URL}/mcp/v3`,
      deprecatedMcpHosts: [...DEPRECATED_CMS_HOSTS],
      mcpUpload: 'brand.generation.prepare',
      auth0: { configured: auth0.configured, enabled: auth0.enabled, issuer: auth0.enabled ? auth0.issuer : null, audience: auth0.enabled ? auth0.audience : null, error: auth0.error },
      postgres: { configured: isPostgresConfigured(), migrationsStarted: isPostgresConfigured(), migrationError: coreMigrationError?.message || null },
      persistence
    })
    return
  }

  const inboxMatch = path.match(/^\/api\/media-inbox\/([a-f0-9]+)$/i)
  if (inboxMatch) {
    applyCors(res, req)
    res.setHeader('Access-Control-Allow-Methods', 'PUT, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      try {
        const buf = await readRawBuffer(req)
        let buffer = buf
        if (isMultipartRequest(req)) {
          const parsed = parseMultipart(buf, req.headers['content-type'])
          buffer = parsed.file?.buffer || buf
        }
        const result = await receiveImageDrop(inboxMatch[1], buffer)
        json(res, 200, result)
      } catch (err) {
        json(res, err.status || 400, { message: err.message, ...(err.extra || {}) })
      }
      return
    }
    json(res, 405, { message: 'Usa PUT con el PNG en el cuerpo' })
    return
  }

  if (req.method === 'GET' && path === '/api/sites') {
    const db = readDb()
    const handles = listSiteHandles()
    const configured = handles
      .map((handle) => publicSiteDirectoryEntry(loadSiteConfig(handle)))
      .filter(Boolean)
    const sites = (db.sites || [])
      .map((site) => {
        const handle = site.handle || site.id
        const config = loadSiteConfig(handle)
        return publicSiteDirectoryEntry({ ...(site || {}), ...(config || {}), handle })
      })
      .filter(Boolean)
    json(res, 200, { sites, configured })
    return
  }

  const siteMatch = path.match(/^\/api\/sites\/([^/]+)\/posts(?:\/([^/]+))?$/)
  if (siteMatch && req.method === 'GET') {
    const site = siteMatch[1]
    const slug = siteMatch[2]
    const db = readDb()
    const siteConfig = loadSiteConfig(site)
    const socialPackChannels = siteConfig ? getSocialPackChannels(siteConfig) : undefined
    const blogEnabled = isPublicBlogEnabled(siteConfig)
    if (!blogEnabled) {
      if (slug) {
        json(res, 404, { message: 'No encontrado', blogEnabled: false })
        return
      }
      json(res, 200, { site, posts: [], socialPackChannels, blogEnabled: false })
      return
    }
    const v2Published = await readV2PublicBlogPosts(site)
    const published = v2Published || db.posts.filter((p) => p.site === site && p.status === 'published')
    if (slug) {
      const post = published.find((p) => p.slug === slug)
      if (!post) {
        json(res, 404, { message: 'No encontrado' })
        return
      }
      json(res, 200, { site, post: publicPost(post), socialPackChannels, blogEnabled: true })
      return
    }
    json(res, 200, { site, posts: published.map(publicPost), socialPackChannels, blogEnabled: true })
    return
  }

  // PWA billing routes use the same session auth and site ACL as AI routes. They are
  // aliases of the shared admin API so the app can keep one server-side contract.
  if (['/api/billing/snapshot', ...(isProductRestructureV1() ? ['/api/billing/checkout', '/api/billing/portal'] : [])].includes(path)) {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    const db = readDb()
    try {
      const body = req.method === 'POST' ? await parseBody(req) : {}
      const site = siteFrom(auth, (req.method === 'GET' ? url.searchParams.get('site') : body.site) || DEFAULT_SITE)
      assertSiteAccess(auth, site)
      const siteConfig = loadSiteConfig(site)
      if (!siteConfig) throw Object.assign(new Error('Sitio no encontrado'), { status: 404 })

      if (req.method === 'GET' && path === '/api/billing/snapshot') {
        const snapshot = getPwaBillingSnapshot(site, { db, siteConfig, auth })
        const cmsAiEnabled = isCmsAiEnabled({ db })
        // A preference selector must only expose providers that are actually
        // enabled and have a usable credential. When CMS AI is disabled, do not
        // expose any model, credit balance or pack metadata to the PWA.
        snapshot.cmsAiEnabled = cmsAiEnabled
        if (cmsAiEnabled) {
          const connectors = new Map(listPublicAiProviderConnectors({ db }).map((item) => [item.provider, item]))
          snapshot.models = (snapshot.models || []).filter((model) => {
            if (model.provider === 'included') return true
            const connector = connectors.get(model.provider)
            return Boolean(connector?.enabled && connector.apiKeyConfigured)
          })
        } else {
          snapshot.models = []
          snapshot.creditPacks = []
          snapshot.cmsAiAllowed = false
          snapshot.ai = {
            monthKey: snapshot.ai?.monthKey || null,
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, creditsUsed: 0 },
            tokenCredits: { monthlyIncluded: 0, monthlyRemaining: 0, purchasedBalance: 0, available: 0 }
          }
        }
        json(res, 200, snapshot)
        return
      }
      if (req.method === 'POST' && path === '/api/billing/checkout') {
        if (body.kind === 'membership') throw Object.assign(new Error('Las membresías están deshabilitadas durante la beta.'), { status: 404 })
        if (body.kind === 'credits') assertCmsAiAllowed(auth)
        if (body.kind === 'credits' && isBillingTestCreditsEnabled(db)) {
          const grant = grantPwaTestCredits(site, body.packId, { db, actorId: auth.userId || auth.role })
          writeDb(db)
          json(res, 200, { site, configured: true, testMode: true, credited: true, ...grant })
          return
        }
        const origin = absoluteCmsOrigin(req)
        const result = await createPwaCheckoutSession({
          site,
          kind: body.kind,
          planId: body.planId,
          packId: body.packId,
          successUrl: `${origin}/app/billing?checkout=success`,
          cancelUrl: `${origin}/app/billing?checkout=cancel`
        }, { db })
        // Return only hosted-session facts; price IDs, Stripe secrets and config stay server-side.
        json(res, 200, {
          site,
          configured: result.configured,
          testMode: false,
          reason: result.reason,
          sessionId: result.sessionId || null,
          url: result.url || null
        })
        return
      }
      if (req.method === 'POST' && path === '/api/billing/portal') {
        const result = await createPwaPortalSession({
          customerId: db.memberships?.[site]?.customerId || db.aiCredits?.[site]?.stripeCustomerId,
          returnUrl: `${absoluteCmsOrigin(req)}/app/billing`
        })
        json(res, 200, { site, configured: result.configured, reason: result.reason, url: result.url || null })
        return
      }
      json(res, 405, { message: 'Método no permitido' })
    } catch (error) {
      json(res, error.status || 400, { message: error.message })
    }
    return
  }

  if (path === '/api/chatgpt/status' || path === '/api/chatgpt/connection') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    if (req.method !== 'GET') {
      json(res, 405, { message: 'Usa GET para consultar la conexión.' })
      return
    }
    json(res, 200, getChatGptConnection(auth.userId))
    return
  }

  if (path === '/api/chatgpt/import' || path === '/api/chatgpt/disconnect') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    try {
      const db = readDb()
      if (path === '/api/chatgpt/import') {
        if (req.method !== 'POST') throw Object.assign(new Error('Usa POST para importar la conexión.'), { status: 405 })
        const body = await parseBody(req)
        const connection = saveChatGptConnection(auth.userId, body.credentials || body, { db })
        writeDb(db)
        json(res, 200, { connection })
      } else {
        if (req.method !== 'DELETE' && req.method !== 'POST') throw Object.assign(new Error('Usa DELETE para desconectar.'), { status: 405 })
        const connection = disconnectChatGpt(auth.userId, { db })
        writeDb(db)
        json(res, 200, { connection })
      }
    } catch (error) {
      json(res, error.status || 400, { message: error.message, code: error.code, ...(error.extra || {}) })
    }
    return
  }

  if (path.startsWith('/api/ai/')) {
    json(res, 410, {
      code: 'server_side_ai_removed',
      message: 'La generación server-side fue retirada. Usa el contexto de marca y las tools de /mcp/v3 con una IA externa.'
    })
    return
  }

  if (path === '/api/ai/chat' || path === '/api/ai/generate') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    if (req.method !== 'POST') {
      json(res, 405, { message: 'Usa POST.' })
      return
    }
    try {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      assertSiteAccess(auth, site)
      assertAiRateLimit(aiRateLimitKey(auth, site, requestIp(req)), { limit: path.endsWith('/chat') ? 60 : 30 })
      if (path.endsWith('/chat')) {
        const result = await runChat({ site, auth, message: body.message, provider: body.provider, model: body.model })
        applyCors(res, req)
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Request-Id': res._requestId })
        for (const delta of splitSseChunks(result.content)) res.write(`event: delta\ndata: ${JSON.stringify({ delta })}\n\n`)
        res.write(`event: done\ndata: ${JSON.stringify({ provider: result.provider, model: result.model, usage: result.usage, billing: result.billing })}\n\n`)
        res.end()
      } else {
        const result = await runGenerateOperation({ site, auth, operation: body.operation, prompt: body.prompt, post: body.post, provider: body.provider, model: body.model })
        json(res, 200, result)
      }
    } catch (error) {
      json(res, error.status || 400, { message: error.message, code: error.code || error.extra?.code, ...(error.extra || {}) })
    }
    return
  }

  // Durable PWA assistant conversations. They are scoped by both site and
  // authenticated user so changing sites never leaks another site's drafts.
  const conversationMatch = path.match(/^\/api\/ai\/conversations\/([^/]+)$/)
  if (path === '/api/ai/conversations' || conversationMatch) {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    try {
      const body = req.method === 'POST' ? await parseBody(req) : {}
      const site = siteFrom(auth, (req.method === 'GET' ? url.searchParams.get('site') : body.site) || DEFAULT_SITE)
      assertSiteAccess(auth, site)
      assertAiRateLimit(aiRateLimitKey(auth, site, requestIp(req)), { limit: 120 })
      const db = readDb()
      assertInAppAssistantEnabled({ cmsAiEnabled: isCmsAiEnabled({ db }), workflow: getWorkflowFlags(db) })
      const ownerId = conversationOwner(auth)
      if (req.method === 'GET' && conversationMatch) {
        const conversation = getConversation({ db, site, ownerId, id: decodeURIComponent(conversationMatch[1]) })
        if (!conversation) {
          json(res, 404, { message: 'Conversación no encontrada' })
          return
        }
        json(res, 200, { conversation })
        return
      }
      if (req.method === 'GET') {
        json(res, 200, { conversations: listConversations({ db, site, ownerId }) })
        return
      }
      if (req.method === 'DELETE' && conversationMatch) {
        const deleted = deleteConversation({ db, site, ownerId, id: decodeURIComponent(conversationMatch[1]) })
        if (!deleted) {
          json(res, 404, { message: 'Conversación no encontrada' })
          return
        }
        writeDb(db)
        json(res, 200, { deleted: true })
        return
      }
      if (req.method === 'POST' && path === '/api/ai/conversations') {
        const conversation = saveConversation({ db, site, ownerId, conversation: body })
        writeDb(db)
        json(res, 200, { conversation })
        return
      }
      json(res, 405, { message: 'Método no permitido' })
    } catch (error) {
      json(res, error.status || 400, { message: error.message })
    }
    return
  }

  // Workflow visibility is readable by every authenticated app user. Billing
  // test flags remain behind /api/admin/feature-flags and super-admin ACLs.
  if (req.method === 'GET' && path === '/api/app/feature-flags') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    try {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      assertSiteAccess(auth, site)
      const db = readDb()
      const cmsAiEnabled = isCmsAiEnabled({ db })
      const workflow = getWorkflowFlags(db)
      let productFlags = { creation_ui_enabled: true, manual_creation_enabled: false }
      if (isPostgresConfigured()) {
        try {
          const context = await resolveWorkspaceContext({ userId: auth.userId || undefined, ...(site ? { siteHandle: site } : {}) })
          const selected = context.sites.find((entry) => entry.handle === site) || context.sites[0]
          productFlags = await getWorkspaceFeatureFlags({ workspaceId: context.workspaceId, siteId: selected?.id })
        } catch { /* legacy users may not have been imported yet */ }
      }
      if (creationUiGlobalKillSwitch()) productFlags = { creation_ui_enabled: false, manual_creation_enabled: false }
      json(res, 200, {
        flags: {
          cmsAiEnabled,
          // The in-app assistant was removed with the server-side AI runtime.
          // ChatGPT connects through the external /mcp/v3 contract instead.
          assistantEnabled: false,
          blogWizardEnabled: cmsAiEnabled && workflow.blogWizardEnabled,
          legacyPreviewEnabled: workflow.legacyPreviewEnabled,
          legacySocialPackEnabled: workflow.legacySocialPackEnabled,
          authorInviteEnabled: workflow.authorInviteEnabled,
          creation_ui_enabled: Boolean(productFlags.creation_ui_enabled),
          manual_creation_enabled: Boolean(productFlags.manual_creation_enabled),
          updatedAt: workflow.updatedAt
        }
      })
    } catch (error) {
      json(res, error.status || 400, { message: error.message })
    }
    return
  }

  // PWA AI endpoints. Keep these outside /api/admin so the new client can use
  // the same session auth while still applying the existing per-site ACL.
  if (path === '/api/ai/tools' || path === '/api/ai/tools/call') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    try {
      const appHiddenTools = new Set(['blog_get_brand_context', 'blog_update_brand_file', 'blog_import_brand_zip'])
      const db = readDb()
      const workflow = getWorkflowFlags(db)
      assertInAppAssistantEnabled({ cmsAiEnabled: isCmsAiEnabled({ db }), workflow })
      if (path === '/api/ai/tools' && req.method === 'GET') {
        assertAiRateLimit(aiRateLimitKey(auth, url.searchParams.get('site') || DEFAULT_SITE, requestIp(req)), { limit: 60 })
        const tools = buildToolList(auth)
          .filter((tool) => isChatToolAllowedName(tool.name))
          .filter((tool) => isSuperAdmin(auth) || !appHiddenTools.has(tool.name))
        json(res, 200, { protocol: 'mcp', version: MCP_SERVER_VERSION, tools })
        return
      }
      if (path === '/api/ai/tools/call' && req.method === 'POST') {
        const body = await parseBody(req)
        if (!body.name || typeof body.name !== 'string') throw Object.assign(new Error('Falta el nombre de la tool MCP.'), { status: 400 })
        const site = body.arguments?.site || DEFAULT_SITE
        assertAiRateLimit(aiRateLimitKey(auth, site, requestIp(req)), { limit: 45 })
        if (!isSuperAdmin(auth) && appHiddenTools.has(body.name)) throw Object.assign(new Error('Esta tool está reservada al espacio/agencia.'), { status: 403 })
        if (!isChatToolAllowedName(body.name)) {
          throw Object.assign(new Error('Esta acción no está disponible desde el asistente.'), { status: 403, extra: { code: 'AI_CHAT_TOOL_BLOCKED' } })
        }
        const result = await invokeMcpTool(body.name, body.arguments || {}, auth, { restrictMutations: true, source: 'app' })
        json(res, 200, { protocol: 'mcp', version: MCP_SERVER_VERSION, ...result })
        return
      }
      json(res, 405, { message: 'Usa GET para listar tools o POST para ejecutarlas.' })
    } catch (error) {
      json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
    }
    return
  }

  if (path === '/api/ai/transcribe') {
    const auth = requireAuth(req, url, res)
    if (!auth) return
    if (req.method !== 'POST') {
      json(res, 405, { message: 'Usa POST' })
      return
    }
    try {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      assertSiteAccess(auth, site)
      assertMembershipActive(site, { userId: auth.userId })
      assertAiRateLimit(aiRateLimitKey(auth, site, requestIp(req)), { limit: 12 })
      const raw = String(body.audioBase64 || '').trim()
      const encoded = raw.includes(',') ? raw.split(',').pop() : raw
      if (!encoded || encoded.length > 13_000_000) {
        throw Object.assign(new Error('El audio está vacío o supera el límite permitido.'), { status: 413 })
      }
      const audio = Buffer.from(encoded, 'base64')
      if (!audio.length) throw Object.assign(new Error('No se pudo leer el audio.'), { status: 400 })
      const connector = getAiProviderConnector('openai', { db: readDb() })
      if (!connector.apiKey) {
        throw Object.assign(new Error('Configura una API key de OpenAI para transcribir audio.'), { status: 503 })
      }
      const mimeType = String(body.mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm'
      const form = new FormData()
      form.append('file', new Blob([audio], { type: mimeType }), String(body.filename || 'escarlet-voice-note.webm'))
      form.append('model', String(process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1'))
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${connector.apiKey}` },
        body: form
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const reason = payload?.error?.message || 'OpenAI rechazó la transcripción.'
        throw Object.assign(new Error(reason), { status: response.status >= 500 ? 502 : 422 })
      }
      const text = String(payload?.text || '').trim()
      if (!text) throw Object.assign(new Error('OpenAI no devolvió texto transcrito.'), { status: 502 })
      json(res, 200, { text: text.slice(0, 12_000), model: String(process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1') })
    } catch (error) {
      json(res, error.status || 400, { message: error.message })
    }
    return
  }


  if (path.startsWith('/api/admin')) {
    const auth = await requireAuthAsync(req, url, res)
    if (!auth) return
    if (path !== '/api/admin/session') {
      json(res, 410, {
        code: 'legacy_api_removed',
        message: 'La API administrativa legacy fue retirada. Usa /api/v2 para la PWA y /mcp/v3 para agentes.'
      })
      return
    }
    const db = readDb()
    const legacyContentWrite = isPostgresConfigured() && req.method !== 'GET' && (
      path.startsWith('/api/admin/posts') ||
      path.startsWith('/api/admin/media') ||
      path === '/api/admin/validate-seo' ||
      path.startsWith('/api/admin/brand-kit') ||
      path.startsWith('/api/admin/site-config') ||
      path === '/api/admin/sites' ||
      path === '/api/admin/feature-flags' ||
      path === '/api/admin/ai/providers' ||
      path.startsWith('/api/admin/billing/credit-packs')
    )
    if (legacyContentWrite) {
      json(res, 409, {
        code: 'legacy_write_disabled',
        message: 'Las escrituras legacy están deshabilitadas cuando Postgres es la fuente canónica.',
        redirect: '/plans'
      })
      return
    }
    if (req.method === 'GET' && path === '/api/admin/session') {
      json(res, 200, await publicSessionForAuth(auth))
      return
    }

    if (isProductRestructureV1() && path === '/api/admin/feature-flags') {
      try {
        if (req.method === 'GET') {
          assertSuperAdmin(auth)
          json(res, 200, { flags: { cmsAiEnabled: isCmsAiEnabled({ db }), ...getBillingTestFlags(db), ...getWorkflowFlags(db) } })
          return
        }
        if (req.method === 'POST') {
          assertSuperAdmin(auth)
          const body = await parseBody(req)
          setCmsAiEnabled({ db, enabled: body.cmsAiEnabled, actorId: auth.userId || auth.role })
          const billingFlags = setBillingTestFlags({
            db,
            creditCheckoutWithoutStripe: body.creditCheckoutWithoutStripe,
            actorId: auth.userId || auth.role
          })
          const workflowFlags = setWorkflowFlags({
            db,
            assistantEnabled: body.assistantEnabled,
            blogWizardEnabled: body.blogWizardEnabled,
            legacyPreviewEnabled: body.legacyPreviewEnabled,
            legacySocialPackEnabled: body.legacySocialPackEnabled,
            authorInviteEnabled: body.authorInviteEnabled,
            actorId: auth.userId || auth.role
          })
          writeDb(db)
          json(res, 200, { ok: true, flags: { cmsAiEnabled: isCmsAiEnabled({ db }), ...billingFlags, ...workflowFlags } })
          return
        }
        json(res, 405, { message: 'Usa GET o POST' })
      } catch (err) {
        json(res, err.status || 400, { message: err.message, ...(err.extra || {}) })
      }
      return
    }

    // AI connector credentials and billing catalogs are global operational settings.
    // They require the global admin role; no secret is ever serialized in responses.
    if (path === '/api/admin/ai/providers') {
      try {
        assertSuperAdmin(auth)
        assertCmsAiEnabled({ db })
        if (req.method === 'GET') {
          json(res, 200, { providers: listPublicAiProviderConnectors({ db }) })
          return
        }
        if (req.method === 'POST') {
          const body = await parseBody(req)
          const provider = saveAiProviderConnector(body.provider, body, { db })
          writeDb(db)
          json(res, 200, { provider })
          return
        }
        json(res, 405, { message: 'Usa GET o POST' })
      } catch (err) {
        json(res, err.status || 400, { message: err.message, ...(err.extra || {}) })
      }
      return
    }

    const providerTestMatch = path.match(/^\/api\/admin\/ai\/providers\/([a-z0-9_-]+)\/test$/i)
    if (providerTestMatch) {
      try {
        assertSuperAdmin(auth)
        assertCmsAiEnabled({ db })
        if (req.method !== 'POST') throw Object.assign(new Error('Usa POST'), { status: 405 })
        const result = await testAiProviderConnector(providerTestMatch[1], { db })
        json(res, result.ok ? 200 : 422, { result })
      } catch (err) {
        json(res, err.status || 400, { message: err.message, ...(err.extra || {}) })
      }
      return
    }

    const packMatch = path.match(/^\/api\/admin\/billing\/credit-packs(?:\/([a-z0-9-]+))?$/i)
    if (packMatch) {
      try {
        assertSuperAdmin(auth)
        assertCmsAiEnabled({ db })
        if (req.method === 'GET') {
          json(res, 200, { packs: getPwaCreditPackCatalog({ db }) })
          return
        }
        if (req.method === 'POST' || req.method === 'PUT') {
          const body = await parseBody(req)
          const pack = savePwaCreditPack({ ...body, id: packMatch[1] || body.id }, { db })
          writeDb(db)
          json(res, 200, { pack })
          return
        }
        if (req.method === 'DELETE') {
          const result = deletePwaCreditPack(packMatch[1], { db })
          writeDb(db)
          json(res, 200, result)
          return
        }
        json(res, 405, { message: 'Método no permitido' })
      } catch (err) {
        json(res, err.status || 400, { message: err.message, ...(err.extra || {}) })
      }
      return
    }

    if (isProductRestructureV1() && req.method === 'GET' && path === '/api/admin/quota') {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        json(res, 200, cmsGetQuotaSnapshot(site))
      } catch (err) {
        json(res, err.status || 403, { message: err.message, ...(err.extra || {}) })
      }
      return
    }

    if (isProductRestructureV1() && req.method === 'GET' && path === '/api/admin/payment-links') {
      try {
        assertAgencyOps(auth)
        json(res, 200, buildPaymentLinkHints())
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
      }
      return
    }

    // PWA billing is intentionally feature-gated with the existing quota/payment APIs.
    // Snapshots and checkout actions are always constrained to the caller's site ACL.
    if (isProductRestructureV1() && req.method === 'GET' && path === '/api/admin/billing') {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        assertCmsAiEnabled({ db })
        const siteConfig = loadSiteConfig(site)
        if (!siteConfig) throw Object.assign(new Error('Sitio no encontrado'), { status: 404 })
        json(res, 200, getPwaBillingSnapshot(site, { db, siteConfig, auth }))
      } catch (err) {
        json(res, err.status || 403, { message: err.message, ...(err.extra || {}) })
      }
      return
    }

    if (isProductRestructureV1() && req.method === 'POST' && path === '/api/admin/billing/checkout') {
      try {
        const body = await parseBody(req)
        if (body.kind === 'membership') throw Object.assign(new Error('Las membresías están deshabilitadas durante la beta.'), { status: 404 })
        if (body.kind === 'credits') assertCmsAiAllowed(auth)
        const site = siteFrom(auth, body.site || DEFAULT_SITE)
        assertSiteAccess(auth, site)
        if (!loadSiteConfig(site)) throw Object.assign(new Error('Sitio no encontrado'), { status: 404 })
        if (body.kind === 'credits' && isBillingTestCreditsEnabled(db)) {
          const grant = grantPwaTestCredits(site, body.packId, { db, actorId: auth.userId || auth.role })
          writeDb(db)
          json(res, 200, { site, configured: true, testMode: true, credited: true, ...grant })
          return
        }
        const origin = absoluteCmsOrigin(req)
        const result = await createPwaCheckoutSession({
          site,
          kind: body.kind,
          planId: body.planId,
          packId: body.packId,
          // Keep Stripe redirects on this application instead of accepting arbitrary URLs.
          successUrl: `${origin}/app/billing?checkout=success`,
          cancelUrl: `${origin}/app/billing?checkout=cancel`
        }, { db })
        // Do not return the resolved Stripe price ID (or any server configuration) to the PWA.
        json(res, 200, {
          site,
          configured: result.configured,
          testMode: false,
          reason: result.reason,
          sessionId: result.sessionId || null,
          url: result.url || null
        })
      } catch (err) {
        json(res, err.status || 400, { message: err.message })
      }
      return
    }

    if (isProductRestructureV1() && req.method === 'POST' && path === '/api/admin/billing/portal') {
      try {
        assertAgencyOps(auth)
        const body = await parseBody(req)
        const site = siteFrom(auth, body.site || DEFAULT_SITE)
        assertSiteAccess(auth, site)
        if (!loadSiteConfig(site)) throw Object.assign(new Error('Sitio no encontrado'), { status: 404 })
        const result = await createPwaPortalSession({
          customerId: db.memberships?.[site]?.customerId || db.aiCredits?.[site]?.stripeCustomerId,
          returnUrl: `${absoluteCmsOrigin(req)}/app/billing`
        })
        json(res, 200, { site, configured: result.configured, reason: result.reason, url: result.url || null })
      } catch (err) {
        json(res, err.status || 400, { message: err.message })
      }
      return
    }

    if (isCmsSocialPackHostEnabled() && req.method === 'GET' && path === '/api/admin/social-pack') {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const siteConfig = loadSiteConfig(site) || { domain: 'https://example.com' }
      if (isSocialMediaOnlySite(siteConfig)) {
        json(res, 200, { site, source: 'cms', socialPackChannels: getSocialPackChannels(siteConfig), packs: [] })
        return
      }
      const posts = db.posts.filter((p) => p.site === site)
      const packs = listSocialPackSummaries(posts, siteConfig, { cmsHostEnabled: true })
      json(res, 200, {
        site,
        source: 'cms',
        socialPackChannels: getSocialPackChannels(siteConfig),
        packs
      })
      return
    }

    const socialPackMatch = path.match(/^\/api\/admin\/social-pack\/([^/]+)$/)
    if (isCmsSocialPackHostEnabled() && req.method === 'GET' && socialPackMatch) {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      if (isSocialMediaOnlySite(loadSiteConfig(site))) {
        json(res, 404, { message: 'Los sitios solo Social Media no tienen packs vinculados a posts.' })
        return
      }
      const slug = decodeURIComponent(socialPackMatch[1])
      const post = findPost(db, site, slug)
      if (!post) {
        json(res, 404, { message: 'Pack no encontrado' })
        return
      }
      const siteConfig = loadSiteConfig(site) || { domain: 'https://example.com' }
      const pack = buildSocialPackPayload(post, siteConfig, {
        cmsHostEnabled: true,
        includeEmpty: true
      })
      json(res, 200, { pack })
      return
    }

    if (req.method === 'GET' && path === '/api/admin/posts') {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        assertBlogSite(site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const status = url.searchParams.get('status')
      let posts = db.posts.filter((p) => p.site === site)
      posts = posts.filter((post) => canViewPostForAuth(post, auth, site))
      if (status) posts = posts.filter((p) => p.status === status)
      json(res, 200, { posts: normalizePostsForClient(posts) })
      return
    }

    const adminPostMatch = path.match(/^\/api\/admin\/posts\/([^/]+)$/)
    if (req.method === 'GET' && adminPostMatch && adminPostMatch[1] !== 'calendar') {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        assertBlogSite(site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const slug = decodeURIComponent(adminPostMatch[1])
      const post = findPost(db, site, slug)
      if (!post) {
        json(res, 404, { message: 'No encontrado' })
        return
      }
      if (!canViewPostForAuth(post, auth, site)) {
        json(res, 403, { message: 'No tienes acceso a este borrador.' })
        return
      }
      json(res, 200, { post: normalizePostForClient(post) })
      return
    }

    if (req.method === 'GET' && path === '/api/admin/sites') {
      const handles = allowedSiteHandles(auth)
      const sites = (db.sites || []).filter((s) => handles.includes(s.handle || s.id))
      json(res, 200, {
        sites,
        handles,
        role: auth.role,
        canCreateSites: isSuperAdmin(auth)
      })
      return
    }

    if (req.method === 'GET' && path === '/api/admin/onboarding') {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      json(res, 200, await getOnboarding(site))
      return
    }

    if (req.method === 'POST' && path === '/api/admin/sites') {
      try {
        assertSuperAdmin(auth)
      const body = await parseBody(req)
      const result = await createSiteRecord({ ...body, createdBy: auth.userId || 'system', createdByRole: workspaceRoleForAuth(auth) })
      if (isPostgresConfigured()) {
        try {
          const canonical = await resolveWorkspaceContext({ userId: auth.userId || undefined, siteHandle: result.site.handle })
          const createdBrand = canonical.sites.find((brand) => brand.handle === result.site.handle) || canonical.sites[0]
          if (createdBrand) {
            const legacyConfig = result.config || body
            await initializeBrandConfiguration({ workspaceId: canonical.workspaceId, siteId: createdBrand.id, legacy: {
              contentMode: legacyConfig.contentMode,
              blogEnabled: legacyConfig.blogEnabled,
              socialPackChannels: legacyConfig.socialPackChannels,
              domain: legacyConfig.domain,
              rebuildWebhookUrl: legacyConfig.rebuildWebhookUrl,
              coolifyApiTokenCiphertext: legacyConfig.coolifyApiToken ? encryptSecret(legacyConfig.coolifyApiToken) : null
            } })
          }
        } catch (error) {
          console.warn('[brand] Postgres channel initialization skipped:', error.message)
        }
      }
      json(res, 201, result)
      } catch (err) {
        json(res, err.status || 500, { message: err.message, ...(err.extra || {}) })
      }
      return
    }

    if (req.method === 'GET' && path === '/api/admin/authors') {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        let userAuthors = []
        try {
          userAuthors = listSiteAuthors({ site, requesterId: auth.userId, requesterRole: auth.role })
        } catch {
          userAuthors = []
        }
        const authors = []
        const seen = new Set()
        for (const value of userAuthors) {
          const author = typeof value === 'string' ? { name: value } : value
          const name = String(author?.name || author?.displayName || '').trim()
          if (!name || seen.has(name.toLowerCase())) continue
          seen.add(name.toLowerCase())
          authors.push({ ...author, name })
        }
        json(res, 200, { authors, site })
      } catch (error) {
        json(res, error.status || 400, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'GET' && path === '/api/admin/categories') {
      json(res, 200, { categories: db.categories || [] })
      return
    }

    if (req.method === 'GET' && path === '/api/admin/media') {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const kind = url.searchParams.get('kind')
      let items = (db.media || []).filter((m) => !m.site || m.site === site)
      if (kind) {
        items = items.filter((m) => m.kind === kind)
        if (kind === 'reference') items = items.filter((m) => isApprovedBrandAsset(site, m.filename || m.path || m.url))
      } else {
        // Brand-kit reference assets stay out of the library unless kind=reference.
        items = items.filter((m) => m.kind !== 'reference')
      }
      const media = []
      let dbDirty = false
      for (const item of items) {
        const client = mediaForClient(item)
        const disk = client.path?.startsWith('/media/')
          ? join(mediaDir, client.path.replace(/^\/media\//, ''))
          : ''
        let bytes = 0
        let ok = false
        let integrity = { reason: 'missing' }
        let buf = null
        if (disk && existsSync(disk)) {
          buf = readFileSync(disk)
          bytes = buf.length
          integrity = inspectImageBuffer(buf)
          ok = integrity.ok
        }
        let thumbUrl = client.thumbUrl || client.thumbPath || ''
        if (!thumbUrl && disk && client.path) {
          const thumbJpg = disk.replace(/\.[a-z0-9]+$/i, '_thumb.jpg')
          const thumbWebp = disk.replace(/\.[a-z0-9]+$/i, '_thumb.webp')
          if (existsSync(thumbJpg)) {
            thumbUrl = client.path.replace(/\.[a-z0-9]+$/i, '_thumb.jpg')
          } else if (existsSync(thumbWebp)) {
            thumbUrl = client.path.replace(/\.[a-z0-9]+$/i, '_thumb.webp')
          } else if (buf && ok) {
            try {
              const thumb = await generateThumbBuffer(buf, 400)
              if (thumb.ok && thumb.buffer?.length) {
                writeFileSync(thumbJpg, thumb.buffer)
                thumbUrl = client.path.replace(/\.[a-z0-9]+$/i, '_thumb.jpg')
                const idx = (db.media || []).findIndex((m) => m.id && item.id && m.id === item.id)
                if (idx >= 0) {
                  db.media[idx] = { ...db.media[idx], thumbPath: thumbUrl }
                  dbDirty = true
                }
              }
            } catch {
              /* thumb best-effort */
            }
          }
        }
        media.push({
          ...client,
          ...(thumbUrl ? { thumbUrl, thumbPath: client.thumbPath || thumbUrl } : {}),
          bytes,
          ok,
          integrity
        })
      }
      if (dbDirty) writeDb(db)
      json(res, 200, { media })
      return
    }

    const siteConfigTestMatch = path.match(/^\/api\/admin\/site-config\/([^/]+)\/test-rebuild$/)
    if (siteConfigTestMatch && req.method === 'POST') {
      const handle = siteConfigTestMatch[1]
      try {
        assertSiteAccess(auth, handle)
        assertAgencyOps(auth)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      if (!loadSiteConfig(handle)) {
        json(res, 404, { message: 'Site no encontrado' })
        return
      }
      const rebuild = await notifyRebuild(handle)
      json(res, rebuild.ok ? 200 : 502, {
        rebuild,
        message: rebuild.message || (rebuild.ok ? 'Rebuild disparado' : 'Webhook falló')
      })
      return
    }

    const siteTokenMatch = path.match(/^\/api\/admin\/site-config\/([^/]+)\/access-token$/)
    if (siteTokenMatch && req.method === 'POST') {
      json(res, 410, { message: 'Los tokens de sitio se han retirado. Usa tu token personal o OAuth.' })
      return
    }

    const agentIconMatch = path.match(/^\/api\/admin\/site-config\/([^/]+)\/agent-icon$/)
    if (agentIconMatch && (req.method === 'GET' || req.method === 'POST')) {
      const handle = agentIconMatch[1]
      try {
        assertSiteAccess(auth, handle)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const siteCfg = await siteConfigForMcp(handle, auth)
      if (!siteCfg) {
        json(res, 404, { message: 'Site no encontrado' })
        return
      }
      if (req.method === 'GET') {
        const mcp = getMcpConnectionInfo({ cmsUrl: CMS_PUBLIC_URL })
        json(res, 200, {
          agentIcon: readSiteAgentIcon(handle),
          mcpUrl: mcp.mcpUrl,
          mcpChatGptUrl: mcp.chatgpt.url,
          mcpClaudeUrl: mcp.claude.url,
          mcpAuthHint: mcp.chatgpt.hint,
          mcpClaudeHint: mcp.claude.hint
        })
        return
      }
      try {
        assertSuperAdmin(auth)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const body = await parseBody(req).catch(() => ({}))
      const agentIcon = await prepareSiteAgentIcon(handle, siteCfg.domain || '', {
        soft: true,
        force: body.force !== false
      })
      json(res, agentIcon.ok ? 200 : 502, { agentIcon })
      return
    }

    const siteConfigMatch = path.match(/^\/api\/admin\/site-config\/([^/]+)$/)
    if (siteConfigMatch) {
      const handle = siteConfigMatch[1]
      try {
        assertSiteAccess(auth, handle)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      if (req.method === 'GET') {
        const config = loadSiteConfig(handle)
        if (!config) {
          json(res, 404, { message: 'Site no encontrado' })
          return
        }
        json(res, 200, { config: publicSiteConfigForAuth(config, auth) })
        return
      }
      if (req.method === 'POST') {
        try {
          assertAgencyOps(auth)
        } catch (err) {
          json(res, err.status || 403, { message: err.message })
          return
        }
        const body = await parseBody(req)
        const previous = loadSiteConfig(handle)
        const partial = {
          name: body.name,
          domain: body.domain,
          rebuildWebhookUrl: body.rebuildWebhookUrl,
          requiresHumanApproval: body.requiresHumanApproval
        }
        if (Object.prototype.hasOwnProperty.call(body, 'blogEnabled')) {
          partial.blogEnabled = body.blogEnabled
        }
        if (body.contentMode === 'blog' || body.contentMode === 'socialmedia') {
          partial.contentMode = body.contentMode
          partial.blogEnabled = body.contentMode === 'blog'
        }
        if (Object.prototype.hasOwnProperty.call(body, 'requiresPublishConfirmation')) {
          partial.requiresPublishConfirmation = body.requiresPublishConfirmation
        }
        if (Object.prototype.hasOwnProperty.call(body, 'reviewMode')) {
          partial.reviewMode = body.reviewMode
        }
        if (Object.prototype.hasOwnProperty.call(body, 'planId')) {
          partial.planId = body.planId
        }
        if (body.coolifyApiToken) partial.coolifyApiToken = body.coolifyApiToken
        if (body.clearCoolifyApiToken) partial.clearCoolifyApiToken = true
        if (body.socialPackChannels && typeof body.socialPackChannels === 'object') {
          partial.socialPackChannels = body.socialPackChannels
        }
        const config = saveSiteConfig(handle, partial)
        const blogToggled =
          previous && isPublicBlogEnabled(previous) !== isPublicBlogEnabled(config)
        let rebuild = null
        if (blogToggled) {
          rebuild = await notifyRebuild(handle)
        }
        json(res, 200, { config: publicSiteConfigForAuth(config, auth), rebuild })
        return
      }
    }

    const brandZipMatch = path.match(/^\/api\/admin\/brand-kit\/([^/]+)\/import-zip$/)
    if (brandZipMatch && req.method === 'POST') {
      const site = brandZipMatch[1]
      try {
        assertSiteAccess(auth, site)
        assertSuperAdmin(auth)
        const body = await parseBody(req)
        if (!body.contentBase64 && !body.zipUrl) {
          json(res, 400, { message: 'Falta zipUrl o contentBase64 del ZIP' })
          return
        }
        const result = await importBrandKitZip(site, {
          contentBase64: body.contentBase64,
          zipUrl: body.zipUrl
        })
        json(res, 200, result)
      } catch (err) {
        json(res, err.status || 400, { message: err.message })
      }
      return
    }

    const brandMatch = path.match(/^\/api\/admin\/brand-kit\/([^/]+)(?:\/([^/]+))?$/)
    if (brandMatch) {
      const site = brandMatch[1]
      try {
        assertSiteAccess(auth, site)
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      const file = brandMatch[2] ? decodeURIComponent(brandMatch[2]) : ''
      const allowedFiles = brandFilesForAuth(auth)
      const allowedLabels = brandLabelsForAuth(auth)
      const allowed = !file || BRAND_ALL_FILES.includes(file) || file === 'agent-rules.md'
      if (req.method === 'GET' && !file) {
        try {
          json(res, 200, {
            ...await appBrandContext(site, auth),
            files: allowedFiles,
            labels: allowedLabels
          })
        } catch (err) {
          json(res, err.status || 503, { message: err.message, code: err.code })
        }
        return
      }
      if (req.method === 'GET' && file && allowed) {
        try {
          assertBrandFileAccess(auth, file, { write: false })
          json(res, 200, { site, file, content: readBrandFile(site, file) })
        } catch (err) {
          json(res, err.status || 403, { message: err.message })
        }
        return
      }
      if (req.method === 'POST' && file && allowed) {
        try {
          assertBrandFileAccess(auth, file, { write: true })
          const body = await parseBody(req)
          writeBrandFile(site, file, body.content || '')
          json(res, 200, { ok: true, file })
        } catch (err) {
          json(res, err.status || 400, { message: err.message })
        }
        return
      }
    }

    if (req.method === 'POST' && path === '/api/admin/validate-seo') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        const result = await cmsValidateSeo(site, body.slug, body.post)
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/media/upload') {
      const body = await parseBody(req)
      try {
        const site = siteFrom(auth, body.site || DEFAULT_SITE)
        assertSiteAccess(auth, site)
        const kind = String(body.kind || 'post').toLowerCase()
        const result = await uploadMedia({ ...body, site, kind, requireBrandGrounding: ['post', 'social'].includes(kind), membershipUserId: auth.userId || '' })
        json(res, 200, result.media ? { media: result.media, ...result } : result)
      } catch (err) {
        json(res, err.status || 400, { message: err.message, ...(err.extra || {}) })
      }
      return
    }

    if (req.method === 'DELETE' && path === '/api/admin/media') {
      const body = await parseBody(req).catch(() => ({}))
      const id = body.id || url.searchParams.get('id')
      const site = siteFrom(auth, body.site || url.searchParams.get('site') || DEFAULT_SITE)
      const mediaPath = body.path || url.searchParams.get('path') || ''
      try {
        assertSiteAccess(auth, site)
        const result = await cmsDeleteMedia(site, id, mediaPath, { membershipUserId: auth.userId || '' })
        json(res, 200, result)
      } catch (err) {
        json(res, err.status || 400, { message: err.message })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/media/delete') {
      const body = await parseBody(req)
      try {
        const site = siteFrom(auth, body.site || DEFAULT_SITE)
        assertSiteAccess(auth, site)
        const result = await cmsDeleteMedia(site, body.id, body.path || '', { membershipUserId: auth.userId || '' })
        json(res, 200, result)
      } catch (err) {
        json(res, err.status || 400, { message: err.message })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/media/update-alt') {
      const body = await parseBody(req)
      try {
        const site = siteFrom(auth, body.site || DEFAULT_SITE)
        assertSiteAccess(auth, site)
        const result = await cmsUpdateMediaAlt(site, body.id, body.alt, { membershipUserId: auth.userId || '' })
        json(res, 200, result)
      } catch (err) {
        json(res, err.status || 400, { message: err.message })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/media/update') {
      const body = await parseBody(req)
      try {
        const site = siteFrom(auth, body.site || DEFAULT_SITE)
        assertSiteAccess(auth, site)
        const result = await cmsUpdateMediaDetails(site, body.id, body, { membershipUserId: auth.userId || '' })
        json(res, 200, result)
      } catch (err) {
        json(res, err.status || 400, { message: err.message })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/media') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        assertMembershipActive(site, { userId: auth.userId })
      } catch (err) {
        json(res, err.status || 403, { message: err.message })
        return
      }
      db.media = db.media || []
      if (body.id && Object.prototype.hasOwnProperty.call(body, 'alt')) {
        const idx = db.media.findIndex((m) => m.id === body.id && (!site || m.site === site))
        if (idx >= 0) {
          try {
            const result = await cmsUpdateMediaAlt(site, body.id, body.alt, { membershipUserId: auth.userId || '' })
            json(res, 200, result)
          } catch (err) {
            json(res, err.status || 400, { message: err.message })
          }
          return
        }
      }
      const item = {
        id: body.id || `media-${Date.now()}`,
        site,
        url: body.url || '',
        alt: body.alt || ''
      }
      db.media.push(item)
      writeDb(db)
      json(res, 200, { media: item })
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts/create-draft') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      try {
        if (String(req.headers['x-escarlet-client'] || '').toLowerCase() === 'pwa' && isPostgresConfigured()) {
          const canonical = await resolveWorkspaceContext({ userId: auth.userId || undefined, siteHandle: site })
          const selected = canonical.sites.find((entry) => entry.handle === site) || canonical.sites[0]
          const flags = await getWorkspaceFeatureFlags({ workspaceId: canonical.workspaceId, siteId: selected?.id })
          if (creationUiGlobalKillSwitch() || !flags.manual_creation_enabled) throw Object.assign(new Error('La creación manual está desactivada.'), { status: 403, code: 'manual_creation_disabled' })
        }
        assertSiteAccess(auth, site)
        assertBlogSite(site)
        assertAuthorAllowed({ site, authorName: body.authorName || body.author, requesterId: auth.userId, requesterRole: auth.role })
        const skipQuota = Boolean(auth.capabilities?.includes('quota:override'))
        const result = await cmsCreateDraft({
          ...body,
          site,
          ownerId: auth.userId || '',
          membershipUserId: auth.userId || '',
          skipQuota,
          contentSource: body.contentSource || (auth.role === 'client' ? 'client' : 'agency')
        })
        json(res, 201, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts') {
      const body = await parseBody(req)
      try {
        const site = siteFrom(auth, body.site || DEFAULT_SITE)
        assertSiteAccess(auth, site)
        assertBlogSite(site)
        assertAuthorAllowed({ site, authorName: body.authorName || body.author, requesterId: auth.userId, requesterRole: auth.role })
        const dbNow = readDb()
        const existing = findPost(dbNow, site, body.originalSlug || body.slug)
        if (existing && !canMutatePostForAuth(existing, auth, site)) {
          json(res, 403, { message: 'No tienes acceso a editar este borrador.' })
          return
        }
        const fields = safePostFields(body, auth, site)
        // A client may demote a publication, never promote it with an update.
        if (body.status === 'draft') fields.status = 'draft'
        if (Object.hasOwn(body, 'publishAt')) fields.publishAt = body.publishAt
        const result = await cmsUpdatePost({ ...fields, site, direct: true, keepPublished: true, membershipUserId: auth.userId || '' })
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'GET' && path === '/api/admin/posts/calendar') {
      const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        assertBlogSite(site)
        const result = await cmsListCalendar(
          site,
          url.searchParams.get('from') || '',
          url.searchParams.get('to') || ''
        )
        result.posts = (result.posts || []).filter((post) => canViewPostForAuth(post, auth, site))
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts/schedule') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        assertBlogSite(site)
        const existing = findPost(readDb(), site, body.slug)
        if (existing && !canMutatePostForAuth(existing, auth, site)) {
          json(res, 403, { message: 'No tienes acceso a programar este borrador.' })
          return
        }
        const result = await cmsSchedulePost(site, body.slug, body.publishAt, { ignoreSeo: Boolean(body.ignoreSeo), direct: Boolean(body.direct), membershipUserId: auth.userId || '' })
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts/confirm-schedule') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      try {
        assertSuperAdmin(auth)
        assertSiteAccess(auth, site)
        assertBlogSite(site)
        const existing = findPost(readDb(), site, body.slug)
        if (existing && !canMutatePostForAuth(existing, auth, site)) {
          json(res, 403, { message: 'No tienes acceso a publicar este borrador.' })
          return
        }
        const result = await cmsConfirmSchedule(site, body.slug, { membershipUserId: auth.userId || '' })
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts/cancel-schedule') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        assertBlogSite(site)
        assertPostAccess(findPost(readDb(), site, body.slug), auth, { write: true })
        const result = await cmsCancelSchedule(site, body.slug, { membershipUserId: auth.userId || '' })
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts/publish') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      const slug = body.slug
      try {
        assertSiteAccess(auth, site)
        assertBlogSite(site)
        assertPostAccess(findPost(readDb(), site, slug), auth, { write: true })
        // Live publish (not submit-for-review, not schedule) respects approverRole.
        if (!body.publishAt) {
          const siteConfig = loadSiteConfig(site)
          const dbNow = readDb()
          const existing = findPost(dbNow, site, slug)
          const needsHuman = isAgencyGate(siteConfig) && body.direct !== true
          const submitForReviewOnly =
            needsHuman &&
            (existing?.status === 'draft' || existing?.status === 'changes_requested')
          if (existing && !submitForReviewOnly && !canApproveLivePublish(auth, siteConfig)) {
            const who = resolveApproverRole(siteConfig)
            const label =
              who === 'site_client'
                ? 'el cliente, un editor o un super-admin'
                : who === 'agency_editor'
                  ? 'un editor de agencia o un super-admin'
                  : 'un super-admin'
            json(res, 403, {
              message: `Solo ${label} pueden publicar en vivo en este sitio. Envía a revisión, programa con publishAt o pide confirmación.`
            })
            return
          }
        }
        const result = await cmsPublishPost(site, slug, {
          publishAt: body.publishAt,
          skipQuota: Boolean(auth.capabilities?.includes('quota:override')),
          ignoreSeo: Boolean(body.ignoreSeo),
          direct: Boolean(body.direct),
          membershipUserId: auth.userId || ''
        })
        if (result.published && result.post) {
          recordPublicationMemory(site, result.post)
          const conversationId = String(result.post.assistantConversationId || '').trim()
          if (conversationId) {
            const publicationDb = readDb()
            if (archiveConversation({
              db: publicationDb,
              site,
              ownerId: conversationOwner(auth),
              id: conversationId,
              publishedSlug: result.post.slug
            })) writeDb(publicationDb)
          }
        }
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts/request-changes') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        assertBlogSite(site)
        assertAgencyOps(auth)
        const result = await cmsRequestPostChanges(site, body.slug, {
          rejectReason: body.rejectReason,
          actor: { role: auth.role }
        })
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/admin/posts/unpublish') {
      const body = await parseBody(req)
      const site = siteFrom(auth, body.site || DEFAULT_SITE)
      try {
        assertSiteAccess(auth, site)
        assertBlogSite(site)
        assertPostAccess(findPost(readDb(), site, body.slug), auth, { write: true })
        const result = await cmsUnpublishPost(site, body.slug, { membershipUserId: auth.userId || '' })
        json(res, 200, result)
      } catch (error) {
        const status = error.status || 500
        json(res, status, { message: error.message, ...(error.extra || {}) })
      }
      return
    }

    if (req.method === 'DELETE') {
      const del = path.match(/^\/api\/admin\/posts\/([^/]+)$/)
      if (del) {
        const site = siteFrom(auth, url.searchParams.get('site') || DEFAULT_SITE)
        const slug = decodeURIComponent(del[1])
        try {
          assertSiteAccess(auth, site)
          assertBlogSite(site)
          const existing = findPost(readDb(), site, slug)
          if (existing && !canMutatePostForAuth(existing, auth, site)) {
            json(res, 403, { message: 'No tienes permiso para eliminar este post.' })
            return
          }
          const result = await cmsDeletePost(site, slug, { membershipUserId: auth.userId || '' })
          json(res, 200, result)
        } catch (error) {
          const status = error.status || 500
          json(res, status, { message: error.message, ...(error.extra || {}) })
        }
        return
      }
    }
  }

  json(res, 404, { message: 'Ruta no encontrada' })
}

const server = createServer((req, res) => {
  const requestId = String(req.headers['x-request-id'] || randomUUID()).slice(0, 120)
  res._request = req
  res._requestId = requestId
  res.setHeader('X-Request-Id', requestId)
  handleRequest(req, res).catch((error) => {
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500
    const payload = {
      message: error?.message || 'Error interno del servidor',
      code: error?.code || (status === 500 ? 'internal_error' : 'request_failed'),
      requestId
    }
    console.error(`[http] ${requestId} ${req.method} ${req.url}:`, error)
    if (!res.headersSent) json(res, status, payload)
    else res.destroy()
  })
})

server.on('clientError', (error, socket) => {
  if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
  console.warn('[http] client error:', error.message)
})

mkdirSync(dataDir, { recursive: true })
mkdirSync(mediaDir, { recursive: true })
if (!checkDataWritable()) {
  console.error(`[cms] No se puede escribir en ${dataDir}. Revisa Persistent Storage en Coolify.`)
} else {
  markPersistent()
}
seedAllBrandKits()

const dbBoot = readDb()
let dbRepaired = repairMediaInDb(dbBoot)
if (repairPostsInDb(dbBoot)) dbRepaired = true
if (dbRepaired) writeDb(dbBoot)

const persistence = getPersistenceStatus()
console.log(`[cms] dataDir=${persistence.dataDir} posts=${persistence.posts} media=${persistence.mediaFiles} volume=${persistence.likelyDockerVolume}`)
if (process.env.NODE_ENV === 'production' && !persistence.likelyDockerVolume) {
  console.warn('[cms] AVISO: sin volumen Docker detectado. Los posts pueden borrarse en el próximo deploy.')
}

server.listen(PORT, () => {
  console.log(`Escarlet blog CMS en http://localhost:${PORT}/app`)
  console.log(`MCP remoto (Hermes) en http://localhost:${PORT}/mcp/v3`)
  if (isLocalDevAutoLogin()) console.log('Login local automático como admin (solo loopback). LOCAL_AUTO_LOGIN=0 para desactivarlo.')
})

const SCHEDULE_TICK_MS = Number(process.env.SCHEDULE_TICK_MS || 60_000)
// Legacy JSON schedules keep their compatibility timer only when Postgres is
// not configured. v2 scheduling is entirely worker/outbox driven.
const scheduleTimer = isPostgresConfigured() ? null : setInterval(() => {
  promoteDueScheduledPosts().catch((err) => {
    console.error('[schedule] promote falló', err.message)
  })
}, SCHEDULE_TICK_MS)
if (scheduleTimer && typeof scheduleTimer.unref === 'function') scheduleTimer.unref()

export { ADMIN_TOKEN, DEFAULT_SITE, CMS_PUBLIC_URL }
