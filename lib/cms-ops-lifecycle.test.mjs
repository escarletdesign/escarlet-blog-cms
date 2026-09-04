import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Jimp from 'jimp'

const dir = mkdtempSync(join(tmpdir(), 'cms-life-'))
process.env.CMS_DATA_DIR = dir
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
  unpublishPost,
  deletePost,
  getBrandContext,
  saveUploadedMedia,
  uploadMedia,
  openImageDrop,
  receiveImageDrop,
  CmsError
} = await import('./cms-ops.mjs')
const { getBrandContext: brandCtxDirect } = await import('./brand-kit.mjs')
const { findPost, readDb } = await import('./db.mjs')

after(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.CMS_DATA_DIR
})

before(async () => {
  await createDraft({
    site: 'escarlet',
    title: 'Post de prueba lifecycle',
    slug: 'post-lifecycle',
    author: 'Silvia'
  })
})

test('updatePost 404 si el slug no existe', async () => {
  await assert.rejects(
    () => updatePost({ site: 'escarlet', slug: 'no-existe-xyz', title: 'X' }),
    (err) => err instanceof CmsError && err.status === 404
  )
})

test('updatePost con originalSlug renombra y no duplica', async () => {
  await updatePost({
    site: 'escarlet',
    originalSlug: 'post-lifecycle',
    slug: 'post-lifecycle-renombrado',
    title: 'Post renombrado'
  })
  const db = readDb()
  assert.equal(findPost(db, 'escarlet', 'post-lifecycle'), undefined)
  const renamed = findPost(db, 'escarlet', 'post-lifecycle-renombrado')
  assert.ok(renamed)
  assert.equal(renamed.title, 'Post renombrado')
  assert.equal(db.posts.filter((p) => p.site === 'escarlet').length, 1)
})

test('updatePost de published sin keepPublished baja a review', async () => {
  const db = readDb()
  const post = findPost(db, 'escarlet', 'post-lifecycle-renombrado')
  post.status = 'published'
  writeFileSync(join(dir, 'db.json'), JSON.stringify(db, null, 2))

  const result = await updatePost({
    site: 'escarlet',
    slug: 'post-lifecycle-renombrado',
    excerptEs: 'Nuevo extracto de prueba.'
  })
  assert.equal(result.post.status, 'review')
  assert.equal(result.demotedToReview, true)
})

test('updatePost con keepPublished mantiene published', async () => {
  const db = readDb()
  const post = findPost(db, 'escarlet', 'post-lifecycle-renombrado')
  post.status = 'published'
  writeFileSync(join(dir, 'db.json'), JSON.stringify(db, null, 2))

  const result = await updatePost({
    site: 'escarlet',
    slug: 'post-lifecycle-renombrado',
    keepPublished: true,
    status: 'published',
    excerptEs: 'Extracto humano desde dashboard.'
  })
  assert.equal(result.post.status, 'published')
  assert.equal(result.demotedToReview, false)
})

test('updatePost convierte markdown de bodyHtml a HTML', async () => {
  const result = await updatePost({
    site: 'escarlet',
    slug: 'post-lifecycle-renombrado',
    keepPublished: true,
    status: 'published',
    bodyHtml: '## Título\n\nPárrafo con **negrita**.'
  })
  assert.match(result.post.bodyHtml, /<h2>/)
  assert.match(result.post.bodyHtml, /<strong>negrita<\/strong>/)
  const stored = findPost(readDb(), 'escarlet', 'post-lifecycle-renombrado')
  assert.match(stored.bodyHtml, /<h2>/)
})

test('unpublishPost pasa a draft', async () => {
  const result = await unpublishPost('escarlet', 'post-lifecycle-renombrado')
  assert.equal(result.post.status, 'draft')
  assert.equal(result.unpublished, true)
})

test('deletePost elimina el post', async () => {
  const result = await deletePost('escarlet', 'post-lifecycle-renombrado')
  assert.equal(result.deleted, true)
  const db = readDb()
  assert.equal(findPost(db, 'escarlet', 'post-lifecycle-renombrado'), undefined)
})

test('saveUploadedMedia rechaza un WebP truncado', async () => {
  const declaredTotal = 121336
  const actualPayload = 2000
  const riffSize = declaredTotal - 8
  const buf = Buffer.alloc(20 + actualPayload)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(riffSize, 4)
  buf.write('WEBP', 8)
  buf.write('VP8 ', 12)
  buf.writeUInt32LE(riffSize - 8, 16)
  buf.fill(0x80, 20)

  await assert.rejects(
    () =>
      saveUploadedMedia({
        site: 'escarlet',
        filename: 'portada-truncada.webp',
        contentBase64: buf.toString('base64')
      }),
    (err) =>
      err instanceof CmsError &&
      err.status === 400 &&
      /incompleto/.test(err.message) &&
      /121336/.test(err.message)
  )
})

test('getBrandContext incluye postFields y editRules', async () => {
  const ctx = await getBrandContext('escarlet')
  assert.ok(Array.isArray(ctx.postFields))
  assert.ok(ctx.postFields.some((f) => f.key === 'title' && f.required))
  assert.ok(ctx.postFields.some((f) => f.askHuman))
  assert.ok(Array.isArray(ctx.editRules))
  assert.ok(ctx.editRules.some((r) => /create_draft/i.test(r)))
  assert.ok(Array.isArray(ctx.workflow))
  assert.ok(Array.isArray(ctx.authors))
  assert.ok(ctx.seoLimits)
  assert.ok(Array.isArray(ctx.missingBrand))

  const direct = brandCtxDirect('escarlet')
  assert.ok(direct.postFields.length >= 10)
})

test('uploadMedia kind social comprime a JPEG y sugiere instagramSlides', async () => {
  const png = await new Jimp(80, 100, 0x2d6a4fff).getBufferAsync(Jimp.MIME_PNG)
  const result = await uploadMedia({
    site: 'escarlet',
    filename: 'cuidar-columna-ig-01.png',
    kind: 'instagram',
    alt: 'Slide uno',
    contentBase64: png.toString('base64')
  })
  assert.equal(result.ok, true)
  assert.equal(result.kind, 'social')
  assert.match(result.media.filename, /\.jpg$/)
  assert.ok(result.suggestedPostPatch.socialPack.instagramSlides[0].imageUrl)
  const disk = join(dir, 'media', 'escarlet', result.media.filename)
  assert.equal(existsSync(disk), true)
  assert.equal(readFileSync(disk)[0], 0xff)
})

test('uploadMedia ensambla contentBase64 a trozos', async () => {
  const png = await new Jimp(48, 48, 0xc45c48ff).getBufferAsync(Jimp.MIME_PNG)
  const encoded = png.toString('base64')
  const mid = Math.ceil(encoded.length / 2)
  const first = await uploadMedia({
    site: 'escarlet',
    filename: 'chunked-cover.png',
    kind: 'post',
    uploadId: 'chunk-test-1',
    chunkIndex: 0,
    chunkCount: 2,
    contentBase64: encoded.slice(0, mid)
  })
  assert.equal(first.awaitingChunks, true)
  const second = await uploadMedia({
    site: 'escarlet',
    filename: 'chunked-cover.png',
    kind: 'post',
    uploadId: 'chunk-test-1',
    chunkIndex: 1,
    chunkCount: 2,
    contentBase64: encoded.slice(mid)
  })
  assert.equal(second.ok, true)
  assert.equal(second.kind, 'post')
  assert.match(second.media.filename, /\.jpg$/)
})

test('openImageDrop + receiveImageDrop guarda un PNG del sandbox', async () => {
  const png = await new Jimp(64, 64, 0x2d6a4fff).getBufferAsync(Jimp.MIME_PNG)
  const drop = openImageDrop({
    site: 'escarlet',
    filename: 'sandbox-portada.png',
    kind: 'post',
    alt: 'Foto de prueba'
  })
  assert.equal(drop.ok, true)
  assert.match(drop.putUrl, /\/api\/media-inbox\//)
  assert.match(drop.sandboxPython, /urllib.request/)
  const result = await receiveImageDrop(drop.token, png)
  assert.equal(result.ok, true)
  assert.equal(result.kind, 'post')
  assert.match(result.media.url, /sandbox-portada\.jpg$/)
  await assert.rejects(() => receiveImageDrop(drop.token, png), (err) => err.status === 404)
})
