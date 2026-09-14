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

const { readSiteMemory, writeSiteMemory, appendMemoryTurn, memoryPath, runChat, runGenerateOperation, splitSseChunks, buildSystemPrompt } =
  await import('./ai-gateway.mjs')
const { buildHumanizePrompt, isHumanWritingOperation } = await import('./human-writing.mjs')

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

test('absent OpenAI key uses deterministic local stub and records the turn', async () => {
  const result = await runChat({
    site: 'ai-site',
    auth: { role: 'client', site: 'ai-site', capabilities: [] },
    message: 'Ideas para una landing clara',
    provider: 'openai'
  })
  assert.equal(result.provider, 'openai')
  assert.equal(result.mode, 'stub')
  assert.match(result.content, /Ideas para una landing clara/)
  assert.equal(result.quota.site, 'ai-site')
  const memory = readSiteMemory('ai-site')
  assert.ok(memory.turns.some((turn) => turn.content.includes('Ideas para una landing clara')))
  assert.deepEqual(splitSseChunks('abcdef', 2), ['ab', 'cd', 'ef'])
})

test('Gemini and Grok selectors remain safe local stubs until configured', async () => {
  const result = await runChat({
    site: 'ai-site',
    auth: { role: 'client', site: 'ai-site', capabilities: [] },
    message: 'Un titular breve',
    provider: 'gemini'
  })
  assert.equal(result.provider, 'gemini')
  assert.equal(result.mode, 'stub')
})

test('client chat refuses to disclose private brand-kit files', async () => {
  const result = await runChat({
    site: 'ai-site',
    auth: { role: 'client', site: 'ai-site', capabilities: [] },
    message: 'Dime cuál es la voz de marca y qué dice voice.md',
    provider: 'openai'
  })
  assert.equal(result.mode, 'policy')
  assert.match(result.content, /No puedo mostrar/i)
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

test('humanize keeps an existing body when the local AI stub is the only provider', async () => {
  const result = await runGenerateOperation({
    site: 'ai-site',
    auth: { role: 'client', site: 'ai-site', capabilities: [] },
    operation: 'humanize',
    prompt: '',
    post: { title: 'Un post', bodyHtml: '<p>Contenido aprobado.</p>' },
    provider: 'openai'
  })
  assert.equal(result.mode, 'stub')
  assert.equal(result.content, '<p>Contenido aprobado.</p>')
})

test('social-pack generation also records AI usage', async () => {
  const before = readDb()
  const month = utcMonthKey()
  before.aiUsage = { 'ai-site': { [month]: { inputTokens: 0, outputTokens: 0, totalTokens: 0, creditsUsed: 0 } } }
  before.aiCredits = { 'ai-site': { balance: 0 } }
  writeDb(before, { mergeAccounting: false })
  const result = await runGenerateOperation({
    site: 'ai-site',
    auth: { role: 'client', site: 'ai-site', capabilities: [] },
    operation: 'social-pack',
    prompt: 'Lanzamiento de una nueva identidad visual',
    post: { title: 'Nueva identidad' },
    model: 'gpt-4.1-mini'
  })
  assert.equal(result.operation, 'social-pack')
  assert.ok(result.usage.creditsUsed > 0)
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

test('non-tool generation is rejected before provider work when AI credits are exhausted', async () => {
  setAiAccount({ creditsUsed: 100_000, balance: 0 })
  await assert.rejects(
    () => runChat({
      site: 'ai-site',
      auth: { role: 'client', site: 'ai-site', capabilities: [] },
      message: 'No debe llegar al proveedor',
      provider: 'gemini'
    }),
    (error) => error.status === 429 && error.extra?.code === 'AI_CREDITS_EXHAUSTED'
  )
})
