import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'cms-sched-'))
process.env.CMS_DATA_DIR = dir
process.env.CMS_SKIP_SEED = '1'
mkdirSync(join(dir, 'media'), { recursive: true })
writeFileSync(
  join(dir, 'db.json'),
  JSON.stringify(
    {
      sites: [{ id: 'escarlet', name: 'Escarlet', handle: 'escarlet' }],
      authors: [],
      categories: [],
      media: [],
      posts: []
    },
    null,
    2
  )
)

const {
  createDraft,
  updatePost,
  schedulePostForDate,
  confirmSchedule,
  cancelSchedule,
  promoteDueScheduledPosts,
  listCalendarPosts,
  getBrandContext,
  updateBrandFile,
  getBrandFile,
  CmsError
} = await import('./cms-ops.mjs')
const { saveSiteConfig } = await import('./site-config.mjs')
const { getBrandContext: brandCtxDirect, assertBrandFileAccess } = await import('./brand-kit.mjs')
const { findPost, readDb } = await import('./db.mjs')
const { todayIso } = await import('./post-utils.mjs')

function futureDay(daysAhead = 5) {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function seedReadyPost(slug) {
  await createDraft({
    site: 'escarlet',
    title: `Artículo ${slug}`,
    slug,
    author: 'Silvia'
  })
  // Cuerpo y SEO mínimos para pasar validatePostSeo en schedule
  await updatePost({
    site: 'escarlet',
    slug,
    keepPublished: true,
    title: `Artículo largo ${slug}`,
    excerptEs: 'Lead corto y claro para el listado del blog.',
    metaTitle: { es: `Título SEO válido ${slug}`, en: `SEO title ${slug}` },
    metaDescription: {
      es: 'Descripción meta con longitud suficiente para pasar validación SEO en español del CMS.',
      en: 'English meta description long enough for the SEO validator in this CMS suite.'
    },
    imageUrl: 'https://cdn.example.com/portada-test.jpg',
    imageAlt: 'Foto de prueba del artículo programado',
    bodyHtml: `<p>${'palabra '.repeat(420)}</p><h2>Sección</h2><p><a href="/blog/otro">enlace</a></p>`
  })
}

after(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.CMS_DATA_DIR
  delete process.env.CMS_SKIP_SEED
})

before(async () => {
  saveSiteConfig('escarlet', {
    requiresHumanApproval: true,
    requiresPublishConfirmation: true,
    socialPackChannels: {
      substack: false,
      linkedin: false,
      x: false,
      videoScript: false,
      instagramCarousel: false
    }
  })
})

test('schedule con confirmación → pending_schedule', async () => {
  await seedReadyPost('prog-confirm')
  const day = futureDay(7)
  const result = await schedulePostForDate('escarlet', 'prog-confirm', day)
  assert.equal(result.post.status, 'pending_schedule')
  assert.equal(result.post.publishAt, day)
  assert.equal(result.pendingConfirmation, true)
})

test('confirmSchedule → scheduled', async () => {
  const result = await confirmSchedule('escarlet', 'prog-confirm')
  assert.equal(result.post.status, 'scheduled')
  assert.equal(result.confirmed, true)
})

test('schedule sin confirmación → scheduled directo', async () => {
  saveSiteConfig('escarlet', { requiresPublishConfirmation: false })
  await seedReadyPost('prog-auto')
  const day = futureDay(10)
  const result = await schedulePostForDate('escarlet', 'prog-auto', day)
  assert.equal(result.post.status, 'scheduled')
  assert.equal(result.scheduled, true)
  saveSiteConfig('escarlet', { requiresPublishConfirmation: true })
})

test('cancelSchedule vuelve a review', async () => {
  await seedReadyPost('prog-cancel')
  const day = futureDay(8)
  await schedulePostForDate('escarlet', 'prog-cancel', day)
  const result = await cancelSchedule('escarlet', 'prog-cancel')
  assert.equal(result.post.status, 'review')
  assert.equal(result.cancelled, true)
  assert.equal(result.post.publishAt, undefined)
})

test('promoteDueScheduledPosts publica los vencidos', async () => {
  await seedReadyPost('prog-due')
  saveSiteConfig('escarlet', { requiresPublishConfirmation: false })
  const day = todayIso()
  // Forzar scheduled con publishAt = hoy vía DB (schedulePostForDate con hoy llama publish)
  const db = readDb()
  const post = findPost(db, 'escarlet', 'prog-due')
  post.status = 'scheduled'
  post.publishAt = day
  writeFileSync(join(dir, 'db.json'), JSON.stringify(db, null, 2))

  const result = await promoteDueScheduledPosts(day)
  assert.ok(result.promoted.some((p) => p.slug === 'prog-due'))
  const after = findPost(readDb(), 'escarlet', 'prog-due')
  assert.equal(after.status, 'published')
  assert.equal(after.publishAt, undefined)
  saveSiteConfig('escarlet', { requiresPublishConfirmation: true })
})

test('listCalendarPosts incluye programados del rango', async () => {
  await seedReadyPost('prog-cal')
  const day = futureDay(12)
  await schedulePostForDate('escarlet', 'prog-cal', day)
  const { posts } = await listCalendarPosts('escarlet', day, day)
  assert.ok(posts.some((p) => p.slug === 'prog-cal' && p.calendarDate === day))
})

test('brand context site omite secretos', () => {
  const full = brandCtxDirect('escarlet', { auth: { role: 'admin' } })
  assert.ok(typeof full.voice === 'string')
  assert.ok('imageSpec' in full || full.imageSpec === null || full.imageSpec)

  const client = brandCtxDirect('escarlet', { auth: { role: 'viewer', site: 'escarlet' } })
  assert.ok(typeof client.voice === 'string')
  assert.ok(client.visualStyle)
  assert.ok(client.imageGuide)
  assert.ok(client.imageSpec)
  assert.ok(typeof client.agentRules === 'string')
  assert.ok(typeof client.keywords === 'string')
  assert.equal(client.brandAccess, 'sanitized')
})

test('assertBrandFileAccess bloquea voice a site', () => {
  assert.throws(
    () => assertBrandFileAccess({ role: 'viewer', site: 'escarlet' }, 'voice.md'),
    /privado|super-admin/i
  )
  assert.equal(assertBrandFileAccess({ role: 'viewer', site: 'escarlet' }, 'AGENT.md'), 'AGENT.md')
})

test('updateBrandFile site no puede voice.md', async () => {
  await assert.rejects(
    () =>
      updateBrandFile('escarlet', 'voice.md', '# hack', {
        auth: { role: 'site', site: 'escarlet' }
      }),
    (err) => err instanceof CmsError && err.status === 403
  )
  const site = 'acl-agent-site'
  await updateBrandFile(site, 'AGENT.md', '# Regla María\nUsa foto de María.\n', {
    auth: { role: 'site', site }
  })
  const file = await getBrandFile(site, 'AGENT.md', {
    auth: { role: 'site', site }
  })
  assert.match(file.content, /María/)
})

test('getBrandContext wrapper respeta auth', async () => {
  const ctx = await getBrandContext('escarlet', { auth: { role: 'site', site: 'escarlet' } })
  assert.deepEqual(ctx.files.sort(), ['AGENT.md', 'keywords.md'].sort())
  assert.equal(ctx.voice, undefined)
})
