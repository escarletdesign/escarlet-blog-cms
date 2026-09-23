import test from 'node:test'
import assert from 'node:assert/strict'
import { blogPublishJobKey, dueBlogJobAction } from './blog-publish.mjs'

test('blog publish job key is stable for the scheduled instant', () => {
  assert.equal(
    blogPublishJobKey('variant-1', '2026-09-30T08:15:00.000Z'),
    'blog-publish:variant-1:2026-09-30T08:15:00.000Z'
  )
  assert.equal(
    blogPublishJobKey('variant-1', new Date('2026-09-30T08:15:00.000Z')),
    blogPublishJobKey('variant-1', '2026-09-30T08:15:00.000Z')
  )
})

test('a due blog without a live job gets enqueued and a dead letter stays put', () => {
  assert.equal(dueBlogJobAction(undefined), 'enqueue')
  assert.equal(dueBlogJobAction('queued'), 'wait')
  assert.equal(dueBlogJobAction('running'), 'wait')
  assert.equal(dueBlogJobAction('dead_letter'), 'wait')
  assert.equal(dueBlogJobAction('completed'), 'requeue')
})
