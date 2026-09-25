import { Server } from '@modelcontextprotocol/server'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { extname, join } from 'node:path'
import { createHash } from 'node:crypto'
import * as cms from '../lib/cms-ops.mjs'
import {
  MCP_CANONICAL_URL,
  MCP_INSTRUCTIONS,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  withMediaUploadContract
} from '../lib/media-upload-contract.mjs'
import { openaiFileDefs, connectorFileMeta } from '../lib/openai-file.mjs'
import { assertSiteAccess, assertSuperAdmin, allowedSiteHandles, isSiteScopedRole, workspaceRoleForAuth } from '../lib/auth.mjs'
import { brandFilesForAuth, SECRET_BRAND_FILES, prepareImageGeneration, loadActiveBrandKitSnapshot, compositionForAssetType, brandKitWriteAccess, assertBrandKitWritable } from '../lib/brand-kit.mjs'
import { CANONICAL_CMS_URL, canonicalCmsPublicUrl } from '../lib/cms-url.mjs'
import { assertChatToolAllowed, assertSafeToolArguments } from '../lib/ai-security.mjs'
import { loadSiteConfig, isSocialMediaOnlySite } from '../lib/site-config.mjs'
import { mediaDir, readDb } from '../lib/db.mjs'
import { getWorkflowFlags } from '../lib/workflow-flags.mjs'
import {
  getStandaloneSocialPack,
  listStandaloneSocialPacks,
  saveStandaloneSocialPack
} from '../lib/social-pack-store.mjs'
import { isCmsAiEnabled } from '../lib/product-flags.mjs'
import { withGenerationPolicy, assertCmsAiAllowed, CMS_AI_TOOLS } from '../lib/generation-policy.mjs'
import { canReadPost, assertPostAccess, safePostFields } from '../lib/post-access.mjs'
import { listSiteAuthors } from '../lib/human-auth.mjs'
import {
  resolveWorkspaceContext,
  listContentPlans,
  listContentItems,
  listScheduledContent,
  createContentBatch,
  getContentBatch,
  updateContentItem,
  approveContentItem,
  scheduleContentItem,
  cancelContentItem,
  approveContentBatch,
  scheduleContentBatch,
  cancelContentBatch,
  createBrandKitVersion,
  publishBrandKitFile,
  registerBrandAssets,
  registerContentMedia,
  attachContentMedia,
  listSiteChannels,
  listBrandCapabilities,
  listBrandConnections,
  getActiveBrandKit
} from '../lib/workspace-domain.mjs'
import { isPostgresConfigured, runCoreMigrations } from '../lib/pg.mjs'
import {
  getImagePreparation,
  persistImagePreparation
} from '../lib/generation-provenance.mjs'

const DEFAULT_SITE = process.env.DEFAULT_SITE || 'escarlet'
const V2_CONTENT_TOOLS = new Set([
  'content_list_plans',
  'content_list_items',
  'content_list_calendar',
  'content_create_batch',
  'content_get_batch',
  'content_upload_media',
  'content_update_item',
  'content_approve',
  'content_schedule',
  'content_cancel'
])
const V2_READ_ONLY_TOOLS = new Set(['content_list_plans', 'content_list_items', 'content_list_calendar', 'content_get_batch'])
const LEGACY_CONTENT_TOOLS = new Set([
  'blog_list_authors',
  'social_save_pack',
  'social_list_packs',
  'social_get_pack',
  'blog_save_social_pack',
  'blog_list_sites',
  'blog_get_onboarding',
  'blog_get_workflow',
  'blog_create_site',
  'blog_list_posts',
  'blog_get_post',
  'blog_get_quota',
  'blog_create_draft',
  'blog_update_post',
  'blog_unpublish',
  'blog_delete_post',
  'blog_validate_seo',
  'blog_publish',
  'blog_request_changes',
  'blog_schedule_post',
  'blog_confirm_schedule',
  'blog_cancel_schedule',
  'blog_list_calendar',
  'blog_get_seo_context',
  'blog_get_brand_context',
  'blog_update_brand_file',
  'blog_import_brand_zip'
])
const LEGACY_CONTENT_REPLACEMENTS = Object.freeze({
  blog_list_posts: 'content_list_items',
  blog_get_post: 'content_get_batch',
  blog_create_draft: 'content_create_batch',
  blog_update_post: 'content_update_item',
  blog_publish: 'content_approve',
  blog_request_changes: 'content_update_item',
  blog_schedule_post: 'content_schedule',
  blog_cancel_schedule: 'content_cancel',
  blog_list_calendar: 'content_list_calendar'
})
const FINAL_IMAGE_RECEIPT_CONDITION = {
  oneOf: [
    {
      properties: { kind: { const: 'reference' } },
      required: ['kind']
    },
    {
      properties: {
        kind: { const: 'post' },
        generationReceiptId: {
          type: 'string',
          minLength: 1,
          description: 'Receipt emitido por brand_complete_image_generation. Obligatorio para post y social.'
        }
      },
      required: ['kind', 'generationReceiptId']
    },
    {
      properties: {
        kind: { const: 'social' },
        generationReceiptId: {
          type: 'string',
          minLength: 1,
          description: 'Receipt emitido por brand_complete_image_generation. Obligatorio para social.'
        },
        textRendered: { const: true, description: 'Debe ser true: la imagen final ya lleva texto renderizado.' },
        templateId: { type: 'string', enum: ['editorial', 'impact'] },
        renderedBy: { const: 'content-system/instagram-renderer' },
        textContent: {
          type: 'object',
          required: ['headline', 'body'],
          properties: {
            headline: { type: 'string', minLength: 1, maxLength: 90 },
            body: { type: 'string', minLength: 1, maxLength: 240 }
          }
        }
      },
      required: ['kind', 'generationReceiptId', 'textRendered', 'templateId', 'renderedBy', 'textContent']
    }
  ]
}
const MUTATING_SITE_TOOLS = new Set([
  'social_save_pack',
  'blog_save_social_pack',
  'blog_create_draft',
  'blog_update_post',
  'blog_unpublish',
  'blog_delete_post',
  'blog_publish',
  'blog_request_changes',
  'blog_schedule_post',
  'blog_cancel_schedule',
  'blog_update_brand_file',
  'blog_upload_media_file',
  'blog_open_image_drop',
  'blog_upload_media',
  'blog_import_remote_image',
  'content_create_batch',
  'content_upload_media',
  'content_update_item',
  'content_approve',
  'content_schedule',
  'content_cancel'
])

export const RESOURCE_MAP = {
  context: null,
  voice: 'voice.md',
  keywords: 'keywords.md',
  'agent-rules': 'AGENT.md',
  agent: 'AGENT.md',
  'image-guide': 'image-guide.md',
  'visual-style': 'visual-style.md',
  'image-spec': 'image-spec.json'
}

// Publication links are an internal dashboard concern. MCP callers should
// receive the operation result and next action, but never a legacy preview or
// admin URL that can pull them out of the in-app workflow. Keep media URLs
// untouched: they are required when attaching generated/uploaded images.
const PRIVATE_WORKFLOW_KEYS = new Set([
  'previewUrl',
  'dashboardUrl',
  'reviewHint',
  'reviewUrl',
  'legacyUrl',
  'publicationUrl'
])

function redactWorkflowLinks(value) {
  if (Array.isArray(value)) return value.map(redactWorkflowLinks)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_WORKFLOW_KEYS.has(key))
      .map(([key, item]) => [key, redactWorkflowLinks(item)])
  )
}

function brandIsolationFor(payload) {
  const access = brandKitWriteAccess({ role: payload?.role })
  return {
    mode: access.writesBrandKit ? 'versioned_writable' : 'versioned_read_only',
    conversationIndependent: true,
    writesBrandKit: access.writesBrandKit,
    currentRole: access.currentRole,
    requiredRoles: access.requiredRoles,
    writableFiles: access.writableFiles,
    writeDeniedReason: access.writeDeniedReason,
    instruction: access.writesBrandKit
      ? 'Puedes persistir cambios del brand kit con brand_update_file. No uses la preparación visual para mutar el kit.'
      : access.writeDeniedReason
  }
}

function textResult(payload) {
  const safePayload = redactWorkflowLinks(payload)
  const response = safePayload && typeof safePayload === 'object' && !Array.isArray(safePayload)
    ? {
        ...safePayload,
        mcpServer: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, contract: 'v2', canonicalUrl: MCP_CANONICAL_URL }
      }
    : safePayload
  return {
    content: [{ type: 'text', text: typeof response === 'string' ? response : JSON.stringify(response, null, 2) }]
  }
}

function referenceDiskPath(item) {
  const candidates = [item?.path, item?.storageKey]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  let dataRoot = ''
  try {
    dataRoot = `${realpathSync(join(mediaDir, '..')).replace(/\/$/, '')}/`
  } catch {
    return ''
  }
  for (const raw of candidates) {
    if (raw.includes('..')) continue
    const normalized = raw.startsWith('media/') ? `/${raw}` : raw
    const relative = normalized.startsWith('/media/') ? normalized.slice('/media/'.length) : ''
    if ((!relative && !normalized.startsWith('/')) || normalized.includes('..')) continue
    const candidate = relative ? join(mediaDir, relative) : normalized
    if (!existsSync(candidate)) continue
    try {
      const resolved = realpathSync(candidate)
      if (resolved.startsWith(dataRoot)) return resolved
    } catch {
      // Try the next storage representation.
    }
  }
  return ''
}

function imageMimeType(filename) {
  const ext = extname(String(filename || '')).toLowerCase()
  return {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif'
  }[ext] || ''
}

export function normalizeImagePreparationArgs(args = {}) {
  const channel = String(args.channel || '').trim().toLowerCase()
  const assetType = String(args.assetType || '').trim().toLowerCase()
  if (channel === 'linkedin' && (!assetType || assetType === 'generic')) return { ...args, assetType: 'blog_cover' }
  return args
}

async function brandContextResult(payload) {
  const safePayload = redactWorkflowLinks(payload)
  const references = Array.isArray(payload?.brandKit?.referenceImages)
    ? payload.brandKit.referenceImages
    : Array.isArray(payload?.referenceImages)
      ? payload.referenceImages
      : []
  const safeReferences = references.map((reference) => {
    const { path, storageKey, ...safe } = reference || {}
    return {
      ...safe,
      url: /^https?:\/\//i.test(String(safe.url || '')) ? safe.url : null,
      thumbUrl: /^https?:\/\//i.test(String(safe.thumbUrl || '')) ? safe.thumbUrl : null
    }
  })
  if (safePayload && typeof safePayload === 'object') {
    safePayload.referenceImages = safeReferences
    if (safePayload.brandKit && typeof safePayload.brandKit === 'object') safePayload.brandKit.referenceImages = safeReferences
  }
  const textPayload = {
    ...safePayload,
    mcpServer: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, contract: 'v2', canonicalUrl: MCP_CANONICAL_URL },
    referenceDelivery: {
      mode: 'catalog_only',
      total: safeReferences.length,
      imageBlocks: 0,
      inspectable: false,
      binaryDeliveryTool: 'brand_prepare_image_generation',
      instruction: 'El contexto solo cataloga referencias. Llama brand_prepare_image_generation para recibir exclusivamente los ImageContent de la ruta elegida.'
    },
    brandIsolation: brandIsolationFor(safePayload)
  }
  return {
    content: [{ type: 'text', text: typeof textPayload === 'string' ? textPayload : JSON.stringify(textPayload, null, 2) }]
  }
}

export async function preparedImageResult(payload, { referenceIndex = 0 } = {}) {
  const prepared = redactWorkflowLinks(payload)
  const refs = Array.isArray(payload?.resolvedReferences)
    ? [...payload.resolvedReferences].sort((a, b) => Number(a.attachmentIndex || 0) - Number(b.attachmentIndex || 0))
    : []
  const selectedIndex = Number.isInteger(Number(referenceIndex)) ? Number(referenceIndex) : 0
  const selectedReferences = refs.length ? [refs[selectedIndex]].filter(Boolean) : []
  const preparationId = String(payload?.brandPreparation?.preparationId || '')
  const attachments = []
  const attachmentHashes = []
  const missing = []
  for (const reference of selectedReferences) {
    const disk = referenceDiskPath(reference)
    const mimeType = imageMimeType(reference?.filename)
    if (!disk || !mimeType) {
      missing.push(String(reference?.filename || 'referencia-desconocida'))
      continue
    }
    try {
      const bytes = readFileSync(disk)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      attachments.push({
        type: 'image',
        data: bytes.toString('base64'),
        mimeType
      })
      attachmentHashes.push({ filename: reference.filename, sha256 })
    } catch {
      missing.push(String(reference?.filename || 'referencia-desconocida'))
    }
  }
  const referenceHashes = new Map(attachmentHashes.map((entry) => [entry.filename, entry.sha256]))
  prepared.preparationId = preparationId
  prepared.resolvedReferences = refs.map((reference) => {
    const { path, storageKey, ...safeReference } = reference
    return {
      ...safeReference,
      ...(referenceHashes.has(reference.filename) ? { sha256: referenceHashes.get(reference.filename) } : {})
    }
  })
  const allReferencesAvailable = !payload?.generationBlocked && refs.length > 0 && missing.length === 0 && attachments.length === selectedReferences.length
  const complete = allReferencesAvailable && selectedIndex === refs.length - 1
  const readyForGeneration = complete
  const referenceDelivery = {
    expected: refs.length,
    attached: attachments.length,
    missing,
    exactReferenceOrder: refs.map((reference) => reference.filename),
    hashes: attachmentHashes.map((entry) => entry.sha256),
    readyForGeneration,
    mode: 'single_image_per_call',
    deliveredIndex: selectedReferences.length ? selectedIndex : null,
    complete,
    nextReferenceIndex: complete ? null : selectedIndex + 1
  }
  const textPayload = {
    ...prepared,
    mcpServer: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, contract: 'v2', canonicalUrl: MCP_CANONICAL_URL },
    generationBlocked: Boolean(payload?.generationBlocked) || selectedReferences.length === 0 || attachments.length !== selectedReferences.length,
    brandPreparation: prepared.brandPreparation,
    readyForGeneration,
    referenceDelivery,
    brandIsolation: {
      mode: 'versioned_snapshot',
      conversationIndependent: true,
      snapshotReadOnly: true,
      instruction: 'Usa únicamente este snapshot y sus ImageContent. La preparación no modifica el brand kit. Si el usuario pide editarlo, usa brand_update_file cuando writesBrandKit sea true.'
    },
    brandGroundingContract: {
      requiredForUpload: true,
      preparationIdField: 'brandPreparation.preparationId',
      finalAssetRequiresText: Boolean(payload?.brandPreparation?.finalAssetRequiresText),
      finalTextRenderer: 'ChatGPT',
      allowedSocialAspectRatios: payload.composition?.allowedAspectRatios || ['4:5'],
      generationCardinality: payload?.generationCardinality || {
        defaultImageCount: 1,
        maxImageCount: 1,
        unit: 'final_image'
      },
      exactReferenceOrder: referenceDelivery.exactReferenceOrder,
      instruction: complete
        ? 'Ya recibiste todos los ImageContent en llamadas consecutivas. Usa todas las referencias en el orden exacto indicado, genera los píxeles finales y sube el archivo con preparationId, channels y assetIndex. Incluye itemId si el contenido ya existe.'
        : allReferencesAvailable
          ? `Esta llamada entrega solo la referencia ${selectedIndex + 1} de ${refs.length}. Vuelve a llamar brand_prepare_image_generation con preparationId ${preparationId} y referenceIndex ${selectedIndex + 1} antes de generar. No uses Pillow ni sustituyas referencias.`
          : 'No generes ninguna imagen. La preparación no pudo adjuntar la referencia solicitada.'
    }
  }
  return {
    isError: Boolean(payload?.generationBlocked) || selectedReferences.length === 0 || attachments.length !== selectedReferences.length,
    content: [
      { type: 'text', text: JSON.stringify(textPayload, null, 2) },
      ...attachments
    ]
  }
}

function preparedPayloadFromStoredPreparation(preparation, canonicalSnapshot) {
  const byFilename = new Map((canonicalSnapshot.references || []).map((reference) => [reference.filename, reference]))
  const resolvedReferences = (preparation.expectedReferences || []).map((expected) => {
    const current = byFilename.get(expected.filename) || {}
    return {
      ...current,
      id: expected.id || current.id,
      mediaId: expected.mediaId || current.mediaId || null,
      filename: expected.filename,
      attachmentIndex: expected.attachmentIndex,
      sha256: expected.sha256 || current.sha256 || ''
    }
  })
  const assetType = preparation.assetType || 'blog_cover'
  return {
    schemaVersion: '1.0.0',
    site: preparation.site,
    brandKitVersionId: preparation.brandKitVersionId,
    brandKitSnapshotHash: preparation.brandKitSnapshotHash,
    generationBlocked: preparation.generationBlocked,
    route: preparation.route,
    composition: compositionForAssetType(assetType),
    generationCardinality: {
      defaultImageCount: Number(preparation.expectedAssetCount || 1),
      maxImageCount: Number(preparation.expectedAssetCount || 1),
      unit: 'final_image'
    },
    brandPreparation: {
      version: '1.0.0',
      preparationId: preparation.preparationId,
      site: preparation.site,
      brandKitVersionId: preparation.brandKitVersionId,
      brandKitSnapshotHash: preparation.brandKitSnapshotHash,
      route: preparation.route,
      assetType,
      expectedAssetCount: Number(preparation.expectedAssetCount || 1),
      finalAssetRequiresText: ['social_image', 'instagram_story'].includes(assetType),
      finalTextRenderer: ['social_image', 'instagram_story'].includes(assetType) ? 'ChatGPT' : null
    },
    resolvedReferences
  }
}

async function preparedUploadGrounding(site, scope, args) {
  const preparation = await getImagePreparation(args.preparationId)
  if (!preparation) throw Object.assign(new Error('No existe la preparación visual.'), { status: 409, code: 'BRAND_PREPARATION_REQUIRED' })
  if (preparation.site !== site || (preparation.siteId && preparation.siteId !== scope.siteId) || preparation.workspaceId !== scope.workspaceId) throw Object.assign(new Error('La preparación no pertenece a esta marca.'), { status: 409, code: 'SITE_MISMATCH' })
  if (preparation.generationBlocked || preparation.state === 'blocked') throw Object.assign(new Error('La preparación visual está bloqueada.'), { status: 409, code: 'GENERATION_BLOCKED' })
  if (preparation.expiresAt && new Date(preparation.expiresAt).getTime() <= Date.now()) throw Object.assign(new Error('La preparación visual ha expirado.'), { status: 409, code: 'BRAND_PREPARATION_EXPIRED' })
  if (preparation.itemId && args.itemId && preparation.itemId !== args.itemId) throw Object.assign(new Error('La preparación pertenece a otro item.'), { status: 409, code: 'ITEM_MISMATCH' })
  const kind = String(args.kind || '').toLowerCase()
  const channels = Array.isArray(args.channels) ? args.channels.map((channel) => String(channel).toLowerCase()) : []
  if (kind === 'post' && preparation.assetType !== 'blog_cover') throw Object.assign(new Error('kind post requiere una preparación blog_cover.'), { status: 409, code: 'ASSET_TYPE_MISMATCH' })
  if (kind === 'social' && !['social_image', 'instagram_story'].includes(preparation.assetType)) throw Object.assign(new Error('kind social requiere una preparación social_image o instagram_story.'), { status: 409, code: 'ASSET_TYPE_MISMATCH' })
  if (channels.includes('instagram_story') !== (preparation.assetType === 'instagram_story')) throw Object.assign(new Error('La preparación y los canales no coinciden.'), { status: 409, code: 'ASSET_TYPE_MISMATCH' })
  const index = Number(args.assetIndex)
  if (!Number.isInteger(index) || index < 0 || index >= Number(preparation.expectedAssetCount || 1)) throw Object.assign(new Error('assetIndex no pertenece a esta preparación.'), { status: 409, code: 'ASSET_INDEX_MISMATCH' })
  const active = await getActiveBrandKit({ workspaceId: scope.workspaceId, siteId: scope.siteId })
  if (active.id !== preparation.brandKitVersionId) throw Object.assign(new Error('El brand kit cambió desde la preparación. Vuelve a preparar la imagen.'), { status: 409, code: 'BRAND_VERSION_MISMATCH' })
  return {
    provenanceVersion: '3',
    brandPreparationId: preparation.preparationId,
    brandKitVersionId: preparation.brandKitVersionId,
    brandKitSnapshotHash: preparation.brandKitSnapshotHash,
    brandRoute: preparation.route,
    assetType: preparation.assetType,
    resolvedReferenceIds: preparation.expectedReferences.map((reference) => reference.id),
    resolvedReferenceHashes: preparation.expectedReferences.map((reference) => reference.sha256),
    itemId: args.itemId,
    channels: args.channels,
    assetIndex: index,
    generatedAt: new Date().toISOString()
  }
}

function normalizedBrandFields(brandKit = {}) {
  const keys = [
    'brandContextContract',
    'voice',
    'keywords',
    'visualStyle',
    'imageGuide',
    'imageSpec',
    'brandCore',
    'visualSystem',
    'imageArchetypes',
    'referenceLibrary',
    'socialTemplates',
    'visualContext',
    'referenceImages',
    'schemaVersion',
    'brandKitSnapshotHash',
    'canonicalPalette',
    'backgroundDirective',
    'referenceSelectionPolicy'
  ]
  return Object.fromEntries(keys.filter((key) => brandKit[key] !== undefined).map((key) => [key, brandKit[key]]))
}

function errorResult(err) {
  const payload = redactWorkflowLinks({
    message: err.message,
    status: err.status || 500,
    mcpServer: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, contract: 'v2', canonicalUrl: MCP_CANONICAL_URL },
    ...(err.code ? { code: err.code } : {}),
    ...(err.extra || {})
  })
  if (payload.validation && !payload.blockingErrors) {
    payload.blockingErrors = payload.validation.errors
    payload.warnings = payload.validation.warnings
  }
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
  }
}

function availableToolSites(auth) {
  const declaredSites = Array.isArray(auth?.sites) ? auth.sites : []
  const candidates = [...allowedSiteHandles(auth), ...declaredSites]
  if (!candidates.length && auth?.site) candidates.push(auth.site)
  return [...new Set(candidates.map((site) => String(site || '').trim()).filter(Boolean))]
}

function brandSelectionRequired(auth, sites = availableToolSites(auth)) {
  const handles = [...new Set(sites.map((site) => String(site || '').trim()).filter(Boolean))]
  const error = new Error(
    `Tienes acceso a varias marcas (${handles.join(', ')}). Pregunta al usuario con qué marca quiere trabajar y vuelve a llamar indicando site.`
  )
  error.status = 400
  error.code = 'brand_selection_required'
  error.extra = {
    code: error.code,
    sites: handles,
    askUser: `¿Con qué marca quieres trabajar? Elige una: ${handles.join(', ')}.`
  }
  return error
}

function resolveToolSite(auth, args = {}) {
  const requested = String(args.siteId || args.site || '').trim()
  if (requested) {
    assertSiteAccess(auth, requested)
    return requested
  }

  const sites = availableToolSites(auth)
  if (sites.length > 1) throw brandSelectionRequired(auth, sites)

  const fallback = sites[0] || (isSiteScopedRole(auth?.role) ? String(auth?.site || '').trim() : DEFAULT_SITE)
  assertSiteAccess(auth, fallback)
  return fallback
}

async function resolveContentScope(auth, args = {}) {
  const explicitSite = String(args.siteId || args.site || '').trim()
  const knownSites = availableToolSites(auth)
  if (!explicitSite && knownSites.length > 1) throw brandSelectionRequired(auth, knownSites)
  const requestedSite = explicitSite || (
    auth?.role !== 'admin' && knownSites.length === 1
      ? knownSites[0]
      : String(auth?.site || '').trim()
  )
  if (!isPostgresConfigured()) throw Object.assign(new Error('Las tools de contenido requieren Postgres.'), { status: 503, code: 'postgres_required' })
  if (auth?.role === 'admin' && !requestedSite && !args.workspaceId && !auth?.workspaceId && !auth?.userId) {
    throw Object.assign(new Error('Para consultar varias marcas con un token administrador pasa workspaceId o site.'), { status: 400, code: 'workspace_required' })
  }
  await runCoreMigrations()
  if (auth?.role !== 'admin' && !auth?.userId && auth?.site && requestedSite && requestedSite !== auth.site) throw Object.assign(new Error('Este token solo gestiona el sitio autorizado.'), { status: 403 })
  const common = { userId: auth?.userId || undefined, workspaceId: args.workspaceId || undefined }
  let context
  try {
    context = await resolveWorkspaceContext({ ...common, ...(requestedSite ? { siteId: requestedSite } : {}) })
  } catch (error) {
    if (!requestedSite) throw error
    context = await resolveWorkspaceContext({ ...common, siteHandle: requestedSite })
  }
  if (!explicitSite && Array.isArray(context.sites) && context.sites.length > 1) {
    throw brandSelectionRequired(auth, context.sites.map((site) => site.handle))
  }
  if (auth?.role !== 'admin' && !auth?.userId) throw Object.assign(new Error('Se requiere un token personal de usuario.'), { status: 401 })
  const role = auth?.role === 'admin' ? 'admin' : context.role || workspaceRoleForAuth(auth)
  const site = requestedSite ? context.sites.find((entry) => entry.id === requestedSite || entry.handle === requestedSite) : context.sites[0]
  if (!site) throw Object.assign(new Error('Sin acceso al sitio.'), { status: 403 })
  return { ...context, role, siteId: site.id, siteHandle: site.handle }
}

function cmsOrigin() {
  return canonicalCmsPublicUrl(process.env.CMS_PUBLIC_URL || CANONICAL_CMS_URL)
    .replace(/\/app$/, '')
}

function appUrl(path = '') {
  return `${cmsOrigin()}/app${path.startsWith('/') ? path : `/${path}`}`
}

const APP_WORKFLOW_KEYS = new Set(['appUrl', 'appBaseUrl', 'appPreviewUrl', 'appSocialPackUrl'])

function hideAppWorkflowLinks(value) {
  if (Array.isArray(value)) return value.map(hideAppWorkflowLinks)
  if (typeof value === 'string') {
    return value
      .replace(/https?:\/\/[^\s)]+\/app(?:\/[^\s)]*)?/gi, 'la app')
      .replace(/\/app(?:\/[^\s)]*)?/gi, 'la app')
  }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !APP_WORKFLOW_KEYS.has(key))
      .map(([key, item]) => [key, key === 'routes' ? {} : hideAppWorkflowLinks(item)])
  )
}

function workflowPayload(payload, source) {
  return source === 'app' || source === 'chat' ? hideAppWorkflowLinks(payload) : payload
}

function directWorkflowPublish(args, source) {
  // The external connector is now the /app workflow. Keep the old review gate
  // available only when an integrator explicitly opts into direct=false.
  return args.direct === true || (source === 'mcp' && args.direct !== false)
}

export function buildToolList(auth) {
  const tools = [
    { name: 'blog_list_authors', description: 'Autores asignados y autorizados para publicar en su nombre.', inputSchema: { type: 'object', properties: { site: { type: 'string' } }, required: ['site'] }, annotations: { readOnlyHint: true } },
    { name: 'social_save_pack', description: 'Guarda un Social Pack independiente, sin crear ni actualizar un post de blog. ChatGPT debe generar los textos y las slides antes de llamar a esta tool.', inputSchema: { type: 'object', properties: { site: { type: 'string' }, id: { type: 'string' }, title: { type: 'string' }, brief: { type: 'string' }, sourceUrl: { type: 'string' }, socialPack: { type: 'object' } }, required: ['site', 'socialPack'] }, annotations: { readOnlyHint: false } },
    { name: 'social_list_packs', description: 'Lista los Social Packs independientes guardados para un sitio; no devuelve posts de blog.', inputSchema: { type: 'object', properties: { site: { type: 'string' } }, required: ['site'] }, annotations: { readOnlyHint: true } },
    { name: 'social_get_pack', description: 'Lee un Social Pack independiente guardado, sin depender de un post de blog.', inputSchema: { type: 'object', properties: { site: { type: 'string' }, id: { type: 'string' } }, required: ['site', 'id'] }, annotations: { readOnlyHint: true } },
    { name: 'blog_save_social_pack', description: 'Guarda textos y slides generados por ChatGPT. Las slides deben llevar texto renderizado por template, templateId y renderedBy. No genera contenido ni llama APIs de IA.', inputSchema: { type: 'object', properties: { site: { type: 'string' }, slug: { type: 'string' }, socialPack: { type: 'object' } }, required: ['site', 'slug', 'socialPack'] }, annotations: { readOnlyHint: false } },
    {
      name: 'blog_list_sites',
      description: 'Lista marcas visibles con este token. Si hay varias, pregunta al usuario cuál quiere usar antes de llamar a cualquier otra tool.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_get_onboarding',
      description:
        'Playbook setup + Coolify + flujo posts. El acceso se limita a las membresías actuales del usuario.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          domain: { type: 'string' },
          name: { type: 'string' }
        }
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_get_workflow',
      description:
        'Explica los dos flujos nuevos de Escarlet en /app y su feature flag. Debes usarla antes de crear un post y preguntar al usuario si prefiere el flujo simple asistido o el flujo guiado con revisión en la app.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          mode: { type: 'string', enum: ['easy', 'guided'] }
        },
        required: ['site']
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_create_site',
      description: 'Alta de un site nuevo. Solo administrador global.',
      inputSchema: {
        type: 'object',
        properties: {
          handle: { type: 'string' },
          name: { type: 'string' },
          domain: { type: 'string' },
          authors: { type: 'array', items: { type: 'string' } },
          rebuildWebhookUrl: { type: 'string' },
          coolifyApiToken: { type: 'string' },
          contentMode: { type: 'string', enum: ['blog', 'socialmedia'] },
          requiresHumanApproval: { type: 'boolean' },
          force: { type: 'boolean' }
        },
        required: ['handle']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      adminOnly: true
    },
    {
      name: 'blog_list_posts',
      description:
        'Lista posts por site y status opcional (draft, pending_schedule, scheduled, published). Solo lectura. Los estados de revisión antiguos se conservan solo para datos históricos.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          status: { type: 'string' }
        },
        required: ['site']
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_get_post',
      description: 'Lee un post completo por slug. Solo lectura.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' }, slug: { type: 'string' } },
        required: ['site', 'slug']
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_get_quota',
      description:
        'Lee métricas históricas del sitio (borradores y publicaciones del mes UTC). En beta no bloquean las publicaciones MCP. Solo lectura.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' } },
        required: ['site']
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_create_draft',
      description:
        'Crea esqueleto de borrador NUEVO. Antes usa blog_get_brand_context. Respeta cupos del plan (QUOTA_EXCEEDED / MEMBERSHIP_SUSPENDED). Escribe en el CMS.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          title: { type: 'string' },
          author: { type: 'string' },
          slug: { type: 'string' },
          date: { type: 'string' },
          contentSource: { type: 'string', description: 'agency | client' }
        },
        required: ['site', 'title']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_update_post',
      description: 'Actualiza un post EXISTENTE. Guarda en el CMS y no dispara rebuild. Para que salga en la web llama blog_publish. No permite modificar estado ni propietario: usa publicar/programar/despublicar. Portada. mediaUpload A→B→C kind post y pega media.url en imageUrl.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          slug: { type: 'string' },
          originalSlug: { type: 'string' },
          title: { type: 'string' },
          excerptEs: { type: 'string' },
          bodyHtml: { type: 'string' },
          metaTitle: { type: 'object' },
          metaDescription: { type: 'object' },
          imageUrl: { type: 'string' },
          imageAlt: { type: 'string' },
          authorName: { type: 'string' },
          relatedSlugs: { type: 'array', items: { type: 'string' } },
          socialPack: { type: 'object' },
          imageGallery: { type: 'array', items: { type: 'object' } },
          visualBrief: { type: 'object', description: 'Metadata del sistema visual v2: arquetipo, composición, referencias y decisión.' },
          imageMetadata: { type: 'object' }
        },
        required: ['site', 'slug']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_unpublish',
      description: 'Despublica un post (published → draft).',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' }, slug: { type: 'string' } },
        required: ['site', 'slug']
      },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false }
    },
    {
      name: 'blog_delete_post',
      description: 'Elimina un post. Obligatorio confirm=true.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          slug: { type: 'string' },
          confirm: { type: 'boolean' }
        },
        required: ['site', 'slug', 'confirm']
      },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: true }
    },
    {
      name: 'blog_validate_seo',
      description: 'Valida quality gates SEO.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' }, slug: { type: 'string' } },
        required: ['site', 'slug']
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_publish',
      description:
        'Publica o programa desde el workflow nuevo de /app. Después de la confirmación del usuario usa direct=true para no entrar en el flujo legacy de revisión. Con publishAt futuro (YYYY-MM-DD) programa el post.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          slug: { type: 'string' },
          publishAt: {
            type: 'string',
            description: 'YYYY-MM-DD. Si es futuro, programa en vez de publicar ya.'
          },
          direct: {
            type: 'boolean',
            description: 'true después de la confirmación del usuario. Publica directamente desde /app y evita review legacy.'
          },
          ignoreSeo: {
            type: 'boolean',
            description: 'Solo si el usuario confirma publicar aunque existan avisos SEO bloqueantes.'
          }
        },
        required: ['site', 'slug']
      },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false }
    },
    {
      name: 'blog_request_changes',
      description:
        'Compatibilidad histórica. Registra un motivo de cambios en un post antiguo; el workflow nuevo de /app no usa este paso.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          slug: { type: 'string' },
          rejectReason: { type: 'string', description: 'Motivo no vacío para el cliente' }
        },
        required: ['site', 'slug', 'rejectReason']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_schedule_post',
      description:
        'Programa un post para publishAt (YYYY-MM-DD). Usa direct=true tras la confirmación del usuario para dejarlo scheduled y evitar la cola de revisión legacy.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          slug: { type: 'string' },
          publishAt: { type: 'string', description: 'YYYY-MM-DD' },
          direct: { type: 'boolean', description: 'true tras la confirmación del usuario; evita pending_schedule legacy.' },
          ignoreSeo: { type: 'boolean', description: 'Solo si el usuario confirma continuar con avisos SEO bloqueantes.' }
        },
        required: ['site', 'slug', 'publishAt']
      },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false }
    },
    {
      name: 'blog_confirm_schedule',
      description: 'Confirma un post pending_schedule → scheduled. Solo super-admin.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' }, slug: { type: 'string' } },
        required: ['site', 'slug']
      },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
      adminOnly: true
    },
    {
      name: 'blog_cancel_schedule',
      description: 'Cancela una programación pending_schedule o scheduled y devuelve el post a un estado editable.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' }, slug: { type: 'string' } },
        required: ['site', 'slug']
      },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false }
    },
    {
      name: 'blog_list_calendar',
      description:
        'Posts del calendario (pending_schedule, scheduled, published) entre from y to (YYYY-MM-DD).',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' }
        },
        required: ['site']
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_get_seo_context',
      description: 'Keywords y reglas SEO del site.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' } },
        required: ['site']
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_get_brand_context',
      description:
        'Devuelve el contexto general canónico y versionado, pero no reemplaza brand_prepare_image_generation. Para cualquier imagen llama primero a brand_prepare_image_generation y repite con preparationId y referenceIndex para recibir un ImageContent por llamada. Está prohibido escoger, sustituir referencias o usar Pillow; si generationBlocked es true, detén la generación.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' } },
        required: ['site']
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_update_brand_file',
      description:
        'Los miembros reciben el contexto normalizado completo. Los archivos fuente privados quedan en la app para owner/admin.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          file: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['site', 'file', 'content']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_upload_media_file',
      description:
        'Plan A de compatibilidad. Para kind post exige receipt de blog_cover. Para kind social exige receipt, texto final renderizado por content-system/instagram-renderer y formato 4:5 o 3:4. brandPreparationId por sí solo no autoriza la subida.',
      inputSchema: {
        type: 'object',
        $defs: openaiFileDefs(),
        properties: {
          site: { type: 'string' },
          filename: {
            type: 'string',
            description: 'Nombre kebab-case. Portada mi-post.png. Slide {slug}-ig-01.png'
          },
          kind: {
            type: 'string',
            enum: ['post', 'social', 'reference'],
            description: 'post = portada. social = carrusel Instagram. reference = moodboard.'
          },
          alt: { type: 'string' },
          brandPreparationId: { type: 'string' },
          generationReceiptId: { type: 'string', description: 'generationReceiptId emitido por brand_complete_image_generation. Obligatorio para post y social.' },
          brandAssetType: { type: 'string', enum: ['blog_cover', 'instagram_background', 'social_image', 'presentation', 'generic'] },
          brandRoute: { type: 'string', description: 'Ruta devuelta por brand_prepare_image_generation.' },
          textRendered: { type: 'boolean', description: 'Obligatorio para social. Debe ser true.' },
          templateId: { type: 'string', enum: ['editorial', 'impact'] },
          renderedBy: { type: 'string', const: 'content-system/instagram-renderer' },
          textContent: { type: 'object', required: ['headline', 'body'], properties: { headline: { type: 'string', minLength: 1, maxLength: 90 }, body: { type: 'string', minLength: 1, maxLength: 240 } } },
          file: { $ref: '#/$defs/OpenAIFile' }
        },
        required: ['site', 'filename', 'kind', 'file'],
        ...FINAL_IMAGE_RECEIPT_CONDITION
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      _meta: {
        ...connectorFileMeta(),
        'openai/toolInvocation/invoking': 'Subiendo la imagen',
        'openai/toolInvocation/invoked': 'Imagen guardada'
      }
    },
    {
      name: 'blog_open_image_drop',
      description:
        'Compatibilidad. Solo si el host puede hacer HTTP PUT. Para kind post exige receipt. Para kind social exige receipt, texto final renderizado por content-system/instagram-renderer y formato 4:5 o 3:4. El sandbox de ChatGPT no resuelve DNS.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          filename: {
            type: 'string',
            description: 'Nombre kebab-case. Portada mi-post.png. Slide {slug}-ig-01.png'
          },
          kind: {
            type: 'string',
            enum: ['post', 'social', 'reference'],
            description: 'post = portada. social = carrusel Instagram. reference = moodboard.'
          },
          alt: { type: 'string' },
          brandPreparationId: { type: 'string' },
          generationReceiptId: { type: 'string', description: 'Receipt emitido por brand_complete_image_generation. Obligatorio para post y social.' },
          brandAssetType: { type: 'string' },
          brandRoute: { type: 'string' },
          textRendered: { type: 'boolean' },
          templateId: { type: 'string', enum: ['editorial', 'impact'] },
          renderedBy: { type: 'string', const: 'content-system/instagram-renderer' },
          textContent: { type: 'object', required: ['headline', 'body'], properties: { headline: { type: 'string', minLength: 1, maxLength: 90 }, body: { type: 'string', minLength: 1, maxLength: 240 } } }
        },
        required: ['site', 'filename', 'kind'],
        ...FINAL_IMAGE_RECEIPT_CONDITION
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_upload_media',
      description:
        'Plan B/C de compatibilidad. Para kind post exige receipt. Para kind social exige receipt, texto final renderizado por content-system/instagram-renderer y formato 4:5 o 3:4. Pasa contentBase64 o blob. Si el host recorta o rechaza, uploadId + chunkIndex + chunkCount.',
      inputSchema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          site: { type: 'string' },
          filename: {
            type: 'string',
            description: 'kebab-case. Portada mi-post.png. Slide Instagram {slug}-ig-01.png'
          },
          kind: {
            type: 'string',
            enum: ['post', 'social', 'reference'],
            description: 'post = portada. social = carrusel Instagram. reference = moodboard.'
          },
          contentBase64: {
            type: 'string',
            description: 'PNG o JPG en base64. Camino normal. 2-3 MB valen.'
          },
          alt: { type: 'string' },
          brandPreparationId: { type: 'string' },
          generationReceiptId: { type: 'string', description: 'generationReceiptId emitido por brand_complete_image_generation. Obligatorio para post y social.' },
          brandAssetType: { type: 'string' },
          brandRoute: { type: 'string' },
          textRendered: { type: 'boolean' },
          templateId: { type: 'string', enum: ['editorial', 'impact'] },
          renderedBy: { type: 'string', const: 'content-system/instagram-renderer' },
          textContent: { type: 'object', required: ['headline', 'body'], properties: { headline: { type: 'string', minLength: 1, maxLength: 90 }, body: { type: 'string', minLength: 1, maxLength: 240 } } },
          imageUrl: {
            type: 'string',
            description: 'Solo si ya tienes un https público real. No uses /mnt/data.'
          },
          blob: {
            type: 'string',
            description: 'Alias de contentBase64'
          },
          filePath: {
            type: 'string',
            description: 'Solo si el archivo existe en el servidor del CMS. En ChatGPT remoto no existe /mnt/data.'
          },
          uploadId: { type: 'string', description: 'Id de la subida a trozos' },
          chunkIndex: { type: 'string', description: 'Número de trozo desde 0, en texto' },
          chunkCount: { type: 'string', description: 'Total de trozos, en texto' }
        },
        required: ['site', 'filename', 'kind'],
        ...FINAL_IMAGE_RECEIPT_CONDITION
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_import_remote_image',
      description:
        'Compatibilidad para una URL https pública real. Para kind post exige receipt. Para kind social exige receipt, texto final renderizado por content-system/instagram-renderer y formato 4:5 o 3:4. Para archivos del chat usa content_upload_media.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          filename: { type: 'string', description: 'Nombre final, ej. portada.webp o {slug}-ig-01.webp.' },
          imageUrl: {
            type: 'string',
            description: 'URL http(s) pública. Prohibido /mnt/data, sandbox:, file://.'
          },
          alt: { type: 'string' },
          brandPreparationId: { type: 'string' },
          generationReceiptId: { type: 'string', description: 'Receipt emitido por brand_complete_image_generation. Obligatorio para post y social.' },
          brandAssetType: { type: 'string' },
          brandRoute: { type: 'string' },
          textRendered: { type: 'boolean' },
          templateId: { type: 'string', enum: ['editorial', 'impact'] },
          renderedBy: { type: 'string', const: 'content-system/instagram-renderer' },
          textContent: { type: 'object', required: ['headline', 'body'], properties: { headline: { type: 'string', minLength: 1, maxLength: 90 }, body: { type: 'string', minLength: 1, maxLength: 240 } } },
          kind: {
            type: 'string',
            enum: ['post', 'social', 'reference'],
            description: 'post, social o reference'
          }
        },
        required: ['site', 'filename', 'kind', 'imageUrl'],
        ...FINAL_IMAGE_RECEIPT_CONDITION
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_import_brand_zip',
      description:
        'Importa un ZIP de brand kit. Solo super-admin. Para el ZIP grande usa zipUrl https.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          zipUrl: {
            type: 'string',
            description: 'URL http(s) pública del ZIP (preferido)'
          },
          contentBase64: {
            type: 'string',
            description: 'Solo si no hay zipUrl y el archivo es pequeño'
          }
        },
        required: ['site']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      adminOnly: true
    }
  ]

  tools.push(
    { name: 'brand_list', description: 'Lista las marcas v2 visibles para este token. Si devuelve varias, pregunta al usuario cuál quiere usar y pasa site en las siguientes llamadas.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' } } }, annotations: { readOnlyHint: true } },
    { name: 'brand_get_context', description: 'Devuelve el contexto y el catálogo de referencias del brand kit activo en Postgres. La app y el MCP leen exactamente la misma versión, hash y lista de assets.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, siteId: { type: 'string' } } }, annotations: { readOnlyHint: true } },
    {
      name: 'brand_prepare_image_generation',
      description: 'Obligatoria antes de toda generación visual. Devuelve preparationId, versión, hash, dimensiones y las referencias binarias exactas. Entrega una referencia por llamada para evitar errores de transporte, repite con preparationId y referenceIndex hasta completar la lista, y solo entonces genera el archivo final. LinkedIn usa blog_cover 3:2 cuando no se indica assetType; si se indica social_image, respétalo. Después llama content_upload_media con preparationId, channels y assetIndex, e incluye itemId solo si ya existe.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          assetType: { type: 'string', enum: ['blog_cover', 'social_image', 'instagram_story', 'presentation', 'generic'] },
          title: { type: 'string' },
          summary: { type: 'string' },
          topic: { type: 'string' },
          tone: { type: 'string' },
          channel: { type: 'string' },
          expectedAssetCount: { type: 'integer', minimum: 1, maximum: 20, description: 'Cantidad explícita de imágenes finales relacionadas. Usa 1 para una imagen singular y el total de slides para un carrusel.' },
          itemId: { type: 'string' },
          batchId: { type: 'string' },
          preparationId: { type: 'string', description: 'Preparación existente para entregar la siguiente referencia binaria sin crear otra preparación.' },
          referenceIndex: { type: 'integer', minimum: 0, description: 'Índice cero-based de la referencia que se debe entregar en esta llamada.' }
        },
        required: ['site']
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    {
      name: 'brand_complete_image_generation',
      description: 'Emite exclusivamente desde backend un generationReceipt verificable del archivo final. Rechaza preparaciones bloqueadas, vencidas o de otra marca, y exige la lista exacta y ordenada de referencias con sus hashes, además del hash SHA-256 del archivo resultante. Para social exige texto renderizado por content-system/instagram-renderer y formato 4:5 o 3:4. El upload posterior valida también el assetType y las dimensiones reales del archivo. No acepta referencias escogidas por el agente.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          preparationId: { type: 'string' },
          usedReferences: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, filename: { type: 'string' }, attachmentIndex: { type: 'integer' }, sha256: { type: 'string' } }, required: ['id', 'filename', 'attachmentIndex', 'sha256'] } },
          generatedResultId: { type: 'string' },
          generatedFileHash: { type: 'string' },
          assetType: { type: 'string' },
          route: { type: 'string' },
          itemId: { type: 'string' },
          batchId: { type: 'string' },
          channel: { type: 'string' },
          textRendered: { type: 'boolean' },
          templateId: { type: 'string', enum: ['editorial', 'impact'] },
          renderedBy: { type: 'string', const: 'content-system/instagram-renderer' },
          textContent: { type: 'object', required: ['headline', 'body'], properties: { headline: { type: 'string', minLength: 1, maxLength: 90 }, body: { type: 'string', minLength: 1, maxLength: 240 } } }
        },
        required: ['site', 'preparationId', 'usedReferences', 'generatedResultId', 'generatedFileHash']
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    {
      name: 'brand_update_file',
      description: 'Actualiza un archivo del brand kit activo y publica una versión nueva. Solo owner o admin del espacio. Si el rol no alcanza, responde por qué. No la uses para generar imágenes.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          file: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['site', 'file', 'content']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'brand_register_generation',
      description: 'Alias de compatibilidad de brand_complete_image_generation. Solo el backend puede emitir el generationReceipt y siempre aplica la misma comprobación estricta de referencias, versión y hash.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          preparationId: { type: 'string' },
          usedReferences: { type: 'array', items: { type: 'object' } },
          generatedResultId: { type: 'string' },
          generatedFileHash: { type: 'string' },
          assetType: { type: 'string' },
          route: { type: 'string' },
          itemId: { type: 'string' },
          batchId: { type: 'string' },
          channel: { type: 'string' },
          textRendered: { type: 'boolean' },
          templateId: { type: 'string', enum: ['editorial', 'impact'] },
          renderedBy: { type: 'string', const: 'content-system/instagram-renderer' },
          textContent: { type: 'object', required: ['headline', 'body'], properties: { headline: { type: 'string', minLength: 1, maxLength: 90 }, body: { type: 'string', minLength: 1, maxLength: 240 } } }
        },
        required: ['site', 'preparationId', 'usedReferences', 'generatedResultId', 'generatedFileHash']
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    {
      name: 'content_upload_media',
      description: 'Sube el archivo final generado por ChatGPT, comprueba marca, preparación, formato y dimensiones, conserva exactamente sus bytes y lo asocia a las variantes indicadas si itemId ya existe. Sin itemId lo guarda como medio pendiente para asociarlo después.',
      inputSchema: {
        type: 'object',
        $defs: openaiFileDefs(),
        additionalProperties: true,
        properties: {
          workspaceId: { type: 'string' },
          site: { type: 'string' },
          filename: { type: 'string' },
          kind: { type: 'string', enum: ['post', 'social', 'reference'] },
          alt: { type: 'string' },
          file: { $ref: '#/$defs/OpenAIFile' },
          contentBase64: { type: 'string' },
          blob: { type: 'string' },
          imageUrl: { type: 'string' },
          filePath: { type: 'string' },
          uploadId: { type: 'string' },
          chunkIndex: { type: 'string' },
          chunkCount: { type: 'string' },
          preparationId: { type: 'string' },
          itemId: { type: 'string' },
          channels: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: ['blog', 'instagram', 'instagram_story', 'linkedin', 'x', 'video', 'substack'] } },
          assetIndex: { type: 'integer', minimum: 0, maximum: 19 }
        },
        required: ['site', 'filename', 'kind'],
        allOf: [{ if: { properties: { kind: { enum: ['post', 'social'] } } }, then: { required: ['preparationId', 'channels', 'assetIndex'] } }]
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: {
        ...connectorFileMeta(),
        'openai/toolInvocation/invoking': 'Subiendo imagen v2',
        'openai/toolInvocation/invoked': 'Imagen v2 guardada'
      }
    },
    { name: 'content_list_plans', description: 'Lista las campañas de contenido de una marca, con progreso, canales y publicaciones.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, status: { type: 'string' }, channel: { type: 'string', enum: ['blog', 'instagram', 'instagram_story', 'linkedin', 'x', 'video', 'substack'] }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } } }, annotations: { readOnlyHint: true } },
    { name: 'content_list_items', description: 'Lista publicaciones v2, incluyendo las generadas o pendientes de revisión aunque todavía no estén publicadas.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, batchId: { type: 'string' }, status: { type: 'string' }, channel: { type: 'string', enum: ['blog', 'instagram', 'instagram_story', 'linkedin', 'x', 'video', 'substack'] }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500 } } }, annotations: { readOnlyHint: true } },
    { name: 'content_list_calendar', description: 'Lista el calendario v2 con publicaciones programadas, sincronizando, publicadas o con error.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 1000 } } }, annotations: { readOnlyHint: true } },
    { name: 'content_create_batch', description: 'Guarda publicaciones en una campaña. Antes lista las campañas activas: si existe alguna, pregunta al usuario si quiere reutilizarla con batchId o crear otra con createNewCampaign=true. Conserva literalmente las variantes recibidas.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, title: { type: 'string', description: 'Título visible de la campaña cuando se crea una nueva.' }, items: { type: 'array', minItems: 1, items: { type: 'object', properties: { title: { type: 'string', maxLength: 90, description: 'Título editorial breve. No incluyas el enfoque, contexto ni el brief.' }, brief: { type: 'string', minLength: 1, maxLength: 500 }, variants: { type: 'object', minProperties: 1, additionalProperties: { type: 'object' } } }, required: ['variants'], additionalProperties: false } }, batchId: { type: 'string', description: 'Identificador de una campaña existente elegida por el usuario.' }, createNewCampaign: { type: 'boolean', description: 'Usa true solo después de que el usuario confirme que quiere una campaña nueva.' }, channels: { type: 'array', items: { type: 'string', enum: ['blog', 'instagram', 'instagram_story', 'linkedin', 'x', 'video', 'substack'] } }, brandKitVersionId: { type: 'string' }, idempotencyKey: { type: 'string', maxLength: 300 }, metadata: { type: 'object' } }, required: ['items'] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'content_get_batch', description: 'Obtiene el progreso, las publicaciones y las variantes de una campaña.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, batchId: { type: 'string' } }, required: ['batchId'] }, annotations: { readOnlyHint: true } },
    { name: 'content_update_item', description: 'Guarda sin reescritura el body recibido. Con readyForReview=true valida que todas las variantes y medios del item estén completos y cambia el estado a generated.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, itemId: { type: 'string' }, topic: { type: 'string' }, channel: { type: 'string', enum: ['blog', 'instagram', 'instagram_story', 'linkedin', 'x', 'video', 'substack'] }, body: { type: 'object' }, visualBrief: { type: 'object' }, mediaAssetIds: { type: 'array', items: { type: 'string' } }, readyForReview: { type: 'boolean' } }, required: ['itemId'] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'content_approve', description: 'Aprueba un item o todos los items de un batch.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, itemId: { type: 'string' }, batchId: { type: 'string' } }, oneOf: [{ required: ['itemId'] }, { required: ['batchId'] }] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'content_schedule', description: 'Programa variantes aprobadas por canal. Blog publica mediante Coolify; Instagram, LinkedIn y Story usan la conexión Buffer configurada.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, itemId: { type: 'string' }, batchId: { type: 'string' }, channels: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: ['blog', 'instagram', 'instagram_story', 'linkedin', 'x', 'video', 'substack'] } }, publicationDate: { type: 'string' }, timezone: { type: 'string' } }, required: ['channels', 'publicationDate'], oneOf: [{ required: ['itemId'] }, { required: ['batchId'] }] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'content_cancel', description: 'Cancela una publicación o campaña que todavía no se publicó.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, itemId: { type: 'string' }, batchId: { type: 'string' } }, oneOf: [{ required: ['itemId'] }, { required: ['batchId'] }] }, annotations: { readOnlyHint: false, destructiveHint: false } }
  )

  return tools
    .filter((t) => !CMS_AI_TOOLS.has(t.name))
    .filter((t) => !['brand_complete_image_generation', 'brand_register_generation'].includes(t.name))
    .filter((t) => !LEGACY_CONTENT_TOOLS.has(t.name))
    .filter((t) => !/^(blog|social)_/.test(t.name))
    .filter((t) => !(t.adminOnly && auth?.role !== 'admin'))
    .map(({ adminOnly, ...rest }) => rest)
}

/**
 * @param {{ role: 'admin' } | { role: 'site', site: string }} [auth]
 */
export function createMcpServer(auth = { role: 'admin' }, { restrictMutations = false, source = 'mcp' } = {}) {
  const server = new Server(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: 'Escarlet CMS v2' },
    { capabilities: { tools: { listChanged: true }, resources: {} }, instructions: MCP_INSTRUCTIONS }
  )

  server.setRequestHandler('tools/list', async () => ({
    tools: buildToolList(auth)
  }))

  server.setRequestHandler('resources/list', async () => {
    const sites = availableToolSites(auth)
    const allowedFiles = new Set(brandFilesForAuth(auth).filter((file) => !SECRET_BRAND_FILES.includes(file)))
    const resources = []
    for (const site of sites) {
      resources.push({
        uri: `brand://${site}/context`,
        name: `${site} normalized brand context`,
        mimeType: 'application/json'
      })
      for (const key of Object.keys(RESOURCE_MAP)) {
        const file = RESOURCE_MAP[key]
        if (!file) continue
        if (!allowedFiles.has(file)) continue
        const mimeType = file.endsWith('.json') ? 'application/json' : 'text/markdown'
        resources.push({
          uri: `brand://${site}/${key}`,
          name: `${site} ${key}`,
          mimeType
        })
      }
    }
    return { resources }
  })

  server.setRequestHandler('resources/read', async (request) => {
    const match = request.params.uri.match(/^brand:\/\/([^/]+)\/([^/]+)$/)
    if (!match) throw new Error(`URI desconocida: ${request.params.uri}`)
    const [, site, key] = match
    assertSiteAccess(auth, site)
    if (key === 'context') {
      const context = await cms.getBrandContext(site, { auth })
      return { contents: [{ uri: request.params.uri, mimeType: 'application/json', text: JSON.stringify(context) }] }
    }
    const file = RESOURCE_MAP[key]
    if (!file) throw new Error(`Recurso desconocido: ${key}`)
    if (SECRET_BRAND_FILES.includes(file)) throw Object.assign(new Error('Los archivos fuente privados solo se consultan desde la app.'), { status: 403 })
    const data = await cms.getBrandFile(site, file, { auth })
    const mimeType = file.endsWith('.json') ? 'application/json' : 'text/markdown'
    let text = data.content || ''
    if (file === 'AGENT.md') {
      text = withMediaUploadContract(text)
    }
    return {
      contents: [{ uri: request.params.uri, mimeType, text }]
    }
  })

  server.setRequestHandler('tools/call', async (request) => withGenerationPolicy({ externalMcp: !['app', 'chat'].includes(source), auth }, async () => {
    const { name, arguments: args = {} } = request.params
    try {
      let scopedAuth = auth
      if (CMS_AI_TOOLS.has(name)) {
        assertCmsAiAllowed(auth)
        throw Object.assign(new Error('Usa el servicio interno de generación de /app, no una herramienta MCP.'), { status: 403 })
      }
      if (LEGACY_CONTENT_TOOLS.has(name)) {
        const replacement = LEGACY_CONTENT_REPLACEMENTS[name] || 'content_list_items'
        throw Object.assign(
          new Error(`La tool ${name} fue retirada del contrato v2. Usa ${replacement}. No es un problema de permisos.`),
          {
            status: 410,
            code: 'legacy_tool_disabled',
            extra: {
              code: 'legacy_tool_disabled',
              tool: name,
              replacement,
              reconnect: 'Actualiza o reconecta el servidor MCP para cargar las tools v2.'
            }
          }
        )
      }
      // Every transport shares the same argument boundary. The optional
      // mutation restriction is enabled only for app/chat bridges; the
      // authenticated external MCP transport keeps its explicit workflow.
      assertSafeToolArguments(name, args, { source })
      if (restrictMutations) {
        const workflow = getWorkflowFlags(readDb())
        assertChatToolAllowed(name, args, { assistantBrandKitToolsEnabled: workflow.assistantBrandKitToolsEnabled })
      }
      const tool = buildToolList(auth).find((t) => t.name === name)
      if (!tool) throw Object.assign(new Error('Herramienta no disponible para este acceso.'), { status: 403 })
      if (MUTATING_SITE_TOOLS.has(name) && auth?.role === 'viewer') {
        throw Object.assign(new Error('El rol viewer solo puede consultar contenido.'), { status: 403 })
      }
      if (MUTATING_SITE_TOOLS.has(name) && !V2_CONTENT_TOOLS.has(name) && isPostgresConfigured()) {
        const site = resolveToolSite(auth, args)
        const scope = await resolveContentScope(auth, { site })
        scopedAuth = {
          ...auth,
          role: scope.role,
          site: scope.siteHandle,
          sites: [scope.siteHandle],
          workspaceId: scope.workspaceId,
          workspaceRole: scope.workspaceRole,
          brandRole: scope.brandRole
        }
        if (scope.role === 'viewer') throw Object.assign(new Error('El rol viewer solo puede consultar contenido.'), { status: 403 })
      }
      if (V2_CONTENT_TOOLS.has(name)) {
        const explicitSite = String(args.siteId || args.site || '').trim()
        const knownSites = availableToolSites(auth)
        if (!explicitSite && knownSites.length > 1) throw brandSelectionRequired(auth, knownSites)
        if (!V2_READ_ONLY_TOOLS.has(name) && auth?.role === 'viewer') {
          throw Object.assign(new Error('El rol viewer solo puede consultar contenido.'), { status: 403 })
        }
        if (isPostgresConfigured()) {
          const scope = await resolveContentScope(auth, args)
          scopedAuth = {
            ...auth,
            role: scope.role,
            site: scope.siteHandle,
            sites: [scope.siteHandle],
            workspaceId: scope.workspaceId,
            workspaceRole: scope.workspaceRole,
            brandRole: scope.brandRole
          }
          if (!V2_READ_ONLY_TOOLS.has(name) && scope.role === 'viewer') {
            throw Object.assign(new Error('El rol viewer solo puede consultar contenido.'), { status: 403 })
          }
        }
      }
      switch (name) {
        case 'brand_list': {
          if (!isPostgresConfigured()) throw Object.assign(new Error('Las marcas v2 requieren Postgres.'), { status: 503, code: 'postgres_required' })
          if (auth?.role === 'admin' && !args.workspaceId && !auth?.workspaceId && !auth?.userId) throw Object.assign(new Error('Para listar marcas con un token administrador pasa workspaceId.'), { status: 400, code: 'workspace_required' })
          if (auth?.role !== 'admin' && !auth?.userId) throw Object.assign(new Error('Se requiere un token personal de usuario para consultar marcas v2.'), { status: 401, code: 'user_token_required' })
          await runCoreMigrations()
          const context = await resolveWorkspaceContext({ userId: auth?.userId || undefined, workspaceId: args.workspaceId || auth?.workspaceId || undefined })
          return textResult({
            workspace: { id: context.workspaceId, name: context.workspaceName },
            brands: context.sites.map((brand) => ({ id: brand.id, handle: brand.handle, name: brand.name, role: brand.role })),
            handles: context.sites.map((brand) => brand.handle).sort(),
            selectionRequired: context.sites.length > 1
          })
        }
        case 'brand_prepare_image_generation': {
          const site = resolveToolSite(auth, args)
          let scope = null
          if (isPostgresConfigured()) scope = await resolveContentScope(auth, { ...args, site })
          if (!scope) throw Object.assign(new Error('La preparación visual requiere Postgres.'), { status: 503, code: 'postgres_required' })
          if (args.preparationId) {
            const preparation = await getImagePreparation(args.preparationId)
            if (!preparation) throw Object.assign(new Error('No existe la preparación visual.'), { status: 409, code: 'BRAND_PREPARATION_REQUIRED' })
            if (preparation.site !== scope.siteHandle || preparation.workspaceId !== scope.workspaceId || (preparation.siteId && preparation.siteId !== scope.siteId)) {
              throw Object.assign(new Error('La preparación no pertenece a esta marca.'), { status: 409, code: 'SITE_MISMATCH' })
            }
            if (preparation.expiresAt && new Date(preparation.expiresAt).getTime() <= Date.now()) throw Object.assign(new Error('La preparación visual ha expirado.'), { status: 409, code: 'BRAND_PREPARATION_EXPIRED' })
            const activeBrandKit = await getActiveBrandKit({ workspaceId: scope.workspaceId, siteId: scope.siteId })
            const canonicalSnapshot = loadActiveBrandKitSnapshot(scope.siteHandle, { manifest: activeBrandKit.manifest, assets: activeBrandKit.assets, brandKitVersionId: activeBrandKit.id, version: activeBrandKit.version })
            if (preparation.brandKitVersionId !== activeBrandKit.id || preparation.brandKitSnapshotHash !== canonicalSnapshot.snapshotHash) throw Object.assign(new Error('El brand kit cambió desde la preparación. Vuelve a preparar la imagen.'), { status: 409, code: 'BRAND_VERSION_MISMATCH' })
            return preparedImageResult(preparedPayloadFromStoredPreparation(preparation, canonicalSnapshot), { referenceIndex: args.referenceIndex })
          }
          const activeBrandKit = await getActiveBrandKit({ workspaceId: scope.workspaceId, siteId: scope.siteId })
          const canonicalSnapshot = loadActiveBrandKitSnapshot(scope.siteHandle, { manifest: activeBrandKit.manifest, assets: activeBrandKit.assets, brandKitVersionId: activeBrandKit.id, version: activeBrandKit.version })
          const prepared = prepareImageGeneration(scope.siteHandle, normalizeImagePreparationArgs(args), { canonicalSnapshot })
          await persistImagePreparation(prepared, {
            workspaceId: scope?.workspaceId || auth?.workspaceId,
            siteId: scope?.siteId,
            itemId: args.itemId,
            batchId: args.batchId,
            channel: args.channel
          })
          return preparedImageResult(prepared, { referenceIndex: args.referenceIndex })
        }
        case 'brand_update_file': {
          const site = resolveToolSite(auth, args)
          let writeAuth = auth
          let scope = null
          if (isPostgresConfigured()) {
            scope = await resolveContentScope(auth, { ...args, site })
            writeAuth = {
              ...auth,
              role: scope.role,
              site: scope.siteHandle,
              sites: [scope.siteHandle],
              workspaceId: scope.workspaceId,
              workspaceRole: scope.workspaceRole,
              brandRole: scope.brandRole
            }
          }
          const access = assertBrandKitWritable(writeAuth)
          const updated = await cms.updateBrandFile(site, args.file, args.content, { auth: writeAuth })
          const published = scope
            ? await publishBrandKitFile({
                workspaceId: scope.workspaceId,
                siteId: scope.siteId,
                userId: auth.userId,
                role: scope.role,
                file: updated.file,
                content: args.content
              })
            : null
          return textResult({
            ...updated,
            writesBrandKit: true,
            currentRole: access.currentRole,
            brandKitVersionId: published?.id || null,
            nextStep: 'Vuelve a llamar brand_get_context si necesitas el snapshot actualizado.'
          })
        }
        case 'content_upload_media': {
          const site = resolveToolSite(auth, args)
          const kind = String(args.kind || 'post').toLowerCase()
          const scope = await resolveContentScope(auth, { ...args, site })
          const brandGroundingOverride = ['post', 'social'].includes(kind) ? await preparedUploadGrounding(site, scope, args) : null
          const uploaded = await cms.uploadMedia({
            ...args,
            site,
            kind,
            brandGroundingOverride,
            requireBrandGrounding: ['post', 'social'].includes(kind),
            membershipUserId: scopedAuth.userId || ''
          })
          if (uploaded?.awaitingChunks) return textResult(uploaded)
          const asset = await registerContentMedia({
            workspaceId: scope.workspaceId,
            siteId: scope.siteId,
            userId: auth.userId,
            role: scope.role,
            media: uploaded.media,
            brandGrounding: uploaded.media?.brandGrounding || null
          })
          const attachment = ['post', 'social'].includes(kind)
            ? await attachContentMedia({ workspaceId: scope.workspaceId, siteId: scope.siteId, itemId: args.itemId, userId: auth.userId, role: scope.role, mediaAssetId: asset.id, channels: args.channels, assetIndex: args.assetIndex })
            : null
          const { suggestedPostPatch, suggestedTool, nextStep, reviewHint, ...safeUpload } = uploaded
          return textResult({
            ...safeUpload,
            mediaAsset: asset,
            mediaAssetId: asset.id,
            attachment,
            nextStep: kind === 'reference'
              ? 'Referencia guardada en el almacenamiento de la marca.'
              : attachment
                ? 'Actualiza el mismo itemId con content_update_item y readyForReview=true cuando todas las variantes y medios estén completos.'
                : `Medio guardado sin asociar. Cuando exista el item, usa content_update_item con mediaAssetIds: ["${asset.id}"].`,
            suggestedTool: kind === 'reference' ? null : 'content_update_item',
            reviewHint: kind === 'reference' ? 'Referencia guardada.' : attachment ? 'Medio asociado al item y a sus variantes.' : 'Medio guardado, pendiente de asociar a un item.'
          })
        }
        case 'brand_get_context': {
          if (!isPostgresConfigured()) throw Object.assign(new Error('El brand kit canónico requiere Postgres.'), { status: 503, code: 'postgres_required' })
          const scope = await resolveContentScope(auth, args)
          const brand = scope.sites.find((entry) => entry.id === scope.siteId) || scope.sites[0]
          const [channels, brandCapabilities, connections, activeBrandKit] = await Promise.all([
            listSiteChannels({ workspaceId: scope.workspaceId, siteId: scope.siteId }),
            listBrandCapabilities({ workspaceId: scope.workspaceId, siteId: scope.siteId }),
            listBrandConnections({ workspaceId: scope.workspaceId, siteId: scope.siteId }),
            getActiveBrandKit({ workspaceId: scope.workspaceId, siteId: scope.siteId })
          ])
          const brandKit = await cms.getBrandContext(scope.siteHandle, {
            auth: scopedAuth,
            brandCapabilities,
            canonicalManifest: activeBrandKit?.manifest,
            canonicalAssets: activeBrandKit?.assets,
            brandKitVersionId: activeBrandKit?.id || undefined,
            brandKitVersion: activeBrandKit ? { id: activeBrandKit.id, version: activeBrandKit.version, status: activeBrandKit.status } : undefined
          })
          const canReadVisualBrandAssets = brandKit.brandAccessLevel !== 'none'
          const visibleAssets = Array.isArray(activeBrandKit?.assets)
            ? activeBrandKit.assets.filter((asset) => asset.visibility === 'public' || (canReadVisualBrandAssets && (scopedAuth?.role === 'admin' || (asset.visibility === 'role_limited' && ['owner', 'admin', 'editor', 'author', 'client', 'viewer'].includes(scopedAuth?.role)))))
            : []
          brandKit.assets = visibleAssets.map((asset) => ({
            id: asset.id,
            filename: asset.name,
            kind: 'reference',
            publicUrl: asset.publicUrl || null,
            contentType: asset.contentType || null,
            sizeBytes: asset.sizeBytes || null,
            sha256: asset.sha256 || null,
            visibility: asset.visibility || 'private',
            metadata: asset.metadata && typeof asset.metadata === 'object'
              ? { alt: String(asset.metadata.alt || '') }
              : {}
          }))
          const declaredCapabilities = Array.isArray(auth?.capabilities) ? auth.capabilities.filter((capability) => capability !== 'brand_kit_access') : []
          const effectiveBrandAccess = brandKit.brandCapabilityEffective === true
          brandKit.brandCapabilities = { ...brandCapabilities }
          return brandContextResult({
            workspace: { id: scope.workspaceId, name: scope.workspaceName || 'Espacio' },
            brand: { id: brand?.id || scope.siteId, handle: brand?.handle || scope.siteHandle, name: brand?.name || scope.siteHandle },
            role: scope.role,
            capabilities: declaredCapabilities,
            declaredCapabilities,
            effectiveCapabilities: declaredCapabilities,
            brandCapabilities,
            brandAccessLevel: brandKit.brandAccessLevel,
            grantedBrandResources: brandKit.grantedBrandResources || [],
            deniedBrandResources: brandKit.deniedBrandResources || [],
            denialReasons: brandKit.denialReasons || {},
            brandKitVersionId: brandKit.brandKitVersionId || activeBrandKit?.id || null,
            ...normalizedBrandFields(brandKit),
            visualContext: brandKit.visualContext,
            referenceImages: brandKit.referenceImages || [],
            files: brandKit.files || {},
            channels,
            connections,
            brandKit
          })
        }
        case 'content_create_batch': {
          const scope = await resolveContentScope(auth, args)
          if (!args.batchId && args.createNewCampaign !== true) {
            const activeCampaigns = await listContentPlans({ workspaceId: scope.workspaceId, siteId: scope.siteId, status: ['draft', 'generated', 'needs_review', 'approved', 'scheduled'], limit: 20 })
            if (activeCampaigns.length) throw Object.assign(new Error('Ya existen campañas activas para esta marca. Elige una o confirma la creación de una campaña nueva.'), { status: 409, code: 'CONTENT_PLAN_SELECTION_REQUIRED', extra: { campaigns: activeCampaigns, askUser: '¿Quieres guardar estas publicaciones en una campaña existente o crear una campaña nueva?' } })
          }
          const result = await createContentBatch({ workspaceId: scope.workspaceId, siteId: scope.siteId, userId: auth.userId || null, role: scope.role, title: args.title, topics: args.topics, items: args.items, batchId: args.batchId, channels: args.channels, brandKitVersionId: args.brandKitVersionId, metadata: args.metadata, idempotencyKey: args.idempotencyKey })
          return textResult(result)
        }
        case 'content_list_plans': {
          const scope = await resolveContentScope(auth, args)
          return textResult({
            site: { id: scope.siteId, handle: scope.siteHandle, name: scope.sites.find((entry) => entry.id === scope.siteId)?.name || scope.siteHandle },
            plans: await listContentPlans({ workspaceId: scope.workspaceId, siteId: scope.siteId, status: args.status, channel: args.channel, query: args.query, limit: args.limit })
          })
        }
        case 'content_list_items': {
          const scope = await resolveContentScope(auth, args)
          return textResult({
            site: { id: scope.siteId, handle: scope.siteHandle, name: scope.sites.find((entry) => entry.id === scope.siteId)?.name || scope.siteHandle },
            items: await listContentItems({ workspaceId: scope.workspaceId, siteId: scope.siteId, batchId: args.batchId, status: args.status, channel: args.channel, query: args.query, limit: args.limit })
          })
        }
        case 'content_list_calendar': {
          const scope = await resolveContentScope(auth, args)
          return textResult({
            site: { id: scope.siteId, handle: scope.siteHandle, name: scope.sites.find((entry) => entry.id === scope.siteId)?.name || scope.siteHandle },
            entries: await listScheduledContent({ workspaceId: scope.workspaceId, siteId: scope.siteId, from: args.from, to: args.to, limit: args.limit })
          })
        }
        case 'content_get_batch': {
          const scope = await resolveContentScope(auth, args)
          return textResult(await getContentBatch({ workspaceId: scope.workspaceId, siteId: scope.siteId, batchId: args.batchId }))
        }
        case 'content_update_item': {
          const scope = await resolveContentScope(auth, args)
          return textResult(await updateContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId, itemId: args.itemId, userId: auth.userId, role: scope.role, topic: args.topic, body: args.body, channel: args.channel, visualBrief: args.visualBrief, mediaAssetIds: args.mediaAssetIds, readyForReview: args.readyForReview }))
        }
        case 'content_approve': {
          const scope = await resolveContentScope(auth, args)
          return textResult(args.batchId
            ? await approveContentBatch({ workspaceId: scope.workspaceId, siteId: scope.siteId, batchId: args.batchId, userId: auth.userId, role: scope.role })
            : await approveContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId, itemId: args.itemId, userId: auth.userId, role: scope.role }))
        }
        case 'content_schedule': {
          const scope = await resolveContentScope(auth, args)
          return textResult(args.batchId
            ? await scheduleContentBatch({ workspaceId: scope.workspaceId, siteId: scope.siteId, batchId: args.batchId, userId: auth.userId, role: scope.role, channels: args.channels, publicationDate: args.publicationDate, timezone: args.timezone })
            : await scheduleContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId, itemId: args.itemId, userId: auth.userId, role: scope.role, channels: args.channels, publicationDate: args.publicationDate, timezone: args.timezone }))
        }
        case 'content_cancel': {
          const scope = await resolveContentScope(auth, args)
          return textResult(args.batchId
            ? await cancelContentBatch({ workspaceId: scope.workspaceId, siteId: scope.siteId, batchId: args.batchId, userId: auth.userId, role: scope.role })
            : await cancelContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId, itemId: args.itemId, userId: auth.userId, role: scope.role }))
        }
        case 'blog_list_authors': {
          const site = resolveToolSite(auth, args)
          return textResult({ authors: listSiteAuthors({ site, requesterId: scopedAuth.userId, requesterRole: scopedAuth.role }) })
        }
        case 'social_save_pack': {
          const site = resolveToolSite(auth, args)
          return textResult({
            pack: saveStandaloneSocialPack({
              ...args,
              site,
              actorId: scopedAuth.userId || scopedAuth.email || scopedAuth.role
            })
          })
        }
        case 'social_list_packs': {
          const site = resolveToolSite(auth, args)
          return textResult({ site, packs: listStandaloneSocialPacks(site) })
        }
        case 'social_get_pack': {
          const site = resolveToolSite(auth, args)
          const pack = getStandaloneSocialPack(site, args.id)
          if (!pack) throw Object.assign(new Error('Social Pack no encontrado.'), { status: 404 })
          return textResult({ pack })
        }
        case 'blog_save_social_pack': {
          const site = resolveToolSite(auth, args)
          if (!args.socialPack || typeof args.socialPack !== 'object' || Array.isArray(args.socialPack)) throw Object.assign(new Error('Falta socialPack.'), { status: 400 })
          return textResult(await cms.updatePost({ site, slug: args.slug, socialPack: args.socialPack, keepPublished: true, direct: true, membershipUserId: scopedAuth.userId || '' }))
        }
        case 'blog_list_sites': {
          const all = await cms.listSites()
          const allowed = new Set(availableToolSites(auth))
          return textResult({
            sites: (all.sites || []).filter((s) => allowed.has(s.handle || s.id)),
            handles: [...allowed].sort(),
            role: scopedAuth.role
          })
        }
        case 'blog_get_onboarding': {
          const { getOnboardingPlaybook } = await import('../lib/onboarding.mjs')
          const handle = resolveToolSite(auth, args)
          const config = loadSiteConfig(handle)
          if (isSocialMediaOnlySite(config)) {
            return textResult({
              site: { handle, name: args.name || config?.name, domain: args.domain || config?.domain },
              socialPackOnly: true,
              message: 'Este sitio usa únicamente Social Pack. No hay flujo de posts de blog.'
            })
          }
          const base = await cms.getOnboarding(handle)
          return textResult(
            getOnboardingPlaybook({
              handle,
              name: args.name || base.site?.name,
              domain: args.domain || base.site?.domain,
              cmsUrl: process.env.CMS_PUBLIC_URL
            })
          )
        }
        case 'blog_get_workflow': {
          const site = resolveToolSite(auth, args)
          const mode = args.mode === 'guided' ? 'guided' : args.mode === 'easy' ? 'easy' : 'choose'
          const workflowDb = readDb()
          const cmsAiEnabled = isCmsAiEnabled({ db: workflowDb })
          const workflow = getWorkflowFlags(workflowDb)
          return textResult(workflowPayload({
            site, mode, enabled: true, generationEngine: 'chatgpt', cmsAiAllowed: false,
            assistantEnabled: cmsAiEnabled && workflow.assistantEnabled,
            blogWizardEnabled: cmsAiEnabled && workflow.blogWizardEnabled,
            appBaseUrl: appUrl('/'),
            routes: { preview: appUrl('/preview/{slug}'), posts: `${appUrl('/posts')}?site=${encodeURIComponent(site)}` },
            askUser: '¿Prefieres el flujo simple o revisar e iterar el borrador con el flujo guiado?',
            steps: ['Consulta blog_get_brand_context y blog_list_authors.', 'Genera en ChatGPT textos e imágenes respetando el brand kit.', 'Crea con blog_create_draft, sube los medios y completa los campos con blog_update_post.', 'En guided entrega appPreviewUrl y aplica las correcciones.', 'Solicita confirmación y usa blog_publish o blog_schedule_post.', 'Solo si se solicita, genera en ChatGPT el Social Pack y guárdalo con blog_save_social_pack.'],
            modes: { easy: { steps: ['Genera todo en ChatGPT', 'Guarda medios y campos', 'Confirma y publica con direct=true'] }, guided: { steps: ['Guarda el borrador', 'Revisa en /app', 'Publica con direct=true'] } },
            appUrl: `${appUrl('/posts')}?site=${encodeURIComponent(site)}`,
            rule: 'Nunca llames APIs de IA del CMS. Si no puedes transferir una imagen, conserva el borrador y pide carga manual.'
          }, source))
        }
        case 'blog_create_site':
          assertSuperAdmin(auth)
          return textResult(await cms.createSiteRecord(args))
        case 'blog_list_posts': {
          const site = resolveToolSite(auth, args)
          const result = await cms.listPosts(site, args.status)
          return textResult({ ...result, posts: result.posts.filter((p) => canReadPost(p, scopedAuth, site)) })
        }
        case 'blog_get_post': {
          const site = resolveToolSite(auth, args)
          return textResult(workflowPayload({ ...await cms.getPost(site, args.slug), appPreviewUrl: `${appUrl(`/preview/${encodeURIComponent(args.slug)}`)}?site=${encodeURIComponent(site)}` }, source))
        }
        case 'blog_get_quota': {
          const site = resolveToolSite(auth, args)
          return textResult(cms.getQuotaSnapshot(site, { userId: auth.userId || '' }))
        }
        case 'blog_create_draft': {
          const site = resolveToolSite(auth, args)
          return textResult(
            await cms.createDraft({
              ...safePostFields(args, scopedAuth, site),
              site,
              ownerId: scopedAuth.userId || '',
              membershipUserId: scopedAuth.userId || '',
              contentSource: args.contentSource || (scopedAuth.role === 'client' ? 'client' : 'agency')
            })
          )
        }
        case 'blog_update_post': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.updatePost({ ...safePostFields(args, scopedAuth, site), site, direct: true, keepPublished: true, membershipUserId: scopedAuth.userId || '' }))
        }
        case 'blog_unpublish': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.unpublishPost(site, args.slug, { membershipUserId: scopedAuth.userId || '' }))
        }
        case 'blog_delete_post': {
          const site = resolveToolSite(auth, args)
          if (args.confirm !== true) {
            throw Object.assign(new Error('Para eliminar, pasa confirm: true'), { status: 400 })
          }
          return textResult(await cms.deletePost(site, args.slug, { membershipUserId: scopedAuth.userId || '' }))
        }
        case 'blog_validate_seo': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.validateSeo(site, args.slug))
        }
        case 'blog_publish': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.publishPost(site, args.slug, {
            publishAt: args.publishAt,
            direct: directWorkflowPublish(args, source),
            ignoreSeo: args.ignoreSeo === true,
            membershipUserId: scopedAuth.userId || ''
          }))
        }
        case 'blog_request_changes': {
          const site = resolveToolSite(auth, args)
          return textResult(
            await cms.requestPostChanges(site, args.slug, {
              rejectReason: args.rejectReason,
              actor: { role: scopedAuth.role }
            })
          )
        }
        case 'blog_schedule_post': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.schedulePostForDate(site, args.slug, args.publishAt, {
            direct: directWorkflowPublish(args, source),
            ignoreSeo: args.ignoreSeo === true,
            membershipUserId: scopedAuth.userId || ''
          }))
        }
        case 'blog_confirm_schedule': {
          assertSuperAdmin(auth)
          const site = resolveToolSite(auth, args)
          return textResult(await cms.confirmSchedule(site, args.slug, { membershipUserId: scopedAuth.userId || '' }))
        }
        case 'blog_cancel_schedule': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.cancelSchedule(site, args.slug, { membershipUserId: scopedAuth.userId || '' }))
        }
        case 'blog_list_calendar': {
          const site = resolveToolSite(auth, args)
          const result = await cms.listCalendarPosts(site, args.from, args.to)
          return textResult({ ...result, posts: result.posts.filter((p) => canReadPost(p, scopedAuth, site)) })
        }
        case 'blog_get_seo_context': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.getSeoContext(site))
        }
        case 'blog_get_brand_context': {
          const site = resolveToolSite(auth, args)
          return brandContextResult(await cms.getBrandContext(site, { auth: scopedAuth }))
        }
        case 'blog_update_brand_file': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.updateBrandFile(site, args.file, args.content, { auth: scopedAuth }))
        }
        case 'blog_import_brand_zip': {
          assertSuperAdmin(auth)
          const site = resolveToolSite(auth, args)
          if (!args.zipUrl && !args.contentBase64) {
            throw Object.assign(new Error('Pasa zipUrl (preferido) o contentBase64'), { status: 400 })
          }
          const imported = await cms.importBrandZip(site, args, { auth })
          if (isPostgresConfigured()) {
            const scope = await resolveContentScope(auth, { site })
            const version = await createBrandKitVersion({ workspaceId: scope.workspaceId, siteId: scope.siteId, userId: auth.userId, role: scope.role, manifest: imported.brand?.files || {}, status: 'published' })
            const origin = cmsOrigin()
            // Reference images are visual guidance, not private credentials.
            // Keep them scoped to the brand and readable by editors through
            // the role-limited asset policy.
            const assets = (imported.importedImages || []).map((name) => ({ name, storageKey: `media/${site}/reference/${name}`, publicUrl: `${origin}/media/${site}/reference/${encodeURIComponent(name)}`, visibility: 'role_limited' }))
            await registerBrandAssets({ workspaceId: scope.workspaceId, siteId: scope.siteId, brandKitVersionId: version.id, userId: auth.userId, role: scope.role, assets })
            return textResult({ ...imported, canonicalBrandKitVersionId: version.id, canonicalAssets: assets.length })
          }
          return textResult(imported)
        }
        default:
          throw new Error(`Tool desconocida: ${name}`)
      }
    } catch (err) {
      return errorResult(err)
    }
  }))

  return server
}

/**
 * In-process bridge for the PWA. It invokes the exact same MCP tools and
 * permission checks as Streamable HTTP, without creating a second action layer.
 * Keeping this bridge here makes /app and external MCP clients share one
 * contract while the transport remains private to the HTTP handler.
 */
export async function invokeMcpTool(
  name,
  args = {},
  auth = { role: 'admin' },
  { restrictMutations = false, source = 'bridge' } = {}
) {
  const server = createMcpServer(auth, { restrictMutations, source })
  const handler = server._requestHandlers.get('tools/call')
  if (typeof handler !== 'function') throw new Error('El servidor MCP no registró tools/call.')
  return handler(
    { method: 'tools/call', params: { name, arguments: args } },
    { mcpReq: { requestState: () => undefined } }
  )
}
