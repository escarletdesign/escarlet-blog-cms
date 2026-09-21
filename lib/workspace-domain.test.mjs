import test from 'node:test'
import assert from 'node:assert/strict'
import { bufferPublishChannels } from './workspace-domain.mjs'

test('Buffer solo admite Instagram y rechaza el Blog', () => {
  assert.deepEqual(bufferPublishChannels(['instagram']), ['instagram'])
  assert.throws(() => bufferPublishChannels(['blog']), (error) => error.code === 'BLOG_WEBHOOK_REQUIRED')
  assert.throws(() => bufferPublishChannels(['blog', 'instagram']), (error) => error.code === 'BLOG_WEBHOOK_REQUIRED')
})
