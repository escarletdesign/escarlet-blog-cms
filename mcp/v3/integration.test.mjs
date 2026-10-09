import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createMcpServerV3Sync } from './index.mjs'

function testRuntime() {
  const jobsByKey = new Map()
  const productAssetsByPreparation = new Map()
  const publicationsByKey = new Map()
  const publicationsById = new Map()
  const calls = { motion: 0, product: 0, publish: 0 }

  return {
    calls,
    resolveWorkspaceContext: async ({ siteHandle = 'escarlet' }) => ({
      workspaceId: 'test-workspace',
      sites: [{ id: 'test-site', handle: siteHandle, name: 'Escarlet test' }]
    }),
    createVideoJob: async (input) => {
      if (jobsByKey.has(input.idempotencyKey)) return jobsByKey.get(input.idempotencyKey)
      calls.motion += 1
      const videoJobId = `vid_test_${jobsByKey.size + 1}`
      const response = {
        videoJobId,
        job: {
          id: videoJobId,
          workspaceId: input.workspaceId,
          siteId: input.siteId,
          sourceMediaId: input.sourceMediaId,
          provider: input.provider,
          status: 'queued',
          metadata: input.metadata
        }
      }
      jobsByKey.set(input.idempotencyKey, response)
      return response
    },
    updateVideoJob: async ({ videoJobId, status, ...input }) => {
      const previous = [...jobsByKey.values()].find((entry) => entry.videoJobId === videoJobId)
      return { job: { ...(previous?.job || {}), id: videoJobId, status, ...input } }
    },
    transformProduct: async ({ sourceAssetId, preparation }) => {
      const previous = productAssetsByPreparation.get(preparation.preparationId)
      if (previous) return { asset: previous }
      calls.product += 1
      const asset = {
        assetId: `derived_${sourceAssetId}`,
        kind: 'image',
        mimeType: 'image/png',
        sha256: createHash('sha256').update(`${sourceAssetId}:${preparation.preparationId}`).digest('hex')
      }
      productAssetsByPreparation.set(preparation.preparationId, asset)
      return { asset }
    },
    registerAssetReference: async ({ assetId, workspaceId, siteId, sha256 }) => ({
      contractVersion: 'os.production.v1',
      assetId,
      sha256: sha256 || createHash('sha256').update(assetId).digest('hex'),
      mimeType: 'image/png',
      provenance: { workspaceId, siteId, source: 'test-media-assets' }
    }),
    persistPublicationOperation: async (contract, scope) => {
      const key = `${scope.workspaceId}:${contract.idempotencyKey}`
      const previous = publicationsByKey.get(key)
      if (previous) return { ...previous, persistence: { ...previous.persistence, deduplicated: true } }
      const run = {
        id: `pubrun_test_${publicationsByKey.size + 1}`,
        runId: contract.runId,
        publicationId: contract.publicationId,
        status: contract.state,
        providerStatus: null
      }
      const result = {
        ...contract,
        state: contract.state,
        status: contract.state,
        persistence: { persisted: true, deduplicated: false, run },
        effects: { ...contract.effects, providerExecution: false, mutatesProvider: false }
      }
      publicationsByKey.set(key, result)
      publicationsById.set(contract.publicationId, run)
      if (contract.operation === 'publication.publish') calls.publish += 1
      return result
    },
    getPublicationRun: async ({ publicationId }) => {
      const run = publicationsById.get(publicationId)
      if (run) return run
      throw Object.assign(new Error('Ejecución de publicación no encontrada.'), { code: 'publication_run_not_found', status: 404 })
    }
  }
}

async function call(server, name, arguments_ = {}) {
  return server._requestHandlers.get('tools/call')({
    method: 'tools/call',
    params: { name, arguments: arguments_ }
  }, { mcpReq: { requestState: () => undefined } })
}

test('las recipes producen resultados trazables con proveedores simulados y quedan para revisión', async () => {
  const runtime = testRuntime()
  const server = createMcpServerV3Sync({
    role: 'agent',
    site: 'escarlet',
    workspaceId: 'test-workspace',
    siteId: 'test-site'
  }, { runtime })

  const recipes = [
    ['recipe.food-to-reel', 'food-asset', 'Plato del día con producto local', 'instagram_reel'],
    ['recipe.menu-to-reel', 'menu-asset', 'Menú del día: ensalada y pasta', 'instagram_story'],
    ['recipe.reel-from-image', 'generic-asset', 'Historia breve de la marca', 'instagram_reel']
  ]
  for (const [recipeId, sourceMediaId, text, formatProfile] of recipes) {
    const result = await call(server, 'recipe.run', { recipeId, site: 'escarlet', sourceMediaId, text, formatProfile, idempotencyKey: `${recipeId}:test` })
    assert.equal(result.isError, false, `${recipeId}: ${JSON.stringify(result.structuredContent)}`)
    const value = result.structuredContent
    assert.equal(value.status, 'queued')
    assert.match(value.runId, /^vid_test_\d+$/)
    assert.equal(value.copy.valid, true)
    assert.equal(value.review.status, 'pending')
    assert.equal(value.review.next, 'human_approval')
    assert.ok(value.motion.job.metadata.brandKitVersionId)
    if (recipeId === 'recipe.reel-from-image') assert.equal(value.motion.job.metadata.recipeId, 'recipe.reel-from-image')
    assert.ok(value.destinations.destinations.length > 0)
    assert.equal(runtime.calls.publish, 0)
  }

  const repeated = { recipeId: 'recipe.food-to-reel', site: 'escarlet', sourceMediaId: 'food-asset', text: 'Plato del día con producto local', formatProfile: 'instagram_reel', idempotencyKey: 'recipe.food-to-reel:test' }
  const replay = await call(server, 'recipe.run', repeated)
  assert.equal(replay.isError, false)
  assert.equal(replay.structuredContent.runId, 'vid_test_1')
  assert.equal(runtime.calls.motion, 3)

  const product = await call(server, 'recipe.run', {
    recipeId: 'recipe.product-to-social',
    site: 'escarlet',
    sourceMediaId: 'product-asset',
    text: 'Novedad de temporada',
    formatProfile: 'instagram_post',
    idempotencyKey: 'recipe.product-to-social:test'
  })
  assert.equal(product.isError, false, JSON.stringify(product.structuredContent))
  assert.equal(product.structuredContent.status, 'ready_for_review')
  assert.equal(product.structuredContent.review.next, 'human_approval')
  assert.match(product.structuredContent.product.runId, /^[a-f0-9]{64}$/)
  assert.equal(product.structuredContent.product.assets[0].assetId, 'derived_product-asset')
  assert.match(product.structuredContent.product.assets[0].sha256, /^[a-f0-9]{64}$/)
  assert.match(product.structuredContent.product.receipt.generatedFileHash, /^[a-f0-9]{64}$/)
  assert.ok(product.structuredContent.product.receipt.resolvedReferenceHashes.every((hash) => /^[a-f0-9]{64}$/i.test(hash)))
  assert.equal(product.structuredContent.product.provenance.brandKitVersionId, product.structuredContent.product.preparation.brandKitVersionId)
  assert.equal(product.structuredContent.product.effects.providerExecution, false)

  const registered = await call(server, 'asset.register', {
    assetId: product.structuredContent.product.assets[0].assetId,
    workspaceId: 'test-workspace',
    siteId: 'test-site',
    sha256: product.structuredContent.product.assets[0].sha256
  })
  assert.equal(registered.isError, false)
  assert.equal(registered.structuredContent.assetId, product.structuredContent.product.assets[0].assetId)
  assert.equal(registered.structuredContent.provenance.workspaceId, 'test-workspace')

  const productReplay = await call(server, 'recipe.run', {
    recipeId: 'recipe.product-to-social',
    site: 'escarlet',
    sourceMediaId: 'product-asset',
    text: 'Novedad de temporada',
    formatProfile: 'instagram_post',
    idempotencyKey: 'recipe.product-to-social:test'
  })
  assert.equal(productReplay.isError, false)
  assert.equal(productReplay.structuredContent.product.runId, product.structuredContent.product.runId)
  assert.equal(productReplay.structuredContent.product.assets[0].assetId, product.structuredContent.product.assets[0].assetId)
  assert.equal(runtime.calls.product, 1)
})

test('una recipe de motion puede recibir solo assets y copy por escena', async () => {
  const runtime = testRuntime()
  const server = createMcpServerV3Sync({ role: 'agent', site: 'escarlet', workspaceId: 'test-workspace', siteId: 'test-site' }, { runtime })
  const result = await call(server, 'recipe.run', {
    recipeId: 'recipe.food-to-reel',
    site: 'escarlet',
    motionAssets: [{ assetId: 'food-asset', role: 'source', kind: 'image' }, { assetId: 'logo-svg', role: 'logo', kind: 'image', mimeType: 'image/svg+xml' }],
    copyBlocks: [{ sceneId: 'intro', headline: 'Plato del día', body: 'Producto local y temporada.' }],
    formatProfile: 'instagram_reel'
  })
  assert.equal(result.isError, false, JSON.stringify(result.structuredContent))
  assert.equal(result.structuredContent.status, 'queued')
  assert.equal(result.structuredContent.copy.valid, true)
  assert.equal(result.structuredContent.motion.job.metadata.sourceMediaId, 'food-asset')
  assert.equal(result.structuredContent.motion.job.metadata.logoAssetId, 'logo-svg')
  assert.equal(result.structuredContent.motion.job.metadata.copyBlocks[0].sceneId, 'intro')
})

test('Publisher valida, persiste idempotencia, exige aprobación y expone estado consultable', async () => {
  const runtime = testRuntime()
  const server = createMcpServerV3Sync({
    role: 'agent',
    site: 'escarlet',
    workspaceId: 'test-workspace',
    siteId: 'test-site'
  }, { runtime })
  const assetIds = ['derived_product-asset']
  const valid = await call(server, 'publication.validate', { assetIds, channel: 'instagram_post', provider: 'postiz' })
  assert.equal(valid.isError, false)
  assert.equal(valid.structuredContent.compatible, true)
  assert.equal(valid.structuredContent.valid, true)

  const selection = await call(server, 'publication.route', { workspaceId: 'test-workspace', siteId: 'test-site', channel: 'instagram_post', assetIds })
  assert.equal(selection.isError, false)
  assert.equal(selection.structuredContent.state, 'provider_selection_required')
  assert.ok(selection.structuredContent.candidates.length > 1)

  const preparedArgs = { workspaceId: 'test-workspace', siteId: 'test-site', channel: 'instagram_post', provider: 'postiz', assetIds, text: 'Novedad de temporada', idempotencyKey: 'publication:test' }
  const prepared = await call(server, 'publication.prepare', preparedArgs)
  assert.equal(prepared.isError, false)
  assert.equal(prepared.structuredContent.state, 'ready_for_review')
  assert.equal(prepared.structuredContent.persistence.persisted, true)
  assert.equal(prepared.structuredContent.effects.providerExecution, false)

  const replay = await call(server, 'publication.prepare', preparedArgs)
  assert.equal(replay.isError, false)
  assert.equal(replay.structuredContent.publicationId, prepared.structuredContent.publicationId)
  assert.equal(replay.structuredContent.persistence.deduplicated, true)

  const scheduled = await call(server, 'publication.schedule', {
    ...preparedArgs,
    idempotencyKey: 'publication:schedule',
    publicationDate: '2099-01-01T10:00:00Z',
    approval: { status: 'approved', approvedBy: 'test-user', approvedAt: '2099-01-01T00:00:00Z' }
  })
  assert.equal(scheduled.isError, false)
  assert.equal(scheduled.structuredContent.state, 'schedule_requested')
  assert.equal(scheduled.structuredContent.persistence.persisted, true)
  assert.equal(scheduled.structuredContent.effects.providerExecution, false)

  const pending = await call(server, 'publication.publish', { ...preparedArgs, idempotencyKey: 'publication:publish', approval: { status: 'pending' } })
  assert.equal(pending.isError, true)
  assert.equal(pending.structuredContent.error.code, 'publication_approval_required')
  assert.equal(pending.structuredContent.error.retryable, false)

  const published = await call(server, 'publication.publish', {
    ...preparedArgs,
    idempotencyKey: 'publication:publish',
    approval: { status: 'approved', approvedBy: 'test-user', approvedAt: '2099-01-01T00:00:00Z' }
  })
  assert.equal(published.isError, false)
  assert.equal(published.structuredContent.state, 'publish_requested')
  assert.equal(published.structuredContent.status, 'publish_requested')
  assert.equal(published.structuredContent.effects.providerExecution, false)
  assert.equal(runtime.calls.publish, 1)

  const status = await call(server, 'publication.status.get', { workspaceId: 'test-workspace', siteId: 'test-site', publicationId: published.structuredContent.publicationId })
  assert.equal(status.isError, false)
  assert.equal(status.structuredContent.status, 'publish_requested')
  assert.equal(status.structuredContent.terminal, false)

  const unknownServer = createMcpServerV3Sync({ role: 'agent', site: 'escarlet', workspaceId: 'test-workspace', siteId: 'test-site' }, { runtime })
  const unknown = await call(unknownServer, 'publication.status.get', { publicationId: 'not-persisted' })
  assert.equal(unknown.isError, false)
  assert.equal(unknown.structuredContent.status, 'unknown')
  assert.equal(unknown.structuredContent.terminal, false)
})

test('motion recibe assets creativos de ChatGPT con roles, copy por escena y logo SVG opcional', async () => {
  const runtime = testRuntime()
  const server = createMcpServerV3Sync({
    role: 'agent',
    site: 'escarlet',
    workspaceId: 'test-workspace',
    siteId: 'test-site'
  }, { runtime })
  const result = await call(server, 'production.motion.compose', {
    site: 'escarlet',
    formatProfile: 'instagram_reel',
    motionAssets: [
      { assetId: 'background-asset', role: 'background', kind: 'image' },
      { assetId: 'logo-asset', role: 'logo', kind: 'image', mimeType: 'image/svg+xml' },
      { assetId: 'audio-asset', role: 'audio', kind: 'audio' }
    ],
    copyBlocks: [{ sceneId: 'intro', headline: 'Una idea clara', body: 'La marca se reconoce cuando sostiene un criterio.', durationMs: 2400 }],
    prompt: 'Animar la entrada con un movimiento suave y una transición luminosa.',
    idempotencyKey: 'motion:role-aware-test'
  })
  assert.equal(result.isError, false, JSON.stringify(result.structuredContent))
  const metadata = result.structuredContent.job.metadata
  assert.equal(result.structuredContent.status, 'queued')
  assert.equal(metadata.sourceMediaId, 'background-asset')
  assert.deepEqual(metadata.motionAssets.map((asset) => asset.role), ['background', 'logo', 'audio'])
  assert.equal(metadata.logoAssetId, 'logo-asset')
  assert.equal(metadata.audioAssetId, 'audio-asset')
  assert.equal(metadata.prompt, 'Animar la entrada con un movimiento suave y una transición luminosa.')
  assert.equal(result.structuredContent.copy.valid, true)
  assert.deepEqual(metadata.copyBlocks[0], { sceneId: 'intro', headline: 'Una idea clara', body: 'La marca se reconoce cuando sostiene un criterio.', durationMs: 2400 })
})

test('motion puede construir un timeline de varias escenas con modo flat_slides', async () => {
  const server = createMcpServerV3Sync({ role: 'agent', site: 'escarlet', workspaceId: 'test-workspace', siteId: 'test-site' }, { runtime: testRuntime() })
  const result = await call(server, 'production.motion.compose', {
    site: 'escarlet',
    formatProfile: 'instagram_reel',
    renderMode: 'flat_slides',
    motionAssets: [
      { assetId: 'slide-01', role: 'source', kind: 'image' },
      { assetId: 'slide-02', role: 'source', kind: 'image' },
      { assetId: 'slide-03', role: 'source', kind: 'image' }
    ],
    scenes: [
      { sceneId: 'intro', assetId: 'slide-01', durationMs: 4000 },
      { sceneId: 'middle', assetId: 'slide-02', durationMs: 4000 },
      { sceneId: 'outro', assetId: 'slide-03', durationMs: 4500 }
    ],
    idempotencyKey: 'motion:flat-slides-test'
  })
  assert.equal(result.isError, false, JSON.stringify(result.structuredContent))
  assert.equal(result.structuredContent.job.metadata.renderMode, 'flat_slides')
  assert.deepEqual(result.structuredContent.job.metadata.scenes.map((scene) => scene.assetId), ['slide-01', 'slide-02', 'slide-03'])
  assert.deepEqual(result.structuredContent.job.metadata.scenes.map((scene) => scene.durationMs), [4000, 4000, 4500])
})

test('motion no declara audio suministrado sin un asset de audio', async () => {
  const server = createMcpServerV3Sync({ role: 'agent', site: 'escarlet', workspaceId: 'test-workspace', siteId: 'test-site' }, { runtime: testRuntime() })
  const result = await call(server, 'production.motion.compose', {
    site: 'escarlet',
    formatProfile: 'instagram_reel',
    sourceMediaId: 'slide-01',
    audioMode: 'supplied',
    idempotencyKey: 'motion:audio-required-test'
  })
  assert.equal(result.isError, true)
  assert.equal(result.structuredContent.error.code, 'motion_audio_required')
})

test('las rutas de integración conservan errores accionables y permisos', async () => {
  const server = createMcpServerV3Sync({ role: 'agent', site: 'escarlet' }, { runtime: testRuntime() })
  const missingInput = await call(server, 'production.motion.compose', { site: 'escarlet', formatProfile: 'instagram_reel' })
  assert.equal(missingInput.isError, true)
  assert.equal(missingInput.structuredContent.error.code, 'motion_input_required')
  assert.equal(missingInput.structuredContent.error.status, 422)
  assert.equal(missingInput.structuredContent.error.retryable, false)

  const viewer = createMcpServerV3Sync({ role: 'viewer', site: 'escarlet' }, { runtime: testRuntime() })
  const denied = await call(viewer, 'recipe.run', { recipeId: 'recipe.food-to-reel', site: 'escarlet', sourceMediaId: 'asset', text: 'Texto' })
  assert.equal(denied.isError, true)
  assert.equal(denied.structuredContent.error.code, 'capability_permission_missing')
  assert.equal(denied.structuredContent.error.status, 403)
  assert.equal(denied.structuredContent.error.retryable, false)
})
