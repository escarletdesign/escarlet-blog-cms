import test from 'node:test'
import assert from 'node:assert/strict'
import { nextProviderPollAt, providerRowNeedsRemoteSync } from './provider-poll.mjs'

const now = Date.parse('2026-09-25T12:00:00Z')
const interval = 300_000
const iso = (ms) => new Date(ms).toISOString()

test('far-future scheduled posts skip Buffer until the due window', () => {
  const due = now + 2 * 24 * 60 * 60 * 1000
  const row = { status: 'scheduled', publication_date: iso(due) }
  assert.equal(providerRowNeedsRemoteSync(row, { now, intervalMs: interval }), false)
  assert.equal(nextProviderPollAt([row], { now, intervalMs: interval })?.getTime(), due - interval)
})

test('due or overdue posts poll again on the interval', () => {
  assert.equal(providerRowNeedsRemoteSync({ status: 'scheduled', publication_date: iso(now + 120_000) }, { now, intervalMs: interval }), true)
  assert.equal(providerRowNeedsRemoteSync({ status: 'scheduled' }, { now, intervalMs: interval }), true)
  assert.equal(nextProviderPollAt([{ status: 'scheduled', publication_date: iso(now - 60_000) }], { now, intervalMs: interval })?.getTime(), now + interval)
  assert.equal(nextProviderPollAt([], { now, intervalMs: interval }), null)
})

test('soonest pending post wins when mixing far-future and due items', () => {
  const far = { status: 'scheduled', publication_date: iso(now + 2 * 24 * 60 * 60 * 1000) }
  const due = { status: 'scheduled', publication_date: iso(now - 1) }
  assert.equal(nextProviderPollAt([far, due], { now, intervalMs: interval })?.getTime(), now + interval)
})
