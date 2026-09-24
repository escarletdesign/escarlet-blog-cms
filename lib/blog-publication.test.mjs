import test from 'node:test'
import assert from 'node:assert/strict'
import { blogPublicationIsLive, blogPublicationSlug, blogPublicationTitle, blogPublicationUrl } from './blog-publication.mjs'

test('el Blog solo se considera publicado cuando su URL pública responde correctamente', async () => {
  const variant = { site_domain: 'https://escarlet.design/', content_title: 'La IA acelera la producción', topic: 'Brief extenso', blog_body: { title: 'Título del plan' } }
  assert.equal(blogPublicationTitle(variant), 'La IA acelera la producción')
  assert.equal(blogPublicationTitle({ topic: 'Publicación antigua', blog_body: { title: 'Título del plan' } }), 'Publicación antigua')
  assert.equal(blogPublicationSlug(variant), 'la-ia-acelera-la-produccion')
  const url = blogPublicationUrl(variant)
  assert.equal(url, 'https://escarlet.design/blog/la-ia-acelera-la-produccion')
  assert.equal(await blogPublicationIsLive(url, async () => ({ ok: false, status: 404 })), false)
  assert.equal(await blogPublicationIsLive(url, async () => ({ ok: true, status: 200 })), true)
})
