import { ESCARLET_OS_CONTRACT_VERSION } from './contracts.mjs'

export const ARTIFACT_KINDS = Object.freeze([
  'image',
  'video',
  'audio',
  'text',
  'caption',
  'brand_context',
  'publication_bundle'
])

export const RUN_STATUSES = Object.freeze([
  'queued',
  'running',
  'awaiting_provider',
  'awaiting_human_approval',
  'ready_for_review',
  'approved',
  'scheduled',
  'published',
  'failed',
  'cancelled',
  'blocked'
])

export const ARTIFACT_REFERENCE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    assetId: { type: 'string', minLength: 1 },
    role: { type: 'string', minLength: 1 },
    sha256: { type: 'string', minLength: 1 },
    kind: { type: 'string', enum: ARTIFACT_KINDS }
  },
  required: ['assetId'],
  additionalProperties: false
})

function fail(message, code = 'ARTIFACT_INVALID', details = {}) {
  const error = new TypeError(message)
  error.code = code
  error.details = details
  throw error
}
function text(value, field, max = 500) {
  const result = String(value ?? '').trim()
  if (!result) fail(`${field} es obligatorio.`, 'ARTIFACT_FIELD_REQUIRED', { field })
  if (result.length > max) fail(`${field} supera el máximo permitido.`, 'ARTIFACT_FIELD_TOO_LONG', { field, max })
  return result
}

function optionalText(value, field, max = 500) {
  if (value === undefined || value === null || value === '') return null
  return text(value, field, max)
}

function object(value, field, fallback = {}) {
  if (value === undefined || value === null) return fallback
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} debe ser un objeto.`, 'ARTIFACT_OBJECT_INVALID', { field })
  return value
}

function clone(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(clone)
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]))
}

export function normalizeArtifactReference(input = {}, { role, kind } = {}) {
  if (typeof input === 'string') input = { assetId: input }
  const source = object(input, 'artifact')
  const assetId = text(source.assetId || source.id, 'assetId', 300)
  const resolvedRole = optionalText(source.role || role, 'role', 120)
  const resolvedKind = optionalText(source.kind || kind, 'kind', 60)
  if (resolvedKind && !ARTIFACT_KINDS.includes(resolvedKind)) fail(`kind no soportado: ${resolvedKind}.`, 'ARTIFACT_KIND_INVALID', { kind: resolvedKind })
  const sha256 = optionalText(source.sha256 || source.hash, 'sha256', 200)
  return Object.freeze({
    assetId,
    ...(resolvedRole ? { role: resolvedRole } : {}),
    ...(resolvedKind ? { kind: resolvedKind } : {}),
    ...(sha256 ? { sha256 } : {})
  })
}

export function normalizeArtifact(input = {}) {
  const source = object(input, 'artifact')
  const kind = text(source.kind || source.type, 'kind', 60)
  if (!ARTIFACT_KINDS.includes(kind)) fail(`kind no soportado: ${kind}.`, 'ARTIFACT_KIND_INVALID', { kind })
  const artifactId = text(source.artifactId || source.assetId || source.id, 'artifactId', 300)
  const mimeType = optionalText(source.mimeType || source.mime_type, 'mimeType', 160)
  const sha256 = optionalText(source.sha256 || source.hash, 'sha256', 200)
  const metadata = clone(object(source.metadata, 'metadata'))
  const provenance = clone(object(source.provenance, 'provenance'))
  const dimensions = source.dimensions === undefined ? null : clone(object(source.dimensions, 'dimensions'))
  const durationMs = source.durationMs === undefined || source.durationMs === null ? null : Number(source.durationMs)
  if (durationMs !== null && (!Number.isFinite(durationMs) || durationMs < 0)) fail('durationMs debe ser un número no negativo.', 'ARTIFACT_DURATION_INVALID', { durationMs })
  return Object.freeze({
    contractVersion: source.contractVersion || ESCARLET_OS_CONTRACT_VERSION,
    artifactId,
    kind,
    ...(mimeType ? { mimeType } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(source.storageUrl ? { storageUrl: text(source.storageUrl, 'storageUrl', 4000) } : {}),
    ...(dimensions ? { dimensions } : {}),
    ...(durationMs !== null ? { durationMs } : {}),
    metadata,
    provenance,
    createdAt: source.createdAt || new Date().toISOString()
  })
}

export function normalizeRunEnvelope(input = {}) {
  const source = object(input, 'run')
  const status = text(source.status, 'status', 60).toLowerCase()
  if (!RUN_STATUSES.includes(status)) fail(`status no soportado: ${status}.`, 'RUN_STATUS_INVALID', { status })
  const outputs = Array.isArray(source.outputs) ? source.outputs.map((entry) => normalizeArtifactReference(entry)) : []
  const error = source.error === undefined || source.error === null ? null : (() => {
    const value = object(source.error, 'error')
    return {
      code: text(value.code || 'run_failed', 'error.code', 120),
      message: text(value.message || 'La ejecución no pudo completarse.', 'error.message', 2000),
      retryable: value.retryable === true
    }
  })()
  return Object.freeze({
    contractVersion: source.contractVersion || ESCARLET_OS_CONTRACT_VERSION,
    runId: text(source.runId, 'runId', 300),
    capability: optionalText(source.capability, 'capability', 160),
    status,
    outputs,
    ...(source.nextAction ? { nextAction: text(source.nextAction, 'nextAction', 200) } : {}),
    ...(error ? { error } : {})
  })
}
