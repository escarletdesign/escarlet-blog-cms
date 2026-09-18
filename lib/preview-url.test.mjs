import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftPreviewUrl, dashboardUrl, withPostLinks, absoluteMediaUrl } from './preview-url.mjs'

test('draftPreviewUrl usa CMS_PUBLIC_URL y token', () => {
  process.env.CMS_PUBLIC_URL = 'https://cms.escarlet.design'
  process.env.ADMIN_TOKEN = 'secret-token'
  const url = draftPreviewUrl('escarlet', 'mi-post')
  assert.equal(url, 'https://cms.escarlet.design/app/preview/mi-post?site=escarlet')
})

test('withPostLinks añade previewUrl absoluto y reviewHint', () => {
  process.env.CMS_PUBLIC_URL = 'https://cms.escarlet.design'
  process.env.ADMIN_TOKEN = 't'
  const out = withPostLinks({ post: { slug: 'x' } }, 'escarlet', 'mi-slug')
  assert.ok(out.previewUrl.startsWith('https://cms.escarlet.design/app/preview/mi-slug'))
  assert.ok(out.dashboardUrl.endsWith('/app'))
  assert.ok(out.reviewHint.includes('https://cms.escarlet.design'))
})

test('draftPreviewUrl sigue absoluto aunque CMS_PUBLIC_URL sea localhost', () => {
  process.env.CMS_PUBLIC_URL = 'http://localhost:3040'
  process.env.ADMIN_TOKEN = 'local'
  delete process.env.CMS_PUBLIC_URL_FALLBACK
  const url = draftPreviewUrl('escarlet', 'a')
  assert.equal(url, 'https://cms.escarlet.design/app/preview/a?site=escarlet')
  assert.equal(dashboardUrl(), 'https://cms.escarlet.design/app')
  assert.equal(absoluteMediaUrl('/media/escarlet/a.png'), 'https://cms.escarlet.design/media/escarlet/a.png')
})
