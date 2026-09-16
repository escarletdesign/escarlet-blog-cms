import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MCP_INSTRUCTIONS,
  MEDIA_UPLOAD_CONTRACT,
  mediaUploadMarkdown,
  withMediaUploadContract,
  MCP_SERVER_VERSION
} from './media-upload-contract.mjs'

test('contrato 2.5.0 incluye workflows /app y autonomía A→B→C', () => {
  assert.equal(MCP_SERVER_VERSION, '2.5.0')
  assert.equal(MEDIA_UPLOAD_CONTRACT.fallback, 'blog_upload_media')
  assert.match(MEDIA_UPLOAD_CONTRACT.autonomy, /contentBase64|trozos/)
  assert.ok(MEDIA_UPLOAD_CONTRACT.avoid.some((x) => /bloqueado|disponible/i.test(x)))
  assert.match(MCP_INSTRUCTIONS, /ChatGPT genera TODOS|genera todos/i)
  assert.match(MCP_INSTRUCTIONS, /blog_upload_media/)
  assert.match(MCP_INSTRUCTIONS, /blog_get_workflow/)
  assert.match(MCP_INSTRUCTIONS, /\/app/)
  assert.match(MCP_INSTRUCTIONS, /storyscope-inspired-human-writing/)
  assert.match(MCP_INSTRUCTIONS, /No inventes experiencias personales/i)
  assert.match(MCP_INSTRUCTIONS, /referenceImages/)
  assert.match(MCP_INSTRUCTIONS, /legible en un móvil/i)
  assert.match(mediaUploadMarkdown(), /A\./)
  assert.match(mediaUploadMarkdown(), /B\./)
  assert.match(mediaUploadMarkdown(), /C\./)
})

test('withMediaUploadContract antepone el contrato una sola vez', () => {
  const once = withMediaUploadContract('# AGENT\n\nHola')
  assert.match(once, /Contrato de subida/)
  assert.match(once, /# AGENT/)
  const twice = withMediaUploadContract(once)
  assert.equal(twice, once)
})
