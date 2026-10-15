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
import { assertSiteAccess, assertSuperAdmin, allowedSiteHandles, isSiteScopedRole, isSuperAdmin, workspaceRoleForAuth } from '../lib/auth.mjs'
import { brandFilesForAuth, SECRET_BRAND_FILES, prepareImageGeneration, loadActiveBrandKitSnapshot, compositionForAssetType, archetypeForRoute, brandKitWriteAccess, assertBrandKitWritable } from '../lib/brand-kit.mjs'
import { generatePreviewBuffer, generateThumbBuffer } from '../lib/media-optimize.mjs'
import { getOrCreateStyleBoard, styleBoardFingerprint } from '../lib/style-board.mjs'
import { CANONICAL_CMS_URL, canonicalCmsPublicUrl } from '../lib/cms-url.mjs'
import { absoluteMediaUrl, contentItemPreviewUrl, dashboardUrl } from '../lib/preview-url.mjs'
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
import { mcpToolResult, toIsoDeep } from '../lib/mcp-public-json.mjs'
import { canReadPost, assertPostAccess, safePostFields } from '../lib/post-access.mjs'
import { listSiteAuthors } from '../lib/human-auth.mjs'
import {
  resolveWorkspaceContext,
  listContentPlans,
  listContentItemSummaries,
  listScheduledContent,
  createContentBatch,
  getContentBatch,
  getContentItem,
  updateContentItem,
  approveContentItem,
  scheduleContentItem,
  cancelContentItem,
  approveContentBatch,
  scheduleContentBatch,
  cancelContentBatch,
  createBrandKitVersion,
  getBrandKitVersion,
  validateBrandKitVersion,
  publishBrandKitVersion,
  publishBrandKitFile,
  registerBrandAssets,
  registerContentMedia,
  attachContentMedia,
  listSiteChannels,
  listBrandCapabilities,
  listBrandConnections,
  getActiveBrandKit,
  listBrandDirectory,
  preflightContentMediaAttachment
} from '../lib/workspace-domain.mjs'
import { isPostgresConfigured, runCoreMigrations } from '../lib/pg.mjs'
import {
  createVideoJob,
  getVideoJob,
  updateVideoJob,
  listVideoJobs,
  ingestVideoUpload,
  importExternalVideoMedia
} from '../lib/video-jobs.mjs'
import {
  getImagePreparation,
  persistImagePreparation,
  assertAssetTypeForMediaKind,
  assertSocialTextMetadata
} from '../lib/generation-provenance.mjs'

const DEFAULT_SITE = process.env.DEFAULT_SITE || 'escarlet'
const CONTENT_BRIEF_SCHEMA = {
  type: 'object',
  description: 'Brief común de la campaña.',
  properties: {
    objective: { type: 'string' },
    audience: { type: 'string' },
    idea: { type: 'string' },
    channels: { type: 'array', items: { type: 'string' } },
    format: { type: 'string' },
    cta: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' } },
    constraints: { type: 'array', items: { type: 'string' } },
    language: { type: 'string' }
  },
  additionalProperties: false
}
const V2_CONTENT_TOOLS = new Set([
  'content_list_plans',
  'content_list_items',
  'content_get_item',
  'content_list_calendar',
  'content_create_batch',
  'content_get_batch',
  'content_upload_media',
  'content_attach_media',
  'content_update_item',
  'content_approve',
  'content_schedule',
  'content_cancel'
])
const V2_READ_ONLY_TOOLS = new Set(['content_list_plans', 'content_list_items', 'content_get_item', 'content_list_calendar', 'content_get_batch'])
const V2_VIDEO_TOOLS = new Set([
  'video_create_job',
  'video_get_job',
  'video_update_job',
  'video_upload_media',
  'video_import_external_media',
  'video_list_jobs'
])
const V2_VIDEO_READ_ONLY_TOOLS = new Set(['video_get_job', 'video_list_jobs'])
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
  'brand_update_file',
  'blog_update_brand_file',
  'blog_upload_media_file',
  'blog_open_image_drop',
  'blog_upload_media',
  'blog_import_remote_image',
  'content_create_batch',
  'content_upload_media',
  'content_attach_media',
  'content_update_item',
  'content_approve',
  'content_schedule',
  'content_cancel',
  'video_create_job',
  'video_update_job',
  'video_upload_media',
  'video_import_external_media',
  'brand_create_draft',
  'brand_upload_asset',
  'brand_publish_draft'
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
  return mcpToolResult(redactWorkflowLinks(payload), {
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
    contract: 'v2',
    canonicalUrl: MCP_CANONICAL_URL
  })
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
  const board = String(args.board || '').trim().toLowerCase()
  const next = { ...args }
  if (board && ['style', 'character', 'logo', 'default'].includes(board)) next.board = board
  if (channel === 'linkedin' && (!assetType || assetType === 'generic')) next.assetType = 'blog_cover'
  if (channel === 'instagram' && (!assetType || assetType === 'generic')) next.assetType = 'social_image'
  if (channel === 'instagram_story' && (!assetType || assetType === 'generic')) next.assetType = 'instagram_story'
  assertChannelAssetType(next.channel, next.assetType)
  return next
}

const CHANNEL_ASSET_TYPES = Object.freeze({
  instagram: 'social_image',
  instagram_story: 'instagram_story'
})

export function assertChannelAssetType(channel, assetType) {
  const normalizedChannel = String(channel || '').trim().toLowerCase()
  const normalizedAssetType = String(assetType || '').trim().toLowerCase()
  const expectedAssetType = CHANNEL_ASSET_TYPES[normalizedChannel]
  if (expectedAssetType && normalizedAssetType !== expectedAssetType) {
    throw Object.assign(new Error(`${normalizedChannel} solo admite ${expectedAssetType}.`), {
      status: 409,
      code: 'ASSET_TYPE_CHANNEL_MISMATCH',
      channel: normalizedChannel,
      assetType: normalizedAssetType,
      expectedAssetType
    })
  }
  return true
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
      binaryDeliveryTool: 'brand_get_style_board',
      instruction: 'El contexto solo cataloga. Usa brand_get_style_board (consulta) o brand_prepare_image_generation (si vas a subir al CMS) para un ImageContent (style board).'
    },
    brandIsolation: brandIsolationFor(safePayload)
  }
  return {
    content: [{ type: 'text', text: typeof textPayload === 'string' ? textPayload : JSON.stringify(textPayload, null, 2) }]
  }
}

// One image per call. OpenAI's MCP bridge copies ImageContent into content_items, and grpc.aio
// rejects the message once it passes the default 4MiB max_receive_message_length (AioRpcError).
// 1.2MB raw stays under that limit even after base64 and the client-side copy. Do not raise the gRPC limit.
const MAX_REFERENCE_BYTES = 1_200_000

function referenceOrdinal(reference, position) {
  const index = Number(reference?.index)
  if (Number.isInteger(index) && index >= 0) return index
  const attachment = Number(reference?.attachmentIndex || reference?.order || 0)
  return attachment > 0 ? attachment - 1 : position
}

async function deliverReferenceBytes(disk, mimeType) {
  const original = readFileSync(disk)
  const originalSha = createHash('sha256').update(original).digest('hex')
  if (original.length <= MAX_REFERENCE_BYTES) return { bytes: original, mimeType, originalSha, sizeBytes: original.length, optimized: false }
  const preview = await generatePreviewBuffer(original, 1200)
  if (preview.ok && preview.buffer?.length && preview.buffer.length <= MAX_REFERENCE_BYTES) {
    return { bytes: preview.buffer, mimeType: 'image/jpeg', originalSha, sizeBytes: preview.buffer.length, optimized: true, originalSizeBytes: original.length }
  }
  const thumb = await generateThumbBuffer(original, 800)
  if (thumb.ok && thumb.buffer?.length && thumb.buffer.length <= MAX_REFERENCE_BYTES) {
    return { bytes: thumb.buffer, mimeType: 'image/jpeg', originalSha, sizeBytes: thumb.buffer.length, optimized: true, originalSizeBytes: original.length }
  }
  throw Object.assign(new Error('La referencia visual supera el tamaño seguro de transporte.'), { status: 413, code: 'REFERENCE_TOO_LARGE', extra: { sizeBytes: original.length } })
}

export async function preparedImageResult(payload, options = {}) {
  const refs = Array.isArray(payload?.resolvedReferences)
    ? [...payload.resolvedReferences].sort((left, right) => referenceOrdinal(left, 0) - referenceOrdinal(right, 0))
    : []
  for (const reference of refs) {
    if (reference.sha256) continue
    const disk = referenceDiskPath(reference)
    if (!disk) continue
    reference.sha256 = createHash('sha256').update(readFileSync(disk)).digest('hex')
  }
  const total = refs.length
  const preparationId = String(payload?.brandPreparation?.preparationId || '')
  const site = String(payload?.site || payload?.brandPreparation?.site || '')
  const catalog = refs.map((reference, position) => ({
    index: referenceOrdinal(reference, position),
    filename: String(reference?.filename || ''),
    sha256: String(reference?.sha256 || ''),
    required: reference?.required !== false,
    role: reference?.role || null
  }))
  const legacyIndexRequested = options.referenceIndex !== undefined && options.referenceIndex !== null && options.referenceIndex !== ''
  const metadata = {
    preparationId,
    brandKitVersionId: payload?.brandKitVersionId || payload?.brandPreparation?.brandKitVersionId || null,
    brandKitSnapshotHash: payload?.brandKitSnapshotHash || payload?.brandPreparation?.brandKitSnapshotHash || null,
    assetType: payload?.brandPreparation?.assetType || payload?.assetType || null,
    expectedDimensions: payload?.composition?.dimensions || null,
    expectedAssetCount: Number(payload?.brandPreparation?.expectedAssetCount || payload?.generationCardinality?.maxImageCount || 1),
    route: payload?.route || payload?.brandPreparation?.route || null,
    archetype: payload?.archetype || null,
    references: catalog,
    generationPrompt: payload?.generationPrompt || '',
    negativeRules: Array.isArray(payload?.negativeRules) ? payload.negativeRules : [],
    canonicalPalette: payload?.canonicalPalette || null,
    composition: payload?.composition || null,
    deliveryMode: legacyIndexRequested ? 'legacy_single_reference' : 'style_board',
    mcpServer: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, contract: 'v2', canonicalUrl: MCP_CANONICAL_URL }
  }
  if (!total || payload?.generationBlocked) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Preparation ${preparationId || 'blocked'}. No style board delivered.` }],
      structuredContent: { ...metadata, generationBlocked: true, referenceDelivery: { total, currentIndex: null, nextReferenceIndex: null, complete: false } }
    }
  }

  // Happy path: one ImageContent. Discrete refs stay server-side.
  if (!legacyIndexRequested) {
    const diskPaths = refs.map((reference) => referenceDiskPath(reference)).filter(Boolean)
    if (diskPaths.length !== refs.length) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Preparation ${preparationId}. Style board incomplete: missing reference files.` }],
        structuredContent: { ...metadata, code: 'REFERENCE_FILE_MISSING', referenceDelivery: { total, currentIndex: 0, nextReferenceIndex: null, complete: false } }
      }
    }
    let board
    if (diskPaths.length === 1) {
      const delivered = await deliverReferenceBytes(diskPaths[0], imageMimeType(refs[0]?.filename) || 'image/png')
      board = { buffer: delivered.bytes, mimeType: delivered.mimeType, sha256: createHash('sha256').update(delivered.bytes).digest('hex'), sizeBytes: delivered.sizeBytes }
    } else {
      const fingerprint = styleBoardFingerprint({
        site,
        brandKitVersionId: metadata.brandKitVersionId,
        brandKitSnapshotHash: metadata.brandKitSnapshotHash,
        route: metadata.route,
        filenames: catalog.map((entry) => entry.filename)
      })
      board = await getOrCreateStyleBoard({ site, fingerprint, diskPaths })
      board = { ...board, sizeBytes: board.buffer.length }
    }
    const referenceDelivery = { total: 1, currentIndex: 0, nextReferenceIndex: null, complete: true, sourceReferenceCount: total }
    const summary = `Preparation ${preparationId}. Style board ready (${total} source refs). Generate the final image with approved text now.`
    console.info(JSON.stringify({
      event: 'brand_image_style_board_delivered',
      preparationId,
      site,
      route: metadata.route,
      sourceReferenceCount: total,
      mimeType: board.mimeType,
      sizeBytes: board.sizeBytes || board.buffer.length,
      sha256: board.sha256
    }))
    return {
      isError: false,
      content: [
        { type: 'text', text: summary },
        { type: 'image', data: board.buffer.toString('base64'), mimeType: board.mimeType }
      ],
      structuredContent: {
        ...metadata,
        styleBoard: { sha256: board.sha256, mimeType: board.mimeType, sizeBytes: board.sizeBytes || board.buffer.length, sourceFilenames: catalog.map((entry) => entry.filename) },
        referenceDelivery,
        readyForGeneration: true
      }
    }
  }

  const index = Number(options.referenceIndex)
  if (!Number.isInteger(index) || index < 0 || index >= total) {
    const error = Object.assign(new Error(`referenceIndex fuera de rango. Hay ${total} referencias.`), { status: 400, code: 'INVALID_REFERENCE_INDEX' })
    console.info(JSON.stringify({ event: 'brand_image_reference_delivery_failed', preparationId, referenceIndex: options.referenceIndex, error: error.message, payloadBytes: 0 }))
    throw error
  }
  const reference = refs[index]
  const disk = referenceDiskPath(reference)
  const mimeType = imageMimeType(reference?.filename)
  if (!disk || !mimeType) {
    console.info(JSON.stringify({ event: 'brand_image_reference_delivery_failed', preparationId, referenceIndex: index, filename: reference?.filename || '', error: 'missing file', payloadBytes: 0 }))
    return {
      isError: true,
      content: [{ type: 'text', text: `Preparation ${preparationId}. Reference ${index + 1} of ${total} is missing.` }],
      structuredContent: { ...metadata, code: 'REFERENCE_FILE_MISSING', referenceDelivery: { total, currentIndex: index, nextReferenceIndex: null, complete: false } }
    }
  }
  let delivered
  try {
    delivered = await deliverReferenceBytes(disk, mimeType)
  } catch (err) {
    console.info(JSON.stringify({ event: 'brand_image_reference_delivery_failed', preparationId, referenceIndex: index, filename: reference?.filename || '', error: err.message, payloadBytes: err.extra?.sizeBytes || 0 }))
    throw err
  }
  const nextReferenceIndex = index + 1 < total ? index + 1 : null
  const referenceDelivery = { total, currentIndex: index, nextReferenceIndex, complete: nextReferenceIndex === null }
  const references = catalog.map((entry) => entry.index === index && delivered.originalSha ? { ...entry, sha256: delivered.originalSha } : entry)
  const summary = `Preparation ${preparationId}. Legacy reference ${index + 1} of ${total}. Prefer style board (omit referenceIndex).`
  console.info(JSON.stringify({
    event: 'brand_image_reference_delivered',
    preparationId,
    referenceIndex: index,
    filename: reference.filename,
    mimeType: delivered.mimeType,
    sizeBytes: delivered.sizeBytes
  }))
  return {
    isError: false,
    content: [
      { type: 'text', text: summary },
      { type: 'image', data: delivered.bytes.toString('base64'), mimeType: delivered.mimeType }
    ],
    structuredContent: { ...metadata, references, referenceDelivery }
  }
}

export function preparedPayloadFromStoredPreparation(preparation) {
  const assetType = preparation.assetType || 'blog_cover'
  const resolvedReferences = (preparation.expectedReferences || []).map((expected, position) => ({
    index: Number.isInteger(expected.index) ? expected.index : position,
    id: expected.id,
    mediaId: expected.mediaId || null,
    filename: expected.filename,
    attachmentIndex: expected.attachmentIndex || position + 1,
    sha256: expected.sha256 || '',
    required: expected.required !== false,
    path: expected.path || expected.storageKey || (preparation.site && expected.filename ? `/media/${preparation.site}/reference/${expected.filename}` : ''),
    storageKey: expected.storageKey || expected.path || ''
  }))
  // Rebuild prompt/negativeRules from the kit; keep the stored preparationId and refs.
  let rebuilt = null
  try {
    rebuilt = prepareImageGeneration(preparation.site, {
      assetType,
      expectedAssetCount: Number(preparation.expectedAssetCount || 1),
      channel: preparation.channel,
      itemId: preparation.itemId,
      batchId: preparation.batchId
    })
  } catch {
    rebuilt = null
  }
  return {
    site: preparation.site,
    brandKitVersionId: preparation.brandKitVersionId,
    brandKitSnapshotHash: preparation.brandKitSnapshotHash,
    generationBlocked: preparation.generationBlocked,
    route: preparation.route,
    archetype: archetypeForRoute(preparation.route),
    composition: compositionForAssetType(assetType),
    generationPrompt: rebuilt?.generationPrompt || '',
    negativeRules: Array.isArray(rebuilt?.negativeRules) ? rebuilt.negativeRules : [],
    canonicalPalette: rebuilt?.canonicalPalette || null,
    brandPreparation: {
      preparationId: preparation.preparationId,
      site: preparation.site,
      brandKitVersionId: preparation.brandKitVersionId,
      brandKitSnapshotHash: preparation.brandKitSnapshotHash,
      route: preparation.route,
      assetType,
      expectedAssetCount: Number(preparation.expectedAssetCount || 1)
    },
    resolvedReferences
  }
}

export function assertPreparationUploadMatch(preparation, args = {}) {
  const fail = (message) => { throw Object.assign(new Error(message), { status: 409, code: 'PREPARATION_MISMATCH' }) }
  if (args.brandKitVersionId && String(args.brandKitVersionId) !== String(preparation.brandKitVersionId)) fail('brandKitVersionId no coincide con la preparación.')
  if (args.brandKitSnapshotHash && String(args.brandKitSnapshotHash) !== String(preparation.brandKitSnapshotHash)) fail('brandKitSnapshotHash no coincide con la preparación.')
  if (args.expectedAssetCount !== undefined && args.expectedAssetCount !== null && args.expectedAssetCount !== '' && Number(args.expectedAssetCount) !== Number(preparation.expectedAssetCount || 1)) fail('expectedAssetCount no coincide con la preparación.')
  const channel = String(args.channel || '').trim().toLowerCase()
  if (channel && preparation.channel && channel !== String(preparation.channel).toLowerCase()) fail('channel no coincide con la preparación.')
  if (channel && preparation.assetType) assertChannelAssetType(channel, preparation.assetType)
  const channels = Array.isArray(args.channels) ? args.channels.map((value) => String(value).toLowerCase()) : []
  if (preparation.channel && channels.length && channels.some((value) => value !== String(preparation.channel).toLowerCase())) fail('channels no coincide con la preparación.')
  if (preparation.assetType) for (const value of channels) assertChannelAssetType(value, preparation.assetType)
}

async function preparedUploadGrounding(site, scope, args) {
  const preparation = await getImagePreparation(args.preparationId)
  if (!preparation) throw Object.assign(new Error('No existe la preparación visual.'), { status: 404, code: 'PREPARATION_NOT_FOUND' })
  if (preparation.site !== site || (preparation.siteId && preparation.siteId !== scope.siteId) || preparation.workspaceId !== scope.workspaceId) throw Object.assign(new Error('La preparación no pertenece a esta marca.'), { status: 409, code: 'PREPARATION_SITE_MISMATCH' })
  if (preparation.generationBlocked || preparation.state === 'blocked') throw Object.assign(new Error('La preparación visual está bloqueada.'), { status: 409, code: 'GENERATION_BLOCKED' })
  if (preparation.expiresAt && new Date(preparation.expiresAt).getTime() <= Date.now()) throw Object.assign(new Error('La preparación visual ha expirado.'), { status: 409, code: 'PREPARATION_EXPIRED' })
  if (preparation.itemId && args.itemId && preparation.itemId !== args.itemId) throw Object.assign(new Error('La preparación pertenece a otro item.'), { status: 409, code: 'ITEM_MISMATCH' })
  assertPreparationUploadMatch(preparation, args)
  const itemId = args.itemId || preparation.itemId || null
  const assetType = String(preparation.assetType || '')
  const inferredKind = assetType === 'blog_cover' ? 'post' : ['social_image', 'instagram_story'].includes(assetType) ? 'social' : ''
  const kind = String(args.kind || inferredKind).toLowerCase()
  const channels = Array.isArray(args.channels) && args.channels.length
    ? args.channels.map((channel) => String(channel).toLowerCase())
    : preparation.channel ? [String(preparation.channel).toLowerCase()] : []
  if (!['post', 'social'].includes(kind)) throw Object.assign(new Error('kind debe ser post o social para esta preparación visual; no se puede inferir desde preparationId.'), { status: 400, code: args.kind ? 'MEDIA_KIND_INVALID' : 'MEDIA_KIND_REQUIRED' })
  assertAssetTypeForMediaKind(kind, preparation.assetType)
  if (channels.some((channel) => !['blog', 'instagram', 'instagram_story', 'linkedin', 'x', 'video', 'substack'].includes(channel))) {
    throw Object.assign(new Error('channels contiene un canal no reconocido.'), { status: 400, code: 'MEDIA_CHANNEL_INVALID' })
  }
  if (itemId && !channels.length) throw Object.assign(new Error('Indica el canal al preparar la imagen o envía channels al subirla.'), { status: 400, code: 'MEDIA_CHANNELS_REQUIRED' })
  for (const channel of channels) assertChannelAssetType(channel, preparation.assetType)
  const expectedDimensions = compositionForAssetType(preparation.assetType).dimensions
  if (args.expectedDimensions && String(args.expectedDimensions) !== expectedDimensions) {
    throw Object.assign(new Error(`expectedDimensions debe ser ${expectedDimensions} para ${preparation.assetType}.`), { status: 409, code: 'EXPECTED_DIMENSIONS_MISMATCH', expectedDimensions })
  }
  const index = Number(args.assetIndex ?? 0)
  if (!Number.isInteger(index) || index < 0 || index >= Number(preparation.expectedAssetCount || 1)) throw Object.assign(new Error('assetIndex no pertenece a esta preparación.'), { status: 409, code: 'ASSET_INDEX_MISMATCH' })
  const attachment = itemId ? await preflightContentMediaAttachment({ workspaceId: scope.workspaceId, siteId: scope.siteId, itemId, channels, assetIndex: index }) : null
  const socialText = ['social_image', 'instagram_story'].includes(preparation.assetType)
    ? assertSocialTextMetadata({
        assetType: preparation.assetType,
        textRendered: args.textRendered,
        templateId: args.templateId,
        renderedBy: args.renderedBy,
        textContent: attachment?.socialTextContent || args.textContent
      })
    : null
  return {
    provenanceVersion: '3',
    brandPreparationId: preparation.preparationId,
    brandKitVersionId: preparation.brandKitVersionId,
    brandKitSnapshotHash: preparation.brandKitSnapshotHash,
    brandRoute: preparation.route,
    assetType: preparation.assetType,
    kind,
    resolvedReferenceIds: preparation.expectedReferences.map((reference) => reference.id),
    resolvedReferenceHashes: preparation.expectedReferences.map((reference) => reference.sha256),
    itemId,
    channels,
    assetIndex: index,
    expectedAssetCount: Number(preparation.expectedAssetCount || 1),
    ...(socialText || {}),
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
  const payload = toIsoDeep(redactWorkflowLinks({
    message: err.message,
    status: err.status || 500,
    mcpServer: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, contract: 'v2', canonicalUrl: MCP_CANONICAL_URL },
    ...(err.code ? { code: err.code } : {}),
    ...(err.extra || {})
  }))
  if (payload.validation && !payload.blockingErrors) {
    payload.blockingErrors = payload.validation.errors
    payload.warnings = payload.validation.warnings
  }
  return {
    isError: true,
    content: [{ type: 'text', text: `${payload.message || 'Error'}${payload.code ? ` [${payload.code}]` : ''}` }],
    structuredContent: payload
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
  const globalAdmin = isSuperAdmin(auth)
  if (globalAdmin && !requestedSite && !args.workspaceId && !auth?.workspaceId) {
    throw Object.assign(new Error('Para consultar varias marcas con un token administrador pasa workspaceId o site.'), { status: 400, code: 'workspace_required' })
  }
  await runCoreMigrations()
  if (!globalAdmin && !auth?.userId && auth?.site && requestedSite && requestedSite !== auth.site) throw Object.assign(new Error('Este token solo gestiona el sitio autorizado.'), { status: 403 })
  const common = { userId: globalAdmin ? undefined : (auth?.userId || undefined), workspaceId: args.workspaceId || undefined, globalAdmin }
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
  if (!globalAdmin && !auth?.userId) throw Object.assign(new Error('Se requiere un token personal de usuario.'), { status: 401 })
  const role = globalAdmin ? 'admin' : context.role || workspaceRoleForAuth(auth)
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
        'Devuelve el contexto general canónico y versionado. Para grounding visual usa brand_get_style_board o brand_prepare_image_generation (un ImageContent). No elijas referencias sueltas.',
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
    { name: 'brand_list', description: 'Lista los workspaces y marcas visibles. workspaceId es opcional. Si hay varias, pregunta al usuario cuál usar y pasa site.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' } } }, annotations: { readOnlyHint: true } },
    { name: 'brand_get_context', description: 'Devuelve el contexto y el catálogo de referencias del brand kit activo en Postgres. Si la marca tiene assets de uso personaje, debes preguntar al usuario si quiere usar uno antes de preparar cualquier imagen.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, siteId: { type: 'string' } } }, annotations: { readOnlyHint: true } },
    {
      name: 'brand_create_draft',
      description: 'Crea un draft versionado del brand kit copiando el manifest y los assets de la versión activa. Solo owner o admin. Nunca modifica la versión activa. Usa idempotencyKey para reintentos seguros.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          manifest: { type: 'object' },
          baseVersionId: { type: 'string' },
          expectedActiveVersionId: { type: 'string' },
          idempotencyKey: { type: 'string', maxLength: 300 }
        },
        required: ['site']
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    {
      name: 'brand_validate_draft',
      description: 'Valida un draft de brand kit sin publicarlo. Comprueba manifest y assets canónicos.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' }, versionId: { type: 'string' } },
        required: ['site', 'versionId']
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'brand_upload_asset',
      description: 'Añade o reemplaza assets en un draft de Brand Kit. Las versiones publicadas son inmutables. Solo owner o admin.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          versionId: { type: 'string' },
          assets: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                storageKey: { type: 'string' },
                publicUrl: { type: 'string' },
                contentType: { type: 'string' },
                sizeBytes: { type: 'integer' },
                sha256: { type: 'string' },
                visibility: { type: 'string', enum: ['private', 'role_limited', 'public'] },
                metadata: { type: 'object' }
              },
              required: ['name', 'storageKey']
            }
          }
        },
        required: ['site', 'versionId', 'assets']
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    {
      name: 'brand_publish_draft',
      description: 'Publica un draft validado como nueva versión activa. Solo owner o admin. Rechaza si el brand kit activo cambió desde la lectura indicada.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          versionId: { type: 'string' },
          expectedActiveVersionId: { type: 'string' },
          idempotencyKey: { type: 'string', maxLength: 300 }
        },
        required: ['site', 'versionId']
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    {
      name: 'brand_prepare_image_generation',
      description: 'Crea una preparación visual y entrega UN style board (un ImageContent) con generationPrompt. Omite referenceIndex. El catálogo textual lista las referencias fuente; no elijas archivos. Para publicar, reutiliza preparationId en content_upload_media. referenceIndex solo es compatibilidad legacy (una ref suelta).',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          assetType: { type: 'string', enum: ['blog_cover', 'social_image', 'instagram_story', 'presentation', 'generic'] },
          title: { type: 'string' },
          summary: { type: 'string' },
          topic: { type: 'string' },
          textContent: { type: 'object', properties: { headline: { type: 'string', minLength: 1, maxLength: 90 }, body: { type: 'string', minLength: 1, maxLength: 240 } }, required: ['headline', 'body'], description: 'Copy aprobado que ChatGPT debe integrar en la imagen social final.' },
          tone: { type: 'string' },
          channel: { type: 'string' },
          expectedAssetCount: { type: 'integer', minimum: 1, maximum: 20, description: 'Cantidad de imágenes finales. Usa 1 o el total de slides del carrusel.' },
          itemId: { type: 'string' },
          batchId: { type: 'string' },
          useCharacter: { type: 'boolean', description: 'Usa el tablero de personajes (o characterId) solo si el usuario lo pide.' },
          characterId: { type: 'string', description: 'silvia | charly' },
          board: { type: 'string', enum: ['style', 'background', 'character', 'logo'], description: 'style (default), background, character o logo PNG.' },
          preparationId: { type: 'string', description: 'Reentrega el style board de una preparación existente.' },
          referenceIndex: { type: 'integer', minimum: 0, description: 'Legacy: una referencia suelta. Omítelo para recibir el style board completo.' }
        },
        required: ['site']
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    {
      name: 'brand_get_style_board',
      description: 'Consulta de marca: un ImageContent. board=style (default) tablero maestro; board=background fondo oficial; board=character tablero de personajes; board=logo logo PNG de referencia. No publica.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          board: { type: 'string', enum: ['style', 'background', 'character', 'logo'], description: 'Qué tablero entregar. Default style.' },
          assetType: { type: 'string', enum: ['blog_cover', 'social_image', 'instagram_story', 'presentation', 'generic'] },
          title: { type: 'string' },
          summary: { type: 'string' },
          topic: { type: 'string' },
          channel: { type: 'string' },
          expectedAssetCount: { type: 'integer', minimum: 1, maximum: 20 },
          useCharacter: { type: 'boolean' },
          characterId: { type: 'string', description: 'silvia | charly' }
        },
        required: ['site']
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    {
      name: 'brand_recap_image_preparation',
      description: 'Recap textual de una preparación (sin binarios): catálogo, generationPrompt, negativeRules y nextToolCall. Usa esto si el chat compactó el style board.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          preparationId: { type: 'string' }
        },
        required: ['site', 'preparationId']
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
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
          content: { type: 'string' },
          expectedActiveVersionId: { type: 'string', description: 'Versión activa que el usuario leyó antes de editar.' },
          idempotencyKey: { type: 'string', maxLength: 300, description: 'Clave estable para reintentar la misma publicación.' }
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
      description: 'Publish: sube con preparationId la imagen final generada por ChatGPT, con texto integrado. El CMS valida, almacena y asocia el PNG tal cual, sin overlays ni composición. kind=reference es moodboard y no se asocia a variantes.',
      inputSchema: {
        type: 'object',
        $defs: openaiFileDefs(),
        additionalProperties: true,
        properties: {
          workspaceId: { type: 'string' },
          site: { type: 'string' },
          filename: { type: 'string' },
          kind: { type: 'string', enum: ['post', 'social', 'reference'], description: 'Opcional con preparationId: el CMS lo deriva del assetType. reference = moodboard no asociable.' },
          alt: { type: 'string' },
          imageAlt: { type: 'string', description: 'Alias compatible de alt.' },
          file: { $ref: '#/$defs/OpenAIFile' },
          contentBase64: { type: 'string' },
          blob: { type: 'string' },
          imageUrl: { type: 'string' },
          filePath: { type: 'string' },
          uploadId: { type: 'string' },
          chunkIndex: { type: 'string' },
          chunkCount: { type: 'string' },
          preparationId: { type: 'string' },
          brandKitVersionId: { type: 'string' },
          brandKitSnapshotHash: { type: 'string' },
          channel: { type: 'string' },
          expectedAssetCount: { type: 'integer', minimum: 1, maximum: 20 },
          textRendered: { type: 'boolean', const: true, description: 'La imagen final ya contiene el texto.' },
          templateId: { type: 'string', enum: ['editorial', 'impact'] },
          renderedBy: { type: 'string', const: 'chatgpt-image-generation' },
          textContent: { type: 'object', properties: { headline: { type: 'string', minLength: 1, maxLength: 90 }, body: { type: 'string', minLength: 1, maxLength: 240 } }, required: ['headline', 'body'], description: 'Copy exacto que ya está integrado en la imagen final.' },
          itemId: { type: 'string' },
          channels: { type: 'array', uniqueItems: true, items: { type: 'string', enum: ['blog', 'instagram', 'instagram_story', 'linkedin', 'x', 'video', 'substack'] } },
          assetIndex: { type: 'integer', minimum: 0, maximum: 19, default: 0 },
          expectedDimensions: { type: 'string', description: 'Opcional. El CMS la deriva de preparationId y, si se envía, comprueba que coincida.' },
          autoNormalize: { type: 'boolean', default: false, description: 'Compatibilidad para portadas. Las imágenes sociales finales siempre se almacenan sin normalizar.' },
          idempotencyKey: { type: 'string', maxLength: 300 }
        },
        required: ['site', 'filename'],
        allOf: [
          { if: { not: { properties: { kind: { const: 'reference' } }, required: ['kind'] } }, then: { required: ['preparationId'] } },
          { if: { properties: { kind: { const: 'social' } }, required: ['kind'] }, then: { required: ['textRendered', 'templateId', 'renderedBy', 'textContent'] } }
        ]
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: {
        ...connectorFileMeta(),
        'openai/toolInvocation/invoking': 'Subiendo imagen v2',
        'openai/toolInvocation/invoked': 'Imagen v2 guardada'
      }
    },
    {
      name: 'content_attach_media',
      description: 'Asocia un pendingMediaId (post/social con preparationId) a variantes. Rechaza kind=reference y medios sin grounding. Marca generated (= pendiente de revisión) cuando esté completo. Nunca aprueba ni publica.',
      inputSchema: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          site: { type: 'string' },
          itemId: { type: 'string' },
          mediaId: { type: 'string' },
          channels: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: ['blog', 'instagram', 'instagram_story', 'linkedin', 'x', 'video', 'substack'] } },
          assetIndex: { type: 'integer', minimum: 0, maximum: 19 }
        },
        required: ['itemId', 'mediaId', 'channels', 'assetIndex']
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    { name: 'content_list_plans', description: 'Lista las campañas de contenido de una marca, con progreso, canales y publicaciones.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, status: { type: 'string' }, channel: { type: 'string', enum: ['blog', 'instagram', 'instagram_story', 'linkedin', 'x', 'video', 'substack'] }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } } }, annotations: { readOnlyHint: true } },
    { name: 'content_list_items', description: 'Resumen de publicaciones, sin body. El detalle está en content_get_item.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, batchId: { type: 'string' }, status: { type: 'string' }, channel: { type: 'string', enum: ['blog', 'instagram', 'instagram_story', 'linkedin', 'x', 'video', 'substack'] }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500 } } }, annotations: { readOnlyHint: true } },
    { name: 'content_get_item', description: 'Body, medios y readiness de una publicación.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, itemId: { type: 'string' } }, required: ['itemId'] }, annotations: { readOnlyHint: true } },
    { name: 'content_list_calendar', description: 'Lista el calendario v2 con publicaciones programadas, sincronizando, publicadas o con error.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 1000 } } }, annotations: { readOnlyHint: true } },
    { name: 'content_create_batch', description: 'Guarda primero los textos completos de una o varias publicaciones. Crea una campaña nueva automáticamente y registra el brief, el contexto de marca y los hallazgos de consistencia.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, title: { type: 'string', description: 'Opcional. Por defecto usa el título del primer post.' }, brief: CONTENT_BRIEF_SCHEMA, items: { type: 'array', minItems: 1, items: { type: 'object', properties: { title: { type: 'string', maxLength: 90, description: 'Título editorial breve. No incluyas el enfoque, contexto ni el brief.' }, brief: { type: 'string', minLength: 1, maxLength: 500 }, variants: { type: 'object', minProperties: 1, additionalProperties: { type: 'object' } } }, required: ['variants'], additionalProperties: false } }, batchId: { type: 'string', description: 'Solo si el usuario pidió añadir a una campaña existente.' }, createNewCampaign: { type: 'boolean', description: 'Compatibilidad anterior. No hace falta enviarlo para crear campaña nueva.' }, channels: { type: 'array', items: { type: 'string', enum: ['blog', 'instagram', 'instagram_story', 'linkedin', 'x', 'video', 'substack'] } }, brandKitVersionId: { type: 'string' }, idempotencyKey: { type: 'string', maxLength: 300 }, metadata: { type: 'object', description: 'Puede incluir contentBrief si el cliente no usa el campo brief.' } }, required: ['items'] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'content_get_batch', description: 'Detalle de una campaña. La readiness usa la misma lectura que readyForReview.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, batchId: { type: 'string' } }, required: ['batchId'] }, annotations: { readOnlyHint: true } },
    { name: 'content_update_item', description: 'Reemplaza sin reescritura el body de esa variante. Lee content_get_item antes y reenvía el body completo. readyForReview=true valida expectedAssetCount y assetIndex.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, itemId: { type: 'string' }, topic: { type: 'string' }, channel: { type: 'string', enum: ['blog', 'instagram', 'instagram_story', 'linkedin', 'x', 'video', 'substack'] }, body: { type: 'object' }, visualBrief: { type: 'object' }, mediaAssetIds: { type: 'array', items: { type: 'string' } }, readyForReview: { type: 'boolean' } }, required: ['itemId'] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'content_approve', description: 'Aprueba un item o todos los items de un batch.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, itemId: { type: 'string' }, batchId: { type: 'string' } }, oneOf: [{ required: ['itemId'] }, { required: ['batchId'] }] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'content_schedule', description: 'Programa variantes aprobadas por canal. Blog publica mediante Coolify; Instagram, LinkedIn y Story usan la conexión Buffer configurada.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, itemId: { type: 'string' }, batchId: { type: 'string' }, channels: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: ['blog', 'instagram', 'instagram_story', 'linkedin', 'x', 'video', 'substack'] } }, publicationDate: { type: 'string' }, timezone: { type: 'string' } }, required: ['channels', 'publicationDate'], oneOf: [{ required: ['itemId'] }, { required: ['batchId'] }] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'content_cancel', description: 'Cancela una publicación o campaña que todavía no se publicó.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, itemId: { type: 'string' }, batchId: { type: 'string' } }, oneOf: [{ required: ['itemId'] }, { required: ['batchId'] }] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'video_create_job', description: 'Crea un VideoJob para edición externa (Descript, etc.). Opcionalmente asocia un content item o crea uno mínimo con createContentIfMissing.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, contentItemId: { type: 'string' }, sourceMediaId: { type: 'string' }, provider: { type: 'string', enum: ['descript', 'heygen', 'higgsfield', 'runway', 'manual', 'unknown'] }, speaker: { type: 'string' }, channel: { type: 'string' }, format: { type: 'string' }, objective: { type: 'string' }, topic: { type: 'string' }, metadata: { type: 'object' }, idempotencyKey: { type: 'string', maxLength: 300 }, createContentIfMissing: { type: 'boolean' } } }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'video_get_job', description: 'Devuelve el contexto del job de vídeo: sourceUrl, marca, speaker, formato, estado y IDs de proveedor.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, videoJobId: { type: 'string' }, contentItemId: { type: 'string' } }, oneOf: [{ required: ['videoJobId'] }, { required: ['contentItemId'] }] }, annotations: { readOnlyHint: true } },
    { name: 'video_update_job', description: 'Actualiza estado, metadata, IDs de proveedor o caption del canal video. skipEdit=true publica sin editar (final=source).', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, videoJobId: { type: 'string' }, status: { type: 'string' }, provider: { type: 'string' }, providerProjectId: { type: 'string' }, providerCompositionId: { type: 'string' }, speaker: { type: 'string' }, channel: { type: 'string' }, format: { type: 'string' }, objective: { type: 'string' }, topic: { type: 'string' }, metadata: { type: 'object' }, caption: { type: 'string' }, readyForReview: { type: 'boolean' }, skipEdit: { type: 'boolean' } }, required: ['videoJobId'] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'video_upload_media', description: 'Sube vídeo RAW (.mov/.mp4/.webm) con file, contentBase64 o trozos uploadId. No usa content_upload_media.', inputSchema: { type: 'object', $defs: openaiFileDefs(), properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, filename: { type: 'string' }, mimeType: { type: 'string' }, format: { type: 'string', enum: ['portrait', 'landscape'] }, file: { $ref: '#/$defs/OpenAIFile' }, contentBase64: { type: 'string' }, blob: { type: 'string' }, uploadId: { type: 'string' }, chunkIndex: { type: 'string' }, chunkCount: { type: 'string' }, contentItemId: { type: 'string' }, videoJobId: { type: 'string' }, idempotencyKey: { type: 'string', maxLength: 300 } }, required: ['site', 'filename'] }, annotations: { readOnlyHint: false, destructiveHint: false }, _meta: { ...connectorFileMeta(), 'openai/toolInvocation/invoking': 'Subiendo vídeo RAW', 'openai/toolInvocation/invoked': 'Vídeo RAW guardado' } },
    { name: 'video_import_external_media', description: 'Descarga una URL HTTPS pública del export final y la registra como final_video; pasa el job a ready_for_review.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, videoJobId: { type: 'string' }, sourceUrl: { type: 'string' }, idempotencyKey: { type: 'string', maxLength: 300 } }, required: ['videoJobId', 'sourceUrl'] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: 'video_list_jobs', description: 'Lista jobs de vídeo por marca y estado.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, site: { type: 'string' }, status: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } } }, annotations: { readOnlyHint: true } }
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
      if (V2_CONTENT_TOOLS.has(name) || V2_VIDEO_TOOLS.has(name)) {
        const explicitSite = String(args.siteId || args.site || '').trim()
        const knownSites = availableToolSites(auth)
        if (!explicitSite && knownSites.length > 1) throw brandSelectionRequired(auth, knownSites)
        const readOnlyTool = V2_READ_ONLY_TOOLS.has(name) || V2_VIDEO_READ_ONLY_TOOLS.has(name)
        if (!readOnlyTool && auth?.role === 'viewer') {
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
          if (!readOnlyTool && scope.role === 'viewer') {
            throw Object.assign(new Error('El rol viewer solo puede consultar contenido.'), { status: 403 })
          }
        }
      }
      switch (name) {
        case 'brand_list': {
          if (!isPostgresConfigured()) throw Object.assign(new Error('Las marcas v2 requieren Postgres.'), { status: 503, code: 'postgres_required' })
          const systemAdmin = isSuperAdmin(auth)
          if (!systemAdmin && !auth?.userId) throw Object.assign(new Error('Se requiere un token personal de usuario para consultar marcas v2.'), { status: 401, code: 'user_token_required' })
          await runCoreMigrations()
          const workspaces = await listBrandDirectory({
            userId: systemAdmin ? undefined : auth.userId,
            workspaceId: args.workspaceId || auth?.workspaceId || undefined,
            systemAdmin
          })
          const only = workspaces.length === 1 ? workspaces[0] : null
          return textResult({
            workspaces,
            selectionRequired: workspaces.length > 1 || workspaces.some((workspace) => workspace.sites.length > 1),
            ...(only ? {
              workspace: { id: only.id, name: only.name },
              brands: only.sites,
              handles: only.sites.map((brand) => brand.handle).sort()
            } : {})
          })
        }
        case 'brand_create_draft': {
          const site = resolveToolSite(auth, args)
          const scope = await resolveContentScope(auth, { ...args, site })
          const writeAuth = { ...auth, role: scope.role, workspaceRole: scope.workspaceRole, brandRole: scope.brandRole }
          const access = assertBrandKitWritable(writeAuth)
          const active = await getActiveBrandKit({ workspaceId: scope.workspaceId, siteId: scope.siteId })
          const draft = await createBrandKitVersion({
            workspaceId: scope.workspaceId,
            siteId: scope.siteId,
            userId: auth.userId,
            role: scope.role,
            manifest: args.manifest,
            status: 'draft',
            baseVersionId: args.baseVersionId || active.id,
            expectedActiveVersionId: args.expectedActiveVersionId === undefined ? active.id : args.expectedActiveVersionId,
            idempotencyKey: args.idempotencyKey
          })
          return textResult({ ...draft, writesBrandKit: true, currentRole: access.currentRole, nextStep: 'Valida el draft con brand_validate_draft y publícalo con brand_publish_draft tras la confirmación humana.' })
        }
        case 'brand_validate_draft': {
          const site = resolveToolSite(auth, args)
          const scope = await resolveContentScope(auth, { ...args, site })
          return textResult(await validateBrandKitVersion({ workspaceId: scope.workspaceId, siteId: scope.siteId, versionId: args.versionId }))
        }
        case 'brand_upload_asset': {
          const site = resolveToolSite(auth, args)
          const scope = await resolveContentScope(auth, { ...args, site })
          const writeAuth = { ...auth, role: scope.role, workspaceRole: scope.workspaceRole, brandRole: scope.brandRole }
          const access = assertBrandKitWritable(writeAuth)
          const version = await getBrandKitVersion({ workspaceId: scope.workspaceId, siteId: scope.siteId, versionId: args.versionId })
          if (version.status === 'published') throw Object.assign(new Error('Las versiones publicadas son inmutables. Crea un draft para cargar assets.'), { status: 409, code: 'BRAND_KIT_VERSION_IMMUTABLE' })
          const assets = await registerBrandAssets({ workspaceId: scope.workspaceId, siteId: scope.siteId, brandKitVersionId: args.versionId, userId: auth.userId, role: scope.role, assets: args.assets })
          return textResult({ versionId: args.versionId, assets, writesBrandKit: true, currentRole: access.currentRole, nextStep: 'Valida el draft con brand_validate_draft y publícalo con brand_publish_draft tras la confirmación humana.' })
        }
        case 'brand_publish_draft': {
          const site = resolveToolSite(auth, args)
          const scope = await resolveContentScope(auth, { ...args, site })
          const writeAuth = { ...auth, role: scope.role, workspaceRole: scope.workspaceRole, brandRole: scope.brandRole }
          const access = assertBrandKitWritable(writeAuth)
          const active = await getActiveBrandKit({ workspaceId: scope.workspaceId, siteId: scope.siteId })
          const validation = await validateBrandKitVersion({ workspaceId: scope.workspaceId, siteId: scope.siteId, versionId: args.versionId })
          if (!validation.valid) throw Object.assign(new Error('El draft del brand kit no pasa la validación.'), { status: 409, code: 'BRAND_KIT_VALIDATION_FAILED', extra: validation })
          const published = await publishBrandKitVersion({
            workspaceId: scope.workspaceId,
            siteId: scope.siteId,
            userId: auth.userId,
            role: scope.role,
            versionId: args.versionId,
            expectedActiveVersionId: args.expectedActiveVersionId === undefined ? active.id : args.expectedActiveVersionId,
            idempotencyKey: args.idempotencyKey
          })
          return textResult({ ...published, writesBrandKit: true, currentRole: access.currentRole })
        }
        case 'brand_get_style_board':
        case 'brand_prepare_image_generation': {
          const site = resolveToolSite(auth, args)
          let scope = null
          if (isPostgresConfigured()) scope = await resolveContentScope(auth, { ...args, site })
          if (!scope) throw Object.assign(new Error('La preparación visual requiere Postgres.'), { status: 503, code: 'postgres_required' })
          if (args.preparationId) {
            const preparation = await getImagePreparation(args.preparationId)
            if (!preparation) throw Object.assign(new Error('No existe la preparación visual.'), { status: 404, code: 'PREPARATION_NOT_FOUND' })
            if (preparation.site !== scope.siteHandle || preparation.workspaceId !== scope.workspaceId || (preparation.siteId && preparation.siteId !== scope.siteId)) {
              throw Object.assign(new Error('La preparación no pertenece a esta marca.'), { status: 409, code: 'PREPARATION_SITE_MISMATCH' })
            }
            if (preparation.expiresAt && new Date(preparation.expiresAt).getTime() <= Date.now()) throw Object.assign(new Error('La preparación visual ha expirado.'), { status: 409, code: 'PREPARATION_EXPIRED' })
            return preparedImageResult(preparedPayloadFromStoredPreparation(preparation), { referenceIndex: args.referenceIndex })
          }
          const activeBrandKit = await getActiveBrandKit({ workspaceId: scope.workspaceId, siteId: scope.siteId })
          const canonicalSnapshot = loadActiveBrandKitSnapshot(scope.siteHandle, { manifest: activeBrandKit.manifest, assets: activeBrandKit.assets, brandKitVersionId: activeBrandKit.id, version: activeBrandKit.version })
          const characters = canonicalSnapshot.references.filter((reference) => String(reference.usage || '').toLowerCase() === 'character')
          if (args.useCharacter === true && characters.length > 1 && !args.characterId) {
            throw Object.assign(new Error('La marca tiene más de un personaje. Pregunta cuál quiere usar y vuelve a preparar la imagen con characterId.'), {
              status: 409,
              code: 'CHARACTER_ID_REQUIRED',
              extra: { askUser: true, characters: characters.map((character) => ({ id: character.id, filename: character.filename, alt: character.alt || character.filename })) }
            })
          }
          if (args.useCharacter === true && args.characterId && !characters.some((character) => String(character.id) === String(args.characterId) || character.filename === args.characterId)) {
            throw Object.assign(new Error('El personaje elegido no pertenece al brand kit activo.'), { status: 409, code: 'CHARACTER_NOT_FOUND' })
          }
          const prepared = prepareImageGeneration(scope.siteHandle, normalizeImagePreparationArgs(args), { canonicalSnapshot })
          await persistImagePreparation(prepared, {
            workspaceId: scope?.workspaceId || auth?.workspaceId,
            siteId: scope?.siteId,
            itemId: args.itemId,
            batchId: args.batchId,
            channel: args.channel
          })
          console.info(JSON.stringify({
            event: name === 'brand_get_style_board' ? 'brand_style_board_created' : 'brand_image_preparation_created',
            preparationId: prepared.brandPreparation?.preparationId,
            site: scope.siteHandle,
            brandKitVersionId: prepared.brandKitVersionId,
            referenceCount: Array.isArray(prepared.resolvedReferences) ? prepared.resolvedReferences.length : 0,
            expectedAssetCount: Number(prepared.brandPreparation?.expectedAssetCount || 1)
          }))
          return preparedImageResult(prepared, { referenceIndex: args.referenceIndex })
        }
        case 'brand_recap_image_preparation': {
          const site = resolveToolSite(auth, args)
          const scope = await resolveContentScope(auth, { ...args, site })
          const preparation = await getImagePreparation(args.preparationId)
          if (!preparation) throw Object.assign(new Error('No existe la preparación visual.'), { status: 404, code: 'PREPARATION_NOT_FOUND' })
          if (preparation.site !== scope.siteHandle || preparation.workspaceId !== scope.workspaceId || (preparation.siteId && preparation.siteId !== scope.siteId)) {
            throw Object.assign(new Error('La preparación no pertenece a esta marca.'), { status: 409, code: 'PREPARATION_SITE_MISMATCH' })
          }
          const payload = preparedPayloadFromStoredPreparation(preparation)
          return textResult({
            preparationId: preparation.preparationId,
            site: preparation.site,
            assetType: preparation.assetType,
            route: preparation.route,
            expectedAssetCount: Number(preparation.expectedAssetCount || 1),
            brandKitVersionId: preparation.brandKitVersionId,
            brandKitSnapshotHash: preparation.brandKitSnapshotHash,
            references: (preparation.expectedReferences || []).map((reference, position) => ({
              index: Number.isInteger(reference.index) ? reference.index : position,
              filename: reference.filename,
              sha256: reference.sha256 || '',
              required: reference.required !== false
            })),
            generationPrompt: payload.generationPrompt || '',
            negativeRules: payload.negativeRules || [],
            canonicalPalette: payload.canonicalPalette || null,
            composition: payload.composition || null,
            deliveryMode: 'style_board',
            imageBlocks: 0,
            nextToolCall: preparation.itemId
              ? { tool: 'content_upload_media', arguments: { site: preparation.site, preparationId: preparation.preparationId, itemId: preparation.itemId } }
              : { tool: 'content_upload_media', arguments: { site: preparation.site, preparationId: preparation.preparationId } },
            instruction: 'Sin binarios. Si necesitas el style board otra vez, llama brand_prepare_image_generation con preparationId.'
          })
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
                content: args.content,
                expectedActiveVersionId: args.expectedActiveVersionId,
                idempotencyKey: args.idempotencyKey
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
          if (Object.prototype.hasOwnProperty.call(args, 'composeMode')) {
            throw Object.assign(new Error('composeMode ya no forma parte del contrato. El CMS guarda siempre la imagen final tal cual.'), { status: 409, code: 'CMS_COMPOSITION_DISABLED' })
          }
          const scope = await resolveContentScope(auth, { ...args, site })
          const requestedKind = String(args.kind || '').toLowerCase()
          if (requestedKind && !['post', 'social', 'reference'].includes(requestedKind)) throw Object.assign(new Error('kind debe ser post, social o reference.'), { status: 400, code: 'MEDIA_KIND_INVALID' })
          const brandGroundingOverride = requestedKind === 'reference' ? null : await preparedUploadGrounding(site, scope, args)
          const kind = requestedKind || brandGroundingOverride.kind
          const itemId = brandGroundingOverride?.itemId || args.itemId || null
          const channels = brandGroundingOverride?.channels || args.channels || []
          const alt = args.alt || args.imageAlt || ''
          const uploaded = await cms.uploadMedia({
            ...args,
            alt,
            site,
            kind,
            brandGroundingOverride,
            requireBrandGrounding: ['post', 'social'].includes(kind),
            autoNormalize: kind === 'social' ? false : args.autoNormalize !== false,
            membershipUserId: scopedAuth.userId || ''
          })
          if (uploaded?.awaitingChunks) return textResult(uploaded)
          const asset = await registerContentMedia({
            workspaceId: scope.workspaceId,
            siteId: scope.siteId,
            userId: auth.userId,
            role: scope.role,
            media: uploaded.media,
            brandGrounding: uploaded.media?.brandGrounding || null,
            idempotencyKey: args.idempotencyKey || args.uploadId || '',
            idempotencyFingerprint: createHash('sha256').update(JSON.stringify({
              siteId: scope.siteId,
              filename: uploaded.media?.filename || '',
              sha256: uploaded.media?.sha256 || '',
              originalSha256: uploaded.media?.metadata?.originalSha256 || '',
              kind,
              alt,
              preparationId: args.preparationId || '',
              assetType: uploaded.media?.brandGrounding?.assetType || '',
              itemId: itemId || '',
              channels,
              assetIndex: Number(args.assetIndex ?? 0)
            })).digest('hex')
          })
          const attachment = ['post', 'social'].includes(kind)
            ? itemId
              ? await attachContentMedia({ workspaceId: scope.workspaceId, siteId: scope.siteId, itemId, userId: auth.userId, role: scope.role, mediaAssetId: asset.id, channels, assetIndex: args.assetIndex ?? 0 })
              : null
            : null
          const expectedAssetCount = Number(brandGroundingOverride?.expectedAssetCount || 1)
          const assetIndex = Number(brandGroundingOverride?.assetIndex ?? args.assetIndex ?? 0)
          const moreSlidesPending = Boolean(attachment && assetIndex + 1 < expectedAssetCount)
          const { suggestedPostPatch, suggestedTool, nextStep, reviewHint, ...safeUpload } = uploaded
          const previewUrl = attachment?.contentComplete && itemId
            ? contentItemPreviewUrl(itemId, attachment.batchId)
            : null
          const mediaPreviewUrl = absoluteMediaUrl(uploaded.media?.previewPath || uploaded.media?.previewUrl || uploaded.media?.path || uploaded.media?.url || '')
          const originalSha256 = uploaded.media?.metadata?.originalSha256 || uploaded.originalSha256 || null
          const finalSha256 = uploaded.media?.sha256 || uploaded.finalSha256 || null
          return textResult({
            ...safeUpload,
            mediaAsset: asset,
            mediaAssetId: asset.id,
            originalSha256,
            finalSha256,
            textRendered: Boolean(uploaded.media?.brandGrounding?.textRendered || uploaded.textRendered),
            previewUrl: mediaPreviewUrl || null,
            ...(kind !== 'reference' && !itemId ? { pendingMediaId: asset.id } : {}),
            attachment,
            operationStatus: kind === 'reference' ? 'complete' : attachment?.contentComplete ? 'ready_for_review' : moreSlidesPending ? 'in_progress' : attachment ? 'needs_completion' : 'upload_complete_attachment_pending',
            readyForReview: Boolean(attachment?.contentComplete),
            ...(previewUrl ? { previewUrl, dashboardUrl: dashboardUrl() } : {}),
            nextStep: kind === 'reference'
              ? 'Referencia (moodboard) guardada. No la asocies a blog/Instagram.'
              : attachment?.contentComplete
                ? `Pendiente de revisión humana. Comparte ${previewUrl}. La imagen guardada es el PNG final generado por ChatGPT.`
                : moreSlidesPending
                  ? `Slide ${assetIndex + 1} de ${expectedAssetCount} asociada. Sube las slides restantes con el mismo preparationId.`
                : attachment
                  ? `Medio asociado. Faltan estos campos antes de revisión: ${(attachment.incomplete || []).map((entry) => `${entry.channel}: ${entry.fields.join(', ')}`).join('; ')}`
              : `Medio guardado como pendingMediaId. Cuando exista el item, asócialo con content_attach_media usando mediaId "${asset.id}" (solo post/social con preparationId).`,
            suggestedTool: kind === 'reference' || attachment?.contentComplete || moreSlidesPending ? null : attachment ? 'content_get_batch' : 'content_attach_media',
            nextAction: attachment && !attachment.contentComplete && !moreSlidesPending
              ? { tool: 'content_get_batch', arguments: { batchId: attachment.batchId }, then: 'Recupera los bodies completos y usa content_update_item por canal para guardar cada body completo. No envíes solo los campos que faltan.' }
              : attachment?.contentComplete
                ? { tool: null, then: `Revisión humana en ${previewUrl}. No apruebes sin confirmación.` }
                : null,
            reviewHint: kind === 'reference' ? 'Moodboard guardado (no publicable).' : attachment?.contentComplete ? `Listo para revisión: ${previewUrl}` : attachment ? 'Medio asociado al item y a sus variantes.' : 'Medio guardado, pendiente de asociar a un item.'
          })
        }
        case 'content_attach_media': {
          const scope = await resolveContentScope(auth, args)
          const attachment = await attachContentMedia({
            workspaceId: scope.workspaceId,
            siteId: scope.siteId,
            itemId: args.itemId,
            userId: auth.userId,
            role: scope.role,
            mediaAssetId: args.mediaId,
            channels: args.channels,
            assetIndex: args.assetIndex
          })
          return textResult({
            ...attachment,
            readyForReview: attachment.contentComplete,
            approved: false,
            published: false,
            suggestedTool: attachment.contentComplete ? null : 'content_get_batch',
            nextAction: attachment.contentComplete
              ? null
              : { tool: 'content_get_batch', arguments: { batchId: attachment.batchId }, then: 'Recupera los bodies completos y usa content_update_item por canal para guardar cada body completo. No envíes solo los campos que faltan.' }
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
            kind: String(asset.metadata?.usage || 'reference').toLowerCase(),
            publicUrl: asset.publicUrl || null,
            contentType: asset.contentType || null,
            sizeBytes: asset.sizeBytes || null,
            sha256: asset.sha256 || null,
            visibility: asset.visibility || 'private',
            metadata: asset.metadata && typeof asset.metadata === 'object'
              ? {
                  alt: String(asset.metadata.alt || ''),
                  usage: String(asset.metadata.usage || 'reference').toLowerCase(),
                  ...(asset.metadata.characterId ? { characterId: String(asset.metadata.characterId) } : {})
                }
              : {}
          }))
          const characters = brandKit.assets.filter((asset) => asset.kind === 'character').map((asset) => ({
            id: asset.id,
            filename: asset.filename,
            alt: asset.metadata?.alt || asset.filename
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
            characters,
            characterPolicy: characters.length
              ? { askBeforeUse: false, instruction: 'No uses personajes salvo que el usuario lo pida. Si lo pide, conserva sus rasgos faciales y usa useCharacter=true.' }
              : { askBeforeUse: false },
            files: brandKit.files || {},
            channels,
            connections,
            brandKit
          })
        }
        case 'content_create_batch': {
          const scope = await resolveContentScope(auth, args)
          const requestedChannels = [...new Set((Array.isArray(args.channels) && args.channels.length
            ? args.channels
            : (args.items || []).flatMap((item) => Object.keys(item?.variants || {}))).map((channel) => String(channel).toLowerCase()))]
          const enabled = new Set((await listSiteChannels({ workspaceId: scope.workspaceId, siteId: scope.siteId }))
            .filter((channel) => channel.enabled).map((channel) => channel.channel))
          const activeChannels = requestedChannels.filter((channel) => enabled.has(channel))
          const unavailableChannels = requestedChannels.filter((channel) => !enabled.has(channel))
          if (!activeChannels.length) throw Object.assign(new Error('No hay canales activos para crear esta campaña.'), { status: 409, code: 'NO_ACTIVE_CONTENT_CHANNELS', extra: { unavailableChannels } })
          const activeItems = (args.items || []).map((item) => ({
            ...item,
            variants: Object.fromEntries(Object.entries(item?.variants || {}).filter(([channel]) => activeChannels.includes(channel.toLowerCase())))
          }))
          const result = await createContentBatch({ workspaceId: scope.workspaceId, siteId: scope.siteId, userId: auth.userId || null, role: scope.role, title: args.title, topics: args.topics, items: activeItems, batchId: args.batchId, channels: activeChannels, brandKitVersionId: args.brandKitVersionId, metadata: { ...(args.metadata || {}), contentBrief: args.brief || args.metadata?.contentBrief }, idempotencyKey: args.idempotencyKey })
          return textResult({
            ...result,
            unavailableChannels,
            channelAvailability: {
              active: activeChannels,
              unavailable: unavailableChannels,
              message: unavailableChannels.length ? `Se omitieron canales desactivados: ${unavailableChannels.join(', ')}.` : 'Todos los canales solicitados están activos.'
            }
          })
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
            items: await listContentItemSummaries({ workspaceId: scope.workspaceId, siteId: scope.siteId, batchId: args.batchId, status: args.status, channel: args.channel, query: args.query, limit: args.limit })
          })
        }
        case 'content_get_item': {
          const scope = await resolveContentScope(auth, args)
          return textResult(await getContentItem({ workspaceId: scope.workspaceId, siteId: scope.siteId, itemId: args.itemId }))
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
        case 'video_create_job': {
          const scope = await resolveContentScope(auth, args)
          return textResult(await createVideoJob({
            workspaceId: scope.workspaceId,
            siteId: scope.siteId,
            siteHandle: scope.siteHandle,
            userId: auth.userId,
            role: scope.role,
            contentItemId: args.contentItemId,
            sourceMediaId: args.sourceMediaId,
            provider: args.provider,
            speaker: args.speaker,
            channel: args.channel,
            format: args.format,
            objective: args.objective,
            topic: args.topic,
            metadata: args.metadata,
            idempotencyKey: args.idempotencyKey,
            createContentIfMissing: args.createContentIfMissing === true
          }))
        }
        case 'video_get_job': {
          const scope = await resolveContentScope(auth, args)
          return textResult(await getVideoJob({
            workspaceId: scope.workspaceId,
            siteId: scope.siteId,
            siteHandle: scope.siteHandle,
            videoJobId: args.videoJobId,
            contentItemId: args.contentItemId
          }))
        }
        case 'video_update_job': {
          const scope = await resolveContentScope(auth, args)
          return textResult(await updateVideoJob({
            workspaceId: scope.workspaceId,
            siteId: scope.siteId,
            videoJobId: args.videoJobId,
            userId: auth.userId,
            role: scope.role,
            status: args.status,
            provider: args.provider,
            providerProjectId: args.providerProjectId,
            providerCompositionId: args.providerCompositionId,
            speaker: args.speaker,
            channel: args.channel,
            format: args.format,
            objective: args.objective,
            topic: args.topic,
            metadata: args.metadata,
            caption: args.caption,
            readyForReview: args.readyForReview === true,
            skipEdit: args.skipEdit === true
          }))
        }
        case 'video_upload_media': {
          const scope = await resolveContentScope(auth, args)
          const uploaded = await ingestVideoUpload({
            workspaceId: scope.workspaceId,
            siteId: scope.siteId,
            siteHandle: scope.siteHandle,
            userId: auth.userId,
            role: scope.role,
            payload: args,
            format: args.format === 'landscape' ? 'landscape' : 'portrait',
            contentItemId: args.contentItemId,
            videoJobId: args.videoJobId,
            attachToItem: Boolean(args.contentItemId)
          })
          if (uploaded.awaitingChunks) return textResult(uploaded)
          return textResult(uploaded)
        }
        case 'video_import_external_media': {
          const scope = await resolveContentScope(auth, args)
          return textResult(await importExternalVideoMedia({
            workspaceId: scope.workspaceId,
            siteId: scope.siteId,
            siteHandle: scope.siteHandle,
            userId: auth.userId,
            role: scope.role,
            videoJobId: args.videoJobId,
            sourceUrl: args.sourceUrl,
            idempotencyKey: args.idempotencyKey
          }))
        }
        case 'video_list_jobs': {
          const scope = await resolveContentScope(auth, args)
          return textResult({
            site: { id: scope.siteId, handle: scope.siteHandle },
            jobs: await listVideoJobs({ workspaceId: scope.workspaceId, siteId: scope.siteId, status: args.status, limit: args.limit })
          })
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
          const mode = args.mode === 'guided' ? 'guided' : 'easy'
          const workflowDb = readDb()
          const cmsAiEnabled = isCmsAiEnabled({ db: workflowDb })
          const workflow = getWorkflowFlags(workflowDb)
          return textResult(workflowPayload({
            site, mode, enabled: true, generationEngine: 'chatgpt', cmsAiAllowed: false,
            assistantEnabled: cmsAiEnabled && workflow.assistantEnabled,
            blogWizardEnabled: cmsAiEnabled && workflow.blogWizardEnabled,
            appBaseUrl: appUrl('/'),
            routes: { preview: appUrl('/preview/{slug}'), posts: `${appUrl('/posts')}?site=${encodeURIComponent(site)}` },
            steps: ['Lee brand_get_context.', 'Escribe y guarda los textos completos con content_create_batch.', 'Prepara imágenes con brand_prepare_image_generation.', 'Genera en ChatGPT cada imagen final con el copy exacto integrado y súbela con content_upload_media.', 'Espera la revisión humana antes de aprobar o programar.'],
            modes: { easy: { steps: ['Genera textos e imágenes en un flujo directo', 'Guarda los medios y revisa readyForReview'] }, guided: { steps: ['Guarda el borrador', 'Revísalo en la app antes de aprobar'] } },
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
            const draft = await createBrandKitVersion({ workspaceId: scope.workspaceId, siteId: scope.siteId, userId: auth.userId, role: scope.role, manifest: imported.brand?.files || {}, status: 'draft' })
            const origin = cmsOrigin()
            // Reference images are visual guidance, not private credentials.
            // Keep them scoped to the brand and readable by editors through
            // the role-limited asset policy.
            const metadataByName = new Map((imported.importedImageMetadata || []).map((asset) => [String(asset.filename || '').toLowerCase(), asset]))
            const assets = (imported.importedImages || []).map((name) => {
              const declared = metadataByName.get(String(name).toLowerCase()) || {}
              const { filename: _filename, alt: _alt, ...metadata } = declared
              return {
                name,
                storageKey: `media/${site}/reference/${name}`,
                publicUrl: `${origin}/media/${site}/reference/${encodeURIComponent(name)}`,
                visibility: 'role_limited',
                metadata: { source: 'brand-kit', ...metadata, ...(declared.alt ? { alt: declared.alt } : {}) }
              }
            })
            await registerBrandAssets({ workspaceId: scope.workspaceId, siteId: scope.siteId, brandKitVersionId: draft.id, userId: auth.userId, role: scope.role, assets })
            const version = await publishBrandKitVersion({ workspaceId: scope.workspaceId, siteId: scope.siteId, userId: auth.userId, role: scope.role, versionId: draft.id, expectedActiveVersionId: draft.baseVersionId || null })
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
