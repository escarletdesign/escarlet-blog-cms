import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createEmbedSession,
  consumeEmbedSession,
  sanitizeNext
} from './embed-session.mjs'

test('sanitizeNext only allows PWA routes', () => {
  assert.equal(sanitizeNext(''), '/')
  assert.equal(sanitizeNext('/posts'), '/posts')
  assert.equal(sanitizeNext('#/entrada/hola'), '/preview/hola')
  assert.equal(sanitizeNext('entrada/hola/revisar'), '/preview/hola')
  assert.equal(sanitizeNext('https://evil.example'), '/')
  assert.equal(sanitizeNext('//evil'), '/')
})

test('create and consume embed session once', () => {
  const created = createEmbedSession({
    token: 'site_test_token_abc',
    site: 'demo',
    next: '#/entrada/post-uno'
  })
  assert.ok(created.code)
  assert.ok(created.expiresAt > Date.now())

  const first = consumeEmbedSession(created.code)
  assert.equal(first.token, 'site_test_token_abc')
  assert.equal(first.site, 'demo')
  assert.equal(first.next, '/preview/post-uno')

  const second = consumeEmbedSession(created.code)
  assert.equal(second, null)
})
