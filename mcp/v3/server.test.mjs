import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_CAPABILITIES,
  MCP_V3_CONTRACT,
  createMcpServerV3Sync,
  normalizeOsRegistry,
  invokeMcpToolV3
} from './index.mjs'
import { getOsRegistry } from '../../lib/os/index.mjs'

async function list(server, method) {
  return server._requestHandlers.get(method)({ method, params: {} })
}

test('MCP v3 publica solo tools namespaced y excluye nombres legacy', async () => {
  const server = createMcpServerV3Sync({ role: 'admin', workspaceId: 'workspace-1' })
  const listed = await list(server, 'tools/list')
  assert.ok(listed.tools.length >= 10)
  assert.ok(listed.tools.some((tool) => tool.name === 'brand.context.get'))
  assert.ok(listed.tools.some((tool) => tool.name === 'brand.version.create'))
  assert.ok(listed.tools.some((tool) => tool.name === 'brand.version.publish'))
  assert.ok(listed.tools.some((tool) => tool.name === 'brand.generation.prepare'))
  assert.ok(listed.tools.some((tool) => tool.name === 'publication.destination.list'))
  assert.ok(listed.tools.some((tool) => tool.name === 'publication.route'))
  assert.ok(listed.tools.some((tool) => tool.name === 'asset.list'))
  assert.ok(listed.tools.some((tool) => tool.name === 'asset.delete'))
  for (const name of ['workspace.context.get', 'content.post.list', 'content.post.archive', 'content.audit.inventory', 'content.audit.repair.plan']) assert.ok(listed.tools.some((tool) => tool.name === name), name)
  for (const name of ['content.post.list', 'content.post.archive', 'content.audit.inventory']) {
    const tool = listed.tools.find((entry) => entry.name === name)
    const manifest = BUILTIN_CAPABILITIES.find((entry) => entry.id === name)
    assert.deepEqual(tool.inputSchema, manifest.inputSchema, `${name} inputSchema`)
    assert.deepEqual(tool.outputSchema, manifest.outputSchema, `${name} outputSchema`)
  }
  assert.ok(listed.tools.some((tool) => tool.name === 'recipe.run'))
  for (const name of ['production.motion.status.get', 'production.motion.retry', 'production.motion.cancel']) assert.ok(listed.tools.some((tool) => tool.name === name), name)
  for (const tool of listed.tools) {
    assert.match(tool.name, /^[a-z][a-z0-9]*(?:\.[a-z0-9_-]+)+$/)
    assert.doesNotMatch(tool.name, /^(?:blog|social|content|video|brand)_/)
  }
  assert.equal(listed.tools.some((tool) => /^(?:blog|social|content|video|brand)_/.test(tool.name)), false)
})

test('resources/list expone el índice, recipes y Brand Kernel sin archivos privados', async () => {
  const server = createMcpServerV3Sync({ role: 'agent' })
  const listed = await list(server, 'resources/list')
  const uris = listed.resources.map((resource) => resource.uri)
  assert.equal(new Set(uris).size, uris.length)
  assert.ok(uris.includes('escarlet://capabilities/index'))
  assert.ok(uris.includes('escarlet://recipes/index'))
  assert.ok(uris.includes('escarlet://workflows/index'))
  assert.ok(uris.includes('escarlet://brand/kernel'))
  assert.ok(uris.some((uri) => uri === 'escarlet://capabilities/brand.context.get'))
  assert.equal(uris.some((uri) => /voice\.md|AGENT\.md|secret|token/i.test(uri)), false)
})

test('resources/read devuelve contrato versionado de Brand Kernel', async () => {
  const server = createMcpServerV3Sync()
  const result = await server._requestHandlers.get('resources/read')({ method: 'resources/read', params: { uri: 'escarlet://brand/kernel' } }, { mcpReq: { requestState: () => undefined } })
  const payload = JSON.parse(result.contents[0].text)
  assert.equal(payload.contractVersion, MCP_V3_CONTRACT)
  assert.equal(payload.policy, 'read_preparation_provenance')
})

test('discovery es invocable y no ejecuta generacion por defecto', async () => {
  const server = createMcpServerV3Sync()
  const result = await server._requestHandlers.get('tools/call')({ method: 'tools/call', params: { name: 'capability.search', arguments: { query: 'routing' } } }, { mcpReq: { requestState: () => undefined } })
  assert.equal(result.isError, false)
  assert.ok(result.structuredContent.capabilities.some((entry) => entry.id === 'publication.route'))
  const blocked = await server._requestHandlers.get('tools/call')({ method: 'tools/call', params: { name: 'production.motion.compose', arguments: { inputs: [], formatProfile: 'instagram_reel_9_16' } } }, { mcpReq: { requestState: () => undefined } })
  assert.equal(blocked.isError, true)
  assert.equal(blocked.structuredContent.error.code, 'motion_input_required')
  const recipe = await server._requestHandlers.get('tools/call')({ method: 'tools/call', params: { name: 'recipe.run', arguments: { recipeId: 'food-to-reel', site: 'escarlet', sourceMediaId: 'media-1', text: 'Plato del día', formatProfile: 'instagram_reel_9_16' } } }, { mcpReq: { requestState: () => undefined } })
  assert.equal(recipe.isError, true)
  assert.equal(recipe.structuredContent.error.code, 'postgres_required')
  const viewer = createMcpServerV3Sync({ role: 'viewer' })
  const deniedRecipe = await viewer._requestHandlers.get('tools/call')({ method: 'tools/call', params: { name: 'recipe.run', arguments: { text: 'Plato' } } }, { mcpReq: { requestState: () => undefined } })
  assert.equal(deniedRecipe.structuredContent.error.code, 'capability_permission_missing')
  const recipes = await server._requestHandlers.get('tools/call')({ method: 'tools/call', params: { name: 'capability.search', arguments: { type: 'recipe', query: 'food reel' } } }, { mcpReq: { requestState: () => undefined } })
  assert.ok(recipes.structuredContent.capabilities.some((entry) => entry.id === 'recipe.food-to-reel' || entry.id === 'food-to-reel'))
})

test('las respuestas grandes no duplican el payload completo en content.text', async () => {
  const server = createMcpServerV3Sync({ role: 'admin' })
  const result = await server._requestHandlers.get('tools/call')({
    method: 'tools/call',
    params: { name: 'capability.search', arguments: { includeSchemas: true } }
  }, { mcpReq: { requestState: () => undefined } })
  assert.equal(result.isError, false)
  assert.ok(result.content[0].text.length < JSON.stringify(result.structuredContent).length)
  assert.match(result.content[0].text, /structuredContent/)
})

test('discovery progresivo separa resumen de schema completo', async () => {
  const search = await invokeMcpToolV3('capability.search', { query: 'motion' }, { role: 'admin' })
  assert.equal(search.structuredContent.capabilities.some((entry) => entry.id === 'production.motion.compose'), true)
  const summary = search.structuredContent.capabilities.find((entry) => entry.id === 'production.motion.compose')
  assert.equal(summary.inputSchema, undefined)
  assert.ok(summary.inputKeys.includes('formatProfile'))

  const full = await invokeMcpToolV3('capability.get', { capabilityId: 'production.motion.compose' }, { role: 'admin' })
  assert.equal(full.structuredContent.capability.id, 'production.motion.compose')
  assert.equal(full.structuredContent.capability.inputSchema.type, 'object')
  assert.equal(full.structuredContent.capability.reviewPolicy, 'human_required')

  const recipes = await invokeMcpToolV3('recipe.list', { query: 'reel' }, { role: 'admin' })
  assert.equal(recipes.structuredContent.recipes.some((entry) => entry.id === 'recipe.food-to-reel'), true)
  assert.equal(recipes.structuredContent.recipes.filter((entry) => entry.id.replace(/^recipe\./, '') === 'food-to-reel').length, 1)
  const legacyLookup = await invokeMcpToolV3('recipe.get', { recipeId: 'food-to-reel' }, { role: 'admin' })
  assert.equal(legacyLookup.structuredContent.recipe.id, 'recipe.food-to-reel')
})

test('workflow expone selectores, valida respuestas y conserva un modo libre', async () => {
  const auth = { role: 'admin', site: 'escarlet' }
  const listed = await invokeMcpToolV3('workflow.list', {}, auth)
  const workflow = listed.structuredContent.workflows.find((entry) => entry.id === 'content.create')
  assert.ok(workflow)
  assert.equal(workflow.steps.find((step) => step.id === 'mode').type, 'single_select')
  assert.ok(workflow.steps.find((step) => step.id === 'recipe').options.some((option) => option.id === 'recipe.food-to-reel'))

  let step = await invokeMcpToolV3('workflow.next', { workflowId: 'content.create' }, auth)
  assert.equal(step.structuredContent.stepId, 'mode')
  step = await invokeMcpToolV3('workflow.next', { workflowId: 'content.create', stepId: 'mode', answer: 'guided' }, auth)
  const recipeId = step.structuredContent.options[0].id
  step = await invokeMcpToolV3('workflow.next', { workflowId: 'content.create', stepId: 'recipe', answer: recipeId, answers: step.structuredContent.answers }, auth)
  step = await invokeMcpToolV3('workflow.next', { workflowId: 'content.create', stepId: 'format', answer: 'youtube_landscape', answers: step.structuredContent.answers }, auth)
  step = await invokeMcpToolV3('workflow.next', { workflowId: 'content.create', stepId: 'asset', answer: { assetId: 'asset-1' }, answers: step.structuredContent.answers }, auth)
  step = await invokeMcpToolV3('workflow.next', { workflowId: 'content.create', stepId: 'brief', answer: 'Una historia breve de la marca.', answers: step.structuredContent.answers }, auth)
  step = await invokeMcpToolV3('workflow.next', { workflowId: 'content.create', stepId: 'review', answer: true, answers: step.structuredContent.answers }, auth)
  assert.equal(step.structuredContent.complete, true)
  assert.equal(step.structuredContent.execution.tool, 'recipe.run')
  assert.equal(step.structuredContent.execution.arguments.formatProfile, 'youtube_landscape')

  const free = await invokeMcpToolV3('workflow.next', { workflowId: 'content.create', stepId: 'mode', answer: 'free' }, auth)
  const freeDone = await invokeMcpToolV3('workflow.next', { workflowId: 'content.create', stepId: 'free_goal', answer: 'Crear una pieza editorial con libertad de motion.', answers: free.structuredContent.answers }, auth)
  assert.equal(freeDone.structuredContent.complete, true)
  assert.equal(freeDone.structuredContent.execution.mode, 'free')

  const invalid = await invokeMcpToolV3('workflow.next', { workflowId: 'content.create', stepId: 'mode', answer: 'no-existe' }, auth)
  assert.equal(invalid.isError, true)
  assert.equal(invalid.structuredContent.error.code, 'workflow_option_invalid')
})

test('capability.search entiende una intención editorial en español', async () => {
  const result = await invokeMcpToolV3('capability.search', { query: 'generación de contenido, imágenes, vídeo y publicación' }, { role: 'admin' })
  assert.equal(result.isError, false)
  const ids = result.structuredContent.capabilities.map((entry) => entry.id)
  assert.ok(ids.includes('production.motion.compose') || ids.includes('recipe.food-to-reel'))
  assert.ok(ids.includes('publication.destination.list') || ids.includes('publication.route'))
})

test('el registro OS puede ampliar el catálogo, pero no introducir aliases legacy', async () => {
  const registry = normalizeOsRegistry({ capabilities: [{ id: 'audio.transcribe', description: 'Transcribe audio.', inputSchema: { type: 'object' } }] })
  const server = createMcpServerV3Sync({ role: 'agent' }, { registry })
  const listed = await list(server, 'tools/list')
  assert.ok(listed.tools.some((tool) => tool.name === 'audio.transcribe'))
  assert.throws(() => normalizeOsRegistry({ capabilities: [{ id: 'brand_get_context' }] }), /namespaced/)
})

test('adapta manifests OS a semántica MCP sin perder recetas ni efectos', async () => {
  const server = createMcpServerV3Sync({ role: 'admin' }, { registry: getOsRegistry() })
  const listed = await list(server, 'tools/list')
  const motion = listed.tools.find((tool) => tool.name === 'production.motion.compose')
  assert.equal(motion.annotations.destructiveHint, false)
  assert.equal(motion._meta.sideEffects, 'write')
  assert.equal(motion._meta.humanReviewRequired, true)
  assert.ok(motion.inputSchema.properties.motionAssets)
  assert.ok(motion.inputSchema.properties.copyBlocks)
  assert.deepEqual(motion.inputSchema.properties.scenes.items.properties.textPosition.enum, ['top_left', 'center_left', 'bottom_left'])
  const statusManifest = await server._requestHandlers.get('tools/call')({ method: 'tools/call', params: { name: 'capability.get', arguments: { capabilityId: 'production.motion.status.get' } } }, { mcpReq: { requestState: () => undefined } })
  assert.deepEqual(statusManifest.structuredContent.capability.outputSchema.properties.outputs.items.required, ['kind', 'mimeType', 'url'])
  assert.ok(motion.inputSchema.oneOf.some((branch) => branch.required?.includes('runId')))
  const recipes = await server._requestHandlers.get('tools/call')({ method: 'tools/call', params: { name: 'recipe.list', arguments: {} } }, { mcpReq: { requestState: () => undefined } })
  assert.ok(recipes.structuredContent.recipes.some((entry) => entry.id === 'recipe.food-to-reel'))
})

test('todos los manifests registrados tienen schemas MCP canónicos', () => {
  const registry = normalizeOsRegistry(getOsRegistry())
  const builtins = new Map(BUILTIN_CAPABILITIES.map((entry) => [entry.id, entry]))
  for (const entry of [...registry.capabilities, ...registry.recipes]) {
    assert.equal(entry.inputSchema?.type, 'object', entry.id)
    assert.equal(entry.outputSchema?.type, 'object', entry.id)
    if (builtins.has(entry.id)) {
      assert.deepEqual(entry.inputSchema, builtins.get(entry.id).inputSchema, entry.id)
      assert.deepEqual(entry.outputSchema, builtins.get(entry.id).outputSchema, entry.id)
    }
    if (entry.type === 'recipe') assert.ok(entry.outputSchema.required.includes('review'), entry.id)
  }
})

test('tools/call delega en el registro OS sin dar acceso implícito a generación', async () => {
  const calls = []
  const server = createMcpServerV3Sync({ role: 'agent' }, {
    registry: {
      invoke: async (name, args, context) => {
        calls.push({ name, args, contractVersion: context.contractVersion })
        return { contractVersion: context.contractVersion, site: 'escarlet', brandKitVersionId: args.brandKitVersionId, brandKitSnapshotHash: 'hash-1', status: 'ready_for_review' }
      }
    }
  })
  const result = await server._requestHandlers.get('tools/call')({ method: 'tools/call', params: { name: 'brand.context.get', arguments: { site: 'escarlet', brandKitVersionId: 'kit-1' } } }, { mcpReq: { requestState: () => undefined } })
  assert.equal(result.isError, false)
  assert.equal(result.structuredContent.brandKitVersionId, 'kit-1')
  assert.deepEqual(calls, [{ name: 'brand.context.get', args: { site: 'escarlet', brandKitVersionId: 'kit-1' }, contractVersion: MCP_V3_CONTRACT }])
})

test('tools/call rechaza cualquier nombre legacy incluso si no está catalogado', async () => {
  const server = createMcpServerV3Sync()
  for (const name of ['brand_get_context', 'content_create_batch', 'video_create_job', 'blog_publish']) {
    const result = await server._requestHandlers.get('tools/call')({ method: 'tools/call', params: { name, arguments: {} } }, { mcpReq: { requestState: () => undefined } })
    assert.equal(result.isError, true, name)
    assert.equal(result.structuredContent.error.code, 'namespaced_tool_required', name)
  }
})

test('tools/call valida los argumentos declarados antes de ejecutar una capability', async () => {
  const server = createMcpServerV3Sync({ role: 'admin' })
  const result = await server._requestHandlers.get('tools/call')({
    method: 'tools/call',
    params: { name: 'content.campaign.list', arguments: { limit: 201 } }
  }, { mcpReq: { requestState: () => undefined } })
  assert.equal(result.isError, true)
  assert.equal(result.structuredContent.error.code, 'capability_input_invalid')
  assert.ok(result.structuredContent.error.details.fields.some((field) => field.includes('limit')))
})

test('el catálogo inicial mantiene los contratos de Brand Kernel y Publisher', () => {
  const ids = new Set(BUILTIN_CAPABILITIES.map((entry) => entry.id))
  for (const id of ['brand.context.get', 'brand.version.create', 'brand.version.validate', 'brand.asset.register', 'brand.version.publish', 'brand.voice.get', 'brand.visual_style.get', 'brand.rules.get', 'brand.references.resolve', 'brand.generation.prepare', 'brand.generation.receipt.issue', 'asset.upload', 'production.image.product.transform', 'production.motion.status.get', 'production.motion.retry', 'production.motion.cancel', 'content.campaign.list', 'content.campaign.get', 'content.campaign.create', 'content.campaign.approve', 'content.campaign.schedule', 'content.campaign.publish', 'content.media.attach', 'publication.destination.list', 'publication.validate', 'publication.route', 'publication.prepare', 'publication.schedule', 'publication.publish', 'publication.status.get']) assert.ok(ids.has(id), id)
})

test('las respuestas reales de Brand Kernel y Publisher cumplen sus manifests', async () => {
  const auth = { role: 'admin', site: 'escarlet' }
  const calls = [
    ['brand.context.get', { site: 'escarlet' }],
    ['brand.voice.get', { site: 'escarlet' }],
    ['brand.visual_style.get', { site: 'escarlet' }],
    ['brand.rules.get', { site: 'escarlet' }],
    ['brand.references.resolve', { site: 'escarlet', purpose: 'blog cover' }],
    ['brand.generation.prepare', { site: 'escarlet', purpose: 'blog cover' }],
    ['copy.validate', { site: 'escarlet', text: 'Diseñamos una presencia digital clara.', purpose: 'social' }],
    ['publication.destination.list', { channel: 'instagram_reel' }],
    ['publication.validate', { channel: 'instagram_reel', provider: 'postiz', assetIds: ['reel-1'] }],
    ['publication.route', { channel: 'instagram_reel', assetIds: ['reel-1'] }],
    ['publication.prepare', { channel: 'instagram_reel', provider: 'postiz', assetIds: ['reel-1'], text: 'Reel listo para revisión' }],
    ['publication.schedule', { channel: 'linkedin_post', provider: 'metricool', assetIds: ['image-1'], approval: { status: 'approved' }, publicationDate: '2099-01-01T10:00:00Z' }],
    ['publication.publish', { channel: 'linkedin_post', provider: 'metricool', assetIds: ['image-1'], approval: { status: 'approved' }, idempotencyKey: 'contract-test-publish' }],
    ['publication.status.get', { publicationId: 'missing-publication' }]
  ]
  for (const [name, args] of calls) {
    const result = await invokeMcpToolV3(name, args, auth)
    assert.equal(result.isError, false, `${name}: ${JSON.stringify(result.structuredContent)}`)
  }
})

test('copy.validate bloquea claims comerciales conocidos en el recorrido MCP', async () => {
  const result = await invokeMcpToolV3('copy.validate', {
    site: 'escarlet',
    text: 'Somos la agencia premium número uno. Multiplicamos tus ventas y garantizamos libertad financiera.',
    purpose: 'social'
  }, { role: 'admin', site: 'escarlet' })
  assert.equal(result.isError, false)
  assert.equal(result.structuredContent.valid, false)
  assert.ok(result.structuredContent.findings.some((finding) => finding.code === 'prohibited_term'))
  assert.ok(result.structuredContent.findings.filter((finding) => finding.code === 'unsupported_claim').length >= 3)
  assert.ok(result.structuredContent.findings.some((finding) => finding.code === 'audience_missing' && finding.severity === 'warning'))
})
