import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildToolList, createMcpServer, invokeMcpTool } from './create-mcp-server.mjs'
import { MCP_INSTRUCTIONS, MCP_SERVER_VERSION } from '../lib/media-upload-contract.mjs'

function payload(result) {
  return JSON.parse(result.content?.find((block) => block.type === 'text')?.text || '{}')
}

test('el contrato MCP expone media y contenido v2, sin operaciones de posts legacy', () => {
  const tools = buildToolList({ role: 'admin' })
  const upload = tools.find((tool) => tool.name === 'content_upload_media')
  const update = tools.find((tool) => tool.name === 'content_update_item')
  const complete = tools.find((tool) => tool.name === 'brand_complete_image_generation')
  const createBatch = tools.find((tool) => tool.name === 'content_create_batch')
  assert.ok(upload)
  assert.ok(update)
  assert.ok(complete)
  assert.ok(createBatch)
  assert.ok(createBatch.inputSchema.properties.items)
  assert.ok(createBatch.inputSchema.properties.batchId)
  assert.ok(createBatch.inputSchema.properties.createNewPlan)
  assert.match(createBatch.description, /título del plan.*título de una publicación/i)
  assert.ok(tools.some((tool) => tool.name === 'brand_update_file'))
  assert.deepEqual(complete.inputSchema.required, ['site', 'preparationId', 'usedReferences', 'generatedResultId', 'generatedFileHash'])
  assert.deepEqual(upload._meta['openai/fileParams'], ['file'])
  assert.equal(upload.inputSchema.properties.file.$ref, '#/$defs/OpenAIFile')
  assert.deepEqual(upload.inputSchema.$defs.OpenAIFile.required, ['download_url', 'file_id'])
  assert.ok(tools.some((tool) => tool.name === 'brand_list'))
  assert.ok(tools.some((tool) => tool.name === 'brand_get_context'))
  assert.ok(tools.some((tool) => tool.name === 'brand_prepare_image_generation'))
  assert.equal(tools.find((tool) => tool.name === 'brand_prepare_image_generation').inputSchema.properties.expectedAssetCount.type, 'integer')
  assert.match(upload.description, /brandPreparationId/)
  assert.ok(upload.inputSchema.properties.brandPreparationId)
  assert.ok(upload.inputSchema.properties.generationReceiptId)
  assert.ok(upload.inputSchema.properties.textRendered)
  assert.ok(upload.inputSchema.properties.templateId)
  assert.ok(upload.inputSchema.properties.renderedBy)
  assert.ok(upload.inputSchema.properties.textContent)
  assert.ok(upload.inputSchema.oneOf.some((branch) => branch.properties?.kind?.const === 'social' && branch.required?.includes('textRendered')))
  assert.ok(upload.inputSchema.oneOf.some((branch) => branch.required?.includes('generationReceiptId')))
  assert.ok(update.inputSchema.properties.generationReceiptIds)
  assert.match(update.description, /brandPreparationId/)
  for (const name of ['blog_upload_media_file', 'blog_open_image_drop', 'blog_upload_media', 'blog_import_remote_image']) {
    const legacyUpload = tools.find((tool) => tool.name === name)
    assert.ok(legacyUpload, name)
    assert.ok(legacyUpload.inputSchema.properties.generationReceiptId, name)
    assert.ok(legacyUpload.inputSchema.oneOf.some((branch) => branch.required?.includes('generationReceiptId')), name)
    assert.ok(legacyUpload.inputSchema.required.includes('kind'), name)
  }
  for (const name of ['content_list_plans', 'content_list_items', 'content_list_calendar', 'content_create_batch', 'content_get_batch', 'content_update_item', 'content_approve', 'content_reject', 'content_schedule', 'content_cancel']) {
    assert.ok(tools.some((tool) => tool.name === name), name)
  }
  for (const name of ['blog_list_posts', 'blog_get_post', 'blog_create_draft', 'blog_update_post', 'blog_publish', 'blog_schedule_post', 'blog_list_calendar', 'blog_get_workflow', 'blog_get_brand_context', 'social_list_packs']) {
    assert.equal(tools.some((tool) => tool.name === name), false, name)
  }
  assert.equal(tools.some((tool) => /^blog_|^social_/.test(tool.name) && !['blog_upload_media_file', 'blog_open_image_drop', 'blog_upload_media', 'blog_import_remote_image'].includes(tool.name)), false)
  assert.equal(buildToolList({ role: 'editor' }).some((tool) => tool.name === 'brand_update_file'), false)
  assert.equal(MCP_SERVER_VERSION, '2.8.0')
})

test('el registro tools/list publica la certificación y todos los uploads compatibles', async () => {
  const server = createMcpServer({ role: 'admin', site: 'escarlet' })
  assert.equal(server._capabilities.tools.listChanged, true)
  const listed = await server._requestHandlers.get('tools/list')({ method: 'tools/list', params: {} })
  const names = listed.tools.map((tool) => tool.name)
  assert.ok(names.includes('brand_complete_image_generation'))
  for (const name of ['content_upload_media', 'blog_upload_media_file', 'blog_open_image_drop', 'blog_upload_media', 'blog_import_remote_image']) {
    assert.ok(names.includes(name), name)
  }
})

test('brand_complete_image_generation es invocable y los uploads legacy rechazan post sin receipt', async () => {
  const completion = await invokeMcpTool('brand_complete_image_generation', {
    site: 'escarlet',
    preparationId: 'missing-preparation',
    usedReferences: [],
    generatedResultId: 'generated-result',
    generatedFileHash: 'a'.repeat(64)
  }, { role: 'admin', site: 'escarlet' })
  assert.equal(completion.isError, true)
  assert.equal(payload(completion).code, 'BRAND_PREPARATION_REQUIRED')

  const legacyArgs = {
    blog_upload_media_file: { file: { file_id: 'file-1', download_url: 'https://example.com/image.png' } },
    blog_open_image_drop: {},
    blog_upload_media: { contentBase64: 'not-an-image' },
    blog_import_remote_image: { imageUrl: 'https://example.com/image.png' }
  }
  for (const [name, extra] of Object.entries(legacyArgs)) {
    const result = await invokeMcpTool(name, { site: 'escarlet', filename: `${name}.png`, kind: 'post', ...extra }, { role: 'admin', site: 'escarlet' })
    assert.equal(result.isError, true, name)
    assert.equal(payload(result).code, 'GENERATION_RECEIPT_REQUIRED', name)
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
  assert.match(MCP_INSTRUCTIONS, /barrera obligatoria/i)
  assert.match(MCP_INSTRUCTIONS, /versión 2\.8\.0/)
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
    assert.equal(value.code, 'brand_selection_required', name)
    assert.deepEqual(value.sites, ['escarlet', 'segunda-marca'])
    assert.match(value.askUser, /Con qué marca/i)
  }
})

test('una marca explícita llega al resolver v2 aunque Postgres no esté configurado', async () => {
  const result = await invokeMcpTool('content_list_items', { site: 'escarlet' }, { role: 'client', site: 'escarlet' })
  const value = payload(result)
  assert.equal(result.isError, true)
  assert.equal(value.code, 'postgres_required')
})

test('brand_get_context y media siguen compartiendo el contrato de referencias', async () => {
  const result = await invokeMcpTool('brand_get_context', { site: 'escarlet' }, { role: 'editor', site: 'escarlet', capabilities: ['brand_kit_access'] })
  const value = payload(result)
  assert.equal(value.brandAccessLevel, 'sanitized')
  assert.equal(value.referenceDelivery.mode, 'catalog_only')
  assert.equal(value.referenceDelivery.binaryDeliveryTool, 'brand_prepare_image_generation')
  assert.equal(value.referenceDelivery.imageBlocks, 0)
  assert.deepEqual(value.mcpServer, { name: 'escarlet-cms-v2', version: '2.8.0', contract: 'v2', canonicalUrl: 'https://cms.escarlet.design/mcp' })
  assert.match(JSON.stringify(value.brandKit?.agentRules), /content_list_items/)
  assert.doesNotMatch(JSON.stringify(value), /blog_list_posts|blog_get_brand_context|blog_upload_media|blog_open_image_drop/)
  assert.equal(result.content.some((block) => block.type === 'image' || block.type === 'resource_link'), false)
})

test('las respuestas de preparación exponen la versión MCP activa', async () => {
  const result = await invokeMcpTool('brand_prepare_image_generation', { site: 'escarlet', assetType: 'generic', title: 'versión MCP' }, { role: 'admin' })
  const value = payload(result)
  assert.equal(value.mcpServer.name, 'escarlet-cms-v2')
  assert.equal(value.mcpServer.version, '2.8.0')
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
  assert.equal(value.code, 'GENERATION_RECEIPT_REQUIRED')
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
