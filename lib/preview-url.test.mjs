import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftPreviewUrl, dashboardUrl, withPostLinks } from './preview-url.mjs'

test('draftPreviewUrl usa CMS_PUBLIC_URL y token', () => {
  process.env.CMS_PUBLIC_URL = 'https://blog-cms.escarlet.cc'
  process.env.ADMIN_TOKEN = 'secret-token'
  const url = draftPreviewUrl('escarlet', 'mi-post')
  assert.equal(url, 'https://blog-cms.escarlet.cc/preview/escarlet/mi-post?token=secret-token')
})

test('withPostLinks añade previewUrl y reviewHint', () => {
  process.env.CMS_PUBLIC_URL = 'https://blog-cms.escarlet.cc'
  process.env.ADMIN_TOKEN = 't'
  const out = withPostLinks({ post: { slug: 'x' } }, 'escarlet', 'mi-slug')
  assert.ok(out.previewUrl.includes('/preview/escarlet/mi-slug'))
  assert.ok(out.dashboardUrl.includes('/admin'))
  assert.ok(out.reviewHint)
})

test('draftPreviewUrl relativo si base es localhost', () => {
  process.env.CMS_PUBLIC_URL = 'http://localhost:3040'
  process.env.ADMIN_TOKEN = 'local'
  assert.equal(draftPreviewUrl('escarlet', 'a'), '/preview/escarlet/a?token=local')
  assert.equal(dashboardUrl(), '/admin')
})
