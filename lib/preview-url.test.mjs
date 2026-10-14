import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftPreviewUrl, dashboardUrl, withPostLinks, absoluteMediaUrl, contentItemPreviewUrl, contentPostUrl } from './preview-url.mjs'

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

test('contentItemPreviewUrl apunta a /app/plans/.../preview', () => {
  process.env.CMS_PUBLIC_URL = 'https://cms.escarlet.design'
  assert.equal(
    contentItemPreviewUrl('item-1', 'batch-9'),
    'https://cms.escarlet.design/app/plans/item-1/preview?batchId=batch-9'
  )
})

test('contentPostUrl apunta al espacio canónico del Post y conserva la marca', () => {
  process.env.CMS_PUBLIC_URL = 'https://cms.escarlet.design'
  assert.equal(contentPostUrl('post-1', 'escarlet'), 'https://cms.escarlet.design/app/content/post-1?site=escarlet')
})
