import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalPost } from './content-contract.mjs'

test('canonicalPost projects one item into Post with channel variants', () => {
  const post = canonicalPost({
    id: 'post-1',
    site_id: 'brand-1',
    topic: 'Lanzamiento',
    status: 'needs_review',
    metadata: { contentTitle: 'Lanzamiento', brandOs: { brandContext: { brandKitVersionId: 'kit-2' } } },
    variants: [{ id: 'variant-1', channel: 'blog', status: 'generated', body: { bodyHtml: '<p>Hola</p>' } }]
  })
  assert.equal(post.id, 'post-1')
  assert.equal(post.brandId, 'brand-1')
  assert.equal(post.status, 'ready_for_review')
  assert.equal(post.brandKitVersionId, 'kit-2')
  assert.equal(post.variants[0].channel, 'blog')
})
