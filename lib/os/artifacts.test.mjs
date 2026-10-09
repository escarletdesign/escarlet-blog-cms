import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeArtifact, normalizeArtifactReference, normalizeRunEnvelope } from './artifacts.mjs'

test('normaliza referencias de artefactos sin aceptar blobs', () => {
  assert.deepEqual(normalizeArtifactReference({ assetId: 'asset-1', role: 'product', kind: 'image' }), {
    assetId: 'asset-1', role: 'product', kind: 'image'
  })
  assert.throws(() => normalizeArtifactReference({ assetId: 'asset-1', kind: 'binary' }), /kind no soportado/)
})

test('normaliza artefactos con procedencia y metadatos', () => {
  const artifact = normalizeArtifact({
    artifactId: 'media-1', kind: 'video', mimeType: 'video/mp4', sha256: 'abc',
    durationMs: 1200, provenance: { recipeId: 'food-to-reel' }
  })
  assert.equal(artifact.contractVersion, 'production.v1')
  assert.equal(artifact.kind, 'video')
  assert.equal(artifact.provenance.recipeId, 'food-to-reel')
})

test('normaliza envelopes de ejecución y errores accionables', () => {
  const run = normalizeRunEnvelope({
    runId: 'run-1', capability: 'production.motion.compose', status: 'failed',
    outputs: [{ assetId: 'asset-1', role: 'video' }],
    error: { code: 'provider_missing', message: 'Configura el proveedor.', retryable: false }
  })
  assert.equal(run.status, 'failed')
  assert.equal(run.outputs[0].assetId, 'asset-1')
  assert.equal(run.error.retryable, false)
})
