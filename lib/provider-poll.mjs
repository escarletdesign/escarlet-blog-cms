const MIN_DELAY_MS = 60_000

function dueAt(row) {
  const value = Date.parse(row?.publication_date || row?.publicationDate || '')
  return Number.isFinite(value) ? value : null
}

export function providerRowNeedsRemoteSync(row, { now = Date.now(), intervalMs } = {}) {
  const interval = Math.max(Number(intervalMs) || 0, MIN_DELAY_MS)
  if (String(row?.status || row?.schedule_status || '').toLowerCase() === 'syncing') return true
  const due = dueAt(row)
  if (due == null) return true
  return due <= now + interval
}

export function nextProviderPollAt(rows, { now = Date.now(), intervalMs } = {}) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return null
  const interval = Math.max(Number(intervalMs) || 0, MIN_DELAY_MS)
  let soonest = Infinity
  for (const row of list) {
    const due = dueAt(row)
    soonest = Math.min(soonest, due == null || due <= now ? now + interval : due - interval)
  }
  return Number.isFinite(soonest) ? new Date(Math.max(soonest, now + MIN_DELAY_MS)) : null
}
