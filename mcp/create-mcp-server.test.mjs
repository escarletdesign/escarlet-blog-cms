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
  assert.ok(MCP_SERVER_VERSION.startsWith('2.3'))
})

test('createMcpServer arranca con instructions y versión 2.3', () => {
  const server = createMcpServer({ role: 'admin' })
  assert.ok(server)
  assert.ok(MCP_SERVER_VERSION.startsWith('2.3'))
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
