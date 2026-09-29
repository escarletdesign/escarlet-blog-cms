import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { buildToolList, createMcpServer, invokeMcpTool, normalizeImagePreparationArgs, preparedImageResult } from './create-mcp-server.mjs'
import { MCP_INSTRUCTIONS, MCP_SERVER_VERSION } from '../lib/media-upload-contract.mjs'
import { assertSafeToolArguments } from '../lib/ai-security.mjs'

function payload(result) {
  return JSON.parse(result.content?.find((block) => block.type === 'text')?.text || '{}')
}

test('el contrato MCP expone media y contenido v2, sin operaciones de posts legacy', () => {
  const tools = buildToolList({ role: 'admin' })
  const upload = tools.find((tool) => tool.name === 'content_upload_media')
  const update = tools.find((tool) => tool.name === 'content_update_item')
  const createBatch = tools.find((tool) => tool.name === 'content_create_batch')
  assert.ok(upload)
  assert.ok(update)
  assert.ok(createBatch)
  assert.ok(createBatch.inputSchema.properties.items)
  assert.ok(createBatch.inputSchema.properties.items.items.properties.variants)
  assert.ok(createBatch.inputSchema.properties.batchId)
  assert.ok(createBatch.inputSchema.properties.createNewCampaign)
  assert.equal(createBatch.inputSchema.properties.createNewPlan, undefined)
  assert.match(createBatch.description, /campaña/i)
  assert.match(createBatch.description, /pregunta al usuario/i)
  assert.equal(tools.some((tool) => tool.name === 'brand_update_file'), true)
  assert.equal(tools.some((tool) => tool.name === 'brand_complete_image_generation'), false)
  assert.equal(tools.some((tool) => tool.name === 'brand_register_generation'), false)
  assert.deepEqual(upload._meta['openai/fileParams'], ['file'])
  assert.equal(upload.inputSchema.properties.file.$ref, '#/$defs/OpenAIFile')
  assert.deepEqual(upload.inputSchema.$defs.OpenAIFile.required, ['download_url', 'file_id'])
  assert.ok(tools.some((tool) => tool.name === 'brand_list'))
  assert.ok(tools.some((tool) => tool.name === 'brand_get_context'))
  assert.ok(tools.some((tool) => tool.name === 'brand_prepare_image_generation'))
  for (const name of ['brand_create_draft', 'brand_upload_asset', 'brand_validate_draft', 'brand_publish_draft']) assert.ok(tools.some((tool) => tool.name === name), name)
  assert.ok(tools.find((tool) => tool.name === 'brand_create_draft').inputSchema.properties.idempotencyKey)
  assert.ok(tools.find((tool) => tool.name === 'brand_publish_draft').inputSchema.properties.expectedActiveVersionId)
  assert.equal(tools.find((tool) => tool.name === 'brand_prepare_image_generation').inputSchema.properties.expectedAssetCount.type, 'integer')
  assert.match(upload.description, /normaliza la imagen/i)
  for (const field of ['preparationId', 'itemId', 'channels', 'assetIndex']) assert.ok(upload.inputSchema.properties[field], field)
  assert.deepEqual(upload.inputSchema.required, ['site', 'filename'])
  assert.deepEqual(upload.inputSchema.allOf[0].then.required, ['preparationId', 'sourceDimensions', 'assetIndex'])
  assert.equal(upload.inputSchema.properties.expectedDimensions.description.includes('Opcional'), true)
  assert.ok(upload.inputSchema.properties.imageAlt)
  assert.ok(tools.some((tool) => tool.name === 'content_attach_media'))
  assert.equal(upload.inputSchema.properties.generationReceiptId, undefined)
  assert.ok(update.inputSchema.properties.readyForReview)
  assert.match(update.description, /sin reescritura/i)
  for (const name of ['blog_upload_media_file', 'blog_open_image_drop', 'blog_upload_media', 'blog_import_remote_image']) {
    assert.equal(tools.some((tool) => tool.name === name), false, name)
  }
  for (const name of ['content_list_plans', 'content_list_items', 'content_list_calendar', 'content_create_batch', 'content_get_batch', 'content_update_item', 'content_attach_media', 'content_approve', 'content_schedule', 'content_cancel']) {
    assert.ok(tools.some((tool) => tool.name === name), name)
  }
  assert.equal(tools.some((tool) => tool.name === 'content_reject'), false)
  for (const name of ['blog_list_posts', 'blog_get_post', 'blog_create_draft', 'blog_update_post', 'blog_publish', 'blog_schedule_post', 'blog_list_calendar', 'blog_get_workflow', 'blog_get_brand_context', 'social_list_packs']) {
    assert.equal(tools.some((tool) => tool.name === name), false, name)
  }
  assert.equal(tools.some((tool) => /^blog_|^social_/.test(tool.name)), false)
  const publicContract = JSON.stringify(tools)
  assert.doesNotMatch(publicContract, /generationReceiptId|brand_complete_image_generation|brand_register_generation|content-system\/instagram-renderer/)
  assert.equal(buildToolList({ role: 'editor' }).some((tool) => tool.name === 'brand_update_file'), true)
  assert.equal(MCP_SERVER_VERSION, '3.5.1')
  for (const name of ['video_create_job', 'video_get_job', 'video_update_job', 'video_upload_media', 'video_import_external_media', 'video_list_jobs']) {
    assert.ok(tools.some((tool) => tool.name === name), name)
  }
})

test('el registro tools/list publica un único upload y no expone aliases legacy', async () => {
  const server = createMcpServer({ role: 'admin', site: 'escarlet' })
  assert.equal(server._capabilities.tools.listChanged, true)
  const listed = await server._requestHandlers.get('tools/list')({ method: 'tools/list', params: {} })
  const names = listed.tools.map((tool) => tool.name)
  assert.ok(names.includes('content_upload_media'))
  assert.equal(names.includes('brand_complete_image_generation'), false)
  assert.equal(names.some((name) => /^blog_.*upload|^blog_import_remote_image/.test(name)), false)
})

test('el preflight de seguridad permite slides y frames estructurados en content_create_batch', () => {
  const args = {
    items: [{
      title: 'Campaña',
      variants: {
        instagram: { socialPack: { instagramSlides: [{ headline: 'Título', body: 'Texto', alt: 'Descripción', media: { mediaId: 'pending-1' } }] } },
        instagram_story: { socialPack: { instagramStory: { text: 'Story', frames: [{ alt: 'Frame', media: { mediaId: 'pending-2' } }] } } }
      }
    }]
  }
  assert.equal(assertSafeToolArguments('content_create_batch', args), args)
  const deepArgs = { body: {} }
  let nested = deepArgs.body
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
    nested[key] = {}
    nested = nested[key]
  }
  assert.throws(() => assertSafeToolArguments('content_update_item', deepArgs))
})

test('las tools retiradas no son invocables', async () => {
  for (const name of ['brand_complete_image_generation', 'brand_register_generation', 'blog_upload_media', 'content_reject']) {
    const result = await invokeMcpTool(name, {}, { role: 'admin', site: 'escarlet' })
    assert.equal(result.isError, true, name)
  }
})

test('createMcpServer anuncia el contrato v2 y la selección explícita de marca', () => {
  const server = createMcpServer({ role: 'admin' })
  assert.ok(server)
  assert.match(MCP_INSTRUCTIONS, /contrato de contenido es v2/i)
  assert.match(MCP_INSTRUCTIONS, /brand_list/)
  assert.match(MCP_INSTRUCTIONS, /pregunta al usuario/i)
  assert.match(MCP_INSTRUCTIONS, /content_list_items/)
  assert.match(MCP_INSTRUCTIONS, /content_upload_media/)
  assert.match(MCP_INSTRUCTIONS, /exactamente una imagen/i)
  assert.match(MCP_INSTRUCTIONS, /expectedDimensions.*sourceDimensions.*channels/i)
  assert.match(MCP_INSTRUCTIONS, /versión 3\.5\.1/)
  assert.match(MCP_INSTRUCTIONS, /video_upload_media/)
})

test('LinkedIn usa la portada del blog salvo petición explícita de otra pieza', () => {
  assert.equal(normalizeImagePreparationArgs({ channel: 'linkedin', title: 'Trabajo fraccional' }).assetType, 'blog_cover')
  assert.equal(normalizeImagePreparationArgs({ channel: 'linkedin', assetType: 'generic' }).assetType, 'blog_cover')
  assert.equal(normalizeImagePreparationArgs({ channel: 'linkedin', assetType: 'social_image' }).assetType, 'social_image')
})

test('la preparación entrega todas las referencias binarias en una llamada y conserva el orden', async () => {
  const resolvedReferences = ['05-tablero-visual.png', 'fondo-escarlet.jpg', 'reference-blog-example.png'].map((filename, index) => ({
    filename,
    attachmentIndex: index + 1,
    path: `/media/escarlet/reference/${filename}`
  }))
  const payload = {
    generationBlocked: false,
    resolvedReferences,
    brandPreparation: { preparationId: 'preparation-test', site: 'escarlet', assetType: 'blog_cover' },
    composition: { dimensions: '1536x1024', allowedAspectRatios: ['3:2'] },
    generationCardinality: { maxImageCount: 1 }
  }
  const first = await preparedImageResult(payload)
  const firstText = JSON.parse(first.content[0].text)
  assert.equal(first.isError, false)
  assert.equal(first.content.length, 4)
  assert.equal(firstText.referenceCount, 3)
  assert.equal(firstText.readyForGeneration, true)
  assert.equal(first.structuredContent.referenceDelivery.complete, true)
  assert.equal(first.structuredContent.resolvedReferences.length, 3)
  assert.equal(first.structuredContent.preparationId, 'preparation-test')
  assert.equal(first.structuredContent.expectedDimensions, '1536x1024')
})

test('el MCP no elige una marca por defecto cuando el acceso incluye varias', async () => {
  const auth = { role: 'client', site: 'escarlet', sites: ['escarlet', 'segunda-marca'] }
  const old = await invokeMcpTool('blog_list_posts', {}, auth)
  assert.equal(old.isError, true)
  const oldValue = payload(old)
  assert.equal(oldValue.code, 'legacy_tool_disabled')
  assert.equal(oldValue.replacement, 'content_list_items')
  assert.match(oldValue.message, /No es un problema de permisos/i)

  for (const name of ['brand_get_context', 'brand_prepare_image_generation', 'content_list_plans', 'content_list_items', 'content_create_batch']) {
    const args = name === 'content_create_batch'
      ? { topics: ['tema'] }
      : name === 'brand_prepare_image_generation'
        ? { assetType: 'generic', title: 'imagen' }
        : {}
    const result = await invokeMcpTool(name, args, auth)
    const value = payload(result)
    assert.equal(result.isError, true)
    const expectedCode = name === 'brand_get_context' ? 'postgres_required' : 'brand_selection_required'
    assert.equal(value.code, expectedCode, name)
  }
})

test('una marca explícita llega al resolver v2 aunque Postgres no esté configurado', async () => {
  const result = await invokeMcpTool('content_list_items', { site: 'escarlet' }, { role: 'client', site: 'escarlet' })
  const value = payload(result)
  assert.equal(result.isError, true)
  assert.equal(value.code, 'postgres_required')
})

test('brand_get_context exige la fuente canónica Postgres', async () => {
  const result = await invokeMcpTool('brand_get_context', { site: 'escarlet' }, { role: 'editor', site: 'escarlet', capabilities: ['brand_kit_access'] })
  const value = payload(result)
  assert.equal(result.isError, true)
  assert.equal(value.code, 'postgres_required')
})

test('las respuestas de preparación exponen la versión MCP activa', async () => {
  const result = await invokeMcpTool('brand_prepare_image_generation', { site: 'escarlet', assetType: 'generic', title: 'versión MCP' }, { role: 'admin' })
  const value = payload(result)
  assert.equal(value.mcpServer.name, 'escarlet-cms-v2')
  assert.equal(value.mcpServer.version, '3.5.1')
  assert.equal(value.mcpServer.contract, 'v2')
})

test('la subida de medios del MCP usa exclusivamente el runtime v2', async () => {
  const result = await invokeMcpTool('content_upload_media', {
    site: 'escarlet',
    filename: 'sin-grounding.png',
    kind: 'post',
    contentBase64: 'not-an-image'
  }, { role: 'admin' })
  assert.equal(result.isError, true)
  const value = payload(result)
  assert.equal(value.code, 'postgres_required')
})

test('los recursos MCP solo anuncian archivos que el rol puede leer', async () => {
  const server = createMcpServer({ role: 'editor', site: 'escarlet', capabilities: ['brand_kit_access'] })
  const handler = server._requestHandlers.get('resources/list')
  const listed = await handler({ method: 'resources/list', params: {} })
  const names = listed.resources.map((resource) => resource.name)
  assert.ok(names.includes('escarlet agent-rules'))
  assert.ok(names.includes('escarlet normalized brand context'))
  assert.ok(!names.includes('escarlet visual-style'))
  assert.ok(!names.includes('escarlet image-spec'))
})

test('la restricción del bridge bloquea acciones v2 mutables', async () => {
  const result = await invokeMcpTool(
    'content_schedule',
    { site: 'escarlet', itemId: 'item-1', publicationDate: '2030-01-01' },
    { role: 'client', site: 'escarlet' },
    { restrictMutations: true, source: 'chat' }
  )
  assert.equal(result.isError, true)
  assert.match(result.content?.[0]?.text || '', /AI_CHAT_TOOL_BLOCKED/)
})

test('owner y admin pueden editar el brand kit; un editor recibe el motivo', async () => {
  const site = `kit-mcp-write-${Date.now()}`
  try {
    const denied = await invokeMcpTool(
      'brand_update_file',
      { site: 'escarlet', file: 'voice.md', content: '# no' },
      { role: 'editor', site: 'escarlet' }
    )
    assert.equal(denied.isError, true)
    const deniedValue = payload(denied)
    assert.equal(deniedValue.code, 'brand_kit_write_forbidden')
    assert.equal(deniedValue.writesBrandKit, false)
    assert.equal(deniedValue.currentRole, 'editor')
    assert.deepEqual(deniedValue.requiredRoles, ['owner', 'admin'])
    assert.match(deniedValue.message, /owner o admin/)

    const chatEditorDenied = await invokeMcpTool(
      'brand_update_file',
      { site: 'escarlet', file: 'voice.md', content: '# no' },
      { role: 'editor', site: 'escarlet' },
      { restrictMutations: true, source: 'chat' }
    )
    assert.equal(chatEditorDenied.isError, true)
    assert.equal(payload(chatEditorDenied).code, 'brand_kit_write_forbidden')

    const marker = `voz-mcp-${Date.now()}`
    const saved = await invokeMcpTool(
      'brand_update_file',
      { site, file: 'voice.md', content: `# Voz\n\n${marker}\n` },
      { role: 'agency_admin', site }
    )
    assert.ok(!saved.isError)
    const savedValue = payload(saved)
    assert.equal(savedValue.ok, true)
    assert.equal(savedValue.file, 'voice.md')
    assert.equal(savedValue.writesBrandKit, true)
  } finally {
    rmSync(join(new URL('../', import.meta.url).pathname, 'data', 'brand', site), { recursive: true, force: true })
  }
})
