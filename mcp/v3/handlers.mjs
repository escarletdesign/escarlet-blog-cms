import { createHash } from 'node:crypto'
import { assertSiteAccess } from '../../lib/auth.mjs'
import { getBrandContext, getMotionBrandAssets, loadActiveBrandKitSnapshot, prepareImageGeneration, validateImagePreparation } from '../../lib/brand-kit.mjs'
import { buildBrandOsMetadata } from '../../lib/brand-os.mjs'
import { assertAssetTypeForMediaKind, assertSocialTextMetadata, getImagePreparation, issueGenerationReceipt, persistImagePreparation } from '../../lib/generation-provenance.mjs'
import { getActiveBrandKit, resolveWorkspaceContext } from '../../lib/workspace-domain.mjs'
import { getPgPool } from '../../lib/pg.mjs'
import { cancelVideoJob, createVideoJob, getVideoJob, retryVideoJob, updateVideoJob } from '../../lib/video-jobs.mjs'
import { uploadMedia } from '../../lib/cms-ops.mjs'
import {
  attachContentMedia,
  approveContentBatch,
  createContentBatch,
  getContentBatch,
  listContentPlans,
  registerContentMedia,
  scheduleContentBatch,
  scheduleContentItem
} from '../../lib/workspace-domain.mjs'
import { mediaDir } from '../../lib/db.mjs'
import { renderProductTransform } from '../../lib/product-renderer.mjs'
import { resolve as resolvePath, join } from 'node:path'
import { deleteCanonicalMedia, listCanonicalMedia } from '../../lib/media-admin.mjs'
import {
  getPublicationStatus,
  listPublicationDestinations,
  preparePublication,
  publishPublication,
  routePublication,
  schedulePublication,
  validatePublicationCompatibility
} from '../../lib/publication/index.mjs'
import { getPublicationRun, persistPublicationOperation } from '../../lib/publication/persistence.mjs'
import { MCP_V3_CONTRACT, MOTION_FORMAT_PROFILES } from './catalog.mjs'

const FORMAT_ASSET_TYPES = Object.freeze({
  blog: 'blog_cover',
  blog_cover: 'blog_cover',
  social: 'social_image',
  instagram_post: 'social_image',
  instagram_story: 'instagram_story',
  story: 'instagram_story'
})

const ROLE_PERMISSIONS = Object.freeze({
  admin: ['*'],
  owner: ['brand:read', 'asset:read', 'asset:write', 'copy:validate', 'generation:prepare', 'generation:provenance', 'generation:run', 'production:motion', 'publication:read', 'publication:write', 'publication:publish', 'content:read', 'content:write', 'content:publish'],
  agency_admin: ['brand:read', 'asset:read', 'asset:write', 'copy:validate', 'generation:prepare', 'generation:provenance', 'generation:run', 'production:motion', 'publication:read', 'publication:write', 'publication:publish', 'content:read', 'content:write', 'content:publish'],
  editor: ['brand:read', 'asset:read', 'asset:write', 'copy:validate', 'generation:prepare', 'generation:provenance', 'generation:run', 'production:motion', 'publication:read', 'publication:write', 'content:read', 'content:write', 'content:publish'],
  author: ['brand:read', 'asset:read', 'asset:write', 'copy:validate', 'generation:prepare', 'generation:provenance', 'generation:run', 'production:motion', 'publication:read', 'content:read', 'content:write'],
  client: ['brand:read', 'asset:read', 'asset:write', 'copy:validate', 'generation:prepare', 'generation:provenance', 'generation:run', 'production:motion', 'publication:read', 'content:read'],
  viewer: ['brand:read', 'asset:read', 'publication:read'],
  agent: ['brand:read', 'asset:read', 'asset:write', 'copy:validate', 'generation:prepare', 'generation:provenance', 'generation:run', 'production:motion', 'publication:read', 'publication:write', 'content:read', 'content:write', 'content:publish']
})

function authPermissions(auth = {}) {
  if (Array.isArray(auth.permissions) && auth.permissions.length) return [...new Set(auth.permissions)]
  if (Array.isArray(auth.capabilities)) {
    const mapped = [...(ROLE_PERMISSIONS[auth.role] || [])]
    if (auth.capabilities.includes('posts:publish_live') || auth.capabilities.includes('content_publishing')) mapped.push('publication:write')
    if (auth.capabilities.includes('brand:full') || auth.capabilities.includes('brand:limited')) mapped.push('brand:read')
    if (auth.capabilities.includes('posts:read')) mapped.push('publication:read', 'asset:read')
    if (auth.capabilities.includes('posts:write')) mapped.push('asset:write')
    return [...new Set(mapped)]
  }
  return [...(ROLE_PERMISSIONS[auth.role] || [])]
}

function siteFor(args, auth) {
  const site = String(args?.site || args?.brandId || auth?.site || '').trim().toLowerCase()
  if (!site) throw Object.assign(new Error('site o brandId es obligatorio.'), { code: 'site_required', status: 422 })
  assertSiteAccess({ ...auth, role: auth?.role === 'agent' ? 'editor' : auth?.role }, site)
  return site
}

function contextProjection(context) {
  const {
    files,
    agentRules,
    reminder,
    ...publicContext
  } = context || {}
  return publicContext
}

function formatAssetType(args = {}) {
  return String(args.assetType || FORMAT_ASSET_TYPES[String(args.formatProfile || '').toLowerCase()] || 'blog_cover')
}

function preparationInput(args = {}) {
  return {
    ...args,
    assetType: formatAssetType(args),
    title: args.title || args.topic || args.purpose,
    topic: args.topic || args.text || args.purpose,
    textContent: args.textContent || (args.text ? { body: args.text } : undefined)
  }
}

async function activeBrandOptions(site, args, auth) {
  const workspaceId = String(args.workspaceId || auth.workspaceId || '').trim()
  const siteId = String(args.siteId || auth.siteId || '').trim()
  if (!workspaceId || !siteId || !(await getPgPool())) return {}
  try {
    const active = await getActiveBrandKit({ workspaceId, siteId })
    return {
      canonicalManifest: active.manifest,
      canonicalAssets: active.assets,
      brandKitVersionId: active.id,
      brandKitVersion: { id: active.id, version: active.version, status: active.status },
      canonicalSnapshot: loadActiveBrandKitSnapshot(site, {
        manifest: active.manifest,
        assets: active.assets,
        brandKitVersionId: active.id,
        version: active.version
      })
    }
  } catch {
    return {}
  }
}

function publicationInput(args, auth) {
  const permissions = authPermissions(auth)
  return {
    ...args,
    assets: Array.isArray(args.assets) ? args.assets : (Array.isArray(args.assetIds) ? args.assetIds.map((assetId) => ({ assetId })) : args.assets),
    permissions: permissions.includes('*')
      ? ['publication:read', 'publication:write', 'publication:publish', 'publication:route', 'publication:prepare', 'publication:schedule']
      : permissions
  }
}

async function registerAssetReference(args, auth, runtime) {
  const assetId = String(args.assetId || '').trim()
  if (!assetId) throw Object.assign(new Error('assetId es obligatorio.'), { code: 'asset_id_required', status: 422 })
  const workspaceId = String(args.workspaceId || auth.workspaceId || '').trim()
  const siteId = String(args.siteId || auth.siteId || '').trim()
  if (!workspaceId || !siteId) throw Object.assign(new Error('workspaceId y siteId son obligatorios para registrar la procedencia.'), { code: 'asset_scope_required', status: 422 })
  if (typeof runtime?.registerAssetReference === 'function') {
    return runtime.registerAssetReference({ ...args, assetId, workspaceId, siteId }, { auth })
  }
  const pool = await getPgPool()
  if (!pool) throw Object.assign(new Error('Postgres no está configurado.'), { code: 'postgres_required', status: 503, retryable: true })
  const result = await pool.query(
    'SELECT id,sha256,content_type AS "mimeType",storage_key AS "storageKey" FROM media_assets WHERE id=$1 AND workspace_id=$2 AND site_id=$3',
    [assetId, workspaceId, siteId]
  )
  if (!result.rowCount) throw Object.assign(new Error('El asset no existe o no pertenece a esta marca.'), { code: 'asset_not_found', status: 404 })
  const asset = result.rows[0]
  const requestedHash = String(args.sha256 || '').trim().toLowerCase()
  const storedHash = String(asset.sha256 || '').trim().toLowerCase()
  if (requestedHash && storedHash && requestedHash !== storedHash) {
    throw Object.assign(new Error('El sha256 declarado no coincide con el asset registrado.'), { code: 'asset_hash_mismatch', status: 409 })
  }
  return {
    contractVersion: 'os.production.v1',
    assetId: asset.id,
    sha256: storedHash || requestedHash || null,
    mimeType: asset.mimeType || null,
    provenance: { workspaceId, siteId, storageKey: asset.storageKey || null, source: 'media_assets' }
  }
}

async function canonicalAssetScope(args, auth) {
  const workspaceId = String(args.workspaceId || auth.workspaceId || '').trim()
  const siteId = String(args.siteId || auth.siteId || '').trim()
  if (!workspaceId || !siteId) throw Object.assign(new Error('workspaceId y siteId son obligatorios para operar sobre assets canónicos.'), { code: 'asset_scope_required', status: 422 })
  const site = String(args.site || auth.site || '').trim()
  if (site) siteFor({ site }, auth)
  if (auth.role !== 'admin') {
    if (auth.workspaceId && workspaceId !== String(auth.workspaceId).trim()) {
      throw Object.assign(new Error('El workspace del asset no pertenece al contexto autenticado.'), { code: 'asset_scope_forbidden', status: 403 })
    }
    if (auth.siteId && siteId !== String(auth.siteId).trim()) {
      throw Object.assign(new Error('El sitio del asset no pertenece al contexto autenticado.'), { code: 'asset_scope_forbidden', status: 403 })
    }
    if (!auth.siteId) {
      const membership = await resolveWorkspaceContext({ userId: auth.userId || undefined, workspaceId, siteId })
      if (!membership.sites.some((entry) => entry.id === siteId)) {
        throw Object.assign(new Error('Sin acceso al sitio indicado.'), { code: 'asset_scope_forbidden', status: 403 })
      }
    }
  }
  return { workspaceId, siteId }
}

async function listCanonicalAssets(args, auth) {
  const scope = await canonicalAssetScope(args, auth)
  return { contractVersion: 'os.production.v1', capability: 'asset.list', ...await listCanonicalMedia({ ...scope, mode: args.mode, temporaryOnly: args.temporaryOnly === true, assetIds: args.assetIds, limit: args.limit }) }
}

async function deleteCanonicalAssets(args, auth) {
  if (!['admin', 'owner'].includes(String(auth.role || '').toLowerCase())) {
    throw Object.assign(new Error('Sólo owner o admin pueden eliminar assets canónicos.'), { code: 'media_delete_forbidden', status: 403 })
  }
  const scope = await canonicalAssetScope(args, auth)
  return { contractVersion: 'os.production.v1', capability: 'asset.delete', ...await deleteCanonicalMedia({ ...scope, userId: auth.userId, role: String(auth.role || '').toLowerCase(), mode: args.mode, assetIds: args.assetIds, confirm: args.confirm, idempotencyKey: args.idempotencyKey }) }
}

async function uploadGeneratedAsset(args, auth, runtime) {
  const site = siteFor(args, auth)
  const requestedKind = String(args.kind || '').trim().toLowerCase()
  const preparationId = String(args.preparationId || '').trim()
  if (requestedKind !== 'reference' && !preparationId) throw Object.assign(new Error('asset.upload necesita preparationId para assets publicables.'), { code: 'brand_preparation_required', status: 422 })
  const scope = await motionScope(args, auth, runtime)
  let preparation = null
  let brandGrounding = null

  if (requestedKind !== 'reference') {
    preparation = await getImagePreparation(preparationId)
    if (!preparation) throw Object.assign(new Error('No existe la preparación visual.'), { code: 'preparation_not_found', status: 404 })
    if (preparation.site !== site || (preparation.workspaceId && preparation.workspaceId !== scope.workspaceId) || (preparation.siteId && preparation.siteId !== scope.siteId)) {
      throw Object.assign(new Error('La preparación no pertenece a esta marca.'), { code: 'preparation_site_mismatch', status: 409 })
    }
    if (preparation.generationBlocked || preparation.state === 'blocked') throw Object.assign(new Error('La preparación visual está bloqueada.'), { code: 'generation_blocked', status: 409 })
    if (preparation.expiresAt && new Date(preparation.expiresAt).getTime() <= Date.now()) throw Object.assign(new Error('La preparación visual ha expirado.'), { code: 'preparation_expired', status: 409 })
    const assetType = String(args.assetType || preparation.assetType || '').trim()
    const validation = validateImagePreparation(site, preparationId, {
      assetType,
      route: preparation.route,
      expectedAssetCount: preparation.expectedAssetCount,
      itemId: preparation.itemId || args.itemId,
      batchId: preparation.batchId || args.batchId,
      channel: preparation.channel || args.channel
    })
    if (!validation.ok) throw Object.assign(new Error('La preparación no coincide con el Brand Kit actual.'), { code: validation.code || 'brand_grounding_stale', status: 409, details: validation })
    const kind = requestedKind || (assetType === 'blog_cover' ? 'post' : ['social_image', 'instagram_story'].includes(assetType) ? 'social' : '')
    if (!['post', 'social'].includes(kind)) throw Object.assign(new Error('kind debe ser post o social para una preparación visual.'), { code: 'media_kind_required', status: 422 })
    assertAssetTypeForMediaKind(kind, assetType)
    const assetIndex = Number(args.assetIndex ?? 0)
    if (!Number.isInteger(assetIndex) || assetIndex < 0 || assetIndex >= Number(preparation.expectedAssetCount || 1)) throw Object.assign(new Error('assetIndex no pertenece a esta preparación.'), { code: 'asset_index_mismatch', status: 409 })
    const channels = Array.isArray(args.channels) && args.channels.length
      ? [...new Set(args.channels.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))]
      : preparation.channel ? [String(preparation.channel).toLowerCase()] : []
    const socialText = ['social_image', 'instagram_story'].includes(assetType)
      ? assertSocialTextMetadata({ assetType, textRendered: args.textRendered, templateId: args.templateId, renderedBy: args.renderedBy, textContent: args.textContent })
      : null
    brandGrounding = {
      provenanceVersion: '3',
      brandPreparationId: preparation.preparationId,
      brandKitVersionId: preparation.brandKitVersionId,
      brandKitSnapshotHash: preparation.brandKitSnapshotHash,
      brandRoute: preparation.route,
      assetType,
      kind,
      resolvedReferenceIds: (preparation.expectedReferences || []).map((reference) => reference.id),
      resolvedReferenceHashes: (preparation.expectedReferences || []).map((reference) => reference.sha256),
      itemId: args.itemId || preparation.itemId || null,
      channels,
      assetIndex,
      expectedAssetCount: Number(preparation.expectedAssetCount || 1),
      ...(socialText || {}),
      generatedAt: new Date().toISOString()
    }
  }

  const kind = brandGrounding?.kind || requestedKind || 'reference'
  const uploaded = await uploadMedia({
    ...args,
    site,
    kind,
    brandGroundingOverride: brandGrounding,
    requireBrandGrounding: kind !== 'reference',
    autoNormalize: false,
    membershipUserId: auth.userId || ''
  })
  if (uploaded?.awaitingChunks) return { contractVersion: 'os.production.v1', ...uploaded, status: 'uploading' }
  const asset = await registerContentMedia({
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
    userId: auth.userId,
    role: auth.role === 'agent' ? 'editor' : auth.role,
    media: uploaded.media,
    brandGrounding: uploaded.media?.brandGrounding || brandGrounding,
    idempotencyKey: args.idempotencyKey || '',
    idempotencyFingerprint: `${args.filename || ''}:${uploaded.finalSha256 || uploaded.media?.sha256 || ''}:${preparationId}:${args.assetIndex ?? 0}`
  })
  let attachment = null
  if (brandGrounding?.itemId && brandGrounding.channels?.length) {
    attachment = await attachContentMedia({
      workspaceId: scope.workspaceId,
      siteId: scope.siteId,
      itemId: brandGrounding.itemId,
      userId: auth.userId,
      role: auth.role === 'agent' ? 'editor' : auth.role,
      mediaAssetId: asset.id,
      channels: brandGrounding.channels,
      assetIndex: brandGrounding.assetIndex
    })
  }
  const receipt = preparation
    ? await issueGenerationReceipt({
        site,
        preparationId: preparation.preparationId,
        usedReferences: preparation.expectedReferences || [],
        generatedResultId: asset.id,
        generatedFileHash: uploaded.finalSha256 || uploaded.media?.sha256,
        itemId: brandGrounding.itemId || undefined,
        batchId: preparation.batchId || undefined,
        channel: preparation.channel || undefined,
        assetType: preparation.assetType,
        route: preparation.route,
        textRendered: brandGrounding?.textRendered,
        templateId: brandGrounding?.templateId,
        renderedBy: brandGrounding?.renderedBy,
        textContent: brandGrounding?.textContent
      })
    : null
  return {
    contractVersion: 'os.production.v1',
    capability: 'asset.upload',
    status: attachment?.contentComplete || !brandGrounding?.itemId ? 'ready_for_review' : 'uploaded',
    assetId: asset.id,
    asset,
    media: uploaded.media,
    attachment,
    receipt,
    provenance: brandGrounding ? { ...brandGrounding, receiptId: receipt?.receiptId || null } : null,
    nextAction: attachment?.contentComplete || !brandGrounding?.itemId ? 'human_review' : 'attach_to_content_item'
  }
}

async function persistPublicationIfScoped(contract, args, auth, runtime) {
  const workspaceId = String(args.workspaceId || auth.workspaceId || '').trim()
  if (!workspaceId || !contract?.publicationId || !contract?.idempotencyKey) return contract
  if (typeof runtime?.persistPublicationOperation === 'function') {
    return runtime.persistPublicationOperation(contract, {
      workspaceId,
      siteId: args.siteId || auth.siteId,
      siteHandle: args.site || args.brandId || auth.site,
      userId: auth.userId || null,
      metadata: { source: 'mcp.v3' }
    })
  }
  return persistPublicationOperation(contract, {
    workspaceId,
    siteId: args.siteId || auth.siteId,
    siteHandle: args.site || args.brandId || auth.site,
    userId: auth.userId || null,
    metadata: { source: 'mcp.v3' }
  })
}

async function contentCampaignAction(name, args, auth, runtime) {
  const scope = await motionScope(args, auth, runtime)
  const role = (scope.role || auth.role) === 'agent' ? 'editor' : (scope.role || auth.role)
  const shared = { workspaceId: scope.workspaceId, siteId: scope.siteId, userId: auth.userId, role, quotaExempt: Boolean(auth.systemAdmin) }
  const campaignId = args.campaignId || args.batchId
  const listCampaigns = typeof runtime?.listContentPlans === 'function' ? runtime.listContentPlans : listContentPlans
  const getCampaign = typeof runtime?.getContentBatch === 'function' ? runtime.getContentBatch : getContentBatch
  const createCampaign = typeof runtime?.createContentBatch === 'function' ? runtime.createContentBatch : createContentBatch
  const approveCampaign = typeof runtime?.approveContentBatch === 'function' ? runtime.approveContentBatch : approveContentBatch
  const scheduleCampaign = typeof runtime?.scheduleContentBatch === 'function' ? runtime.scheduleContentBatch : scheduleContentBatch
  const attachMedia = typeof runtime?.attachContentMedia === 'function' ? runtime.attachContentMedia : attachContentMedia
  if (name === 'content.campaign.list') {
    return {
      contractVersion: MCP_V3_CONTRACT,
      capability: name,
      campaigns: await listCampaigns({ workspaceId: scope.workspaceId, siteId: scope.siteId, status: args.status, channel: args.channel, query: args.query, limit: args.limit })
    }
  }
  if (name === 'content.campaign.get') {
    return { contractVersion: MCP_V3_CONTRACT, capability: name, campaign: await getCampaign({ workspaceId: scope.workspaceId, siteId: scope.siteId, batchId: campaignId }) }
  }
  if (name === 'content.campaign.create') {
    const metadata = { ...(args.metadata && typeof args.metadata === 'object' ? args.metadata : {}) }
    if (args.brief && !metadata.contentBrief) metadata.contentBrief = args.brief
    return {
      contractVersion: MCP_V3_CONTRACT,
      capability: name,
      campaign: await createCampaign({
        ...shared,
        title: args.title,
        topics: args.topics,
        items: args.items,
        channels: args.channels,
        brandKitVersionId: args.brandKitVersionId,
        metadata,
        idempotencyKey: args.idempotencyKey
      })
    }
  }
  if (name === 'content.campaign.approve') {
    return { contractVersion: MCP_V3_CONTRACT, capability: name, ...await approveCampaign({ ...shared, batchId: campaignId }) }
  }
  if (name === 'content.campaign.schedule') {
    return {
      contractVersion: MCP_V3_CONTRACT,
      capability: name,
      ...await scheduleCampaign({ ...shared, batchId: campaignId, channels: args.channels, publicationDate: args.publicationDate, timezone: args.timezone || 'UTC' })
    }
  }
  if (name === 'content.campaign.publish') {
    const campaign = await getCampaign({ workspaceId: scope.workspaceId, siteId: scope.siteId, batchId: campaignId })
    const channels = [...new Set((Array.isArray(args.channels) ? args.channels : []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))]
    if (!channels.length) throw Object.assign(new Error('channels debe contener al menos un canal.'), { code: 'content_channels_required', status: 422 })
    const variants = (campaign.items || []).flatMap((item) => (item.variants || []).filter((variant) => channels.includes(String(variant.channel || '').toLowerCase())))
    if (variants.length && variants.every((variant) => ['scheduled', 'syncing', 'published'].includes(String(variant.scheduleStatus || variant.status)))) {
      return { contractVersion: MCP_V3_CONTRACT, capability: name, batchId: campaign.id, status: variants.every((variant) => String(variant.scheduleStatus || variant.status) === 'published') ? 'published' : 'scheduled', channels, items: campaign.items || [], idempotentReplay: true }
    }
    const publicationDate = args.publicationDate || new Date().toISOString()
    const scheduled = await scheduleCampaign({ ...shared, batchId: campaignId, channels, publicationDate, timezone: args.timezone || 'UTC', publishNow: true })
    return { contractVersion: MCP_V3_CONTRACT, capability: name, ...scheduled, status: scheduled.status || 'scheduled' }
  }
  if (name === 'content.media.attach') {
    return {
      contractVersion: MCP_V3_CONTRACT,
      capability: name,
      attachment: await attachMedia({ ...shared, itemId: args.itemId, mediaAssetId: args.mediaAssetId, channels: args.channels, assetIndex: args.assetIndex, createMissingVariants: args.createMissingVariants, removeReplacedAssets: args.removeReplacedAssets === true })
    }
  }
  return undefined
}

async function publishCoolifyContentItem(args, auth, runtime, publication) {
  const itemId = String(args.contentItemId || '').trim()
  if (!itemId) throw Object.assign(new Error('contentItemId es obligatorio para publicar el blog mediante Coolify.'), { code: 'content_item_required', status: 422 })
  const scope = await motionScope(args, auth, runtime)
  const publishItem = typeof runtime?.scheduleContentItem === 'function' ? runtime.scheduleContentItem : scheduleContentItem
  const execution = await publishItem({
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
    itemId,
    userId: auth.userId,
    role: (scope.role || auth.role) === 'agent' ? 'editor' : (scope.role || auth.role),
    channels: ['blog'],
    publicationDate: args.publicationDate || new Date().toISOString(),
    timezone: args.timezone || 'UTC',
    publishNow: true,
    quotaExempt: Boolean(auth.systemAdmin)
  })
  return {
    ...publication,
    state: 'publish_requested',
    status: 'publish_requested',
    contentItemId: itemId,
    execution,
    effects: { ...publication.effects, providerExecution: false, mutatesProvider: false, contentOutboxQueued: true },
    next: ['content.campaign.get', 'publication.status.get']
  }
}

function validateCopy(args, context) {
  const text = String(args.text || '').trim()
  const metadata = buildBrandOsMetadata({
    site: context.site,
    brandKitVersionId: context.brandKitVersionId,
    brandKitVersion: context.brandKitVersion,
    brandKitSnapshotHash: context.brandKitSnapshotHash,
    manifest: {
      'brand-core.json': context.brandCore || {},
      'voice.md': context.voice || ''
    },
    brief: { objective: args.purpose || args.channel || '', audience: args.audience || '', cta: args.cta || '' },
    variants: { input: { body: text } }
  })
  return {
    contractVersion: 'os.production.v1',
    valid: metadata.findings.every((finding) => finding.severity !== 'blocker'),
    findings: metadata.findings,
    brandKitVersionId: context.brandKitVersionId,
    brandKitSnapshotHash: context.brandKitSnapshotHash
  }
}

function motionProfile(formatProfile = '', format = '') {
  const requested = String(formatProfile || '').trim().toLowerCase()
  const explicitFormat = String(format || '').trim().toLowerCase()
  const profile = requested || (explicitFormat === 'landscape' || explicitFormat === 'youtube' ? 'youtube_landscape' : 'instagram_reel')
  const selected = MOTION_FORMAT_PROFILES[profile] || MOTION_FORMAT_PROFILES.instagram_reel
  return { profile: MOTION_FORMAT_PROFILES[profile] ? profile : 'instagram_reel', ...selected }
}

const MOTION_ASSET_ROLES = new Set(['source', 'slide', 'background', 'foreground', 'overlay', 'logo', 'audio', 'reference', 'icon', 'shape'])
const MOTION_PRESETS = new Set(['none', 'subtle_editorial', 'dynamic_editorial'])
const MOTION_TEXT_ANIMATIONS = new Set(['none', 'fade_in', 'fade_up', 'slide_left', 'slide_right'])
const MOTION_TEXT_POSITIONS = new Set(['top_left', 'center_left', 'bottom_left'])
const MOTION_TEXT_TONES = new Set(['auto', 'light', 'dark'])
const MOTION_TRANSITIONS = new Set(['none', 'crossfade', 'fade', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'circleopen', 'fadeblack', 'fadewhite'])
const MOTION_LAYER_ROLES = new Set(['background', 'foreground', 'overlay', 'logo', 'headline', 'body', 'caption', 'icon', 'shape'])
const MOTION_LAYER_ANIMATIONS = new Set(['none', 'fade_in', 'fade_up', 'slide_left', 'slide_right', 'scale_in', 'float', 'ken_burns', 'reveal', 'pop'])
const MOTION_EASINGS = new Set(['linear', 'ease_in', 'ease_out', 'ease_in_out', 'spring'])

function normalizeMotionAssets(args = {}) {
  const declared = [
    ...(Array.isArray(args.inputs) ? args.inputs : []),
    ...(Array.isArray(args.motionAssets) ? args.motionAssets : [])
  ]
  const normalized = []
  const seen = new Set()
  const append = (value, fallbackRole = '') => {
    const source = value && typeof value === 'object' ? value : { assetId: value }
    const assetId = String(source.assetId || source.id || '').trim()
    if (!assetId) throw Object.assign(new Error('Cada asset de motion necesita assetId.'), { code: 'motion_asset_id_required', status: 422 })
    const role = String(source.role || fallbackRole || 'source').trim().toLowerCase()
    if (!MOTION_ASSET_ROLES.has(role)) throw Object.assign(new Error(`Rol de asset de motion no válido: ${role}.`), { code: 'motion_asset_role_invalid', status: 422 })
    const key = `${assetId}:${role}`
    if (seen.has(key)) return
    seen.add(key)
    normalized.push({
      assetId,
      role,
      ...(source.kind ? { kind: String(source.kind).trim().toLowerCase() } : {}),
      ...(source.mimeType ? { mimeType: String(source.mimeType).trim().toLowerCase() } : {}),
      ...(source.sha256 ? { sha256: String(source.sha256).trim().toLowerCase() } : {})
    })
  }
  declared.forEach((value) => append(value))
  if (args.audioAsset && typeof args.audioAsset === 'object') append({ ...args.audioAsset, role: 'audio' })
  if (args.sourceMediaId) append({ assetId: args.sourceMediaId, role: 'source', kind: 'image' })
  if (args.audioAssetId) append({ assetId: args.audioAssetId, role: 'audio', kind: 'audio' })
  if (args.logoAssetId) append({ assetId: args.logoAssetId, role: 'logo', kind: 'image' })
  if (args.backgroundAssetId) append({ assetId: args.backgroundAssetId, role: 'background', kind: 'image' })
  const declaredScenes = [
    ...(Array.isArray(args.scenes) ? args.scenes : []),
    ...(Array.isArray(args.storyboard?.scenes) ? args.storyboard.scenes : [])
  ]
  if (declaredScenes.length) declaredScenes.forEach((scene) => {
    if (scene && typeof scene === 'object') {
      if (scene.assetId) append({ assetId: scene.assetId, role: 'source', kind: 'image' })
      if (scene.backgroundAssetId) append({ assetId: scene.backgroundAssetId, role: 'background', kind: 'image' })
      if (Array.isArray(scene.layers)) scene.layers.forEach((layer) => {
        if (layer?.assetId && ['background', 'foreground', 'overlay', 'logo', 'icon', 'shape'].includes(String(layer.role || '').trim().toLowerCase())) {
          append({ assetId: layer.assetId, role: String(layer.role).trim().toLowerCase(), kind: layer.role === 'logo' ? 'image' : undefined, mimeType: layer.role === 'logo' ? 'image/svg+xml' : undefined })
        }
      })
    }
  })
  return normalized
}

function normalizeMotionCopyBlocks(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 50).map((block, index) => {
    const source = block && typeof block === 'object' ? block : {}
    const headline = String(source.headline || '').replace(/[\u2014\u2013]/g, '-').trim().slice(0, 160)
    const body = String(source.body || '').replace(/[\u2014\u2013]/g, '-').trim().slice(0, 1000)
    const durationMs = Number(source.durationMs)
    return {
      sceneId: String(source.sceneId || `scene-${index + 1}`).trim().slice(0, 120),
      ...(headline ? { headline } : {}),
      ...(body ? { body } : {}),
      ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs: Math.min(120000, Math.round(durationMs)) } : {})
    }
  }).filter((block) => block.headline || block.body)
}

function finiteNumber(value, fallback = null) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function boundedNumber(value, minimum, maximum, fallback = null) {
  const number = finiteNumber(value, fallback)
  return number === null ? null : Math.min(maximum, Math.max(minimum, number))
}

function normalizeMotionKeyframes(value, layerId) {
  if (!Array.isArray(value)) return []
  const keyframes = value.slice(0, 24).map((frame, index) => {
    const source = frame && typeof frame === 'object' ? frame : {}
    const timeMs = finiteNumber(source.timeMs)
    if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > 120000) {
      throw Object.assign(new Error(`El keyframe ${index + 1} de ${layerId} tiene un timeMs inválido.`), { code: 'motion_keyframe_time_invalid', status: 422 })
    }
    const normalized = { timeMs: Math.round(timeMs) }
    const x = boundedNumber(source.x, -2000, 4000)
    const y = boundedNumber(source.y, -2000, 4000)
    const scale = boundedNumber(source.scale, 0.1, 4)
    const rotate = boundedNumber(source.rotate, -360, 360)
    const opacity = boundedNumber(source.opacity, 0, 1)
    if (x !== null) normalized.x = x
    if (y !== null) normalized.y = y
    if (scale !== null) normalized.scale = scale
    if (rotate !== null) normalized.rotate = rotate
    if (opacity !== null) normalized.opacity = opacity
    const easing = String(source.easing || '').trim().toLowerCase()
    if (easing && !MOTION_EASINGS.has(easing)) throw Object.assign(new Error(`Easing no permitido en ${layerId}: ${easing}.`), { code: 'motion_easing_invalid', status: 422 })
    if (easing) normalized.easing = easing
    return normalized
  }).sort((left, right) => left.timeMs - right.timeMs)
  for (let index = 1; index < keyframes.length; index += 1) {
    if (keyframes[index].timeMs === keyframes[index - 1].timeMs) throw Object.assign(new Error(`Los keyframes de ${layerId} no pueden repetir timeMs.`), { code: 'motion_keyframe_time_duplicate', status: 422 })
  }
  return keyframes
}

function normalizeMotionLayers(value, sceneIndex = 0, sceneDurationMs = 120000) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 24).map((layer, index) => {
    const source = layer && typeof layer === 'object' ? layer : {}
    const role = String(source.role || '').trim().toLowerCase()
    if (!MOTION_LAYER_ROLES.has(role)) throw Object.assign(new Error(`Rol de capa no válido en escena ${sceneIndex + 1}: ${role || 'vacío'}.`), { code: 'motion_layer_role_invalid', status: 422 })
    const layerId = String(source.layerId || `${role}-${index + 1}`).trim().slice(0, 120)
    const assetId = String(source.assetId || '').trim()
    const text = String(source.text || '').replace(/[\u2014\u2013]/g, '-').trim().slice(0, 2000)
    if (['background', 'foreground', 'overlay', 'logo', 'icon'].includes(role) && !assetId) throw Object.assign(new Error(`La capa ${layerId} necesita assetId.`), { code: 'motion_layer_asset_required', status: 422 })
    if (['headline', 'body', 'caption'].includes(role) && !assetId && !text) throw Object.assign(new Error(`La capa ${layerId} necesita text o assetId.`), { code: 'motion_layer_content_required', status: 422 })
    const animation = String(source.animation || 'none').trim().toLowerCase()
    if (!MOTION_LAYER_ANIMATIONS.has(animation)) throw Object.assign(new Error(`Animación no permitida en ${layerId}: ${animation}.`), { code: 'motion_layer_animation_invalid', status: 422 })
    const startMs = boundedNumber(source.startMs, 0, 120000)
    const endMs = boundedNumber(source.endMs, 0, 120000)
    if (startMs !== null && endMs !== null && endMs <= startMs) throw Object.assign(new Error(`La capa ${layerId} tiene un intervalo inválido.`), { code: 'motion_layer_timeline_invalid', status: 422 })
    if ((startMs !== null && startMs > sceneDurationMs) || (endMs !== null && endMs > sceneDurationMs)) throw Object.assign(new Error(`La capa ${layerId} excede la duración de su escena.`), { code: 'motion_layer_timeline_invalid', status: 422 })
    const normalized = { layerId, role, ...(assetId ? { assetId } : {}), ...(text ? { text } : {}), animation }
    for (const [key, minimum, maximum] of [['startMs', 0, 120000], ['endMs', 0, 120000], ['x', -2000, 4000], ['y', -2000, 4000], ['width', 1, 4000], ['height', 1, 4000], ['scale', 0.1, 4], ['rotate', -360, 360], ['opacity', 0, 1]]) {
      const number = boundedNumber(source[key], minimum, maximum)
      if (number !== null) normalized[key] = ['startMs', 'endMs'].includes(key) ? Math.round(number) : number
    }
    const easing = String(source.easing || '').trim().toLowerCase()
    if (easing && !MOTION_EASINGS.has(easing)) throw Object.assign(new Error(`Easing no permitido en ${layerId}: ${easing}.`), { code: 'motion_easing_invalid', status: 422 })
    if (easing) normalized.easing = easing
    const keyframes = normalizeMotionKeyframes(source.keyframes, layerId)
    if (keyframes.some((frame) => frame.timeMs > sceneDurationMs)) throw Object.assign(new Error(`Los keyframes de ${layerId} exceden la duración de su escena.`), { code: 'motion_keyframe_timeline_invalid', status: 422 })
    if (keyframes.length) normalized.keyframes = keyframes
    return normalized
  })
}

function normalizeMotionScenes(value, motionAssets, copyBlocks) {
  const declared = Array.isArray(value) ? value : []
  const visualAssets = motionAssets.filter((asset) => !['audio', 'logo', 'reference'].includes(asset.role))
  const source = declared.length
    ? declared
    : visualAssets.length > 1 || copyBlocks.length > 1
      ? visualAssets.map((asset, index) => ({ assetId: asset.assetId, ...(copyBlocks[index] || copyBlocks[0] || {}) }))
      : []
  return source.slice(0, 50).map((scene, index) => {
    const item = scene && typeof scene === 'object' ? scene : {}
    const assetId = String(item.assetId || visualAssets[index]?.assetId || visualAssets[0]?.assetId || '').trim()
    if (!assetId) throw Object.assign(new Error(`La escena ${index + 1} necesita assetId.`), { code: 'motion_scene_asset_required', status: 422 })
    const durationMs = Number(item.durationMs)
    return {
      sceneId: String(item.sceneId || `scene-${index + 1}`).trim().slice(0, 120),
      assetId,
      fit: String(item.fit || 'contain').toLowerCase() === 'cover' ? 'cover' : 'contain',
      ...(item.backgroundAssetId ? { backgroundAssetId: String(item.backgroundAssetId).trim() } : {}),
      ...(item.headline || item.title ? { headline: String(item.headline || item.title).replace(/[\u2014\u2013]/g, '-').trim().slice(0, 160) } : {}),
      ...(item.body || item.text ? { body: String(item.body || item.text).replace(/[\u2014\u2013]/g, '-').trim().slice(0, 1000) } : {}),
      ...(MOTION_TEXT_ANIMATIONS.has(String(item.textAnimation || '').trim().toLowerCase()) ? { textAnimation: String(item.textAnimation).trim().toLowerCase() } : {}),
      ...(MOTION_PRESETS.has(String(item.motionPreset || '').trim().toLowerCase()) ? { motionPreset: String(item.motionPreset).trim().toLowerCase() } : {}),
      ...(MOTION_TEXT_POSITIONS.has(String(item.textPosition || '').trim().toLowerCase()) ? { textPosition: String(item.textPosition).trim().toLowerCase() } : {}),
      ...(MOTION_TEXT_TONES.has(String(item.textTone || '').trim().toLowerCase()) ? { textTone: String(item.textTone).trim().toLowerCase() } : {}),
      ...(Array.isArray(item.layers) ? { layers: normalizeMotionLayers(item.layers, index, Number.isFinite(durationMs) && durationMs > 0 ? Math.min(120000, Math.round(durationMs)) : 120000) } : {}),
      ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs: Math.min(120000, Math.round(durationMs)) } : {})
    }
  })
}

function normalizeMotionStoryboard({ storyboard, scenes, motionAssets, copyBlocks, transition, formatProfile } = {}) {
  const source = storyboard && typeof storyboard === 'object' ? storyboard : {}
  let normalizedScenes = normalizeMotionScenes(source.scenes || scenes, motionAssets, copyBlocks)
  if (!normalizedScenes.length) {
    const fallbackAsset = motionAssets.find((asset) => !['audio', 'logo', 'reference'].includes(asset.role))
    if (fallbackAsset) normalizedScenes = normalizeMotionScenes([{ assetId: fallbackAsset.assetId, ...(copyBlocks[0] || {}) }], motionAssets, copyBlocks)
  }
  if (!normalizedScenes.length) throw Object.assign(new Error('El storyboard de motion necesita al menos una escena.'), { code: 'motion_storyboard_required', status: 422 })
  const selectedTransition = transition || source.transition || {}
  const requestedTransition = String(selectedTransition.type || 'crossfade').trim().toLowerCase()
  const transitionType = MOTION_TRANSITIONS.has(requestedTransition) ? requestedTransition : 'crossfade'
  const transitionDurationMs = Number(selectedTransition.durationMs)
  return {
    version: '1.0',
    ...(source.title ? { title: String(source.title).trim().slice(0, 160) } : {}),
    formatProfile,
    transition: { type: transitionType, durationMs: transitionType === 'none' ? 0 : Number.isFinite(transitionDurationMs) && transitionDurationMs >= 0 ? Math.min(1000, Math.round(transitionDurationMs)) : 400 },
    scenes: normalizedScenes
  }
}

async function assertMotionAssetsBelongToScope(motionAssets, scope) {
  const ids = [...new Set(motionAssets.map((asset) => asset.assetId).filter(Boolean))]
  if (!ids.length) return []
  const virtualBrandAssets = new Map(getMotionBrandAssets(scope.site).map((asset) => [asset.assetId || asset.id, asset]))
  const pool = await getPgPool()
  if (!pool) return []
  const rows = []
  const result = await pool.query(
    'SELECT id,content_type AS "mimeType",metadata FROM media_assets WHERE id=ANY($1::text[]) AND workspace_id=$2 AND site_id=$3',
    [ids, scope.workspaceId, scope.siteId]
  )
  rows.push(...result.rows)
  const brandAssets = await pool.query(`
    SELECT ba.id,ba.content_type AS "mimeType",ba.metadata
    FROM brand_assets ba
    JOIN brand_kit_versions bkv ON bkv.id=ba.brand_kit_version_id AND bkv.status='published'
    JOIN brand_kits bk ON bk.active_version_id=bkv.id
    JOIN sites s ON s.id=bk.site_id
    WHERE ba.id=ANY($1::text[]) AND s.workspace_id=$2 AND s.id=$3
  `, [ids, scope.workspaceId, scope.siteId])
  rows.push(...brandAssets.rows)
  const known = new Map(rows.map((row) => [row.id, row]))
  ids.forEach((id) => {
    if (!known.has(id) && virtualBrandAssets.has(id)) known.set(id, virtualBrandAssets.get(id))
  })
  const missing = ids.filter((id) => !known.has(id))
  if (missing.length) throw Object.assign(new Error('Uno o más assets de motion no pertenecen a esta marca.'), { code: 'motion_asset_not_found', status: 404, details: { assetIds: missing } })
  const logo = motionAssets.find((asset) => asset.role === 'logo')
  if (logo) {
    const mimeType = String(known.get(logo.assetId)?.mimeType || logo.mimeType || '').toLowerCase()
    if (mimeType && mimeType !== 'image/svg+xml') throw Object.assign(new Error('El logo de motion debe ser un SVG aprobado.'), { code: 'motion_logo_svg_required', status: 422, details: { assetId: logo.assetId, mimeType } })
  }
  return rows
}

function motionIdempotencyKey(args, site, sourceMediaId) {
  if (args.idempotencyKey || args.runId) return String(args.idempotencyKey || args.runId)
  const payload = JSON.stringify({ site, sourceMediaId, motionAssets: args.motionAssets || args.inputs || [], storyboard: args.storyboard || null, scenes: args.scenes || [], copyBlocks: args.copyBlocks || [], renderMode: args.renderMode || '', audioMode: args.audioMode || '', backgroundMode: args.backgroundMode || '', backgroundAssetId: args.backgroundAssetId || '', transition: args.transition || {}, motionPreset: args.motionPreset || '', prompt: args.prompt || '', brandKitVersionId: args.brandKitVersionId || '', recipeId: args.recipeId || '', formatProfile: args.formatProfile, format: args.format || '', text: args.text || args.script || args.topic || '' })
  return `motion:${createHash('sha256').update(payload).digest('hex').slice(0, 32)}`
}

async function motionScope(args, auth, runtime) {
  const site = siteFor(args, auth)
  const requestedWorkspaceId = String(args.workspaceId || auth.workspaceId || '').trim()
  const requestedSiteId = String(args.siteId || auth.siteId || '').trim()
  const resolveContext = typeof runtime?.resolveWorkspaceContext === 'function' ? runtime.resolveWorkspaceContext : resolveWorkspaceContext
  const context = await resolveContext({
    userId: auth.userId || undefined,
    workspaceId: requestedWorkspaceId || undefined,
    siteId: requestedSiteId || undefined,
    siteHandle: site,
    role: auth.role === 'admin' ? 'admin' : auth.role === 'agent' ? 'editor' : undefined
  })
  const selected = context.sites.find((entry) => entry.id === requestedSiteId || entry.handle === site) || context.sites[0]
  if (!selected) throw Object.assign(new Error('La marca no está disponible para crear el trabajo.'), { code: 'motion_site_required', status: 422 })
  return { site: selected.handle || site, workspaceId: context.workspaceId, siteId: selected.id, siteHandle: selected.handle || site, role: selected.role || context.role || auth.role }
}

async function planMotionStoryboard(args, auth, runtime) {
  const site = siteFor(args, auth)
  const profile = motionProfile(args.formatProfile, args.format)
  const motionAssets = normalizeMotionAssets(args)
  const copyBlocks = normalizeMotionCopyBlocks(args.copyBlocks)
  const storyboard = normalizeMotionStoryboard({
    storyboard: args.storyboard,
    scenes: args.scenes,
    motionAssets,
    copyBlocks,
    transition: args.transition,
    formatProfile: profile.profile
  })
  const brandOptions = await activeBrandOptions(site, args, auth)
  const brand = getBrandContext(site, { auth: { ...auth, role: auth.role === 'agent' ? 'editor' : auth.role }, ...brandOptions })
  return {
    contractVersion: 'os.production.v1',
    capability: 'production.motion.plan',
    formatProfile: profile.profile,
    format: profile,
    storyboard,
    brandKitVersionId: brand.brandKitVersionId,
    brandKitSnapshotHash: brand.brandKitSnapshotHash,
    review: { required: false, status: 'planned', next: 'production.motion.compose' },
    warnings: []
  }
}

async function composeMotionJob(args, auth, runtime) {
  if (args.runId && !args.sourceMediaId && !args.motionAssets && !args.inputs && !args.scenes) return motionJobAction(args, auth, runtime, 'status')
  const motionAssets = normalizeMotionAssets(args)
  const sourceMediaId = String(args.sourceMediaId || motionAssets.find((asset) => ['source', 'foreground'].includes(asset.role))?.assetId || motionAssets.find((asset) => !['audio', 'logo', 'background', 'reference'].includes(asset.role))?.assetId || motionAssets.find((asset) => asset.role !== 'audio' && asset.role !== 'logo')?.assetId || '').trim()
  if (!sourceMediaId) throw Object.assign(new Error('production.motion.compose necesita al menos un asset de entrada.'), { code: 'motion_input_required', status: 422 })
  const scope = await motionScope(args, auth, runtime)
  await assertMotionAssetsBelongToScope(motionAssets, scope)
  const audioAssetId = String(args.audioAssetId || motionAssets.find((asset) => asset.role === 'audio')?.assetId || '').trim()
  const logoAssetId = String(args.logoAssetId || motionAssets.find((asset) => asset.role === 'logo')?.assetId || '').trim()
  const backgroundAssetId = String(args.backgroundAssetId || motionAssets.find((asset) => asset.role === 'background')?.assetId || '').trim()
  if (args.audioMode === 'supplied' && !audioAssetId) throw Object.assign(new Error('audioMode=supplied requiere audioAssetId o audioAsset.'), { code: 'motion_audio_required', status: 422 })
  const copyBlocks = normalizeMotionCopyBlocks(args.copyBlocks)
  const profile = motionProfile(args.formatProfile, args.format)
  const storyboard = normalizeMotionStoryboard({
    storyboard: args.storyboard,
    scenes: args.scenes,
    motionAssets,
    copyBlocks,
    transition: args.transition,
    formatProfile: profile.profile
  })
  const scenes = storyboard.scenes
  const backgroundMode = ['blurred_source', 'brand_color', 'generated'].includes(args.backgroundMode) ? args.backgroundMode : 'blurred_source'
  const motionPreset = MOTION_PRESETS.has(String(args.motionPreset || '').trim().toLowerCase()) ? String(args.motionPreset).trim().toLowerCase() : 'subtle_editorial'
  const requestedTransition = String(args.transition?.type || 'crossfade').trim().toLowerCase()
  const transitionType = MOTION_TRANSITIONS.has(requestedTransition) ? requestedTransition : 'crossfade'
  const transitionDurationMs = Number(args.transition?.durationMs)
  const transition = { type: transitionType, durationMs: transitionType === 'none' ? 0 : Number.isFinite(transitionDurationMs) && transitionDurationMs >= 0 ? Math.min(1000, Math.round(transitionDurationMs)) : 400 }
  const brandOptions = await activeBrandOptions(scope.site, args, auth)
  const brand = getBrandContext(scope.site, { auth: { ...auth, role: auth.role === 'agent' ? 'editor' : auth.role }, ...brandOptions })
  const text = String(args.text || args.script || args.topic || copyBlocks.map((block) => [block.headline, block.body].filter(Boolean).join('\n')).filter(Boolean).join('\n') || '').replace(/[\u2014\u2013]/g, '-').trim()
  const copy = text
    ? validateCopy({ ...args, site: scope.site, text, purpose: args.purpose || 'motion' }, brand)
    : { contractVersion: 'os.production.v1', valid: true, findings: [], brandKitVersionId: brand.brandKitVersionId, brandKitSnapshotHash: brand.brandKitSnapshotHash }
  if (!copy.valid) {
    return {
      contractVersion: 'os.production.v1',
      capability: 'production.motion.compose',
      runId: null,
      status: 'blocked',
      copy,
      review: { required: true, status: 'copy_blocked', next: 'fix_copy' }
    }
  }
  const createJob = typeof runtime?.createVideoJob === 'function' ? runtime.createVideoJob : createVideoJob
  const updateJob = typeof runtime?.updateVideoJob === 'function' ? runtime.updateVideoJob : updateVideoJob
  const result = await createJob({
    ...scope,
    userId: auth.userId,
    role: auth.role === 'agent' ? 'editor' : auth.role,
    contentItemId: args.contentItemId,
    sourceMediaId,
    provider: args.provider || process.env.DEFAULT_MOTION_PROVIDER || 'local',
    channel: args.channel || profile.channel,
    format: args.format || profile.format,
    objective: args.objective || ({
      'recipe.reel-from-image': 'reel-from-image',
      'recipe.food-to-reel': 'food-to-reel',
      'recipe.menu-to-reel': 'menu-to-reel'
    }[args.recipeId] || 'motion'),
    topic: args.topic || text,
    metadata: {
      contractVersion: 'os.production.v1',
      capability: 'production.motion.compose',
      capabilityVersion: '1.0.0',
      correlationId: args.correlationId || args.runId || null,
      recipeId: args.recipeId || null,
      formatProfile: profile.profile,
      formatSpec: profile,
      sourceMediaId,
      inputs: motionAssets,
      motionAssets,
      audioAssetId: audioAssetId || null,
      logoAssetId: logoAssetId || null,
      backgroundAssetId: backgroundAssetId || null,
      copyBlocks,
      scenes,
      storyboard,
      renderMode: args.renderMode === 'flat_slides' ? 'flat_slides' : 'layered_motion',
      audioMode: args.audioMode === 'none' ? 'none' : audioAssetId ? 'supplied' : 'none',
      backgroundMode,
      motionPreset,
      transition,
      assetRequirements: {
        cleanBackgrounds: true,
        textRenderedInSource: false,
        logoSvgAllowed: true,
        animatableElements: true
      },
      prompt: String(args.prompt || '').trim().slice(0, 12000) || null,
      text,
      brandKitVersionId: args.brandKitVersionId || brand.brandKitVersionId,
      brandKitSnapshotHash: brand.brandKitSnapshotHash,
      review: { required: true, status: 'pending' }
    },
    idempotencyKey: motionIdempotencyKey(args, scope.site, sourceMediaId),
    createContentIfMissing: args.createContentIfMissing === true
  })
  const queued = result.idempotentReplay
    ? { job: result.job }
    : await updateJob({
      ...scope,
      videoJobId: result.videoJobId,
      userId: auth.userId,
      role: auth.role === 'agent' ? 'editor' : auth.role,
      status: 'queued'
    })
  return {
    contractVersion: 'os.production.v1',
    capability: 'production.motion.compose',
    runId: result.videoJobId,
    jobId: result.videoJobId,
    status: queued.job.status,
    job: queued.job,
    copy,
    brandKitVersionId: brand.brandKitVersionId,
    brandKitSnapshotHash: brand.brandKitSnapshotHash,
    review: { required: true, status: 'pending' },
    effects: { jobCreated: true, providerExecution: false, mutatesProvider: false }
  }
}

async function motionJobAction(args, auth, runtime, action) {
  const videoJobId = String(args.videoJobId || args.jobId || args.runId || '').trim()
  if (!videoJobId) throw Object.assign(new Error('videoJobId, jobId o runId es obligatorio.'), { code: 'motion_job_required', status: 422 })
  const scope = await motionScope(args, auth, runtime)
  const input = { ...scope, videoJobId, siteHandle: scope.siteHandle, userId: auth.userId, role: auth.role === 'agent' ? 'editor' : auth.role }
  if (action === 'status') {
    const readJob = typeof runtime?.getVideoJob === 'function' ? runtime.getVideoJob : getVideoJob
    const job = await readJob(input)
    const processing = job.processing || job.metadata?.processing || {}
    return {
      contractVersion: 'os.production.v1',
      capability: 'production.motion.status.get',
      runId: videoJobId,
      jobId: videoJobId,
      status: job.status,
      job,
      outputs: job.outputs || [],
      processing,
      terminal: job.terminal === true,
      retryable: job.retryable === true || processing.retryable === true,
      nextAction: job.nextAction || (processing.retryable ? 'retry' : 'check_status')
    }
  }
  const mutate = action === 'retry'
    ? (typeof runtime?.retryVideoJob === 'function' ? runtime.retryVideoJob : retryVideoJob)
    : (typeof runtime?.cancelVideoJob === 'function' ? runtime.cancelVideoJob : cancelVideoJob)
  const result = await mutate(input)
  const job = result.job || result
  return {
    contractVersion: 'os.production.v1',
    capability: `production.motion.${action}`,
    runId: videoJobId,
    jobId: videoJobId,
    status: job.status,
    job,
    outputs: job.outputs || [],
    processing: job.processing || job.metadata?.processing || {},
    terminal: job.terminal === true || (action === 'cancel' && job.status === 'cancelled'),
    retryable: job.retryable === true,
    nextAction: action === 'cancel' ? 'none' : 'check_status',
    ...(result.previousStatus ? { previousStatus: result.previousStatus } : {})
  }
}

async function prepareProductTransform(args, auth, runtime) {
  const sourceAsset = args.sourceAsset && typeof args.sourceAsset === 'object'
    ? args.sourceAsset
    : { assetId: args.sourceAssetId }
  const sourceAssetId = String(sourceAsset.assetId || '').trim()
  if (!sourceAssetId) throw Object.assign(new Error('production.image.product.transform necesita sourceAsset.assetId.'), { code: 'product_source_required', status: 422 })
  const scope = await motionScope(args, auth, runtime)
  const brand = getBrandContext(scope.site, { auth: { ...auth, role: auth.role === 'agent' ? 'editor' : auth.role } })
  const pool = await getPgPool()
  let sourceRow = null
  if (pool) {
    const owned = await pool.query('SELECT id,storage_key,content_type,sha256 FROM media_assets WHERE id=$1 AND workspace_id=$2 AND site_id=$3', [sourceAssetId, scope.workspaceId, scope.siteId])
    if (!owned.rowCount) throw Object.assign(new Error('El asset fuente no pertenece a esta marca.'), { code: 'product_source_not_found', status: 404 })
    sourceRow = owned.rows[0]
  }
  const prepared = prepareImageGeneration(scope.site, {
    // Product transformation changes the visual treatment; publication copy
    // remains a separate validated field and does not force text into the image.
    assetType: args.assetType || 'generic',
    title: args.title || args.topic || 'product transform',
    topic: args.topic || args.instructions || 'Adaptar el producto al estilo visual de la marca',
    expectedAssetCount: 1,
    // Keep product preparations deterministic per caller key and source asset.
    itemId: args.itemId,
    batchId: args.batchId || args.idempotencyKey || `source:${sourceAssetId}`
  })
  const record = await persistImagePreparation(prepared, {
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
    channel: args.channel || args.formatProfile
  })
  if (typeof runtime?.transformProduct === 'function') {
    const generated = await runtime.transformProduct({
      sourceAsset,
      sourceAssetId,
      scope,
      brand,
      prepared,
      preparation: record,
      args
    })
    const asset = generated?.asset || generated || {}
    const generatedAssetId = String(asset.assetId || asset.id || '').trim()
    const generatedHash = String(asset.sha256 || '').trim().toLowerCase()
    if (!generatedAssetId || !/^[a-f0-9]{64}$/i.test(generatedHash)) {
      throw Object.assign(new Error('El proveedor de transformación debe devolver assetId y sha256.'), { code: 'product_provider_result_invalid', status: 502, retryable: false })
    }
    const receipt = await issueGenerationReceipt({
      site: scope.site,
      preparationId: record.preparationId,
      usedReferences: prepared.resolvedReferences || [],
      generatedResultId: generatedAssetId,
      generatedFileHash: generatedHash,
      assetType: prepared.assetType,
      route: prepared.route
    })
    return {
      contractVersion: 'os.production.v1',
      capability: 'production.image.product.transform',
      runId: record.preparationId,
      status: 'ready_for_review',
      sourceAsset,
      assets: [{ assetId: generatedAssetId, kind: asset.kind || 'image', mimeType: asset.mimeType || 'image/png', sha256: generatedHash }],
      preparation: { ...record, state: 'receipted' },
      receipt,
      provenance: { sourceAssetId, brandKitVersionId: prepared.brandKitVersionId, brandKitSnapshotHash: prepared.brandKitSnapshotHash, preparationId: record.preparationId, receiptId: receipt.receiptId },
      effects: { assetCreated: true, providerExecution: false, mutatesProvider: false },
      nextAction: 'human_review'
    }
  }
  if (pool) {
    const existing = await pool.query("SELECT id,public_url AS \"publicUrl\",storage_key AS \"storageKey\",content_type AS \"mimeType\",sha256 FROM media_assets WHERE workspace_id=$1 AND site_id=$2 AND metadata->'brandGrounding'->>'preparationId'=$3 LIMIT 1", [scope.workspaceId, scope.siteId, record.preparationId])
    if (existing.rowCount) {
      const asset = existing.rows[0]
      return { contractVersion: 'os.production.v1', capability: 'production.image.product.transform', runId: record.preparationId, status: 'ready_for_review', sourceAsset, assets: [{ assetId: asset.id, kind: 'image', mimeType: asset.mimeType, sha256: asset.sha256 }], preparation: { ...record, state: 'receipted' }, provenance: { sourceAssetId, brandKitVersionId: prepared.brandKitVersionId, brandKitSnapshotHash: prepared.brandKitSnapshotHash, preparationId: record.preparationId }, effects: { assetCreated: false, providerExecution: false, mutatesProvider: false }, nextAction: 'human_review', idempotentReplay: true }
    }
  }
  const localProductSupported = Boolean(sourceRow?.storage_key)
  if (!prepared.generationBlocked && localProductSupported && process.env.PRODUCT_RENDERER_LOCAL !== 'false' && sourceRow?.storage_key) {
    const root = resolvePath(mediaDir)
    const relative = String(sourceRow.storage_key).replace(/^\/?media\//, '').replace(/^\/+/, '')
    const sourcePath = resolvePath(join(root, relative))
    if (sourcePath === root || sourcePath.startsWith(`${root}/`)) {
      try {
        const output = renderProductTransform({ sourcePath, site: scope.site, title: args.title || args.topic || 'Producto', formatProfile: args.formatProfile, palette: brand.canonicalPalette })
        const stored = await saveUploadedMedia({ site: scope.site, filename: `product-transform-${sourceAssetId}.png`, buffer: output, alt: args.title || args.topic || 'Producto adaptado', kind: 'post' })
        const asset = await registerContentMedia({ workspaceId: scope.workspaceId, siteId: scope.siteId, userId: auth.userId, role: auth.role === 'agent' ? 'editor' : auth.role, media: stored, brandGrounding: { provenanceVersion: 'v3', preparationId: record.preparationId, sourceAssetId, brandKitVersionId: prepared.brandKitVersionId, brandKitSnapshotHash: prepared.brandKitSnapshotHash }, idempotencyKey: `product-transform:${record.preparationId}`, idempotencyFingerprint: stored.sha256 || sourceRow.sha256 || '' })
        const receipt = await issueGenerationReceipt({ site: scope.site, preparationId: record.preparationId, usedReferences: prepared.resolvedReferences || [], generatedResultId: asset.id, generatedFileHash: stored.sha256, assetType: prepared.assetType, route: prepared.route })
        return { contractVersion: 'os.production.v1', capability: 'production.image.product.transform', runId: record.preparationId, status: 'ready_for_review', sourceAsset, assets: [{ assetId: asset.id, kind: 'image', mimeType: stored.mimeType, sha256: stored.sha256 }], preparation: { ...record, state: 'receipted' }, receipt, provenance: { sourceAssetId, brandKitVersionId: prepared.brandKitVersionId, brandKitSnapshotHash: prepared.brandKitSnapshotHash, preparationId: record.preparationId, receiptId: receipt.receiptId }, effects: { assetCreated: true, providerExecution: false, mutatesProvider: false }, nextAction: 'human_review' }
      } catch (error) {
        return { contractVersion: 'os.production.v1', capability: 'production.image.product.transform', runId: record.preparationId, status: 'awaiting_provider', sourceAsset, assets: [], preparation: record, provenance: { sourceAssetId, brandKitVersionId: prepared.brandKitVersionId, brandKitSnapshotHash: prepared.brandKitSnapshotHash, preparationId: record.preparationId }, effects: { assetCreated: false, providerExecution: false, mutatesProvider: false }, nextAction: 'configure_image_provider', error: { code: error.code || 'product_renderer_failed', retryable: true, message: String(error.message || 'No se pudo transformar el producto.') } }
      }
    }
  }
  return {
    contractVersion: 'os.production.v1',
    capability: 'production.image.product.transform',
    runId: record.preparationId,
    status: prepared.generationBlocked ? 'blocked' : 'awaiting_provider',
    sourceAsset,
    assets: [],
    preparation: record,
    provenance: {
      sourceAssetId,
      brandKitVersionId: prepared.brandKitVersionId,
      brandKitSnapshotHash: prepared.brandKitSnapshotHash,
      preparationId: record.preparationId
    },
    effects: { assetCreated: false, providerExecution: false, mutatesProvider: false },
    nextAction: prepared.generationBlocked ? 'fix_brand_references' : 'configure_image_provider'
  }
}

function recipeId(value) {
  const id = String(value || '').trim().toLowerCase()
  return id.startsWith('recipe.') ? id.slice('recipe.'.length) : id
}

async function runRecipe(args, auth, runtime) {
  const id = recipeId(args.recipeId || args.recipe || 'food-to-reel')
  if (!['food-to-reel', 'menu-to-reel', 'reel-from-image', 'product-to-social'].includes(id)) {
    throw Object.assign(new Error(`La recipe ${id || '(vacía)'} todavía no tiene ejecutor.`), { code: 'recipe_executor_missing', status: 501 })
  }
  const copyBlockText = normalizeMotionCopyBlocks(args.copyBlocks)
    .map((block) => [block.headline, block.body].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n')
  const text = String(args.text || args.menuText || args.script || copyBlockText).trim()
  if (!text) throw Object.assign(new Error('La recipe necesita text o menuText.'), { code: 'recipe_text_required', status: 422 })
  const site = siteFor(args, auth)
  const context = await invokeBuiltinCapability('brand.context.get', { site, brandKitVersionId: args.brandKitVersionId }, { auth })
  const copy = validateCopy({ ...args, site, text, purpose: args.purpose || id }, context)
  if (!copy.valid) {
    return {
      contractVersion: 'os.production.v1',
      recipe: `recipe.${id}`,
      runId: null,
      status: 'blocked',
      copy,
      review: { required: true, status: 'copy_blocked', next: 'fix_copy' }
    }
  }
  if (id === 'product-to-social') {
    const sourceMediaId = String(args.sourceMediaId || args.sourceAssetId || '').trim()
    if (!sourceMediaId) throw Object.assign(new Error('La recipe product-to-social necesita sourceMediaId.'), { code: 'product_source_required', status: 422 })
    const product = await invokeBuiltinCapability('production.image.product.transform', {
      ...args,
      site,
      sourceAssetId: sourceMediaId,
      topic: text,
      formatProfile: args.formatProfile || 'instagram_post'
    }, { auth, runtime })
    const assetIds = (product.assets || []).map((asset) => asset.assetId || asset.id).filter(Boolean)
    const destinations = product.status === 'ready_for_review'
      ? await invokeBuiltinCapability('publication.destination.list', { ...args, site, assetIds, assets: product.assets || [], channel: args.channel || 'instagram_post', formatProfile: args.formatProfile || 'instagram_post' }, { auth })
      : { destinations: [] }
    return {
      contractVersion: 'os.production.v1',
      recipe: `recipe.${id}`,
      runId: product.runId || null,
      status: product.status,
      copy,
      product,
      destinations,
      review: { required: true, status: product.status === 'ready_for_review' ? 'pending' : product.status, next: product.status === 'ready_for_review' ? 'human_approval' : product.nextAction }
    }
  }
  const motion = await composeMotionJob({
    ...args,
    site,
    recipeId: `recipe.${id}`,
    text,
    brandKitVersionId: args.brandKitVersionId || context.brandKitVersionId,
    createContentIfMissing: args.createContentIfMissing !== false
  }, auth, runtime)
  const destinations = await invokeBuiltinCapability('publication.destination.list', {
    channel: args.channel || (String(args.formatProfile || '').includes('story') ? 'instagram_story' : 'instagram_reel'),
    assetIds: [motion.job?.finalMediaId || motion.job?.sourceMediaId || args.sourceMediaId].filter(Boolean),
    formatProfile: args.formatProfile
  }, { auth })
  return {
    contractVersion: 'os.production.v1',
    recipe: `recipe.${id}`,
    runId: motion.runId,
    status: motion.status,
    copy,
    motion,
    destinations,
    review: { required: true, status: 'pending', next: 'human_approval' }
  }
}

export async function invokeBuiltinCapability(name, args = {}, { auth = {}, runtime = null } = {}) {
  if (name === 'recipe.run') return runRecipe(args, auth, runtime)
  if (name.startsWith('brand.') || name === 'copy.validate') {
    const site = siteFor(args, auth)
    const brandOptions = await activeBrandOptions(site, args, auth)
    const context = getBrandContext(site, { auth: { ...auth, role: auth.role === 'agent' ? 'editor' : auth.role }, ...brandOptions })
    if (name === 'brand.context.get') return { contractVersion: 'os.production.v1', ...contextProjection(context) }
    if (name === 'brand.voice.get') return { contractVersion: 'os.production.v1', site, brandKitVersionId: context.brandKitVersionId, brandKitSnapshotHash: context.brandKitSnapshotHash, voice: context.voice, keywords: context.keywords }
    if (name === 'brand.visual_style.get') return { contractVersion: 'os.production.v1', site, brandKitVersionId: context.brandKitVersionId, brandKitSnapshotHash: context.brandKitSnapshotHash, visualStyle: context.visualStyle, imageGuide: context.imageGuide, imageSpec: context.imageSpec, canonicalPalette: context.canonicalPalette, referenceImages: context.referenceImages, motionAssets: getMotionBrandAssets(site) }
    if (name === 'brand.rules.get') return { contractVersion: 'os.production.v1', site, brandKitVersionId: context.brandKitVersionId, brandKitSnapshotHash: context.brandKitSnapshotHash, sharedEditorialPolicy: context.sharedEditorialPolicy, editRules: context.editRules, workflow: context.workflow, requiresHumanApproval: context.requiresHumanApproval, requiresPublishConfirmation: context.requiresPublishConfirmation }
    if (name === 'brand.references.resolve') {
      const prepared = prepareImageGeneration(site, preparationInput(args), brandOptions.canonicalSnapshot ? { canonicalSnapshot: brandOptions.canonicalSnapshot } : {})
      return { contractVersion: 'os.production.v1', site, brandKitVersionId: prepared.brandKitVersionId, brandKitSnapshotHash: prepared.brandKitSnapshotHash, route: prepared.route, generationBlocked: prepared.generationBlocked, references: prepared.resolvedReferences, resolvedReferences: prepared.resolvedReferences }
    }
    if (name === 'brand.generation.prepare') {
      const prepared = prepareImageGeneration(site, preparationInput(args), brandOptions.canonicalSnapshot ? { canonicalSnapshot: brandOptions.canonicalSnapshot } : {})
      const record = await persistImagePreparation(prepared, { workspaceId: auth.workspaceId || args.workspaceId, siteId: auth.siteId || args.siteId, itemId: args.itemId, batchId: args.batchId, channel: args.channel })
      return { contractVersion: 'os.production.v1', ...prepared, preparation: record }
    }
    if (name === 'brand.generation.receipt.issue') {
      return {
        contractVersion: 'os.production.v1',
        receipt: await issueGenerationReceipt({
          ...args,
          site,
          generatedResultId: args.generatedResultId || args.outputAssetId,
          generatedFileHash: args.generatedFileHash || args.outputSha256,
          usedReferences: args.usedReferences || args.references || args.resolvedReferences || []
        })
      }
    }
    if (name === 'copy.validate') return validateCopy(args, context)
    return undefined
  }

  const publication = publicationInput(args, auth)
  if (name === 'publication.publish' && String(args.channel || '').toLowerCase() === 'wordpress_post' && String(args.provider || '').toLowerCase() === 'web') {
    return publishCoolifyContentItem(args, auth, runtime, publishPublication(publication))
  }
  if (name === 'publication.destination.list') return listPublicationDestinations(publication)
  if (name === 'publication.validate') {
    const compatibility = validatePublicationCompatibility(publication)
    return { ...compatibility, valid: compatibility.compatible, findings: compatibility.errors }
  }
  if (name === 'publication.prepare') return persistPublicationIfScoped(preparePublication(publication), args, auth, runtime)
  if (name === 'publication.route') return persistPublicationIfScoped(routePublication(publication), args, auth, runtime)
  if (name === 'publication.schedule') return persistPublicationIfScoped(schedulePublication(publication), args, auth, runtime)
  if (name === 'publication.publish') return persistPublicationIfScoped(publishPublication(publication), args, auth, runtime)
  if (name === 'publication.status.get') {
    const workspaceId = String(args.workspaceId || auth.workspaceId || '').trim()
    if (workspaceId && (args.runId || args.publicationId)) {
      const getRun = typeof runtime?.getPublicationRun === 'function' ? runtime.getPublicationRun : getPublicationRun
      try {
        const run = await getRun({ workspaceId, siteId: args.siteId || auth.siteId, runId: args.runId, publicationId: args.publicationId })
        return { contractVersion: 'publication.v1', operation: 'publication.status.get', publicationId: run.publicationId, status: run.status, providerStatus: run.providerStatus, terminal: ['published', 'canceled', 'failed'].includes(run.status), persisted: true, run }
      } catch (error) {
        if (error?.code !== 'publication_run_not_found' && error?.status !== 404) throw error
        return { ...getPublicationStatus({ ...publication, publicationId: args.publicationId || null, runId: args.runId || null }), persisted: false, run: null }
      }
    }
    return getPublicationStatus(publication)
  }
  if (name === 'asset.register') return registerAssetReference(args, auth, runtime)
  if (name === 'asset.list') return listCanonicalAssets(args, auth)
  if (name === 'asset.delete') return deleteCanonicalAssets(args, auth)
  if (name === 'asset.upload') return uploadGeneratedAsset(args, auth, runtime)
  if (name === 'production.image.product.transform') return prepareProductTransform(args, auth, runtime)
  if (name === 'production.motion.plan') return planMotionStoryboard(args, auth, runtime)
  if (name === 'production.motion.compose') return composeMotionJob(args, auth, runtime)
  if (name === 'production.motion.status.get') return motionJobAction(args, auth, runtime, 'status')
  if (name === 'production.motion.retry') return motionJobAction(args, auth, runtime, 'retry')
  if (name === 'production.motion.cancel') return motionJobAction(args, auth, runtime, 'cancel')
  if (name.startsWith('content.campaign.') || name === 'content.media.attach') return contentCampaignAction(name, args, auth, runtime)

  return undefined
}

export { authPermissions }
