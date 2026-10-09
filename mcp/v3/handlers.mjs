import { createHash } from 'node:crypto'
import { assertSiteAccess } from '../../lib/auth.mjs'
import { getBrandContext, prepareImageGeneration } from '../../lib/brand-kit.mjs'
import { buildBrandOsMetadata } from '../../lib/brand-os.mjs'
import { issueGenerationReceipt, persistImagePreparation } from '../../lib/generation-provenance.mjs'
import { resolveWorkspaceContext } from '../../lib/workspace-domain.mjs'
import { getPgPool } from '../../lib/pg.mjs'
import { createVideoJob, updateVideoJob } from '../../lib/video-jobs.mjs'
import { saveUploadedMedia } from '../../lib/cms-ops.mjs'
import { registerContentMedia } from '../../lib/workspace-domain.mjs'
import { mediaDir } from '../../lib/db.mjs'
import { renderProductTransform } from '../../lib/product-renderer.mjs'
import { resolve as resolvePath, join } from 'node:path'
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
  owner: ['brand:read', 'asset:read', 'asset:write', 'copy:validate', 'generation:prepare', 'generation:provenance', 'generation:run', 'production:motion', 'publication:read', 'publication:write', 'publication:publish'],
  agency_admin: ['brand:read', 'asset:read', 'asset:write', 'copy:validate', 'generation:prepare', 'generation:provenance', 'generation:run', 'production:motion', 'publication:read', 'publication:write', 'publication:publish'],
  editor: ['brand:read', 'asset:read', 'asset:write', 'copy:validate', 'generation:prepare', 'generation:provenance', 'generation:run', 'production:motion', 'publication:read', 'publication:write'],
  author: ['brand:read', 'asset:read', 'asset:write', 'copy:validate', 'generation:prepare', 'generation:provenance', 'generation:run', 'production:motion', 'publication:read'],
  client: ['brand:read', 'asset:read', 'asset:write', 'copy:validate', 'generation:prepare', 'generation:provenance', 'generation:run', 'production:motion', 'publication:read'],
  viewer: ['brand:read', 'asset:read', 'publication:read'],
  agent: ['brand:read', 'asset:read', 'asset:write', 'copy:validate', 'generation:prepare', 'generation:provenance', 'generation:run', 'production:motion', 'publication:read', 'publication:write']
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

async function persistPublicationIfScoped(contract, args, auth) {
  const workspaceId = String(args.workspaceId || auth.workspaceId || '').trim()
  if (!workspaceId || !contract?.publicationId || !contract?.idempotencyKey) return contract
  return persistPublicationOperation(contract, {
    workspaceId,
    siteId: args.siteId || auth.siteId,
    siteHandle: args.site || args.brandId || auth.site,
    userId: auth.userId || null,
    metadata: { source: 'mcp.v3' }
  })
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

function motionProfile(formatProfile = '') {
  const profile = String(formatProfile || '').trim().toLowerCase()
  if (profile.includes('story')) return { channel: 'instagram_story', format: 'story' }
  return { channel: 'instagram', format: 'reel' }
}

function motionIdempotencyKey(args, site, sourceMediaId) {
  if (args.idempotencyKey || args.runId) return String(args.idempotencyKey || args.runId)
  const payload = JSON.stringify({ site, sourceMediaId, brandKitVersionId: args.brandKitVersionId || '', recipeId: args.recipeId || '', formatProfile: args.formatProfile, text: args.text || args.script || args.topic || '' })
  return `motion:${createHash('sha256').update(payload).digest('hex').slice(0, 32)}`
}

async function motionScope(args, auth) {
  const site = siteFor(args, auth)
  const requestedWorkspaceId = String(args.workspaceId || auth.workspaceId || '').trim()
  const requestedSiteId = String(args.siteId || auth.siteId || '').trim()
  const context = await resolveWorkspaceContext({
    userId: auth.userId || undefined,
    workspaceId: requestedWorkspaceId || undefined,
    siteId: requestedSiteId || undefined,
    siteHandle: site,
    role: auth.role === 'admin' ? 'admin' : auth.role === 'agent' ? 'editor' : undefined
  })
  const selected = context.sites.find((entry) => entry.id === requestedSiteId || entry.handle === site) || context.sites[0]
  if (!selected) throw Object.assign(new Error('La marca no está disponible para crear el trabajo.'), { code: 'motion_site_required', status: 422 })
  return { site: selected.handle || site, workspaceId: context.workspaceId, siteId: selected.id, siteHandle: selected.handle || site }
}

async function composeMotionJob(args, auth) {
  const inputs = Array.isArray(args.inputs) ? args.inputs : []
  const sourceMediaId = String(args.sourceMediaId || inputs[0]?.assetId || '').trim()
  if (!sourceMediaId) throw Object.assign(new Error('production.motion.compose necesita al menos un asset de entrada.'), { code: 'motion_input_required', status: 422 })
  const scope = await motionScope(args, auth)
  const audioAssetId = String(args.audioAssetId || '').trim()
  if (audioAssetId) {
    const pool = await getPgPool()
    if (pool) {
      const ownedAudio = await pool.query('SELECT id FROM media_assets WHERE id=$1 AND workspace_id=$2 AND site_id=$3', [audioAssetId, scope.workspaceId, scope.siteId])
      if (!ownedAudio.rowCount) throw Object.assign(new Error('El asset de audio no pertenece a esta marca.'), { code: 'motion_audio_not_found', status: 404 })
    }
  }
  const brand = getBrandContext(scope.site, { auth: { ...auth, role: auth.role === 'agent' ? 'editor' : auth.role } })
  const profile = motionProfile(args.formatProfile)
  const text = String(args.text || args.script || args.topic || '').trim()
  const result = await createVideoJob({
    ...scope,
    userId: auth.userId,
    role: auth.role === 'agent' ? 'editor' : auth.role,
    contentItemId: args.contentItemId,
    sourceMediaId,
    provider: args.provider || process.env.DEFAULT_MOTION_PROVIDER || 'local',
    channel: args.channel || profile.channel,
    format: args.format || profile.format,
    objective: args.objective || 'food-to-reel',
    topic: args.topic || text,
    metadata: {
      contractVersion: 'os.production.v1',
      capability: 'production.motion.compose',
      capabilityVersion: '1.0.0',
      correlationId: args.correlationId || args.runId || null,
      recipeId: args.recipeId || null,
      formatProfile: args.formatProfile,
      sourceMediaId,
      inputs,
      audioAssetId: audioAssetId || null,
      text,
      brandKitVersionId: args.brandKitVersionId || brand.brandKitVersionId,
      brandKitSnapshotHash: brand.brandKitSnapshotHash,
      review: { required: true, status: 'pending' }
    },
    idempotencyKey: motionIdempotencyKey(args, scope.site, sourceMediaId),
    createContentIfMissing: args.createContentIfMissing === true
  })
  const queued = await updateVideoJob({
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
    brandKitVersionId: brand.brandKitVersionId,
    brandKitSnapshotHash: brand.brandKitSnapshotHash,
    review: { required: true, status: 'pending' },
    effects: { jobCreated: true, providerExecution: false, mutatesProvider: false }
  }
}

async function prepareProductTransform(args, auth) {
  const sourceAsset = args.sourceAsset && typeof args.sourceAsset === 'object'
    ? args.sourceAsset
    : { assetId: args.sourceAssetId }
  const sourceAssetId = String(sourceAsset.assetId || '').trim()
  if (!sourceAssetId) throw Object.assign(new Error('production.image.product.transform necesita sourceAsset.assetId.'), { code: 'product_source_required', status: 422 })
  const scope = await motionScope(args, auth)
  const brand = getBrandContext(scope.site, { auth: { ...auth, role: auth.role === 'agent' ? 'editor' : auth.role } })
  const pool = await getPgPool()
  let sourceRow = null
  if (pool) {
    const owned = await pool.query('SELECT id,storage_key,content_type,sha256 FROM media_assets WHERE id=$1 AND workspace_id=$2 AND site_id=$3', [sourceAssetId, scope.workspaceId, scope.siteId])
    if (!owned.rowCount) throw Object.assign(new Error('El asset fuente no pertenece a esta marca.'), { code: 'product_source_not_found', status: 404 })
    sourceRow = owned.rows[0]
  }
  const prepared = prepareImageGeneration(scope.site, {
    assetType: formatAssetType(args),
    title: args.title || args.topic || 'product transform',
    topic: args.topic || args.instructions || 'Adaptar el producto al estilo visual de la marca',
    expectedAssetCount: 1
  })
  const record = await persistImagePreparation(prepared, {
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
    channel: args.channel || args.formatProfile
  })
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

async function runRecipe(args, auth) {
  const id = recipeId(args.recipeId || args.recipe || 'food-to-reel')
  if (!['food-to-reel', 'menu-to-reel', 'product-to-social'].includes(id)) {
    throw Object.assign(new Error(`La recipe ${id || '(vacía)'} todavía no tiene ejecutor.`), { code: 'recipe_executor_missing', status: 501 })
  }
  const text = String(args.text || args.menuText || '').trim()
  if (!text) throw Object.assign(new Error('La recipe necesita text o menuText.'), { code: 'recipe_text_required', status: 422 })
  const site = siteFor(args, auth)
  const context = await invokeBuiltinCapability('brand.context.get', { site, brandKitVersionId: args.brandKitVersionId }, { auth })
  const copy = await invokeBuiltinCapability('copy.validate', { ...args, site, text, purpose: args.purpose || id }, { auth })
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
    }, { auth })
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
  }, auth)
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

export async function invokeBuiltinCapability(name, args = {}, { auth = {} } = {}) {
  if (name === 'recipe.run') return runRecipe(args, auth)
  if (name.startsWith('brand.') || name === 'copy.validate') {
    const site = siteFor(args, auth)
    const context = getBrandContext(site, { auth: { ...auth, role: auth.role === 'agent' ? 'editor' : auth.role } })
    if (name === 'brand.context.get') return { contractVersion: 'os.production.v1', ...contextProjection(context) }
    if (name === 'brand.voice.get') return { contractVersion: 'os.production.v1', site, brandKitVersionId: context.brandKitVersionId, brandKitSnapshotHash: context.brandKitSnapshotHash, voice: context.voice, keywords: context.keywords }
    if (name === 'brand.visual_style.get') return { contractVersion: 'os.production.v1', site, brandKitVersionId: context.brandKitVersionId, brandKitSnapshotHash: context.brandKitSnapshotHash, visualStyle: context.visualStyle, imageGuide: context.imageGuide, imageSpec: context.imageSpec, canonicalPalette: context.canonicalPalette, referenceImages: context.referenceImages }
    if (name === 'brand.rules.get') return { contractVersion: 'os.production.v1', site, brandKitVersionId: context.brandKitVersionId, brandKitSnapshotHash: context.brandKitSnapshotHash, sharedEditorialPolicy: context.sharedEditorialPolicy, editRules: context.editRules, workflow: context.workflow, requiresHumanApproval: context.requiresHumanApproval, requiresPublishConfirmation: context.requiresPublishConfirmation }
    if (name === 'brand.references.resolve') {
      const prepared = prepareImageGeneration(site, preparationInput(args))
      return { contractVersion: 'os.production.v1', site, brandKitVersionId: prepared.brandKitVersionId, brandKitSnapshotHash: prepared.brandKitSnapshotHash, route: prepared.route, generationBlocked: prepared.generationBlocked, resolvedReferences: prepared.resolvedReferences }
    }
    if (name === 'brand.generation.prepare') {
      const prepared = prepareImageGeneration(site, preparationInput(args))
      const record = await persistImagePreparation(prepared, { workspaceId: auth.workspaceId || args.workspaceId, siteId: auth.siteId || args.siteId, itemId: args.itemId, batchId: args.batchId, channel: args.channel })
      return { contractVersion: 'os.production.v1', ...prepared, preparation: record }
    }
    if (name === 'brand.generation.receipt.issue') {
      return { contractVersion: 'os.production.v1', receipt: await issueGenerationReceipt({ ...args, site }) }
    }
    if (name === 'copy.validate') return validateCopy(args, context)
    return undefined
  }

  const publication = publicationInput(args, auth)
  if (name === 'publication.destination.list') return listPublicationDestinations(publication)
  if (name === 'publication.validate') return validatePublicationCompatibility(publication)
  if (name === 'publication.prepare') return persistPublicationIfScoped(preparePublication(publication), args, auth)
  if (name === 'publication.route') return persistPublicationIfScoped(routePublication(publication), args, auth)
  if (name === 'publication.schedule') return persistPublicationIfScoped(schedulePublication(publication), args, auth)
  if (name === 'publication.publish') return persistPublicationIfScoped(publishPublication(publication), args, auth)
  if (name === 'publication.status.get') {
    const workspaceId = String(args.workspaceId || auth.workspaceId || '').trim()
    if (workspaceId && (args.runId || args.publicationId)) {
      const run = await getPublicationRun({ workspaceId, siteId: args.siteId || auth.siteId, runId: args.runId, publicationId: args.publicationId })
      return { contractVersion: 'publication.v1', operation: 'publication.status.get', publicationId: run.publicationId, status: run.status, providerStatus: run.providerStatus, terminal: ['published', 'canceled', 'failed'].includes(run.status), persisted: true, run }
    }
    return getPublicationStatus(publication)
  }
  if (name === 'production.image.product.transform') return prepareProductTransform(args, auth)
  if (name === 'production.motion.compose') return composeMotionJob(args, auth)

  return undefined
}

export { authPermissions }
