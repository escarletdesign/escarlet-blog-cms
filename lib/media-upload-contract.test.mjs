import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MCP_INSTRUCTIONS,
  MEDIA_UPLOAD_CONTRACT,
  mediaUploadMarkdown,
  withMediaUploadContract,
  MCP_SERVER_VERSION
} from './media-upload-contract.mjs'

test('contrato v3.7 separa Brand Consult y Publish Workflow', () => {
  assert.equal(MCP_SERVER_VERSION, '3.7.0')
  assert.equal(MEDIA_UPLOAD_CONTRACT.tool, 'content_upload_media')
  assert.equal(MEDIA_UPLOAD_CONTRACT.preferred, 'content_upload_media')
  assert.equal(MEDIA_UPLOAD_CONTRACT.fallback, null)
  assert.match(MEDIA_UPLOAD_CONTRACT.autonomy, /contentBase64|trozos/)
  assert.ok(MEDIA_UPLOAD_CONTRACT.avoid.some((x) => /sandbox|temporal|reference/i.test(x)))
  assert.match(MCP_INSTRUCTIONS, /Brand Consult/i)
  assert.match(MCP_INSTRUCTIONS, /Publish Workflow/i)
  assert.match(MCP_INSTRUCTIONS, /content_upload_media/)
  assert.match(MCP_INSTRUCTIONS, /brand_list/)
  assert.match(MCP_INSTRUCTIONS, /brand_get_style_board|brand_prepare_image_generation/)
  assert.match(MCP_INSTRUCTIONS, /composedPreviewUrl|finalSha256/)
  assert.match(MCP_INSTRUCTIONS, /fondos SIN texto/i)
  assert.doesNotMatch(MCP_INSTRUCTIONS, /blog_upload_media|blog_open_image_drop|blog_import_remote_image/)
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
