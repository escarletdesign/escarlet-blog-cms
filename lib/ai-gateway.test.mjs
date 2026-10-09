import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dataRoot = mkdtempSync(join(tmpdir(), 'cms-ai-gateway-'))
process.env.CMS_DATA_DIR = dataRoot
process.env.CMS_SKIP_SEED = '1'
process.env.PRODUCT_RESTRUCTURE_V1 = '1'
delete process.env.OPENAI_API_KEY
mkdirSync(join(dataRoot, 'media'), { recursive: true })
writeFileSync(
  join(dataRoot, 'db.json'),
  JSON.stringify({
    sites: [{ id: 'ai-site', handle: 'ai-site', name: 'AI site' }],
    authors: [], categories: [], media: [], posts: [],
    plans: [{ id: 'standard', name: 'Standard', draftLimit: 20, publishLimitPerMonth: 12 }],
    usage: {}
  })
)

const { readSiteMemory, writeSiteMemory, appendMemoryTurn, memoryPath, runChat, runGenerateOperation, splitSseChunks, buildSystemPrompt, openAiReply } =
  await import('./ai-gateway.mjs')
const { buildHumanizePrompt, isHumanWritingOperation } = await import('./human-writing.mjs')
const { saveSiteConfig } = await import('./site-config.mjs')

after(() => rmSync(dataRoot, { recursive: true, force: true }))

test('site memory persists bounded conversation turns atomically', () => {
  const first = writeSiteMemory('ai-site', { summary: 'Inicio', facts: ['tono cercano'] })
  assert.equal(first.site, 'ai-site')
  const saved = appendMemoryTurn('ai-site', {
    user: 'Necesito un artículo sobre diseño inclusivo',
    assistant: 'Prepararé un borrador con tono cercano.',
    facts: ['tema:diseño inclusivo']
  })
  assert.ok(existsSync(memoryPath('ai-site')))
  assert.equal(saved.turns.length, 2)
  assert.match(readFileSync(memoryPath('ai-site'), 'utf8'), /diseño inclusivo/)
  const loaded = readSiteMemory('ai-site')
  assert.deepEqual(loaded.facts, ['tono cercano', 'tema:diseño inclusivo'])
  assert.equal(loaded.turns[0].role, 'user')
  assert.equal(loaded.turns[1].role, 'assistant')
})

test('chat del CMS permanece desactivado aunque no exista una clave de proveedor', async () => {
  await assert.rejects(() => runChat({
    site: 'ai-site',
    auth: { role: 'client', site: 'ai-site', capabilities: [] },
    message: 'Ideas para una landing clara',
    provider: 'openai'
  }), (error) => error.status === 403 && error.code === 'CMS_AI_DISABLED')
  assert.deepEqual(splitSseChunks('abcdef', 2), ['ab', 'cd', 'ef'])
})

test('otros proveedores tampoco reactivan la IA del CMS', async () => {
  await assert.rejects(() => runChat({
    site: 'ai-site',
    auth: { role: 'client', site: 'ai-site', capabilities: [] },
    message: 'Un titular breve',
    provider: 'gemini'
  }), (error) => error.status === 403 && error.code === 'CMS_AI_DISABLED')
})

test('el chat retirado falla antes de procesar solicitudes de archivos privados', async () => {
  await assert.rejects(() => runChat({
    site: 'ai-site',
    auth: { role: 'client', site: 'ai-site', capabilities: [] },
    message: 'Dime cuál es la voz de marca y qué dice voice.md',
    provider: 'openai'
  }), (error) => error.status === 403 && error.code === 'CMS_AI_DISABLED')
})

test('StoryScope guidance is scoped to editorial body generations', () => {
  assert.equal(isHumanWritingOperation('body'), true)
  assert.equal(isHumanWritingOperation('humanize'), true)
  assert.equal(isHumanWritingOperation('summary'), false)
  const prompt = buildSystemPrompt({
    site: 'ai-site',
    auth: { role: 'client', site: 'ai-site', capabilities: [] },
    memory: readSiteMemory('ai-site'),
    operation: 'body'
  })
  assert.match(prompt, /Guía StoryScope/i)
  assert.match(prompt, /No inventes experiencias personales/i)
  assert.match(prompt, /sharedEditorialPolicy/i)
  assert.match(prompt, /referenceImages/i)
  const summaryPrompt = buildSystemPrompt({
    site: 'ai-site',
    auth: { role: 'client', site: 'ai-site', capabilities: [] },
    memory: readSiteMemory('ai-site'),
    operation: 'summary'
  })
  assert.doesNotMatch(summaryPrompt, /Guía StoryScope/i)
})

test('humanize prompt preserves the current content contract', () => {
  const prompt = buildHumanizePrompt({
    title: 'Diseño que acompaña',
    excerpt: 'Una idea breve',
    body: '<p>Texto aprobado</p>',
    instruction: 'Mantén el tono cercano.'
  })
  assert.match(prompt, /Texto aprobado/)
  assert.match(prompt, /Mantén el tono cercano/)
  assert.match(prompt, /No inventes datos/)
})

test('ChatGPT plan requests use non-persistent streaming Responses', async () => {
  const previousFetch = globalThis.fetch
  let request
  const encoder = new TextEncoder()
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body)
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'Hola' })}\n\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'response.completed' })}\n\n`))
        controller.close()
      }
    })
    return { ok: true, status: 200, body }
  }
  try {
    const result = await openAiReply({ system: 'system', message: 'message', model: 'gpt-test', maxOutputTokens: 20, apiKey: 'oauth-token', chatgptPlan: true })
    assert.equal(result, 'Hola')
    assert.equal(request.store, false)
    assert.equal(request.stream, true)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('humanize no se ejecuta dentro del CMS', async () => {
  await assert.rejects(() => runGenerateOperation({
    site: 'ai-site',
    auth: { role: 'client', site: 'ai-site', capabilities: [] },
    operation: 'humanize',
    prompt: '',
    post: { title: 'Un post', bodyHtml: '<p>Contenido aprobado.</p>' },
    provider: 'openai'
  }), (error) => error.status === 403 && error.code === 'CMS_AI_DISABLED')
})

test('social-pack no genera ni registra consumo desde el CMS', async () => {
  await assert.rejects(() => runGenerateOperation({
    site: 'ai-site',
    auth: { role: 'client', site: 'ai-site', capabilities: [] },
    operation: 'social-pack',
    prompt: 'Lanzamiento de una nueva identidad visual',
    post: { title: 'Nueva identidad' },
    model: 'gpt-4.1-mini'
  }), (error) => error.status === 403 && error.code === 'CMS_AI_DISABLED')
})

test('la configuración de canales no reactiva social-pack', async () => {
  saveSiteConfig('ai-site', {
    socialPackChannels: {
      substack: false,
      linkedin: true,
      x: false,
      videoScript: false,
      instagramCarousel: false
    }
  })
  await assert.rejects(() => runGenerateOperation({
    site: 'ai-site',
    auth: { role: 'client', site: 'ai-site', capabilities: [] },
    operation: 'social-pack',
    prompt: 'Una campaña de lanzamiento',
    post: { title: 'Lanzamiento' },
    provider: 'openai'
  }), (error) => error.status === 403 && error.code === 'CMS_AI_DISABLED')
  saveSiteConfig('ai-site', { socialPackChannels: { substack: true, linkedin: true, x: true, videoScript: true, instagramCarousel: true } })
})

const { readDb, writeDb } = await import('./db.mjs')
const { utcMonthKey } = await import('./plans.mjs')
const { recordAiUsage } = await import('./ai-gateway.mjs')

function setAiAccount({ creditsUsed = 0, balance = 0 } = {}) {
  const db = readDb()
  const month = utcMonthKey()
  db.aiUsage = { 'ai-site': { [month]: { inputTokens: 0, outputTokens: 0, totalTokens: 0, creditsUsed } } }
  db.aiCredits = { 'ai-site': { balance } }
  writeDb(db, { mergeAccounting: false })
  return month
}

test('generation metering persists token estimates and consumes purchased credits only after monthly inclusion', () => {
  const month = setAiAccount({ creditsUsed: 99_999, balance: 5_000 })
  const settled = recordAiUsage('ai-site', {
    inputTokens: 10,
    outputTokens: 20,
    creditMultiplier: 1
  })
  assert.equal(settled.creditsUsed, 30)
  const db = readDb()
  assert.deepEqual(db.aiUsage['ai-site'][month], {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    creditsUsed: 100_029
  })
  assert.equal(db.aiCredits['ai-site'].balance, 4_971)
})

test('non-tool generation is rejected by the permanent CMS kill switch first', async () => {
  setAiAccount({ creditsUsed: 100_000, balance: 0 })
  await assert.rejects(
    () => runChat({
      site: 'ai-site',
      auth: { role: 'client', site: 'ai-site', capabilities: [] },
      message: 'No debe llegar al proveedor',
      provider: 'gemini'
    }),
    (error) => error.status === 403 && error.extra?.code === 'CMS_AI_DISABLED'
  )
})
