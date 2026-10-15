import { createHash, randomUUID } from 'node:crypto'
import { getPgPool, runCoreMigrations, withPgTransaction } from '../pg.mjs'

export const PUBLICATION_RUN_STATUSES = Object.freeze([
  'routed', 'ready_for_review', 'scheduled', 'publish_requested',
  'queued', 'running', 'published', 'failed', 'canceled', 'action_required'
])

export const PUBLICATION_EXECUTION_STATUSES = Object.freeze([
  'not_started', 'awaiting_human_approval', 'awaiting_provider',
  'queued', 'running', 'published', 'failed', 'canceled'
])

const PERSISTED_OPERATIONS = new Set([
  'publication.route',
  'publication.prepare',
  'publication.schedule',
  'publication.publish'
])

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max)
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function publicationError(message, status, code, details = {}) {
  return Object.assign(new Error(message), { status, code, details })
}

function scopeValue(value, name) {
  const result = text(value, 200)
  if (!result) throw publicationError(`${name} es obligatorio para persistir la publicación.`, 422, 'publication_scope_required', { field: name })
  return result
}

function runId() {
  return `pubrun_${randomUUID().replace(/-/g, '').slice(0, 20)}`
}

function normalizeOperation(value) {
  const operation = text(value, 80)
  if (!PERSISTED_OPERATIONS.has(operation)) throw publicationError(`Operación de publicación no persistible: ${operation || '(vacía)'}.`, 422, 'publication_operation_invalid', { operation })
  return operation
}

function approvalStatus(contract) {
  return text(contract?.approval?.status, 30).toLowerCase() || 'pending'
}

function statusFor(contract) {
  if (contract.operation === 'publication.route') return 'routed'
  if (contract.operation === 'publication.prepare') return 'ready_for_review'
  if (contract.operation === 'publication.schedule') return 'scheduled'
  return 'publish_requested'
}

function executionStatusFor(contract) {
  if (contract.operation === 'publication.route') return 'not_started'
  if (contract.operation === 'publication.prepare') return 'awaiting_human_approval'
  // shortcut: no MCP Publisher adapter registry yet, keep requests awaiting_provider; upgrade when a provider worker can validate credentials and claim this run.
  return 'awaiting_provider'
}

function nextActionFor(executionStatus) {
  if (executionStatus === 'awaiting_human_approval') return 'human_review'
  if (executionStatus === 'awaiting_provider') return 'configure_provider_connection'
  if (executionStatus === 'failed') return 'inspect_provider_error'
  if (executionStatus === 'published') return null
  return 'publication_status_get'
}

function sanitizedContract(contract = {}) {
  const allowed = [
    'contractVersion', 'operation', 'publicationId', 'runId', 'idempotencyKey',
    'destination', 'approval', 'channel', 'provider', 'content', 'assets',
    'bundle', 'scheduledAt', 'timezone', 'state', 'compatibility', 'candidates',
    'next', 'effects', 'cmsUrl', 'previewUrl', 'editUrl', 'reviewUrl', 'contentItemId', 'batchId'
  ]
  return Object.fromEntries(allowed.filter((key) => contract[key] !== undefined).map((key) => [key, contract[key]]))
}

function requestHash(contract) {
  return createHash('sha256').update(JSON.stringify(sanitizedContract(contract))).digest('hex')
}

function publicRow(row) {
  if (!row) return null
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    userId: row.user_id,
    operation: row.operation,
    publicationId: row.publication_id,
    runId: row.run_id,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    channel: row.channel,
    provider: row.provider,
    destinationId: row.destination_id,
    status: row.status,
    executionStatus: row.execution_status,
    nextAction: nextActionFor(row.execution_status),
    approval: {
      required: true,
      status: row.approval_status,
      approvedAt: row.approved_at,
      approvedBy: row.approved_by
    },
    scheduledAt: row.scheduled_at,
    timezone: row.timezone,
    providerPostId: row.provider_post_id,
    providerStatus: row.provider_status,
    lastError: row.last_error,
    attempts: row.attempts,
    providerExecution: row.provider_execution,
    bundle: object(row.bundle),
    metadata: object(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function validateContract(contract) {
  const operation = normalizeOperation(contract?.operation)
  const publicationId = text(contract?.publicationId, 300)
  if (!publicationId) throw publicationError('publicationId es obligatorio para persistir la publicación.', 422, 'publication_id_required')
  const key = text(contract?.idempotencyKey, 300)
  if (!key) throw publicationError('idempotencyKey es obligatorio para persistir la publicación.', 422, 'publication_idempotency_required')
  const destination = object(contract.destination)
  return {
    operation,
    publicationId,
    runId: text(contract.runId, 300) || publicationId,
    idempotencyKey: key,
    destination,
    approvalStatus: approvalStatus(contract),
    requestHash: requestHash({ ...contract, operation, publicationId, idempotencyKey: key })
  }
}

function persistedResponse(contract, row, { deduplicated = false } = {}) {
  const run = publicRow(row)
  return {
    ...contract,
    state: run.status,
    // Keep the persisted status aligned with the durable run while retaining
    // `state` for existing Publisher clients.
    status: run.status,
    runId: run.runId,
    publicationId: run.publicationId,
    idempotencyKey: run.idempotencyKey,
    persistence: {
      persisted: true,
      deduplicated,
      run
    },
    effects: {
      ...object(contract.effects),
      providerExecution: false,
      mutatesProvider: false,
      publicationRunCreated: !deduplicated
    }
  }
}

async function poolOrThrow() {
  await runCoreMigrations()
  const pool = await getPgPool()
  if (!pool) throw publicationError('Postgres no está configurado.', 503, 'postgres_required')
  return pool
}

/**
 * Persist a pure Publisher contract without contacting a provider.
 * The row is the durable control-plane record consumed by a future adapter.
 */
export async function persistPublicationOperation(contract, { workspaceId, siteId, siteHandle, userId = null, metadata = {} } = {}) {
  const scopeWorkspaceId = scopeValue(workspaceId, 'workspaceId')
  const normalized = validateContract(contract)
  const pool = await poolOrThrow()
  let scopeSiteId = text(siteId, 200)
  if (!scopeSiteId && siteHandle) {
    const site = await pool.query('SELECT id FROM sites WHERE workspace_id=$1 AND LOWER(handle)=LOWER($2) LIMIT 1', [scopeWorkspaceId, text(siteHandle, 200)])
    scopeSiteId = site.rows[0]?.id || ''
  }
  if (!scopeSiteId) throw publicationError('siteId o siteHandle es obligatorio para persistir la publicación.', 422, 'publication_scope_required', { field: 'siteId' })
  const safeContract = sanitizedContract(contract)
  const status = statusFor(normalized)
  const executionStatus = executionStatusFor(normalized)
  const approval = object(contract.approval)
  const scheduledAt = text(contract.scheduledAt, 100) || null
  const destination = normalized.destination
  return withPgTransaction(pool, async (client) => {
    const previous = await client.query(
      'SELECT * FROM publication_runs WHERE workspace_id=$1 AND idempotency_key=$2 FOR UPDATE',
      [scopeWorkspaceId, normalized.idempotencyKey]
    )
    if (previous.rowCount) {
      const row = previous.rows[0]
      if (row.request_hash !== normalized.requestHash) {
        throw publicationError('La clave de idempotencia ya corresponde a otra publicación.', 409, 'publication_idempotency_conflict', { idempotencyKey: normalized.idempotencyKey, publicationId: row.publication_id })
      }
      return persistedResponse(contract, row, { deduplicated: true })
    }
    const id = runId()
    const inserted = await client.query(`
      INSERT INTO publication_runs (
        id,workspace_id,site_id,user_id,operation,publication_id,run_id,idempotency_key,
        request_hash,channel,provider,destination_id,status,execution_status,approval_status,
        approved_at,approved_by,scheduled_at,timezone,provider_execution,bundle,metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,FALSE,$20,$21)
      ON CONFLICT (workspace_id,idempotency_key) DO NOTHING
      RETURNING *
    `, [
      id, scopeWorkspaceId, scopeSiteId, userId || null, normalized.operation,
      normalized.publicationId, normalized.runId, normalized.idempotencyKey,
      normalized.requestHash, text(destination.channelId || destination.channel, 80) || null,
      text(destination.providerId || destination.provider, 80) || null,
      text(destination.id, 200) || null, status, executionStatus,
      normalized.approvalStatus, approval.approvedAt || null, approval.approvedBy || null,
      scheduledAt, text(contract.timezone || 'UTC', 80) || 'UTC',
      JSON.stringify(object(safeContract.bundle)), JSON.stringify({ ...object(metadata), contract: safeContract })
    ])
    if (inserted.rowCount) return persistedResponse(contract, inserted.rows[0])
    const race = await client.query('SELECT * FROM publication_runs WHERE workspace_id=$1 AND idempotency_key=$2 FOR UPDATE', [scopeWorkspaceId, normalized.idempotencyKey])
    const row = race.rows[0]
    if (!row || row.request_hash !== normalized.requestHash) throw publicationError('La clave de idempotencia ya corresponde a otra publicación.', 409, 'publication_idempotency_conflict', { idempotencyKey: normalized.idempotencyKey })
    return persistedResponse(contract, row, { deduplicated: true })
  })
}

export async function getPublicationRun({ workspaceId, siteId, publicationId, runId: requestedRunId } = {}) {
  const scopeWorkspaceId = scopeValue(workspaceId, 'workspaceId')
  const pool = await poolOrThrow()
  const conditions = ['workspace_id=$1']
  const values = [scopeWorkspaceId]
  if (siteId) { values.push(text(siteId, 200)); conditions.push(`site_id=$${values.length}`) }
  if (requestedRunId) { values.push(text(requestedRunId, 300)); conditions.push(`run_id=$${values.length}`) }
  else if (publicationId) { values.push(text(publicationId, 300)); conditions.push(`publication_id=$${values.length}`) }
  else throw publicationError('runId o publicationId es obligatorio.', 422, 'publication_id_required')
  const result = await pool.query(`SELECT * FROM publication_runs WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC LIMIT 1`, values)
  if (!result.rowCount) throw publicationError('Ejecución de publicación no encontrada.', 404, 'publication_run_not_found')
  return publicRow(result.rows[0])
}

export async function listPublicationRuns({ workspaceId, siteId, status, limit = 50 } = {}) {
  const scopeWorkspaceId = scopeValue(workspaceId, 'workspaceId')
  const pool = await poolOrThrow()
  const values = [scopeWorkspaceId]
  const conditions = ['workspace_id=$1']
  if (siteId) { values.push(text(siteId, 200)); conditions.push(`site_id=$${values.length}`) }
  if (status) { values.push(text(status, 80)); conditions.push(`status=$${values.length}`) }
  const max = Math.min(Math.max(Number(limit) || 50, 1), 200)
  const result = await pool.query(`SELECT * FROM publication_runs WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC LIMIT ${max}`, values)
  return result.rows.map(publicRow)
}

export async function transitionPublicationRun({ workspaceId, siteId, runId: requestedRunId, status, providerStatus, providerPostId, error = null, approvedBy = null, approvedAt = null } = {}) {
  const scopeWorkspaceId = scopeValue(workspaceId, 'workspaceId')
  const scopeSiteId = scopeValue(siteId, 'siteId')
  const nextStatus = text(status, 50)
  if (!PUBLICATION_RUN_STATUSES.includes(nextStatus)) throw publicationError('Estado de publicación no válido.', 422, 'publication_status_invalid', { status: nextStatus })
  if (!requestedRunId) throw publicationError('runId es obligatorio.', 422, 'publication_run_required')
  const pool = await poolOrThrow()
  return withPgTransaction(pool, async (client) => {
    const current = await client.query('SELECT * FROM publication_runs WHERE workspace_id=$1 AND site_id=$2 AND run_id=$3 FOR UPDATE', [scopeWorkspaceId, scopeSiteId, text(requestedRunId, 300)])
    if (!current.rowCount) throw publicationError('Ejecución de publicación no encontrada.', 404, 'publication_run_not_found')
    const row = current.rows[0]
    if (['scheduled', 'publish_requested', 'published'].includes(nextStatus) && row.approval_status !== 'approved') throw publicationError('La publicación requiere aprobación humana.', 409, 'publication_approval_required')
    const executionStatus = nextStatus === 'published' ? 'published' : nextStatus === 'failed' ? 'failed' : nextStatus === 'canceled' ? 'canceled' : row.execution_status
    const updated = await client.query(`
      UPDATE publication_runs SET status=$4,execution_status=$5,provider_status=COALESCE($6,provider_status),provider_post_id=COALESCE($7,provider_post_id),last_error=$8,approval_status=CASE WHEN $9 IS NOT NULL THEN 'approved' ELSE approval_status END,approved_by=COALESCE($9,approved_by),approved_at=COALESCE($10,approved_at),updated_at=NOW()
      WHERE workspace_id=$1 AND site_id=$2 AND run_id=$3 RETURNING *
    `, [scopeWorkspaceId, scopeSiteId, text(requestedRunId, 300), nextStatus, executionStatus, text(providerStatus, 200) || null, text(providerPostId, 300) || null, text(error, 2000) || null, text(approvedBy, 200) || null, approvedAt || null])
    return publicRow(updated.rows[0])
  })
}

export const publicationRunSnapshot = publicRow
export const publicationRequestHash = requestHash
