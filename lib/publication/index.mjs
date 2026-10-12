import { createHash } from 'node:crypto'

export const PUBLICATION_CONTRACT_VERSION = 'publication.v1'

const CHANNEL_ALIASES = Object.freeze({
  blog: 'wordpress_post',
  instagram: 'instagram_post',
  instagram_feed: 'instagram_post',
  linkedin: 'linkedin_post',
  x: 'x_post',
  twitter: 'x_post',
  video: 'youtube_video',
  youtube: 'youtube_video',
  substack: 'substack_post'
})

/**
 * Channels describe the destination format. They do not describe how a
 * provider is contacted.
 */
export const PUBLICATION_CHANNELS = Object.freeze({
  instagram_reel: Object.freeze({
    id: 'instagram_reel',
    platform: 'instagram',
    format: 'reel',
    label: 'Instagram Reel',
    acceptedMediaKinds: Object.freeze(['video']),
    maxAssets: 1,
    maxDurationMs: 90_000,
    maxTextLength: 2_200,
    requiresPublicMedia: true
  }),
  instagram_story: Object.freeze({
    id: 'instagram_story',
    platform: 'instagram',
    format: 'story',
    label: 'Instagram Story',
    acceptedMediaKinds: Object.freeze(['image', 'video']),
    maxAssets: 1,
    maxDurationMs: 60_000,
    maxTextLength: 2_200,
    requiresPublicMedia: true
  }),
  instagram_post: Object.freeze({
    id: 'instagram_post',
    platform: 'instagram',
    format: 'post',
    label: 'Instagram post',
    acceptedMediaKinds: Object.freeze(['image', 'video']),
    maxAssets: 10,
    maxTextLength: 2_200,
    requiresPublicMedia: true
  }),
  linkedin_post: Object.freeze({
    id: 'linkedin_post',
    platform: 'linkedin',
    format: 'post',
    label: 'LinkedIn post',
    acceptedMediaKinds: Object.freeze(['image', 'video']),
    maxAssets: 9,
    maxTextLength: 3_000,
    requiresPublicMedia: true
  }),
  x_post: Object.freeze({
    id: 'x_post',
    platform: 'x',
    format: 'post',
    label: 'X post',
    acceptedMediaKinds: Object.freeze(['image', 'video']),
    maxAssets: 4,
    maxTextLength: 280,
    requiresPublicMedia: true
  }),
  wordpress_post: Object.freeze({
    id: 'wordpress_post',
    platform: 'wordpress',
    format: 'post',
    label: 'WordPress post',
    acceptedMediaKinds: Object.freeze(['image', 'video']),
    maxAssets: 20,
    maxTextLength: 100_000,
    requiresPublicMedia: false
  }),
  youtube_video: Object.freeze({
    id: 'youtube_video',
    platform: 'youtube',
    format: 'video',
    label: 'YouTube video',
    acceptedMediaKinds: Object.freeze(['video']),
    maxAssets: 1,
    maxDurationMs: 12 * 60 * 60 * 1_000,
    maxTextLength: 5_000,
    requiresPublicMedia: true
  }),
  substack_post: Object.freeze({
    id: 'substack_post',
    platform: 'substack',
    format: 'post',
    label: 'Substack post',
    acceptedMediaKinds: Object.freeze(['image', 'video']),
    maxAssets: 20,
    maxTextLength: 100_000,
    requiresPublicMedia: false
  })
})

/**
 * Providers are transport adapters. A provider entry is only a capability
 * declaration here. The adapter is deliberately not imported or executed.
 */
export const PUBLICATION_PROVIDERS = Object.freeze({
  buffer: Object.freeze({
    id: 'buffer',
    label: 'Buffer',
    supportedChannels: Object.freeze(['instagram_reel', 'instagram_story', 'instagram_post', 'linkedin_post', 'x_post']),
    connectionType: 'provider_connection'
  }),
  metricool: Object.freeze({
    id: 'metricool',
    label: 'Metricool',
    supportedChannels: Object.freeze(['instagram_reel', 'instagram_post', 'linkedin_post', 'x_post', 'youtube_video']),
    connectionType: 'provider_connection'
  }),
  postiz: Object.freeze({
    id: 'postiz',
    label: 'Postiz',
    supportedChannels: Object.freeze(['instagram_reel', 'instagram_story', 'instagram_post', 'linkedin_post', 'x_post', 'wordpress_post', 'youtube_video', 'substack_post']),
    connectionType: 'provider_connection'
  }),
  planable: Object.freeze({
    id: 'planable',
    label: 'Planable',
    supportedChannels: Object.freeze(['instagram_reel', 'instagram_story', 'instagram_post', 'linkedin_post', 'x_post']),
    connectionType: 'provider_connection'
  }),
  wordpress: Object.freeze({
    id: 'wordpress',
    label: 'WordPress',
    supportedChannels: Object.freeze(['wordpress_post']),
    connectionType: 'site_connection'
  }),
  web: Object.freeze({
    id: 'web',
    label: 'Coolify / Webhook',
    supportedChannels: Object.freeze(['wordpress_post']),
    connectionType: 'site_connection'
  })
})

const OPERATION_PERMISSIONS = Object.freeze({
  list: Object.freeze(['publication:read']),
  route: Object.freeze(['publication:write']),
  prepare: Object.freeze(['publication:write']),
  schedule: Object.freeze(['publication:write']),
  publish: Object.freeze(['publication:write']),
  status: Object.freeze(['publication:read'])
})

const OPERATION_PERMISSION_ALIASES = Object.freeze({
  route: Object.freeze(['publication:route']),
  prepare: Object.freeze(['publication:prepare']),
  schedule: Object.freeze(['publication:schedule']),
  publish: Object.freeze(['publication:publish'])
})

const OPERATION_NAMES = Object.freeze({
  list: 'publication.destination.list',
  route: 'publication.route',
  prepare: 'publication.prepare',
  schedule: 'publication.schedule',
  publish: 'publication.publish',
  status: 'publication.status.get'
})

const APPROVAL_REQUIRED = Object.freeze({ required: true, policy: 'human_required' })

export class PublicationContractError extends Error {
  constructor(code, message, details = {}, status = 400) {
    super(message)
    this.name = 'PublicationContractError'
    this.code = code
    this.status = status
    this.details = details
  }
}

const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const asArray = (value) => Array.isArray(value) ? value : []
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max)

function normalizeChannel(value) {
  const id = clean(value, 80).toLowerCase()
  return CHANNEL_ALIASES[id] || id
}

function normalizeProvider(value) {
  return clean(value, 80).toLowerCase()
}

function normalizePermissions(value) {
  if (Array.isArray(value)) return [...new Set(value.map((entry) => clean(entry, 120)).filter(Boolean))]
  const source = asObject(value)
  const granted = source.granted ?? source.permissions ?? source.scopes
  return Array.isArray(granted) ? [...new Set(granted.map((entry) => clean(entry, 120)).filter(Boolean))] : null
}

function permissionMetadata(operation, supplied) {
  const required = [...(OPERATION_PERMISSIONS[operation] || [])]
  const alternatives = [...required, ...(OPERATION_PERMISSION_ALIASES[operation] || [])]
  const granted = normalizePermissions(supplied)
  const checked = granted !== null
  const missing = checked && alternatives.length && !alternatives.some((permission) => granted.includes(permission)) ? required : []
  return { required, accepted: alternatives, granted: granted || [], missing, checked, allowed: !missing.length }
}

function approvalMetadata(input = {}) {
  const source = input.approval
  const approval = source && typeof source === 'object' ? source : {}
  const status = clean(approval.status || (input.approved === true ? 'approved' : ''), 30).toLowerCase() || 'pending'
  return {
    ...APPROVAL_REQUIRED,
    status,
    approvedAt: clean(approval.approvedAt || approval.approved_at || '', 80) || null,
    approvedBy: clean(approval.approvedBy || approval.approved_by || '', 200) || null,
    reason: clean(approval.reason || '', 500) || null
  }
}

function throwPermissionError(metadata) {
  if (!metadata.checked || metadata.allowed) return
  throw new PublicationContractError(
    'publication_permission_missing',
    `Faltan permisos de publicación: ${metadata.missing.join(', ')}.`,
    { permissions: metadata },
    403
  )
}

function throwApprovalError(metadata) {
  if (metadata.status === 'approved') return
  throw new PublicationContractError(
    'publication_approval_required',
    'La publicación requiere aprobación humana antes de programar o publicar.',
    { approval: metadata },
    409
  )
}

function connectionAllows(destination, connections) {
  if (connections === undefined || connections === null) return true
  const entries = Array.isArray(connections) ? connections : Object.entries(asObject(connections)).map(([provider, value]) => ({ provider, ...asObject(value) }))
  const matching = entries.filter((connection) => normalizeProvider(connection.provider || connection.providerId || connection.type) === destination.providerId)
  if (!matching.length) return false
  return matching.some((connection) => {
    if (connection.enabled === false || connection.active === false || ['disabled', 'error'].includes(String(connection.status || '').toLowerCase())) return false
    const rawChannel = clean(connection.channel || '', 80).toLowerCase()
    const aggregate = !rawChannel || ['buffer', 'workspace', 'account'].includes(rawChannel)
    const connectionChannel = normalizeChannel(rawChannel)
    const declaredChannels = connection.channels ? asArray(connection.channels).map(normalizeChannel) : []
    const samePlatform = ['instagram', 'linkedin', 'x', 'twitter'].includes(rawChannel) && destination.platform === (rawChannel === 'twitter' ? 'x' : rawChannel)
    return aggregate || samePlatform || connectionChannel === destination.channelId || declaredChannels.includes(destination.channelId)
  })
}

function destinationFor(channel, provider) {
  const channelId = normalizeChannel(channel)
  const providerId = normalizeProvider(provider)
  const channelDefinition = PUBLICATION_CHANNELS[channelId]
  const providerDefinition = PUBLICATION_PROVIDERS[providerId]
  if (!channelDefinition) return { channelId, providerId, channelDefinition: null, providerDefinition: null, destination: null }
  if (!providerDefinition) return { channelId, providerId, channelDefinition, providerDefinition: null, destination: null }
  if (!providerDefinition.supportedChannels.includes(channelId)) return { channelId, providerId, channelDefinition, providerDefinition, destination: null }
  return {
    channelId,
    providerId,
    channelDefinition,
    providerDefinition,
    destination: {
      id: `${channelId}:${providerId}`,
      channelId,
      channel: channelId,
      channelLabel: channelDefinition.label,
      platform: channelDefinition.platform,
      format: channelDefinition.format,
      providerId,
      provider: providerId,
      providerLabel: providerDefinition.label,
      requiresPublicMedia: channelDefinition.requiresPublicMedia,
      connectionType: providerDefinition.connectionType,
      approval: { ...APPROVAL_REQUIRED },
      operations: Object.freeze(['prepare', 'schedule', 'publish', 'status']),
      requiredPermissions: Object.freeze({
        prepare: [...OPERATION_PERMISSIONS.prepare, ...OPERATION_PERMISSION_ALIASES.prepare],
        schedule: [...OPERATION_PERMISSIONS.schedule, ...OPERATION_PERMISSION_ALIASES.schedule],
        publish: [...OPERATION_PERMISSIONS.publish, ...OPERATION_PERMISSION_ALIASES.publish]
      })
    }
  }
}

export const PUBLICATION_DESTINATIONS = Object.freeze(Object.values(PUBLICATION_CHANNELS).flatMap((channel) => Object.values(PUBLICATION_PROVIDERS)
  .map((provider) => destinationFor(channel.id, provider.id).destination)
  .filter(Boolean)))

export const CHANNEL_CATALOG = PUBLICATION_CHANNELS
export const PROVIDER_CATALOG = PUBLICATION_PROVIDERS
export const DESTINATION_CATALOG = PUBLICATION_DESTINATIONS

function assertDestination(input = {}) {
  const resolved = destinationFor(input.channel || input.channelId, input.provider || input.providerId)
  if (!resolved.channelDefinition) throw new PublicationContractError('publication_channel_unknown', `Canal de publicación desconocido: ${resolved.channelId || '(vacío)'}.`, { channelId: resolved.channelId })
  if (!resolved.providerDefinition) throw new PublicationContractError('publication_provider_unknown', `Proveedor de publicación desconocido: ${resolved.providerId || '(vacío)'}.`, { providerId: resolved.providerId })
  if (!resolved.destination) throw new PublicationContractError('publication_destination_incompatible', `El proveedor ${resolved.providerId} no admite el canal ${resolved.channelId}.`, { channelId: resolved.channelId, providerId: resolved.providerId })
  if (!connectionAllows(resolved.destination, input.connections)) throw new PublicationContractError('publication_connection_unavailable', `No hay una conexión activa para ${resolved.destination.providerLabel}.`, { destination: resolved.destination.id }, 409)
  return resolved
}

function assetKind(asset) {
  const source = asObject(asset)
  const mime = clean(source.mimeType || source.mime_type || source.metadata?.mimeType || source.metadata?.mime_type, 120).toLowerCase()
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('image/')) return 'image'
  return clean(source.kind || source.type, 30).toLowerCase() || ''
}

function normalizeAssets(assets) {
  return asArray(assets).map((asset) => {
    if (typeof asset === 'string') return { assetId: clean(asset, 300), kind: '' }
    const source = asObject(asset)
    const assetId = clean(source.assetId || source.id, 300)
    if (!assetId) throw new PublicationContractError('publication_asset_reference_required', 'Cada asset debe incluir assetId.', {}, 422)
    const kind = assetKind(source)
    const durationMs = Number(source.durationMs ?? source.metadata?.durationMs ?? source.metadata?.duration_ms)
    return {
      assetId,
      kind,
      ...(clean(source.mimeType || source.mime_type, 120) ? { mimeType: clean(source.mimeType || source.mime_type, 120).toLowerCase() } : {}),
      ...(Number.isFinite(durationMs) ? { durationMs } : {}),
      ...(clean(source.sha256 || source.hash, 200) ? { sha256: clean(source.sha256 || source.hash, 200) } : {})
    }
  })
}

function compatibilityErrors({ channelDefinition, assets, text }) {
  const errors = []
  if (assets.length > channelDefinition.maxAssets) errors.push({ code: 'asset_count_exceeded', message: `El canal admite como máximo ${channelDefinition.maxAssets} asset(s).`, field: 'assets' })
  const textValue = clean(text, channelDefinition.maxTextLength + 1)
  if (textValue.length > channelDefinition.maxTextLength) errors.push({ code: 'text_length_exceeded', message: `El texto supera el límite de ${channelDefinition.maxTextLength} caracteres.`, field: 'text' })
  for (const [index, asset] of assets.entries()) {
    if (asset.kind && !channelDefinition.acceptedMediaKinds.includes(asset.kind)) errors.push({ code: 'asset_kind_incompatible', message: `El asset ${asset.assetId} no es compatible con ${channelDefinition.label}.`, field: `assets.${index}` })
    if (Number.isFinite(channelDefinition.maxDurationMs) && Number.isFinite(asset.durationMs) && asset.durationMs > channelDefinition.maxDurationMs) errors.push({ code: 'asset_duration_exceeded', message: `El asset ${asset.assetId} supera la duración máxima del canal.`, field: `assets.${index}.durationMs` })
  }
  return errors
}

function assertPermissions(input, operation) {
  const permissions = permissionMetadata(operation, input.permissions ?? input.grantedPermissions)
  throwPermissionError(permissions)
  return permissions
}

function contractId(input, operation, destination) {
  const provided = clean(input.publicationId || input.runId, 200)
  if (provided) return provided
  const source = JSON.stringify({ operation, destination: destination?.id || null, workspaceId: clean(input.workspaceId, 200), assets: input.assets || [], text: clean(input.text || input.content?.text, 100_000), publicationDate: input.publicationDate || null })
  return `pub_${createHash('sha256').update(source).digest('hex').slice(0, 24)}`
}

function idempotencyKey(input, operation, publicationId) {
  const explicit = clean(input.idempotencyKey, 300)
  if (explicit) return explicit
  return `${operation}:${publicationId}`
}

function contentPayload(input, maxTextLength = 100_000) {
  const content = asObject(input.content)
  return {
    text: clean(input.text ?? content.text ?? content.body ?? '', maxTextLength),
    ...(clean(input.title ?? content.title ?? '', 500) ? { title: clean(input.title ?? content.title, 500) } : {}),
    ...(clean(input.linkUrl ?? content.linkUrl ?? content.link_url ?? '', 2_000) ? { linkUrl: clean(input.linkUrl ?? content.linkUrl ?? content.link_url, 2_000) } : {})
  }
}

function baseContract(operation, input, resolved, extra = {}) {
  const publicationId = contractId(input, operation, resolved.destination)
  const approval = approvalMetadata(input)
  const permissions = assertPermissions(input, operation)
  return {
    contractVersion: PUBLICATION_CONTRACT_VERSION,
    operation: OPERATION_NAMES[operation],
    publicationId,
    runId: clean(input.runId, 200) || publicationId,
    idempotencyKey: idempotencyKey(input, operation, publicationId),
    destination: resolved.destination,
    approval,
    permissions,
    metadata: { approval, permissions },
    effects: { providerExecution: false, mutatesProvider: false },
    ...extra
  }
}

export function listPublicationDestinations(input = {}) {
  const permissions = permissionMetadata('list', input.permissions ?? input.grantedPermissions)
  throwPermissionError(permissions)
  const requestedChannel = input.channel || input.channelId
  const requestedProvider = input.provider || input.providerId
  const assets = normalizeAssets(input.assets)
  const entries = []
  for (const channel of Object.values(PUBLICATION_CHANNELS)) {
    if (requestedChannel && normalizeChannel(requestedChannel) !== channel.id) continue
    for (const provider of Object.values(PUBLICATION_PROVIDERS)) {
      if (requestedProvider && normalizeProvider(requestedProvider) !== provider.id) continue
      const resolved = destinationFor(channel.id, provider.id)
      if (resolved.destination && connectionAllows(resolved.destination, input.connections) && (!assets.length || compatibilityErrors({ channelDefinition: resolved.channelDefinition, assets, text: input.text ?? input.content?.text ?? input.content?.body }).length === 0)) entries.push(resolved.destination)
    }
  }
  return {
    contractVersion: PUBLICATION_CONTRACT_VERSION,
    operation: OPERATION_NAMES.list,
    destinations: entries,
    count: entries.length,
    filters: {
      ...(requestedChannel ? { channel: normalizeChannel(requestedChannel) } : {}),
      ...(requestedProvider ? { provider: normalizeProvider(requestedProvider) } : {})
    },
    permissions,
    metadata: { permissions }
  }
}

export function validatePublicationCompatibility(input = {}) {
  const channelId = normalizeChannel(input.channel || input.channelId)
  const providerId = normalizeProvider(input.provider || input.providerId)
  const resolved = destinationFor(channelId, providerId)
  const errors = []
  if (!resolved.channelDefinition) errors.push({ code: 'publication_channel_unknown', message: `Canal de publicación desconocido: ${channelId || '(vacío)'}.`, field: 'channel' })
  if (!resolved.providerDefinition) errors.push({ code: 'publication_provider_unknown', message: `Proveedor de publicación desconocido: ${providerId || '(vacío)'}.`, field: 'provider' })
  if (resolved.channelDefinition && resolved.providerDefinition && !resolved.destination) errors.push({ code: 'publication_destination_incompatible', message: `El proveedor ${providerId} no admite el canal ${channelId}.`, field: 'provider' })
  const assets = normalizeAssets(input.assets)
  if (resolved.channelDefinition) errors.push(...compatibilityErrors({ channelDefinition: resolved.channelDefinition, assets, text: input.text ?? input.content?.text ?? input.content?.body }))
  return {
    contractVersion: PUBLICATION_CONTRACT_VERSION,
    operation: 'publication.validate',
    compatible: errors.length === 0,
    destination: resolved.destination,
    errors,
    assets,
    approval: approvalMetadata(input),
    permissions: permissionMetadata('prepare', input.permissions ?? input.grantedPermissions)
  }
}

export function routePublication(input = {}) {
  const permissions = assertPermissions(input, 'route')
  const channel = input.channel || input.channelId
  if (!channel) throw new PublicationContractError('publication_channel_required', 'El canal es obligatorio para enrutar una publicación.')
  const candidates = listPublicationDestinations({ ...input, channel, permissions: undefined, grantedPermissions: undefined }).destinations
  const provider = input.provider || input.providerId
  if (!provider && candidates.length !== 1) {
    return {
      contractVersion: PUBLICATION_CONTRACT_VERSION,
      operation: OPERATION_NAMES.route,
      state: 'provider_selection_required',
      candidates,
      count: candidates.length,
      permissions,
      metadata: { permissions, approval: approvalMetadata(input) },
      effects: { providerExecution: false, mutatesProvider: false }
    }
  }
  const selectedProvider = provider || candidates[0]?.providerId
  const resolved = assertDestination({ ...input, channel, provider: selectedProvider })
  const compatibility = validatePublicationCompatibility({ ...input, channel, provider: selectedProvider })
  if (!compatibility.compatible) throw new PublicationContractError('publication_incompatible', 'El contenido no es compatible con el destino seleccionado.', { compatibility }, 422)
  return baseContract('route', input, resolved, {
    state: 'routed',
    channel: resolved.destination.channelId,
    provider: resolved.destination.providerId,
    destinationId: resolved.destination.id,
    candidates: [resolved.destination],
    compatibility
  })
}

export function preparePublication(input = {}) {
  const resolved = assertDestination(input)
  const compatibility = validatePublicationCompatibility(input)
  if (!compatibility.compatible) throw new PublicationContractError('publication_incompatible', 'El contenido no es compatible con el destino seleccionado.', { compatibility }, 422)
  const assets = normalizeAssets(input.assets)
  const content = contentPayload(input, resolved.channelDefinition.maxTextLength)
  return baseContract('prepare', input, resolved, {
    state: 'ready_for_review',
    channel: { ...resolved.channelDefinition },
    provider: { ...resolved.providerDefinition },
    content,
    assets,
    bundle: { destination: resolved.destination.id, content, assets },
    next: ['human_review', 'publication.schedule', 'publication.publish']
  })
}

function publicationAction(input, operation, state) {
  const resolved = assertDestination(input)
  const compatibility = validatePublicationCompatibility(input)
  if (!compatibility.compatible) throw new PublicationContractError('publication_incompatible', 'El contenido no es compatible con el destino seleccionado.', { compatibility }, 422)
  const approval = approvalMetadata(input)
  throwApprovalError(approval)
  const assets = normalizeAssets(input.assets)
  const content = contentPayload(input, resolved.channelDefinition.maxTextLength)
  return baseContract(operation, input, resolved, {
    state,
    // `state` is the canonical publication lifecycle field. Keep `status` as
    // an additive alias for clients that consume capability manifests.
    status: state,
    channel: { ...resolved.channelDefinition },
    provider: { ...resolved.providerDefinition },
    content,
    assets,
    bundle: { destination: resolved.destination.id, content, assets },
    scheduledAt: operation === 'schedule' ? new Date(input.publicationDate).toISOString() : null,
    timezone: clean(input.timezone || 'UTC', 80) || 'UTC',
    next: ['publication.status.get']
  })
}

export function schedulePublication(input = {}) {
  const date = new Date(input.publicationDate)
  if (!clean(input.publicationDate, 100) || !Number.isFinite(date.getTime())) throw new PublicationContractError('publication_date_invalid', 'publicationDate debe ser una fecha válida.', { field: 'publicationDate' })
  if (date.getTime() <= Date.now()) throw new PublicationContractError('publication_date_not_future', 'publicationDate debe estar en el futuro.', { field: 'publicationDate' })
  return publicationAction(input, 'schedule', 'schedule_requested')
}

export function publishPublication(input = {}) {
  return publicationAction(input, 'publish', 'publish_requested')
}

function normalizeStatus(value) {
  const status = clean(value, 60).toLowerCase()
  if (['queued', 'pending', 'created', 'requested'].includes(status)) return 'queued'
  if (['running', 'processing', 'syncing'].includes(status)) return 'running'
  if (['ready_for_review', 'review'].includes(status)) return 'ready_for_review'
  if (['approved'].includes(status)) return 'approved'
  if (['scheduled', 'schedule_requested', 'draft'].includes(status)) return 'scheduled'
  if (['published', 'publish', 'sent', 'success', 'completed', 'done'].includes(status)) return 'published'
  if (['canceled', 'cancelled'].includes(status)) return 'canceled'
  if (['failed', 'error', 'rejected', 'failure'].includes(status)) return 'failed'
  if (['action_required'].includes(status)) return 'action_required'
  return status || 'unknown'
}

export function getPublicationStatus(input = {}) {
  const permissions = assertPermissions(input, 'status')
  const status = normalizeStatus(input.status || input.externalStatus || input.providerStatus || input.publication?.status)
  const publicationId = clean(input.publicationId || input.publication?.publicationId || input.providerPostId, 300) || null
  return {
    contractVersion: PUBLICATION_CONTRACT_VERSION,
    operation: OPERATION_NAMES.status,
    publicationId,
    status,
    providerStatus: clean(input.externalStatus || input.providerStatus, 100) || null,
    terminal: ['published', 'canceled', 'failed'].includes(status),
    permissions,
    metadata: { permissions }
  }
}

export const destinationList = listPublicationDestinations
export const validateDestination = validatePublicationCompatibility
export const publicationValidate = validatePublicationCompatibility
export const publicationRoute = routePublication
export const publicationPrepare = preparePublication
export const publicationSchedule = schedulePublication
export const publicationPublish = publishPublication
export const publicationStatus = getPublicationStatus
