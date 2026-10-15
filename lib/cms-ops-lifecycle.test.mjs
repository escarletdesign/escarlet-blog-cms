import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
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
  saveUploadedVideoMedia,
  uploadMedia,
  deleteMedia,
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

test('updatePost con status published explícito no baja a review', async () => {
  const db = readDb()
  const post = findPost(db, 'escarlet', 'post-lifecycle-renombrado')
  post.status = 'published'
  writeFileSync(join(dir, 'db.json'), JSON.stringify(db, null, 2))

  const result = await updatePost({
    site: 'escarlet',
    slug: 'post-lifecycle-renombrado',
    status: 'published',
    imageUrl: 'https://blog-cms.escarlet.cc/media/escarlet/demo.jpg'
  })
  assert.equal(result.post.status, 'published')
  assert.equal(result.demotedToReview, false)
  assert.equal(result.savedOnly, true)
  assert.equal(result.rebuild, null)
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

test('deleteMedia elimina del disco un vídeo reemplazado', async () => {
  const video = await saveUploadedVideoMedia({
    site: 'escarlet',
    filename: 'video-anterior.webm',
    buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from('video anterior')]),
    mimeType: 'video/webm',
    skipLegacyDb: false
  })
  const disk = join(dir, 'media', 'escarlet', video.filename)
  assert.equal(existsSync(disk), true)

  await deleteMedia('escarlet', video.id, video.path)

  assert.equal(existsSync(disk), false)
  assert.equal(readDb().media.some((media) => media.id === video.id), false)
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
  assert.ok(ctx.editRules.some((r) => /content_create_batch/i.test(r)))
  assert.ok(Array.isArray(ctx.workflow))
  assert.ok(Array.isArray(ctx.authors))
  assert.ok(ctx.seoLimits)
  assert.ok(Array.isArray(ctx.missingBrand))

  const direct = brandCtxDirect('escarlet')
  assert.ok(direct.postFields.length >= 10)
})

test('uploadMedia kind social conserva exactamente el PNG y sugiere instagramSlides', async () => {
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
  assert.match(result.media.filename, /\.png$/)
  assert.ok(result.suggestedPostPatch.socialPack.instagramSlides[0].imageUrl)
  const disk = join(dir, 'media', 'escarlet', result.media.filename)
  assert.equal(existsSync(disk), true)
  assert.deepEqual(readFileSync(disk), png)
  assert.equal(result.media.sha256, createHash('sha256').update(png).digest('hex'))
})

test('saveUploadedMedia no sobrescribe assets distintos con el mismo filename', async () => {
  const firstBuffer = await new Jimp(64, 64, 0x2d6a4fff).getBufferAsync(Jimp.MIME_PNG)
  const secondBuffer = await new Jimp(64, 64, 0xc45c48ff).getBufferAsync(Jimp.MIME_PNG)
  const first = await saveUploadedMedia({ site: 'escarlet', filename: 'cover.png', kind: 'post', buffer: firstBuffer })
  const second = await saveUploadedMedia({ site: 'escarlet', filename: 'cover.png', kind: 'post', buffer: secondBuffer })
  assert.notEqual(first.filename, second.filename)
  assert.deepEqual(readFileSync(join(dir, 'media', 'escarlet', first.filename)), firstBuffer)
  assert.deepEqual(readFileSync(join(dir, 'media', 'escarlet', second.filename)), secondBuffer)
})

test('saveUploadedMedia conserva la marca de carga manual', async () => {
  const png = await new Jimp(32, 32, 0x2d6a4fff).getBufferAsync(Jimp.MIME_PNG)
  const media = await saveUploadedMedia({ site: 'escarlet', filename: 'manual-social.png', kind: 'social', manualUpload: true, buffer: png })
  assert.equal(media.kind, 'social')
  assert.equal(media.metadata.manualUpload, true)
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
  assert.match(second.media.filename, /\.png$/)
  const mediaCount = readDb().media.length
  const retry = await uploadMedia({
    site: 'escarlet',
    filename: 'chunked-cover.png',
    kind: 'post',
    uploadId: 'chunk-test-1',
    chunkIndex: 1,
    chunkCount: 2,
    contentBase64: encoded.slice(mid)
  })
  assert.equal(retry.idempotentReplay, true)
  assert.equal(retry.media.id, second.media.id)
  assert.equal(readDb().media.length, mediaCount)
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
  assert.match(result.media.url, /sandbox-portada\.png$/)
  await assert.rejects(() => receiveImageDrop(drop.token, png), (err) => err.status === 404)
})

test('uploadMedia descarga file.download_url del conector ChatGPT', async () => {
  const png = await new Jimp(48, 48, 0x2d6a4fff).getBufferAsync(Jimp.MIME_PNG)
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length })
    res.end(png)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    const result = await uploadMedia({
      site: 'escarlet',
      filename: 'connector-file.png',
      kind: 'post',
      alt: 'Foto del conector',
      file: {
        download_url: `http://127.0.0.1:${port}/file.png`,
        file_id: 'file_test_1',
        mime_type: 'image/png',
        file_name: 'connector-file.png'
      }
    })
    assert.equal(result.ok, true)
    assert.equal(result.kind, 'post')
    assert.match(result.media.filename, /connector-file\.png$/)
    assert.match(result.media.url, /connector-file\.png$/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('content_upload_media normaliza imágenes cercanas y conserva alt, dimensiones originales y hash final', async () => {
  const cases = [
    { width: 1536, height: 1024, assetType: 'blog_cover', finalWidth: 1536, finalHeight: 1024, normalized: false, kind: 'post' },
    { width: 1122, height: 1402, assetType: 'social_image', finalWidth: 1080, finalHeight: 1350, normalized: true, kind: 'social' },
    { width: 941, height: 1672, assetType: 'instagram_story', finalWidth: 1080, finalHeight: 1920, normalized: true, kind: 'social' }
  ]
  for (const item of cases) {
    const original = await new Jimp(item.width, item.height, 0x315a7cff).getBufferAsync(Jimp.MIME_PNG)
    const originalSha256 = createHash('sha256').update(original).digest('hex')
    const uploaded = await uploadMedia({
      site: 'escarlet',
      filename: `normalized-${item.assetType}.png`,
      kind: item.kind,
      ...(item.assetType === 'social_image' ? { imageAlt: `Alt ${item.assetType}` } : { alt: `Alt ${item.assetType}` }),
      buffer: original,
      brandGroundingOverride: { provenanceVersion: '3', assetType: item.assetType },
      ...(item.kind === 'social' ? {
        textRendered: true,
        templateId: 'editorial',
        renderedBy: 'chatgpt-image-generation',
        textContent: { headline: `Headline ${item.assetType}`, body: `Body ${item.assetType}` }
      } : {}),
      requireBrandGrounding: true
    })
    const stored = readFileSync(join(dir, 'media', 'escarlet', uploaded.media.filename))
    assert.equal(uploaded.media.width, item.finalWidth)
    assert.equal(uploaded.media.height, item.finalHeight)
    assert.deepEqual(uploaded.media.metadata.originalDimensions, { width: item.width, height: item.height })
    assert.deepEqual(uploaded.media.metadata.normalizedDimensions, { width: item.finalWidth, height: item.finalHeight })
    assert.equal(uploaded.media.metadata.autoNormalized, item.normalized)
    assert.equal(uploaded.media.metadata.alt, `Alt ${item.assetType}`)
    assert.equal(uploaded.media.sha256, createHash('sha256').update(stored).digest('hex'))
    assert.equal(uploaded.media.sha256 === originalSha256, !item.normalized)
    assert.equal(uploaded.media.brandGrounding.generatedFileHash, uploaded.media.sha256)
  }
})

test('content_upload_media rechaza proporciones incompatibles antes de guardar el asset', async () => {
  const before = readDb().media.length
  const image = await new Jimp(1000, 1000, 0x315a7cff).getBufferAsync(Jimp.MIME_PNG)
  await assert.rejects(() => uploadMedia({
    site: 'escarlet',
    filename: 'wrong-ratio.png',
    kind: 'social',
    buffer: image,
    brandGroundingOverride: { provenanceVersion: '3', assetType: 'instagram_story' },
    requireBrandGrounding: true
  }), (error) => error.code === 'GENERATED_IMAGE_ASPECT_MISMATCH')
  assert.equal(readDb().media.length, before)
})

test('content_upload_media conserva los píxeles finales y nunca compone overlays CMS', async () => {
  const png = await new Jimp(1080, 1350, 0x315a7cff).getBufferAsync(Jimp.MIME_PNG)
  await assert.rejects(() => uploadMedia({
    site: 'escarlet',
    filename: 'cms-compose-disabled.png',
    kind: 'social',
    buffer: png,
    composeMode: 'cms',
    brandGroundingOverride: { provenanceVersion: '3', assetType: 'social_image' },
    textRendered: true,
    templateId: 'editorial',
    renderedBy: 'chatgpt-image-generation',
    textContent: { headline: 'Titular final', body: 'Texto final integrado.' },
    requireBrandGrounding: true
  }), (error) => error.code === 'CMS_COMPOSITION_DISABLED')
  const uploaded = await uploadMedia({
    site: 'escarlet',
    filename: 'passthrough-social.png',
    kind: 'social',
    buffer: png,
    brandGroundingOverride: { provenanceVersion: '3', assetType: 'social_image' },
    textRendered: true,
    templateId: 'editorial',
    renderedBy: 'chatgpt-image-generation',
    textContent: { headline: 'Titular final', body: 'Texto final integrado.' },
    requireBrandGrounding: true
  })
  const disk = join(dir, 'media', 'escarlet', uploaded.media.filename)
  assert.deepEqual(readFileSync(disk), png)
  assert.equal(uploaded.media.sha256, createHash('sha256').update(png).digest('hex'))
  assert.equal(uploaded.media.brandGrounding.logoApplied, false)
  assert.equal(uploaded.composeMode, undefined)
  assert.equal(uploaded.composedPreviewUrl, undefined)
  const db = readDb()
  db.media = db.media.filter((media) => media.id !== uploaded.media.id)
  writeFileSync(join(dir, 'db.json'), JSON.stringify(db, null, 2))
  rmSync(disk, { force: true })
})

test('file.download_url transfiere un PNG de más de 2 MB en una llamada', async () => {
  const image = new Jimp(1200, 1200, 0xffffffff)
  let seed = 17
  for (let offset = 0; offset < image.bitmap.data.length; offset += 4) {
    seed = (seed * 48271) % 2147483647
    image.bitmap.data[offset] = seed & 255
    image.bitmap.data[offset + 1] = (seed >>> 8) & 255
    image.bitmap.data[offset + 2] = (seed >>> 16) & 255
    image.bitmap.data[offset + 3] = 255
  }
  const png = await image.getBufferAsync(Jimp.MIME_PNG)
  assert.ok(png.length > 2 * 1024 * 1024)
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length })
    res.end(png)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const uploaded = await uploadMedia({
      site: 'escarlet',
      filename: 'large-connector.png',
      kind: 'post',
      file: { download_url: `http://127.0.0.1:${server.address().port}/large.png`, file_id: 'large-file-1', file_name: 'large-connector.png' }
    })
    const stored = readFileSync(join(dir, 'media', 'escarlet', uploaded.media.filename))
    assert.equal(stored.length, png.length)
    assert.equal(uploaded.media.sha256, createHash('sha256').update(png).digest('hex'))
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
