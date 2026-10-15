import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dataRoot = mkdtempSync(join(tmpdir(), 'cms-db-accounting-'))
process.env.CMS_DATA_DIR = dataRoot
process.env.CMS_SKIP_SEED = '1'

const { publicPost, readDb, writeDb } = await import('./db.mjs')

after(() => rmSync(dataRoot, { recursive: true, force: true }))

test('stale content writes cannot reset AI usage or make the monthly balance look full', () => {
  const current = readDb()
  current.aiUsage = {
    escarlet: {
      '2026-09': { inputTokens: 70_000, outputTokens: 2_000, totalTokens: 72_000, creditsUsed: 72_000 }
    }
  }
  current.aiCredits = { escarlet: { balance: 25_000 } }
  writeDb(current)

  // Simulate a long-running image/content operation that read an old DB before
  // AI usage was recorded, then saves an unrelated post afterwards.
  const stale = {
    ...current,
    aiUsage: {},
    aiCredits: { escarlet: { balance: 25_000 } },
    posts: [{ site: 'escarlet', slug: 'post', title: 'Post guardado' }]
  }
  writeDb(stale)

  const persisted = readDb()
  assert.equal(persisted.aiUsage.escarlet['2026-09'].creditsUsed, 72_000)
  assert.equal(persisted.aiCredits.escarlet.balance, 25_000)
  assert.equal(persisted.posts[0].slug, 'post')
})

test('public social packs omit storage paths and private media metadata', () => {
  const post = publicPost({
    slug: 'publicado',
    socialPack: {
      instagramSlides: [{ imageUrl: 'https://cdn.example/slide.jpg', path: 'private/slide.jpg', metadata: { storageKey: 'private/slide.jpg' } }],
      instagramStory: { frames: [{ url: 'https://cdn.example/story.jpg', storage_key: 'private/story.jpg' }] }
    }
  })

  assert.deepEqual(post.socialPack, {
    instagramSlides: [{ imageUrl: 'https://cdn.example/slide.jpg' }],
    instagramStory: { frames: [{ url: 'https://cdn.example/story.jpg' }] }
  })
})

test('a real usage write can still reduce purchased credits after monthly allowance is exhausted', () => {
  const current = readDb()
  current.aiUsage = {
    escarlet: {
      '2026-09': { inputTokens: 99_900, outputTokens: 0, totalTokens: 99_900, creditsUsed: 99_900 }
    }
  }
  current.aiCredits = { escarlet: { balance: 25_000 } }
  writeDb(current)

  const spend = readDb()
  spend.aiUsage.escarlet['2026-09'].creditsUsed = 100_500
  spend.aiUsage.escarlet['2026-09'].totalTokens = 100_500
  spend.aiCredits.escarlet.balance = 24_400
  writeDb(spend)

  const persisted = readDb()
  assert.equal(persisted.aiUsage.escarlet['2026-09'].creditsUsed, 100_500)
  assert.equal(persisted.aiCredits.escarlet.balance, 24_400)
})
