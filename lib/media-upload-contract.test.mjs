import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MCP_INSTRUCTIONS,
  MEDIA_UPLOAD_CONTRACT,
  mediaUploadMarkdown,
  withMediaUploadContract,
  MCP_SERVER_VERSION
} from './media-upload-contract.mjs'

test('contrato v3 conserva selección de marca, revisión y subida única', () => {
  assert.equal(MCP_SERVER_VERSION, '3.0.0')
  assert.equal(MEDIA_UPLOAD_CONTRACT.tool, 'content_upload_media')
  assert.equal(MEDIA_UPLOAD_CONTRACT.preferred, 'content_upload_media')
  assert.equal(MEDIA_UPLOAD_CONTRACT.fallback, null)
  assert.match(MEDIA_UPLOAD_CONTRACT.autonomy, /contentBase64|trozos/)
  assert.ok(MEDIA_UPLOAD_CONTRACT.avoid.some((x) => /sandbox|temporal/i.test(x)))
  assert.match(MCP_INSTRUCTIONS, /ChatGPT genera TODOS|genera todos/i)
  assert.match(MCP_INSTRUCTIONS, /content_upload_media/)
  assert.doesNotMatch(MCP_INSTRUCTIONS, /blog_upload_media|blog_open_image_drop|blog_import_remote_image/)
  assert.match(MCP_INSTRUCTIONS, /brand_list/)
  assert.match(MCP_INSTRUCTIONS, /content_list_plans/)
  assert.match(MCP_INSTRUCTIONS, /content_approve/)
  assert.match(MCP_INSTRUCTIONS, /app v2/i)
  assert.match(MCP_INSTRUCTIONS, /storyscope-inspired-human-writing/)
  assert.match(MCP_INSTRUCTIONS, /No inventes experiencias personales/i)
  assert.match(MCP_INSTRUCTIONS, /referenceImages/)
  assert.match(MCP_INSTRUCTIONS, /legible en un móvil/i)
  assert.match(MCP_INSTRUCTIONS, /1080\s*×\s*1350/)
  assert.match(MCP_INSTRUCTIONS, /píxeles finales/i)
  assert.match(MCP_INSTRUCTIONS, /preparationId, itemId, channels y assetIndex/)
  assert.match(mediaUploadMarkdown(), /content_upload_media/)
  assert.doesNotMatch(mediaUploadMarkdown(), /blog_upload_media|blog_open_image_drop/)
})

test('withMediaUploadContract antepone el contrato una sola vez', () => {
  const once = withMediaUploadContract('# AGENT\n\nHola')
  assert.match(once, /Contrato de subida/)
  assert.match(once, /# AGENT/)
  const twice = withMediaUploadContract(once)
  assert.equal(twice, once)
})
