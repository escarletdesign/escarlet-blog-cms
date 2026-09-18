import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDb } from './db.mjs'
import { prepareImageGeneration } from './brand-kit.mjs'

const root = join(fileURLToPath(new URL('..', import.meta.url)))
const visualRoot = join(root, 'content-system', 'brand')
const siteBrandRoot = join(root, 'data', 'brand')

function readJsonFile(file, fallback = {}) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback
  } catch {
    return fallback
  }
}

function readJson(name, fallback = {}) {
  return readJsonFile(join(visualRoot, name), fallback)
}

function readSiteJson(site, suffix, fallback = {}) {
  const handle = String(site || '').toLowerCase()
  const siteFile = join(siteBrandRoot, handle, `${suffix}.json`)
  if (existsSync(siteFile)) return readJsonFile(siteFile, fallback)
  return readJson(`${handle}-${suffix}.json`, fallback)
}

export function loadVisualSystem(site = 'escarlet') {
  const requested = String(site || 'escarlet').toLowerCase()
  const empty = { id: requested, version: '0.0.0', identity: { name: requested }, fixed: { imageRules: [] } }
  const hasSiteBrand = Boolean(
    existsSync(join(siteBrandRoot, requested, 'brand-core.json')) ||
      existsSync(join(visualRoot, `${requested}-brand-core.json`))
  )
  const fallbackAllowed = requested === 'escarlet'
  const brand = hasSiteBrand ? readSiteJson(requested, 'brand-core', empty) : fallbackAllowed ? readJson('escarlet-brand-core.json', empty) : empty
  const visualFallback = fallbackAllowed ? readJson('escarlet-visual-system.json', {}) : {}
  const archetypeFallback = fallbackAllowed ? readJson('escarlet-image-archetypes.json', {}) : {}
  const referenceFallback = fallbackAllowed ? readJson('escarlet-reference-library.json', {}) : {}
  const templateFallback = fallbackAllowed ? readJson('escarlet-social-templates.json', {}) : {}
  return {
    brand,
    visual: readSiteJson(requested, 'visual-system', visualFallback),
    archetypes: readSiteJson(requested, 'image-archetypes', archetypeFallback).archetypes || [],
    references: readSiteJson(requested, 'reference-library', referenceFallback).references || [],
    socialTemplates: readSiteJson(requested, 'social-templates', templateFallback).templates || []
  }
}

function tokens(value) {
  return new Set(
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 3)
  )
}

function similarity(a, b) {
  const left = tokens(a)
  const right = tokens(b)
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return shared / Math.max(left.size, right.size)
}

export function recentVisualHistory(site = 'escarlet', { limit = 6, db = readDb() } = {}) {
  return (db.posts || [])
    .filter((post) => post.site === site && ['published', 'scheduled', 'draft'].includes(post.status))
    .sort((a, b) => String(b.dateModified || b.datePublished || '').localeCompare(String(a.dateModified || a.datePublished || '')))
    .slice(0, limit)
    .map((post) => ({
      slug: post.slug,
      title: post.title || '',
      status: post.status,
      archetype: post.visualBrief?.archetype || post.imageMetadata?.archetype || '',
      imageUrl: post.imageUrl || '',
      imageFilename: String(post.imageUrl || '').split('/').pop() || '',
      visualBrief: post.visualBrief || null
    }))
}

function scoreArchetype(archetype, topic, history) {
  const topicTokens = tokens(topic)
  const topicMatch = (archetype.topics || []).reduce((score, item) => score + (topicTokens.has(String(item).toLowerCase()) ? 2 : 0), 0)
  const recentIds = history.map((item) => item.archetype).filter(Boolean)
  const repeatedPenalty = recentIds[0] === archetype.id ? 100 : recentIds.includes(archetype.id) ? 18 : 0
  const riskPenalty = archetype.repetitionRisk === 'alto' && recentIds.includes(archetype.id) ? 8 : 0
  const tensionBonus = /\b(problema|paradoja|tension|friccion|ventaja|riesgo|cambio)\b/i.test(String(topic || '')) && archetype.id === 'metafora-visual-conceptual' ? 8 : 0
  return topicMatch * 5 + tensionBonus - repeatedPenalty - riskPenalty + (archetype.abstraction || 0)
}

export function chooseArchetype({ site = 'escarlet', topic = '', history = recentVisualHistory(site), preferredId = '' } = {}) {
  const { archetypes } = loadVisualSystem(site)
  if (!archetypes.length) throw new Error(`No hay arquetipos configurados para ${site}.`)
  if (preferredId && archetypes.some((item) => item.id === preferredId)) return archetypes.find((item) => item.id === preferredId)
  return [...archetypes].sort((a, b) => scoreArchetype(b, topic, history) - scoreArchetype(a, topic, history))[0]
}

export function selectReferences({ site = 'escarlet', archetype, mode = 'automatic', topic = '' } = {}) {
  const { references } = loadVisualSystem(site)
  if (String(site).toLowerCase() === 'escarlet') {
    return prepareImageGeneration(site, { assetType: 'blog_cover', topic }).resolvedReferences.map((reference) => {
      const detail = references.find((item) => item.id === reference.id) || {}
      return { ...detail, ...reference, description: detail.description || reference.role }
    })
  }
  const limit = mode === 'exploration' ? 3 : 2
  const relevant = references
    .filter((reference) => reference.approved !== false)
    .map((reference) => ({
      reference,
      score: (reference.recommendedUse || []).includes(archetype?.id) ? 5 : 0,
      topicScore: (reference.tags || []).some((tag) => tokens(topic).has(String(tag).toLowerCase())) ? 2 : 0
    }))
    .sort((a, b) => b.score + b.topicScore - (a.score + a.topicScore))
    .slice(0, limit)
    .map(({ reference }) => reference)
  return relevant
}

export function buildCoverBrief({ site = 'escarlet', title = '', summary = '', topic = '', mode = 'automatic', history = recentVisualHistory(site), preferredArchetype = '' } = {}) {
  const system = loadVisualSystem(site)
  const subject = [title, summary, topic].filter(Boolean).join('. ')
  const archetype = chooseArchetype({ site, topic: subject, history, preferredId: preferredArchetype })
  const deterministicPreparation = String(site).toLowerCase() === 'escarlet'
    ? prepareImageGeneration(site, { assetType: 'blog_cover', title, summary, topic })
    : null
  const references = deterministicPreparation
    ? deterministicPreparation.resolvedReferences.map((reference) => {
        const detail = system.references.find((item) => item.id === reference.id) || {}
        return { ...detail, ...reference, description: detail.description || reference.role }
      })
    : selectReferences({ site, archetype, mode, topic: subject })
  const recentTitles = history.map((item) => item.title).filter(Boolean)
  const negativeRules = [
    'no usar texto incrustado',
    'no repetir el arquetipo de la última portada',
    recentTitles.length ? `evitar composiciones parecidas a: ${recentTitles.slice(0, 3).join(' · ')}` : 'evitar portátil, taza y persona sentada como fórmula'
  ]
  const brief = {
    version: system.brand?.version || system.visual?.version || '1.0.0',
    site,
    mode: deterministicPreparation ? 'automatic' : mode,
    topic: subject,
    emotionalIntent: title.toLowerCase().includes('problema') ? 'hacer visible una tensión incómoda sin dramatismo' : 'despertar curiosidad y criterio',
    archetype: archetype.id,
    archetypeDetail: archetype,
    composition: {
      framing: archetype.id === 'entorno-espacio' ? 'plano medio con profundidad' : 'encuadre único con espacio negativo lateral',
      subjectPlacement: 'fuera del centro geométrico',
      aspectRatio: system.visual.cover.aspectRatio,
      abstraction: archetype.abstraction,
      personPresence: archetype.id === 'escena-humana-parcial' ? 'parcial, sin rostro protagonista' : 'no necesaria'
    },
    references: references.map((reference) => reference.id),
    referenceDetails: references,
    negativeRules,
    decision: {
      reason: `Se eligió ${archetype.name} por su ajuste al tema y para evitar repetir ${history[0]?.archetype || 'la fórmula visual reciente'}.`,
      recentPostsInspected: history.map((item) => item.slug),
      similarityToRecent: history.map((item) => ({ slug: item.slug, score: similarity(subject, item.title) }))
    }
  }
  return brief
}

export function buildCoverPrompt(brief, { brand = loadVisualSystem(brief.site).brand } = {}) {
  const detail = brief.archetypeDetail || {}
  const references = (brief.referenceDetails || []).map((reference) => `${reference.id}: ${reference.description}`).join('; ')
  return [
    `Sitio: ${brief.site}. Tema: ${brief.topic}.`,
    `Intención emocional: ${brief.emotionalIntent}.`,
    `Arquetipo visual: ${detail.name || brief.archetype}. ${detail.description || ''}`,
    `Composición: ${JSON.stringify(brief.composition)}.`,
    `Señales visuales: ${(detail.signals || []).join(', ')}.`,
    `Referencias aprobadas: ${references || 'ninguna disponible'}.`,
    `Reglas de marca: ${(brand.fixed?.imageRules || []).join(' ')}`,
    `No repetir: ${brief.negativeRules.join('; ')}.`,
    'Genera una imagen editorial cálida, táctil y contemporánea. No incluyas texto, letras, números, logos, marcas de agua, UI legible ni tipografía.'
  ].join('\n')
}

export function chooseSocialTemplate({ site = 'escarlet', preferredId = '', index = 0 } = {}) {
  const { socialTemplates } = loadVisualSystem(site)
  if (preferredId && socialTemplates.some((template) => template.id === preferredId)) return socialTemplates.find((template) => template.id === preferredId)
  return socialTemplates[index % Math.max(1, socialTemplates.length)] || null
}

export { similarity }
