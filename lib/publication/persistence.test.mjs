import test from 'node:test'
import assert from 'node:assert/strict'
import { publicationRequestHash, publicationRunSnapshot, PUBLICATION_EXECUTION_STATUSES, PUBLICATION_RUN_STATUSES } from './persistence.mjs'

test('el control plane usa estados accionables y no marca ejecución externa', () => {
  assert.ok(PUBLICATION_RUN_STATUSES.includes('action_required'))
  assert.ok(PUBLICATION_EXECUTION_STATUSES.includes('awaiting_provider'))
  const contract = {
    contractVersion: 'publication.v1',
    operation: 'publication.publish',
    publicationId: 'pub-1',
    idempotencyKey: 'publish:pub-1',
    destination: { id: 'instagram_reel:buffer' },
    bundle: { assets: [{ assetId: 'asset-1' }] },
    metadata: { providerToken: 'must-not-affect-hash' }
  }
  assert.equal(publicationRequestHash(contract), publicationRequestHash({ ...contract, metadata: { providerToken: 'other' } }))
})

test('la proyección de un run no expone la fila SQL ni muta el bundle', () => {
  const row = publicationRunSnapshot({
    id: 'run-1', workspace_id: 'w-1', site_id: 's-1', user_id: 'u-1',
    operation: 'publication.prepare', publication_id: 'pub-1', run_id: 'r-1',
    idempotency_key: 'prepare:pub-1', request_hash: 'hash', channel: 'instagram_reel',
    provider: 'buffer', destination_id: 'instagram_reel:buffer', status: 'ready_for_review',
    execution_status: 'awaiting_human_approval', approval_status: 'pending',
    approved_at: null, approved_by: null, scheduled_at: null, timezone: 'UTC',
    provider_post_id: null, provider_status: null, last_error: null, attempts: 0,
    provider_execution: false, bundle: { assets: [{ assetId: 'asset-1' }] }, metadata: {},
    created_at: '2026-10-08T00:00:00.000Z', updated_at: '2026-10-08T00:00:00.000Z'
  })
  assert.equal(row.providerExecution, false)
  assert.equal(row.executionStatus, 'awaiting_human_approval')
  assert.equal(row.nextAction, 'human_review')
  assert.equal(row.bundle.assets[0].assetId, 'asset-1')
  assert.equal('workspace_id' in row, false)
})
