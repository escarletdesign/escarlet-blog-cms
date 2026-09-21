import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { extname, join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
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
import { brandFilesForAuth, SECRET_BRAND_FILES, prepareImageGeneration } from '../lib/brand-kit.mjs'
import { CANONICAL_CMS_URL, canonicalCmsPublicUrl } from '../lib/cms-url.mjs'
import { assertChatToolAllowed, assertSafeToolArguments } from '../lib/ai-security.mjs'
import { loadSiteConfig, isSocialMediaOnlySite } from '../lib/site-config.mjs'
import { mediaDir, readDb } from '../lib/db.mjs'
import {
  getStandaloneSocialPack,
  listStandaloneSocialPacks,
  saveStandaloneSocialPack
} from '../lib/social-pack-store.mjs'
import { getWorkflowFlags } from '../lib/workflow-flags.mjs'
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
  rejectContentItem,
  scheduleContentItem,
  cancelContentItem,
  approveContentBatch,
  rejectContentBatch,
  scheduleContentBatch,
  cancelContentBatch,
  createBrandKitVersion,
  registerBrandAssets,
  registerContentMedia,
  listSiteChannels,
  listBrandCapabilities,
  listBrandConnections,
  getActiveBrandKit
} from '../lib/workspace-domain.mjs'
import { isPostgresConfigured, runCoreMigrations } from '../lib/pg.mjs'
import {
  assertGenerationReceipt,
  issueGenerationReceipt,
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
  'content_reject',
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
  blog_request_changes: 'content_reject',
  blog_schedule_post: 'content_schedule',
  blog_cancel_schedule: 'content_cancel',
  blog_list_calendar: 'content_list_calendar'
})
const LEGACY_UPLOAD_TOOLS = new Set([
  'blog_upload_media_file',
  'blog_open_image_drop',
  'blog_upload_media',
  'blog_import_remote_image'
])
const FINAL_IMAGE_RECEIPT_CONDITION = {
  oneOf: [
    {
      properties: { kind: { const: 'reference' } },
      required: ['kind']
    },
    {
      properties: {
        kind: { enum: ['post', 'social'] },
        generationReceiptId: {
          type: 'string',
          minLength: 1,
          description: 'Receipt emitido por brand_complete_image_generation. Obligatorio para post y social.'
        }
      },
      required: ['kind', 'generationReceiptId']
    }
  ]
}
const MUTATING_SITE_TOOLS = new Set([
  'brand_complete_image_generation',
  'brand_register_generation',
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
  'content_reject',
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
  const raw = String(item?.path || '').trim()
  if (!raw.startsWith('/media/')) return ''
  const relative = raw.slice('/media/'.length)
  if (!relative || relative.includes('..')) return ''
  const candidate = join(mediaDir, relative)
  if (!existsSync(candidate)) return ''
  try {
    const resolved = realpathSync(candidate)
    const mediaRoot = `${realpathSync(mediaDir).replace(/\/$/, '')}/`
    return resolved.startsWith(mediaRoot) ? resolved : ''
  } catch {
    return ''
  }
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

async function brandContextResult(payload) {
  const safePayload = redactWorkflowLinks(payload)
  const references = Array.isArray(payload?.brandKit?.referenceImages)
    ? payload.brandKit.referenceImages
    : Array.isArray(payload?.referenceImages)
      ? payload.referenceImages
      : []
  const textPayload = {
    ...safePayload,
    mcpServer: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, contract: 'v2', canonicalUrl: MCP_CANONICAL_URL },
    referenceDelivery: {
      mode: 'catalog_only',
      total: references.length,
      imageBlocks: 0,
      inspectable: false,
      binaryDeliveryTool: 'brand_prepare_image_generation',
      instruction: 'El contexto solo cataloga referencias. Llama brand_prepare_image_generation para recibir exclusivamente los ImageContent de la ruta elegida.'
    },
    brandIsolation: {
      mode: 'versioned_read_only_snapshot',
      conversationIndependent: true,
      writesBrandKit: false,
      instruction: 'La preparación visual ignora el historial conversacional y no modifica archivos ni referencias del brandkit.'
    }
  }
  return {
    content: [{ type: 'text', text: typeof textPayload === 'string' ? textPayload : JSON.stringify(textPayload, null, 2) }]
  }
}

async function preparedImageResult(payload) {
  const prepared = redactWorkflowLinks(payload)
  const refs = Array.isArray(payload?.resolvedReferences)
    ? [...payload.resolvedReferences].sort((a, b) => Number(a.attachmentIndex || 0) - Number(b.attachmentIndex || 0))
    : []
  const preparationId = String(payload?.brandPreparation?.preparationId || '')
  const attachments = []
  const missing = []
  for (const reference of refs) {
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
        mimeType,
        annotations: { audience: ['assistant'], priority: 1 },
        _meta: {
          'escarlet/reference': {
            filename: reference.filename,
            referenceId: reference.id,
            mediaId: reference.mediaId,
            attachmentIndex: reference.attachmentIndex,
            role: reference.role,
            sha256,
            preparationId
          }
        }
      })
    } catch {
      missing.push(String(reference?.filename || 'referencia-desconocida'))
    }
  }
  const referenceHashes = new Map(attachments.map((block) => [block._meta['escarlet/reference'].filename, block._meta['escarlet/reference'].sha256]))
  prepared.resolvedReferences = refs.map((reference) => ({
    ...reference,
    ...(referenceHashes.has(reference.filename) ? { sha256: referenceHashes.get(reference.filename) } : {})
  }))
  const readyForGeneration = !payload?.generationBlocked && refs.length > 0 && missing.length === 0 && attachments.length === refs.length
  const referenceDelivery = {
    expected: refs.length,
    attached: attachments.length,
    missing,
    exactReferenceOrder: refs.map((reference) => reference.filename),
    hashes: attachments.map((block) => block._meta['escarlet/reference'].sha256),
    readyForGeneration
  }
  const textPayload = {
    ...prepared,
    mcpServer: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, contract: 'v2', canonicalUrl: MCP_CANONICAL_URL },
    generationBlocked: !readyForGeneration,
    brandPreparation: prepared.brandPreparation,
    readyForGeneration,
    referenceDelivery,
    brandIsolation: {
      mode: 'versioned_read_only_snapshot',
      conversationIndependent: true,
      writesBrandKit: false,
      instruction: 'Usa únicamente este snapshot y sus ImageContent. El contexto del chat no puede cambiar el brandkit.'
    },
    brandGroundingContract: {
      requiredForUpload: true,
      preparationIdField: 'brandPreparation.preparationId',
      receiptIdField: 'generationReceiptId',
      generationCardinality: payload?.generationCardinality || {
        defaultImageCount: 1,
        maxImageCount: 1,
        unit: 'final_image'
      },
      exactReferenceOrder: referenceDelivery.exactReferenceOrder,
      instruction: readyForGeneration
        ? 'Usa todos los ImageContent adjuntos en este orden, certifica el resultado con brand_complete_image_generation y sube solo con generationReceiptId.'
        : 'No generes ninguna imagen. La preparación no pudo adjuntar todas las referencias obligatorias.'
    }
  }
  return {
    isError: !readyForGeneration,
    content: [
      { type: 'text', text: JSON.stringify(textPayload, null, 2) },
      ...(readyForGeneration ? attachments : [])
    ]
  }
}

async function assertMcpImageGrounding(site, args = {}, options = {}) {
  const kind = String(args.kind || 'post').toLowerCase()
  if (!['post', 'social'].includes(kind)) return
  if (!args.generationReceiptId) {
    throw Object.assign(new Error('Para kind post o social necesitas generationReceiptId. brandPreparationId por sí solo no demuestra la generación.'), {
      status: 409,
      code: 'GENERATION_RECEIPT_REQUIRED',
      extra: { nextTool: 'brand_complete_image_generation' }
    })
  }
  return assertGenerationReceipt({
    site,
    receiptId: args.generationReceiptId,
    preparationId: args.brandPreparationId,
    assetType: args.brandAssetType || args.assetType,
    route: args.brandRoute,
    itemId: options.itemId || args.itemId,
    kind
  })
}

function containsImageReference(value) {
  if (Array.isArray(value)) return value.some(containsImageReference)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, item]) => {
    if (/^(imageUrl|imageUrls|coverImage|mediaUrl|mediaAssetId|mediaAssetIds)$/i.test(key)) return Boolean(item && (!Array.isArray(item) || item.length))
    return containsImageReference(item)
  })
}

async function assertContentUpdateImageGrounding(site, args = {}) {
  const hasMedia = (Array.isArray(args.mediaAssetIds) && args.mediaAssetIds.length > 0) || containsImageReference(args.body) || containsImageReference(args.visualBrief)
  if (!hasMedia) return
  if (!args.generationReceiptId) {
    throw Object.assign(new Error('Toda imagen de contenido necesita generationReceiptId emitido por el backend antes de asociarse al item.'), {
      status: 409,
      code: 'GENERATION_RECEIPT_REQUIRED',
      extra: { nextTool: 'brand_complete_image_generation' }
    })
  }
  return assertGenerationReceipt({ site, receiptId: args.generationReceiptId, preparationId: args.brandPreparationId, itemId: args.itemId, kind: args.channel === 'blog' ? 'post' : args.channel === 'instagram' ? 'social' : undefined })
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
        'Devuelve el contexto general canónico y versionado, pero no reemplaza brand_prepare_image_generation. Para cualquier imagen llama primero a brand_prepare_image_generation y entrega exactamente sus ImageContent al generador. Está prohibido escoger o sustituir referencias; si generationBlocked es true, detén la generación.',
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
        'Plan A de compatibilidad. Para kind post exige receipt de blog_cover y para social receipt de social_image o instagram_background. El backend valida también las dimensiones reales. brandPreparationId por sí solo no autoriza la subida.',
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
        'Compatibilidad. Solo si el host puede hacer HTTP PUT. Para kind post o social exige receipt con assetType y dimensiones correctos. El sandbox de ChatGPT no resuelve DNS.',
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
          brandRoute: { type: 'string' }
        },
        required: ['site', 'filename', 'kind'],
        ...FINAL_IMAGE_RECEIPT_CONDITION
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_upload_media',
      description:
        'Plan B/C de compatibilidad. Para kind post o social exige receipt con assetType y dimensiones correctos. Pasa contentBase64 o blob. Si el host recorta o rechaza, uploadId + chunkIndex + chunkCount.',
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
        'Compatibilidad para una URL https pública real. Para kind post o social exige receipt con assetType y dimensiones correctos. Para archivos del chat usa content_upload_media.',
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
    { name: 'brand_get_context', description: 'Devuelve el contexto general canónico y el catálogo de referencias de una marca, sin adjuntar binarios. Para recibir las imágenes exactas llama brand_prepare_image_generation. Todos los endpoints leen el mismo snapshot versionado.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, siteId: { type: 'string' } } }, annotations: { readOnlyHint: true } },
    {
      name: 'brand_prepare_image_generation',
      description: 'Obligatoria antes de toda generación visual. Devuelve una preparación versionada, las dimensiones de salida y las referencias binarias exactas como ImageContent. Esta tool no autoriza por sí sola el upload final: certifica el resultado con brand_complete_image_generation usando exactamente esas referencias y sube solo con generationReceiptId. Si generationBlocked es true, aborta.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          assetType: { type: 'string', enum: ['blog_cover', 'instagram_background', 'social_image', 'presentation', 'generic'] },
          title: { type: 'string' },
          summary: { type: 'string' },
          topic: { type: 'string' },
          tone: { type: 'string' },
          channel: { type: 'string' },
          itemId: { type: 'string' },
          batchId: { type: 'string' }
        },
        required: ['site']
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    {
      name: 'brand_complete_image_generation',
      description: 'Emite exclusivamente desde backend un generationReceipt verificable. Rechaza preparaciones bloqueadas, vencidas o de otra marca, y exige la lista exacta y ordenada de referencias con sus hashes, además del hash SHA-256 del archivo resultante. El upload posterior valida también el assetType y las dimensiones reales del archivo. No acepta referencias escogidas por el agente.',
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
          channel: { type: 'string' }
        },
        required: ['site', 'preparationId', 'usedReferences', 'generatedResultId', 'generatedFileHash']
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
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
          channel: { type: 'string' }
        },
        required: ['site', 'preparationId', 'usedReferences', 'generatedResultId', 'generatedFileHash']
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    {
      name: 'content_upload_media',
      description: 'Sube una única imagen al almacenamiento canónico v2 y devuelve un mediaAssetId utilizable por content_update_item. Para kind post exige un receipt de blog_cover y para kind social un receipt de social_image o instagram_background, además de las dimensiones reales correctas. Un brandPreparationId por sí solo no demuestra que las referencias hayan sido utilizadas. El backend comprueba sitio, preparación, brandkit, referencias, expiración, consumo, assetType y hash del archivo.',
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
          brandPreparationId: { type: 'string', description: 'Compatibilidad informativa. Debe coincidir con el preparationId contenido en generationReceiptId.' },
          generationReceiptId: { type: 'string', description: 'Receipt emitido por brand_complete_image_generation. Obligatorio para post y social.' },
          brandAssetType: { type: 'string' },
          brandRoute: { type: 'string' },
          itemId: { type: 'string' }
        },
        required: ['site', 'filename', 'kind'],
        ...FINAL_IMAGE_RECEIPT_CONDITION
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: {
        ...connectorFileMeta(),
        'openai/toolInvocation/invoking': 'Subiendo imagen v2',
        'openai/toolInvocation/invoked': 'Imagen v2 guardada'
      }
    },
    { name: 'content_list_plans', description: 'Lista los planes de contenido v2 de una marca, con progreso, canales y contadores de revisión.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, status: { type: 'string' }, channel: { type: 'string', enum: ['blog', 'instagram', 'linkedin', 'x', 'video', 'substack'] }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } } }, annotations: { readOnlyHint: true } },
    { name: 'content_list_items', description: 'Lista publicaciones v2, incluyendo las generadas o pendientes de revisión aunque todavía no estén publicadas.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, batchId: { type: 'string' }, status: { type: 'string' }, channel: { type: 'string', enum: ['blog', 'instagram', 'linkedin', 'x', 'video', 'substack'] }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500 } } }, annotations: { readOnlyHint: true } },
    { name: 'content_list_calendar', description: 'Lista el calendario v2 con publicaciones programadas, sincronizando, publicadas o con error.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 1000 } } }, annotations: { readOnlyHint: true } },
    { name: 'content_create_batch', description: 'Crea un plan de contenido v2 por temas y canales. La generación se ejecuta de forma asíncrona.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, title: { type: 'string' }, topics: { type: 'array', items: { type: 'string' } }, channels: { type: 'array', items: { type: 'string', enum: ['blog', 'instagram', 'linkedin', 'x', 'video', 'substack'] } }, brandKitVersionId: { type: 'string' }, metadata: { type: 'object' } }, required: ['topics'] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'content_get_batch', description: 'Obtiene el progreso, items y variantes de un batch.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, batchId: { type: 'string' } }, required: ['batchId'] }, annotations: { readOnlyHint: true } },
    { name: 'content_update_item', description: 'Edita el tema, cuerpo, metadata visual y medios canónicos de una variante v2 antes de aprobar. Cualquier mediaAssetId o URL de imagen exige generationReceiptId y provenance v2 válida para este item. brandPreparationId por sí solo no autoriza la asociación.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, itemId: { type: 'string' }, topic: { type: 'string' }, channel: { type: 'string' }, body: { type: 'object' }, visualBrief: { type: 'object' }, brandPreparationId: { type: 'string' }, generationReceiptId: { type: 'string' }, mediaAssetIds: { type: 'array', items: { type: 'string' } } }, required: ['itemId'] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'content_approve', description: 'Aprueba un item o todos los items de un batch.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, itemId: { type: 'string' }, batchId: { type: 'string' } }, oneOf: [{ required: ['itemId'] }, { required: ['batchId'] }] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'content_reject', description: 'Rechaza un item o todos los items de un batch y deja comentario.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, itemId: { type: 'string' }, batchId: { type: 'string' }, comment: { type: 'string' } }, oneOf: [{ required: ['itemId'] }, { required: ['batchId'] }] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'content_schedule', description: 'Programa un item o batch aprobado en zona horaria indicada.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, itemId: { type: 'string' }, batchId: { type: 'string' }, publicationDate: { type: 'string' }, timezone: { type: 'string' } }, required: ['publicationDate'], oneOf: [{ required: ['itemId'] }, { required: ['batchId'] }] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'content_cancel', description: 'Cancela un item o plan v2 que todavía no se publicó.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, itemId: { type: 'string' }, batchId: { type: 'string' } }, oneOf: [{ required: ['itemId'] }, { required: ['batchId'] }] }, annotations: { readOnlyHint: false, destructiveHint: false } }
  )

  return tools
    .filter((t) => !CMS_AI_TOOLS.has(t.name))
    .filter((t) => !LEGACY_CONTENT_TOOLS.has(t.name))
    // v2 has one public contract. Keep legacy content handlers private while
    // exposing the media upload compatibility tools with the same receipt gate.
    .filter((t) => !/^(blog|social)_/.test(t.name) || LEGACY_UPLOAD_TOOLS.has(t.name))
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildToolList(auth)
  }))

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
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

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
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

  server.setRequestHandler(CallToolRequestSchema, async (request) => withGenerationPolicy({ externalMcp: !['app', 'chat'].includes(source), auth }, async () => {
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
      if (restrictMutations) assertChatToolAllowed(name, args)
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
          const prepared = prepareImageGeneration(site, args)
          let scope = null
          if (isPostgresConfigured()) scope = await resolveContentScope(auth, { ...args, site })
          await persistImagePreparation(prepared, {
            workspaceId: scope?.workspaceId || auth?.workspaceId,
            siteId: scope?.siteId,
            itemId: args.itemId,
            batchId: args.batchId,
            channel: args.channel
          })
          return preparedImageResult(prepared)
        }
        case 'brand_complete_image_generation':
        case 'brand_register_generation': {
          const site = resolveToolSite(auth, args)
          const scope = isPostgresConfigured() ? await resolveContentScope(auth, { ...args, site }) : null
          const receipt = await issueGenerationReceipt({
            site,
            preparationId: args.preparationId,
            usedReferences: args.usedReferences || args.referenceEvidence,
            generatedResultId: args.generatedResultId || args.resultId,
            generatedFileHash: args.generatedFileHash || args.fileHash,
            itemId: args.itemId,
            batchId: args.batchId,
            channel: args.channel,
            assetType: args.assetType,
            route: args.route
          })
          return textResult({
            ok: true,
            generationReceipt: receipt,
            generationReceiptId: receipt.receiptId,
            nextTool: 'content_upload_media'
          })
        }
        case 'content_upload_media': {
          const site = resolveToolSite(auth, args)
          const kind = String(args.kind || 'post').toLowerCase()
          await assertMcpImageGrounding(site, args)
          const scope = await resolveContentScope(auth, { ...args, site })
          const uploaded = await cms.uploadMedia({
            ...args,
            site,
            kind,
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
          return textResult({ ...uploaded, mediaAsset: asset, mediaAssetId: asset.id })
        }
        case 'brand_get_context': {
          // Legacy JSON deployments do not have the v2 workspace tables yet.
          // Keep this read-only tool useful there while retaining the same
          // site ACL and normalized response contract.
          if (!isPostgresConfigured()) {
            const site = resolveToolSite(auth, args)
            const brandKit = await cms.getBrandContext(site, { auth: scopedAuth })
            const declaredCapabilities = Array.isArray(auth?.capabilities) ? auth.capabilities.filter((capability) => capability !== 'brand_kit_access') : []
            const effectiveBrandAccess = brandKit.brandAccessLevel !== 'none'
            brandKit.brandCapabilities = {}
            return brandContextResult({
              workspace: { id: auth?.workspaceId || null, name: 'Espacio' },
              brand: { id: site, handle: site, name: loadSiteConfig(site)?.name || site },
              role: auth?.role || 'unknown',
              capabilities: declaredCapabilities,
              declaredCapabilities,
              effectiveCapabilities: declaredCapabilities,
              brandCapabilities: {},
              brandCapabilityDeclared: brandKit.brandCapabilityDeclared === true,
              brandCapabilityEffective: effectiveBrandAccess,
              brandAccessLevel: brandKit.brandAccessLevel,
              grantedBrandResources: brandKit.grantedBrandResources || [],
              deniedBrandResources: brandKit.deniedBrandResources || [],
              denialReasons: brandKit.denialReasons || {},
              brandKitVersionId: brandKit.brandKitVersionId || `brand-${site}-version-1`,
              ...normalizedBrandFields(brandKit),
              visualContext: brandKit.visualContext,
              referenceImages: brandKit.referenceImages || [],
              files: brandKit.files || {},
              channels: [],
              connections: [],
              brandKit
            })
          }
          const scope = await resolveContentScope(auth, args)
          const brand = scope.sites.find((entry) => entry.id === scope.siteId) || scope.sites[0]
          const [channels, brandCapabilities, connections, activeBrandKit] = await Promise.all([
            listSiteChannels({ workspaceId: scope.workspaceId, siteId: scope.siteId }),
            listBrandCapabilities({ workspaceId: scope.workspaceId, siteId: scope.siteId }),
            listBrandConnections({ workspaceId: scope.workspaceId, siteId: scope.siteId }),
            getActiveBrandKit({ workspaceId: scope.workspaceId, siteId: scope.siteId }).catch(() => null)
          ])
          const brandKit = await cms.getBrandContext(scope.siteHandle, {
            auth: scopedAuth,
            brandCapabilities,
            canonicalManifest: activeBrandKit?.manifest,
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
          const result = await createContentBatch({ workspaceId: scope.workspaceId, siteId: scope.siteId, userId: auth.userId || null, role: scope.role, title: args.title, topics: args.topics, channels: args.channels, brandKitVersionId: args.brandKitVersionId, metadata: args.metadata })
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
          await assertContentUpdateImageGrounding(scope.siteHandle, args)
          return textResult(await updateContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId, itemId: args.itemId, userId: auth.userId, role: scope.role, topic: args.topic, body: args.body, channel: args.channel, visualBrief: args.visualBrief, brandPreparationId: args.brandPreparationId, generationReceiptId: args.generationReceiptId, mediaAssetIds: args.mediaAssetIds }))
        }
        case 'content_approve': {
          const scope = await resolveContentScope(auth, args)
          return textResult(args.batchId
            ? await approveContentBatch({ workspaceId: scope.workspaceId, siteId: scope.siteId, batchId: args.batchId, userId: auth.userId, role: scope.role })
            : await approveContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId, itemId: args.itemId, userId: auth.userId, role: scope.role }))
        }
        case 'content_reject': {
          const scope = await resolveContentScope(auth, args)
          return textResult(args.batchId
            ? await rejectContentBatch({ workspaceId: scope.workspaceId, siteId: scope.siteId, batchId: args.batchId, userId: auth.userId, role: scope.role, comment: args.comment })
            : await rejectContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId, itemId: args.itemId, userId: auth.userId, role: scope.role, comment: args.comment }))
        }
        case 'content_schedule': {
          const scope = await resolveContentScope(auth, args)
          return textResult(args.batchId
            ? await scheduleContentBatch({ workspaceId: scope.workspaceId, siteId: scope.siteId, batchId: args.batchId, userId: auth.userId, role: scope.role, publicationDate: args.publicationDate, timezone: args.timezone })
            : await scheduleContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId, itemId: args.itemId, userId: auth.userId, role: scope.role, publicationDate: args.publicationDate, timezone: args.timezone }))
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
        case 'blog_upload_media_file': {
          const site = resolveToolSite(auth, args)
          if (!args.file) {
            throw Object.assign(
              new Error(
                'Falta file. Adjunta el PNG en el argumento file. Si el host no adjunta archivos, usa blog_upload_media con contentBase64. No hagas curl ni PUT.'
              ),
              { status: 400 }
            )
          }
          await assertMcpImageGrounding(site, args)
          return textResult(await cms.uploadMedia({ ...args, site, requireBrandGrounding: ['post', 'social'].includes(String(args.kind || 'post').toLowerCase()), membershipUserId: scopedAuth.userId || '' }))
        }
        case 'blog_open_image_drop': {
          const site = resolveToolSite(auth, args)
          await assertMcpImageGrounding(site, args)
          return textResult(cms.openImageDrop({ ...args, site, requireBrandGrounding: ['post', 'social'].includes(String(args.kind || 'post').toLowerCase()), membershipUserId: scopedAuth.userId || '' }))
        }
        case 'blog_upload_media': {
          const site = resolveToolSite(auth, args)
          await assertMcpImageGrounding(site, args)
          return textResult(await cms.uploadMedia({ ...args, site, requireBrandGrounding: ['post', 'social'].includes(String(args.kind || 'post').toLowerCase()), membershipUserId: scopedAuth.userId || '' }))
        }
        case 'blog_import_remote_image': {
          const site = resolveToolSite(auth, args)
          if (!args.imageUrl) {
            throw Object.assign(
              new Error('Esta tool no sirve para /mnt/data. Usa blog_upload_media_file y adjunta el PNG en file.'),
              { status: 400 }
            )
          }
          await assertMcpImageGrounding(site, args)
          return textResult(await cms.uploadMedia({ ...args, site, requireBrandGrounding: ['post', 'social'].includes(String(args.kind || 'post').toLowerCase()), contentBase64: undefined, membershipUserId: scopedAuth.userId || '' }))
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
  return handler({ method: 'tools/call', params: { name, arguments: args } })
}
