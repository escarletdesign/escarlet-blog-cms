import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAuth } from './auth.mjs'

test('missing ADMIN_TOKEN fails closed and never accepts the historical placeholder', () => {
  const previous = process.env.ADMIN_TOKEN
  delete process.env.ADMIN_TOKEN
  try {
    assert.equal(resolveAuth('cambia-esto'), null)
    assert.equal(resolveAuth(''), null)
    process.env.ADMIN_TOKEN = 'configured-admin-token'
    assert.equal(resolveAuth('configured-admin-token')?.role, 'admin')
  } finally {
    if (previous === undefined) delete process.env.ADMIN_TOKEN
    else process.env.ADMIN_TOKEN = previous
  }
})
