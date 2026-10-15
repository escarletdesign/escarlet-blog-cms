import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Jimp from 'jimp'

const dataRoot = mkdtempSync(join(tmpdir(), 'cms-favicon-'))
process.env.CMS_DATA_DIR = dataRoot
process.env.CMS_PUBLIC_URL = 'https://cms.escarlet.design'
mkdirSync(join(dataRoot, 'media'), { recursive: true })
writeFileSync(
  join(dataRoot, 'db.json'),
  JSON.stringify({ sites: [], authors: [], categories: [], media: [], posts: [] })
)

const {
  AGENT_ICON_FILENAME,
  MAX_AGENT_ICON_BYTES,
  convertToAgentPng,
  extractFaviconCandidates,
  extractImageFromIco,
  getMcpConnectionInfo,
  prepareSiteAgentIcon,
  readSiteAgentIcon
} = await import('./favicon.mjs')

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

after(() => {
  rmSync(dataRoot, { recursive: true, force: true })
})

test('extractFaviconCandidates prioriza apple-touch y png', () => {
  const html = `
    <html><head>
      <link rel="shortcut icon" href="/old.ico" />
      <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
      <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
      <link rel="icon" href="/mark.svg" type="image/svg+xml" />
    </head></html>
  `
  const urls = extractFaviconCandidates(html, 'https://cliente.example')
  assert.equal(urls[0], 'https://cliente.example/apple-touch-icon.png')
  assert.ok(urls.includes('https://cliente.example/favicon-32.png'))
  assert.ok(urls.includes('https://cliente.example/favicon.ico'))
})

test('convertToAgentPng produce PNG bajo 10 KB', async () => {
  const source = new Jimp(256, 256, 0xe11d48ff)
  source.scan(40, 40, 176, 176, function (x, y, idx) {
    this.bitmap.data[idx] = 255
    this.bitmap.data[idx + 1] = 255
    this.bitmap.data[idx + 2] = 255
  })
  const input = await source.getBufferAsync(Jimp.MIME_PNG)
  const png = await convertToAgentPng(input)
  assert.ok(png.length > 32)
  assert.ok(png.length <= MAX_AGENT_ICON_BYTES, `size ${png.length}`)
  assert.ok(png[0] === 0x89 && png[1] === 0x50)
  const roundtrip = await Jimp.read(png)
  assert.equal(roundtrip.getWidth(), roundtrip.getHeight())
  assert.ok(roundtrip.getWidth() <= 64)
})

test('convertToAgentPng convierte SVG a PNG bajo 10 KB', async () => {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="12" fill="#e11d48"/>
      <circle cx="32" cy="32" r="18" fill="#ffffff"/>
    </svg>`
  )
  const png = await convertToAgentPng(svg, { contentType: 'image/svg+xml' })
  assert.ok(png.length > 32)
  assert.ok(png.length <= MAX_AGENT_ICON_BYTES, `size ${png.length}`)
  assert.equal(png[0], 0x89)
  const roundtrip = await Jimp.read(png)
  assert.equal(roundtrip.getWidth(), roundtrip.getHeight())
  assert.ok(roundtrip.getWidth() <= 64)
})

test('convertToAgentPng acepta ICO con PNG embebido', async () => {
  const inner = PNG_1X1
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry[0] = 1
  entry[1] = 1
  entry.writeUInt16LE(0, 4)
  entry.writeUInt32LE(inner.length, 8)
  entry.writeUInt32LE(6 + 16, 12)
  const ico = Buffer.concat([header, entry, inner])
  const extracted = extractImageFromIco(ico)
  assert.ok(extracted)
  assert.deepEqual(extracted, inner)
  const png = await convertToAgentPng(ico, { contentType: 'image/x-icon' })
  assert.ok(png.length <= MAX_AGENT_ICON_BYTES)
  assert.equal(png[0], 0x89)
})

test('prepareSiteAgentIcon guarda en media/{handle}/agent-icon.png', async () => {
  const html = `<html><head><link rel="icon" href="/icon.png" type="image/png" /></head></html>`
  const big = new Jimp(120, 120, 0x1d4ed8ff)
  const pngBuf = await big.getBufferAsync(Jimp.MIME_PNG)

  const fetchImpl = async (url, init = {}) => {
    const u = String(url)
    if (u === 'https://demo-favicon.test' || u === 'https://demo-favicon.test/') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/html' },
        text: async () => html
      }
    }
    if (u.includes('icon.png')) {
      if (init.method === 'HEAD') {
        return { ok: true, status: 200, headers: { get: () => 'image/png' } }
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () =>
          pngBuf.buffer.slice(pngBuf.byteOffset, pngBuf.byteOffset + pngBuf.byteLength)
      }
    }
    return { ok: false, status: 404, headers: { get: () => '' } }
  }

  const result = await prepareSiteAgentIcon('demo-favicon', 'https://demo-favicon.test', {
    fetchImpl,
    force: true
  })
  assert.equal(result.ok, true)
  assert.ok(result.bytes <= MAX_AGENT_ICON_BYTES)
  assert.match(result.path, new RegExp(`/media/demo-favicon/${AGENT_ICON_FILENAME}`))
  assert.match(result.url, /https:\/\/cms\.escarlet\.design\/media\/demo-favicon\/agent-icon\.png/)
  const disk = join(dataRoot, 'media', 'demo-favicon', AGENT_ICON_FILENAME)
  assert.ok(existsSync(disk))
  const saved = readFileSync(disk)
  assert.ok(saved.length <= MAX_AGENT_ICON_BYTES)
  assert.equal(saved[0], 0x89)
  const info = readSiteAgentIcon('demo-favicon')
  assert.equal(info.ok, true)
})

test('getMcpConnectionInfo expone URL MCP para ChatGPT y Claude', () => {
  const info = getMcpConnectionInfo({ cmsUrl: 'https://cms.escarlet.design' })
  assert.equal(info.mcpUrl, 'https://cms.escarlet.design/mcp/v3')
  assert.equal(info.chatgpt.url, 'https://cms.escarlet.design/mcp/v3')
  assert.equal(info.chatgpt.authMode, 'oauth')
  assert.match(info.chatgpt.hint, /OAuth/)
  assert.equal(info.claude.url, 'https://cms.escarlet.design/mcp/v3')
  assert.equal(info.claude.authMode, 'oauth')
  assert.match(info.claude.hint, /Claude/)
})
