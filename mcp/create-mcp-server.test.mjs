import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildToolList, createMcpServer, invokeMcpTool } from './create-mcp-server.mjs'
import { MCP_SERVER_VERSION } from '../lib/media-upload-contract.mjs'

test('blog_upload_media_file declara openai/fileParams y schema OpenAIFile', () => {
  const tools = buildToolList({ role: 'admin' })
  const upload = tools.find((t) => t.name === 'blog_upload_media_file')
  assert.ok(upload)
  assert.deepEqual(upload._meta['openai/fileParams'], ['file'])
  assert.equal(upload.inputSchema.properties.file.$ref, '#/$defs/OpenAIFile')
  assert.deepEqual(upload.inputSchema.$defs.OpenAIFile.required, ['download_url', 'file_id'])
  assert.ok(upload.inputSchema.required.includes('file'))
  assert.ok(tools.some((t) => t.name === 'blog_upload_media'))
  assert.ok(MCP_SERVER_VERSION.startsWith('2.5'))
  assert.ok(tools.some((tool) => tool.name === 'blog_get_workflow'))
  assert.ok(tools.some((tool) => tool.name === 'social_save_pack'))
  assert.ok(tools.some((tool) => tool.name === 'social_list_packs'))
  assert.ok(tools.some((tool) => tool.name === 'social_get_pack'))
  for (const name of ['content_create_batch', 'content_get_batch', 'content_update_item', 'content_approve', 'content_reject', 'content_schedule']) assert.ok(tools.some((tool) => tool.name === name))
  assert.equal(tools.some((tool) => tool.name === 'blog_create_assisted_post'), false)
  assert.equal(tools.some((tool) => tool.name === 'blog_generate_social_pack'), false)
  const publish = tools.find((tool) => tool.name === 'blog_publish')
  assert.ok(publish.inputSchema.properties.direct)
  assert.ok(publish.inputSchema.properties.ignoreSeo)
})

test('createMcpServer arranca con instructions y versión 2.5', () => {
  const server = createMcpServer({ role: 'admin' })
  assert.ok(server)
  assert.ok(MCP_SERVER_VERSION.startsWith('2.5'))
})

test('workflow MCP prioriza /app y oculta sus enlaces al bridge del chat', async () => {
  const result = await invokeMcpTool('blog_get_workflow', { site: 'escarlet' }, { role: 'admin' })
  const payload = JSON.parse(result.content?.[0]?.text || '{}')
  assert.equal(payload.appBaseUrl, 'https://blog-cms.escarlet.cc/app/')
  assert.equal(payload.routes.preview, 'https://blog-cms.escarlet.cc/app/preview/{slug}')
  assert.equal(payload.assistantEnabled, true)
  assert.equal(payload.blogWizardEnabled, true)
  assert.match(payload.modes.easy.steps.join(' '), /direct=true/)
  const bridge = await invokeMcpTool(
    'blog_get_workflow',
    { site: 'escarlet' },
    { role: 'client', site: 'escarlet' },
    { source: 'chat' }
  )
  const bridgePayload = JSON.parse(bridge.content?.[0]?.text || '{}')
  assert.equal(bridgePayload.appBaseUrl, undefined)
  assert.equal(bridgePayload.routes.preview, undefined)
  assert.doesNotMatch(JSON.stringify(bridgePayload), /\/app\/preview/)
})

test('blog_get_brand_context devuelve la política editorial común a todos los sitios', async () => {
  const result = await invokeMcpTool('blog_get_brand_context', { site: 'escarlet' }, { role: 'admin' })
  const payload = JSON.parse(result.content?.[0]?.text || '{}')
  assert.equal(payload.sharedEditorialPolicy.id, 'storyscope-inspired-human-writing')
  assert.match(payload.sharedEditorialPolicy.guidance, /No inventes experiencias personales/i)
  assert.match(payload.sharedEditorialPolicy.guidance, /guiones horizontales/i)
  assert.match(payload.sharedEditorialPolicy.imageGuidance, /referenceImages/)
  assert.match(payload.sharedEditorialPolicy.instagramGuidance, /móvil/i)
})

test('invokeMcpTool reutiliza las mismas tools para la app', async () => {
  const result = await invokeMcpTool('blog_get_quota', { site: 'escarlet' }, { role: 'client', site: 'escarlet' })
  assert.ok(result.content?.[0]?.text?.includes('"site": "escarlet"'))
})

test('bridge restriction blocks scheduling from the assistant while preserving MCP policy errors', async () => {
  const result = await invokeMcpTool(
    'blog_schedule_post',
    { site: 'escarlet', slug: 'demo', publishAt: '2030-01-01' },
    { role: 'client', site: 'escarlet' },
    { restrictMutations: true, source: 'chat' }
  )
  assert.equal(result.isError, true)
  assert.match(result.content?.[0]?.text || '', /AI_CHAT_TOOL_BLOCKED/)
})
