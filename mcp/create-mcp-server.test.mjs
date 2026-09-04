import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildToolList, createMcpServer } from './create-mcp-server.mjs'
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
