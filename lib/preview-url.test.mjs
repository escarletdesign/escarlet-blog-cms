import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftPreviewUrl, dashboardUrl, withPostLinks, absoluteMediaUrl } from './preview-url.mjs'

test('draftPreviewUrl usa CMS_PUBLIC_URL y token', () => {
  process.env.CMS_PUBLIC_URL = 'https://blog-cms.escarlet.cc'
  process.env.ADMIN_TOKEN = 'secret-token'
  const url = draftPreviewUrl('escarlet', 'mi-post')
  assert.equal(url, 'https://blog-cms.escarlet.cc/preview/escarlet/mi-post?token=secret-token')
})

test('withPostLinks añade previewUrl absoluto y reviewHint', () => {
  process.env.CMS_PUBLIC_URL = 'https://blog-cms.escarlet.cc'
  process.env.ADMIN_TOKEN = 't'
  const out = withPostLinks({ post: { slug: 'x' } }, 'escarlet', 'mi-slug')
  assert.ok(out.previewUrl.startsWith('https://blog-cms.escarlet.cc/preview/escarlet/mi-slug'))
  assert.ok(out.dashboardUrl.includes('/admin'))
  assert.ok(out.reviewHint.includes('https://blog-cms.escarlet.cc'))
})

test('draftPreviewUrl sigue absoluto aunque CMS_PUBLIC_URL sea localhost', () => {
  process.env.CMS_PUBLIC_URL = 'http://localhost:3040'
  process.env.ADMIN_TOKEN = 'local'
  delete process.env.CMS_PUBLIC_URL_FALLBACK
  const url = draftPreviewUrl('escarlet', 'a')
  assert.equal(url, 'https://blog-cms.escarlet.cc/preview/escarlet/a?token=local')
  assert.equal(dashboardUrl(), 'https://blog-cms.escarlet.cc/admin')
  assert.equal(absoluteMediaUrl('/media/escarlet/a.png'), 'https://blog-cms.escarlet.cc/media/escarlet/a.png')
})
