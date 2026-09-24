import test from 'node:test'
import assert from 'node:assert/strict'
import { blogPublicationIsLive, blogPublicationUrl } from './blog-publication.mjs'

test('el Blog solo se considera publicado cuando su URL pública responde correctamente', async () => {
  const url = blogPublicationUrl({ site_domain: 'https://escarlet.design/', blog_body: { title: 'El criterio cambió' } })
  assert.equal(url, 'https://escarlet.design/blog/el-criterio-cambio')
  assert.equal(await blogPublicationIsLive(url, async () => ({ ok: false, status: 404 })), false)
  assert.equal(await blogPublicationIsLive(url, async () => ({ ok: true, status: 200 })), true)
})
