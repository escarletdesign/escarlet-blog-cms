import { Server } from '@modelcontextprotocol/server'
import {
  BUILTIN_RESOURCES,
  MCP_V3_CONTRACT,
  MCP_V3_SERVER_NAME,
  MCP_V3_SERVER_VERSION,
  brandKernelResource,
  loadOsRegistry,
  mergeCatalog,
  publicCapabilityManifest,
  publicToolManifest
} from './catalog.mjs'
import { authPermissions, invokeBuiltinCapability } from './handlers.mjs'
import { validateInput, validateOutput } from './schema-validation.mjs'

const LEGACY_NAME = /^(?:blog|social|content|video|brand)_/
const MAX_TEXT_RESULT_BYTES = 32 * 1024

function textProjection(value) {
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_TEXT_RESULT_BYTES) return serialized
  const summary = { truncated: true, bytes: Buffer.byteLength(serialized, 'utf8') }
  for (const key of ['contractVersion', 'capability', 'operation', 'state', 'status', 'publicationId', 'runId', 'batchId']) {
    if (value && value[key] !== undefined) summary[key] = value[key]
  }
  for (const [key, entry] of Object.entries(value || {})) {
    if (Array.isArray(entry)) summary[`${key}Count`] = entry.length
  }
  summary.hint = 'La respuesta completa está en structuredContent.'
  return JSON.stringify(summary)
}

function jsonResult(value) {
  return {
    isError: false,
    structuredContent: value,
    content: [{ type: 'text', text: textProjection(value) }]
  }
}

function errorResult(error, fallbackCode = 'capability_failed') {
  const code = error?.code || fallbackCode
  const status = Number.isInteger(error?.status) ? error.status : 500
  const retryable = error?.retryable === true || (error?.retryable === undefined && status >= 500)
  const action = String(error?.action || (status === 404 ? 'check_capability_id' : status === 403 ? 'request_permission' : retryable ? 'retry_after_fix' : 'inspect_error')).trim()
  const value = { error: { code, status, retryable, action, message: String(error?.message || 'La capability no está disponible.'), ...(error?.details ? { details: error.details } : {}) } }
  return { isError: true, structuredContent: value, content: [{ type: 'text', text: textProjection(value) }] }
}

function findCapability(catalog, name) {
  return catalog.capabilities.find((entry) => entry.id === name) || null
}

function findRecipe(catalog, recipeId) {
  const requested = String(recipeId || '').trim().replace(/^recipe\./, '')
  return catalog.recipes.find((entry) => String(entry.id).replace(/^recipe\./, '') === requested) || null
}

function canUseCapability(auth, capability) {
  const granted = new Set(authPermissions(auth))
  return (capability?.permissions || []).every((permission) => granted.has(permission) || granted.has('*'))
}

function visibleCapabilities(catalog, auth) {
  return catalog.capabilities.filter((entry) => canUseCapability(auth, entry))
}

const SEARCH_STOP_WORDS = new Set(['a', 'al', 'con', 'de', 'del', 'el', 'en', 'la', 'las', 'los', 'para', 'por', 'un', 'una', 'y'])
const SEARCH_ALIASES = Object.freeze({
  generacion: ['generate', 'generation', 'creative'],
  generar: ['generate', 'generation', 'creative'],
  contenido: ['content', 'copy', 'creative'],
  imagen: ['image', 'visual', 'asset'],
  imagenes: ['image', 'visual', 'asset'],
  video: ['video', 'motion', 'reel'],
  videos: ['video', 'motion', 'reel'],
  reel: ['reel', 'video', 'motion'],
  publicacion: ['publication', 'publish', 'publisher'],
  publicar: ['publication', 'publish', 'publisher'],
  publicación: ['publication', 'publish', 'publisher']
})

function searchNormalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function searchTerms(value) {
  return searchNormalize(value).split(/[^a-z0-9]+/).filter((token) => token && !SEARCH_STOP_WORDS.has(token))
}

function searchableText(entry) {
  return searchNormalize([
    entry.id,
    entry.title,
    entry.description,
    ...(entry.tags || []),
    ...(entry.aliases || []),
    ...(entry.useCases || []),
    ...(entry.composesWith || []),
    ...Object.keys(entry.inputSchema?.properties || {}),
    ...Object.keys(entry.outputSchema?.properties || {})
  ].join(' '))
}

function searchMatches(entry, query) {
  const haystack = searchableText(entry)
  const terms = searchTerms(query)
  if (!terms.length) return true
  return terms.some((term) => [term, ...(SEARCH_ALIASES[term] || [])].some((candidate) => haystack.includes(candidate)))
}

function validateCapabilityResult(catalog, name, result) {
  const capability = findCapability(catalog, name)
  const schemaErrors = validateOutput(result, capability?.outputSchema)
  if (!schemaErrors.length) return result
  const error = new Error(`La respuesta de ${name} no cumple su outputSchema.`)
  error.code = 'capability_output_invalid'
  error.status = 500
  error.retryable = false
  error.action = 'inspect_capability_contract'
  error.details = { fields: schemaErrors }
  throw error
}

function searchCapabilities(catalog, auth, args = {}) {
  const query = String(args.query || '').trim().toLowerCase()
  const queryTokens = query.split(/\s+/).filter(Boolean)
  const tag = String(args.tag || '').trim().toLowerCase()
  const type = args.type ? String(args.type) : ''
  const candidates = [...visibleCapabilities(catalog, auth), ...catalog.recipes.filter((entry) => canUseCapability(auth, entry))]
  const capabilities = candidates.filter((entry) => {
    if (type && entry.type !== type) return false
    if (tag && !(entry.tags || []).some((value) => String(value).toLowerCase() === tag)) return false
    if (!query) return true
    return searchMatches(entry, query)
  }).map((entry) => {
    const publicEntry = publicCapabilityManifest(entry)
    if (args.includeSchemas === true) return publicEntry
    const { inputSchema, outputSchema, ...summary } = publicEntry
    return { ...summary, inputKeys: Object.keys(inputSchema?.properties || {}), outputKeys: Object.keys(outputSchema?.properties || {}) }
  })
  return { contractVersion: MCP_V3_CONTRACT, capabilities }
}

function listRecipes(catalog, auth, args = {}) {
  const query = String(args.query || '').trim().toLowerCase()
  const tag = String(args.tag || '').trim().toLowerCase()
  const recipes = catalog.recipes
    .filter((entry) => canUseCapability(auth, entry))
    .filter((entry) => !tag || (entry.tags || []).some((value) => String(value).toLowerCase() === tag))
    .filter((entry) => !query || searchMatches(entry, query))
    .map((entry) => {
      const publicEntry = publicCapabilityManifest(entry)
      const { inputSchema, outputSchema, ...summary } = publicEntry
      return { ...summary, inputKeys: Object.keys(inputSchema?.properties || {}), outputKeys: Object.keys(outputSchema?.properties || {}) }
    })
  return { contractVersion: MCP_V3_CONTRACT, recipes }
}

const WORKFLOW_CHANNEL_OPTIONS = Object.freeze([
  { id: 'instagram_reel', label: 'Instagram Reel', description: 'Video vertical 9:16.' },
  { id: 'instagram_story', label: 'Instagram Story', description: 'Video vertical 9:16 para Stories.' },
  { id: 'youtube_landscape', label: 'YouTube horizontal', description: 'Video horizontal 16:9.' },
  { id: 'instagram_post', label: 'Instagram post', description: 'Imagen o carrusel para el feed.' },
  { id: 'linkedin_post', label: 'LinkedIn', description: 'Publicación editorial para LinkedIn.' },
  { id: 'wordpress_post', label: 'Blog WordPress', description: 'Entrada para el blog.' }
])

function workflowError(message, code = 'workflow_invalid', details = {}) {
  const error = new Error(message)
  error.code = code
  error.status = 422
  error.retryable = false
  error.details = details
  return error
}

function visibleRecipeOptions(catalog, auth) {
  return catalog.recipes
    .filter((entry) => canUseCapability(auth, entry))
    .map((entry) => ({
      id: entry.id,
      label: entry.title || entry.id,
      description: entry.description,
      next: 'format'
    }))
}

function contentWorkflow(catalog, auth) {
  return {
    id: 'content.create',
    title: 'Crear contenido',
    description: 'Elige una recipe, formato, asset y brief. El flujo prepara una ejecución para revisión, pero no genera ni publica por sí solo.',
    entryStep: 'mode',
    freeMode: true,
    steps: [
      {
        id: 'mode',
        question: '¿Querés trabajar con un flujo guiado o usar las herramientas libremente?',
        type: 'single_select',
        responseKey: 'mode',
        required: true,
        options: [
          { id: 'guided', label: 'Flujo guiado', description: 'Te muestro selectores y valido cada paso.', next: 'recipe' },
          { id: 'free', label: 'Modo libre', description: 'ChatGPT decide qué capabilities usar dentro del Brand Kit.', next: 'free_goal' }
        ]
      },
      {
        id: 'recipe',
        question: '¿Qué querés crear?',
        type: 'single_select',
        responseKey: 'recipe',
        required: true,
        options: visibleRecipeOptions(catalog, auth),
        next: 'format'
      },
      {
        id: 'format',
        question: '¿En qué canal o formato lo necesitás?',
        type: 'single_select',
        responseKey: 'formatProfile',
        required: true,
        options: WORKFLOW_CHANNEL_OPTIONS,
        next: 'asset'
      },
      {
        id: 'asset',
        question: 'Seleccioná o subí el asset principal.',
        type: 'asset',
        responseKey: 'asset',
        required: true,
        help: 'Respondé con un assetId o con una referencia de asset autorizada.',
        next: 'brief'
      },
      {
        id: 'brief',
        question: '¿Qué querés comunicar y para quién?',
        type: 'textarea',
        responseKey: 'brief',
        required: true,
        placeholder: 'Tema, mensaje, audiencia, tono y CTA opcional.',
        next: 'review'
      },
      {
        id: 'free_goal',
        question: 'Contame el resultado que querés y qué libertad creativa necesitás.',
        type: 'textarea',
        responseKey: 'goal',
        required: true,
        placeholder: 'Por ejemplo: crear un Reel de 15 segundos con movimiento editorial y el logo SVG.',
        next: null
      },
      {
        id: 'review',
        question: '¿Confirmás esta preparación para que ChatGPT ejecute la recipe y la deje para revisión?',
        type: 'confirm',
        responseKey: 'confirm',
        required: true,
        next: null
      }
    ]
  }
}

function publicationWorkflow() {
  return {
    id: 'publication.prepare',
    title: 'Preparar publicación',
    description: 'Elige canal, asset y copy para preparar un bundle. La publicación externa siempre requiere aprobación.',
    entryStep: 'mode',
    freeMode: true,
    steps: [
      {
        id: 'mode',
        question: '¿Querés una preparación guiada o trabajar libremente?',
        type: 'single_select',
        responseKey: 'mode',
        required: true,
        options: [
          { id: 'guided', label: 'Flujo guiado', next: 'channel' },
          { id: 'free', label: 'Modo libre', next: 'free_goal' }
        ]
      },
      {
        id: 'channel',
        question: '¿Dónde querés publicar?',
        type: 'single_select',
        responseKey: 'channel',
        required: true,
        options: WORKFLOW_CHANNEL_OPTIONS,
        next: 'asset'
      },
      {
        id: 'asset',
        question: '¿Qué asset querés preparar?',
        type: 'asset',
        responseKey: 'asset',
        required: true,
        next: 'copy'
      },
      {
        id: 'copy',
        question: '¿Qué copy debe acompañar el asset?',
        type: 'textarea',
        responseKey: 'copy',
        required: true,
        next: 'review'
      },
      {
        id: 'free_goal',
        question: 'Describí la publicación que querés preparar.',
        type: 'textarea',
        responseKey: 'goal',
        required: true,
        next: null
      },
      {
        id: 'review',
        question: '¿Confirmás que prepare el bundle para revisión humana?',
        type: 'confirm',
        responseKey: 'confirm',
        required: true,
        next: null
      }
    ]
  }
}

function workflowDefinitions(catalog, auth) {
  return [contentWorkflow(catalog, auth), publicationWorkflow()]
}

function findWorkflow(catalog, auth, workflowId) {
  return workflowDefinitions(catalog, auth).find((entry) => entry.id === String(workflowId || '').trim()) || null
}

function workflowStep(workflow, stepId) {
  return workflow.steps.find((step) => step.id === stepId) || null
}

function normalizeWorkflowAnswer(step, value) {
  if (value === undefined || value === null || value === '') {
    if (step.required) throw workflowError(`El paso ${step.id} requiere una respuesta.`, 'workflow_answer_required', { stepId: step.id })
    return value
  }
  if (step.type === 'single_select') {
    if (typeof value !== 'string') throw workflowError(`El paso ${step.id} espera una opción única.`, 'workflow_option_invalid', { stepId: step.id })
    const option = (step.options || []).find((candidate) => candidate.id === value && candidate.disabled !== true)
    if (!option) throw workflowError(`La opción ${value} no es válida para ${step.id}.`, 'workflow_option_invalid', { stepId: step.id, allowed: (step.options || []).map((candidate) => candidate.id) })
    return value
  }
  if (step.type === 'multi_select') {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw workflowError(`El paso ${step.id} espera varias opciones.`, 'workflow_option_invalid', { stepId: step.id })
    const allowed = new Set((step.options || []).filter((candidate) => candidate.disabled !== true).map((candidate) => candidate.id))
    if (value.some((entry) => !allowed.has(entry))) throw workflowError(`Hay opciones no válidas en ${step.id}.`, 'workflow_option_invalid', { stepId: step.id })
    return [...new Set(value)]
  }
  if (step.type === 'confirm') {
    if (typeof value !== 'boolean') throw workflowError(`El paso ${step.id} espera una confirmación.`, 'workflow_confirmation_invalid', { stepId: step.id })
    return value
  }
  if (step.type === 'asset') {
    if (typeof value === 'string' && value.trim()) return { assetId: value.trim() }
    if (typeof value === 'object' && String(value.assetId || '').trim()) return { assetId: String(value.assetId).trim(), ...(value.sha256 ? { sha256: String(value.sha256) } : {}) }
    throw workflowError(`El paso ${step.id} necesita un assetId autorizado.`, 'workflow_asset_invalid', { stepId: step.id })
  }
  if (typeof value !== 'string' || !value.trim()) throw workflowError(`El paso ${step.id} necesita texto.`, 'workflow_text_required', { stepId: step.id })
  return value.trim()
}

function workflowPrompt(workflow, step, answers, mode = 'guided') {
  return {
    contractVersion: MCP_V3_CONTRACT,
    workflowId: workflow.id,
    mode,
    stepId: step?.id || null,
    complete: false,
    question: step?.question || null,
    type: step?.type || null,
    responseKey: step?.responseKey || null,
    options: step?.options || [],
    answers,
    execution: null,
    review: { required: true, status: 'pending', message: 'La ejecución y la publicación requieren confirmación humana.' }
  }
}

function nextWorkflowStep(workflow, step, value) {
  if (step.id === 'mode') return value === 'free' ? 'free_goal' : step.options.find((option) => option.id === value)?.next || 'recipe'
  return step.next || null
}

function workflowNext(catalog, auth, args = {}) {
  const workflow = findWorkflow(catalog, auth, args.workflowId)
  if (!workflow) throw workflowError(`Flujo desconocido: ${args.workflowId || ''}`, 'workflow_not_found', { workflowId: args.workflowId })
  const suppliedAnswers = args.answers && typeof args.answers === 'object' && !Array.isArray(args.answers) ? { ...args.answers } : {}
  const stepId = String(args.stepId || workflow.entryStep)
  const step = workflowStep(workflow, stepId)
  if (!step) throw workflowError(`Paso desconocido: ${stepId}`, 'workflow_step_not_found', { workflowId: workflow.id, stepId })
  const hasAnswer = args.answer !== undefined || Object.prototype.hasOwnProperty.call(suppliedAnswers, step.responseKey)
  if (!hasAnswer) return workflowPrompt(workflow, step, suppliedAnswers)
  const rawValue = args.answer !== undefined ? args.answer : suppliedAnswers[step.responseKey]
  const value = normalizeWorkflowAnswer(step, rawValue)
  const answers = { ...suppliedAnswers, [step.responseKey]: value }
  const mode = answers.mode === 'free' ? 'free' : 'guided'
  if (mode === 'free' && step.id === 'free_goal') {
    return {
      ...workflowPrompt(workflow, null, answers, 'free'),
      complete: true,
      execution: {
        mode: 'free',
        goal: value,
        suggestedTools: ['capability.search', 'capability.get', 'recipe.get', 'production.motion.plan', 'recipe.run'],
        instruction: 'Usá las capabilities autorizadas que mejor resuelvan el objetivo, manteniendo el Brand Kit y la revisión humana.'
      },
      review: { required: true, status: 'pending', message: 'El modo libre deja la selección de tools en manos de ChatGPT y no ejecuta nada automáticamente.' }
    }
  }
  if (step.id === 'review') {
    if (value !== true) return { ...workflowPrompt(workflow, step, answers, mode), review: { required: true, status: 'needs_changes', message: 'Podés cambiar las respuestas y volver a confirmar.' } }
    if (workflow.id === 'content.create') {
      const asset = answers.asset?.assetId
      return {
        ...workflowPrompt(workflow, null, answers, 'guided'),
        complete: true,
        execution: { tool: 'recipe.run', arguments: { recipeId: answers.recipe, formatProfile: answers.formatProfile, channel: answers.formatProfile, sourceMediaId: asset, text: answers.brief } },
        review: { required: true, status: 'pending', message: 'La recipe se puede ejecutar y quedará para revisión humana. No se publica automáticamente.' }
      }
    }
    return {
      ...workflowPrompt(workflow, null, answers, 'guided'),
      complete: true,
      execution: { tool: 'publication.destination.list', arguments: { formatProfile: answers.channel } },
      review: { required: true, status: 'pending', message: 'Primero se consultan destinos compatibles. La publicación requiere aprobación explícita.' }
    }
  }
  const nextId = nextWorkflowStep(workflow, step, value)
  const next = nextId ? workflowStep(workflow, nextId) : null
  return workflowPrompt(workflow, next, answers, mode)
}

function listWorkflows(catalog, auth, args = {}) {
  const query = searchNormalize(args.query || '')
  const workflows = workflowDefinitions(catalog, auth).filter((workflow) => !query || searchNormalize(`${workflow.id} ${workflow.title} ${workflow.description}`).includes(query)).map((workflow) => ({
    ...workflow,
    steps: workflow.steps.map((step) => ({ ...step, options: step.options || [] }))
  }))
  return { contractVersion: MCP_V3_CONTRACT, workflows }
}

function agentGuide(catalog, auth, args = {}) {
  const goal = String(args.goal || '').trim()
  const recipes = catalog.recipes
    .filter((entry) => canUseCapability(auth, entry))
    .map((entry) => ({ id: entry.id, description: entry.description, inputKeys: Object.keys(entry.inputSchema?.properties || {}), reviewRequired: entry.humanReviewRequired === true }))
  return {
    contractVersion: MCP_V3_CONTRACT,
    goal: goal || null,
    firstSteps: [
      'Si querés una interacción guiada, llama workflow.list y luego workflow.next. Sus respuestas incluyen question, type, options y responseKey para que puedas mostrar selectores, campos o confirmaciones. También podés elegir mode=free y continuar con discovery.',
      'Llama capability.search o recipe.list para encontrar una capability autorizada. Si es tu primera vez, usa capability.get o recipe.get antes de ejecutar.',
      'Fija site o brandId y llama brand.context.get para trabajar con el Brand Kit versionado correcto.',
      'Para una imagen de Instagram, llama brand.generation.prepare con assetType=social_image y usa el modelo de imágenes del host para crear cada slide final con el generationPrompt y las referencias resueltas. Esta capability solo prepara, no genera píxeles.',
      'Después de generar cada PNG final, llama asset.upload con preparationId, contentBase64 o file, assetIndex y el copy exacto. No cierres el trabajo hasta recibir assetId, url y status ready_for_review.',
      'Para un Reel, Story o video horizontal de YouTube, llama brand.visual_style.get para consultar motionAssets. Genera o selecciona las imágenes limpias, fondos, audio, logo SVG y copy en ChatGPT; sube cualquier archivo nuevo mediante asset.upload y luego entrega al motor motion los assetId con sus roles. Elige formatProfile=instagram_reel, instagram_story o youtube_landscape. Antes de renderizar, usa production.motion.plan para validar un storyboard. Cada escena puede declarar layers independientes de fondo, foreground, logo, headline, body, caption, icon o shape, con animaciones y keyframes acotados. Usa production.motion.compose con ese storyboard, y el motor ajusta el wrapping y elimina guiones tipográficos no permitidos. Usa transition para elegir crossfade, fade, wipe o slide sin enviar filtros ni código FFmpeg. Consulta production.motion.status.get para el render, y usa production.motion.retry o production.motion.cancel solo como acciones explícitas.',
      'Entrega referencias de artefactos con assetId y, cuando exista, sha256. No envíes blobs ni credenciales entre capabilities.',
      'Ejecuta una recipe solo con los inputs que indique su manifest. El resultado queda ready_for_review y no se publica automáticamente.',
      'Para publicar, usa publication.destination.list, publication.prepare y después espera aprobación humana antes de schedule o publish.'
    ],
    rules: [
      'Las capabilities usan nombres namespaced y los IDs de recipes usan el prefijo recipe.',
      'Los workflows solo guían y validan respuestas. No generes ni publiques hasta que el flujo devuelva execution y la persona confirme. El modo libre conserva discovery y revisión humana.',
      'Una respuesta con status blocked, awaiting_provider o failed requiere una acción explícita, no un reintento ciego.',
      'El motor motion es creativo pero acotado: el agente puede diseñar la secuencia, el ritmo, las animaciones de copy y las transiciones declarativas. Nunca envíes HTML, SVG generado, URLs externas, filtros FFmpeg ni blobs como instrucciones de render.',
      'Escarlet no compone imágenes sociales finales. No uses SVG, HTML, CSS, plantillas locales ni content-system/instagram-renderer para sustituir la generación de imágenes de ChatGPT. El motor motion sí puede animar los assets que ChatGPT entrega en production.motion.compose. Si falta el proveedor de vídeo, conserva awaiting_provider.',
      'Cada slide social debe ser una imagen final de 1080x1350 con el headline y body aprobados integrados, textRendered=true, templateId y renderedBy=chatgpt-image-generation.',
      'La subida final pasa por asset.upload. Nunca afirmes que una imagen fue guardada usando solo brand.generation.prepare; necesitas assetId y url del resultado.',
      'La publicación es una frontera separada: ninguna capability creativa recibe credenciales de proveedores.'
    ],
    examples: [
      {
        intent: 'Crear un Reel de un plato',
        discover: { tool: 'recipe.list', arguments: { query: 'food reel' } },
        inspect: { tool: 'recipe.get', arguments: { recipeId: 'recipe.food-to-reel' } },
        execute: {
          tool: 'recipe.run',
          arguments: {
            recipeId: 'recipe.food-to-reel',
            site: '<site>',
            sourceMediaId: '<assetId>',
            renderMode: 'layered_motion',
            motionPreset: 'dynamic_editorial',
            transition: { type: 'crossfade', durationMs: 400 },
            motionAssets: [
              { assetId: '<assetId>', role: 'source', kind: 'image' },
              { assetId: '<backgroundAssetId>', role: 'background', kind: 'image' },
              { assetId: '<logoSvgAssetId>', role: 'logo', kind: 'image', mimeType: 'image/svg+xml' }
            ],
            scenes: [{ sceneId: 'intro', assetId: '<assetId>', durationMs: 4000, headline: '<titular>', body: '<texto aprobado>', textAnimation: 'fade_up' }],
            copyBlocks: [{ sceneId: 'intro', headline: '<titular>', body: '<texto aprobado>' }],
            text: '<descripción del plato>',
            formatProfile: 'instagram_reel'
          }
        }
      },
      { intent: 'Convertir el menú del día en Story', discover: { tool: 'recipe.list', arguments: { query: 'menu' } }, inspect: { tool: 'recipe.get', arguments: { recipeId: 'recipe.menu-to-reel' } }, execute: { tool: 'recipe.run', arguments: { recipeId: 'recipe.menu-to-reel', site: '<site>', sourceMediaId: '<assetId>', text: '<texto del menú>', formatProfile: 'instagram_story', channel: 'instagram_story' } } },
      { intent: 'Crear un carrusel de Instagram', discover: { tool: 'capability.search', arguments: { query: 'social image', type: 'primitive' } }, inspect: { tool: 'capability.get', arguments: { capabilityId: 'brand.generation.prepare' } }, execute: { tool: 'brand.generation.prepare', arguments: { site: '<site>', purpose: 'instagram-carousel', assetType: 'social_image', formatProfile: 'instagram_post', expectedAssetCount: 6, channel: 'instagram', topic: '<tema del carrusel>' } }, afterPrepare: 'Para cada slide, usa el modelo de imágenes de ChatGPT con las referencias y generationPrompt devueltos, integra el copy aprobado y llama asset.upload con el mismo preparationId y assetIndex 0..5. No uses un renderer del CMS y no cierres el flujo hasta tener seis assetId con url.', },
      { intent: goal || 'Preparar una publicación', discover: { tool: 'capability.search', arguments: { query: 'publication' } }, inspect: { tool: 'capability.get', arguments: { capabilityId: 'publication.destination.list' } } }
    ],
    recipes
  }
}

async function invokeRegisteredCapability(catalog, capability, name, args, auth, runtime) {
  if (typeof catalog.invoke === 'function') return catalog.invoke(name, args, { auth, capability, runtime, contractVersion: MCP_V3_CONTRACT })
  if (typeof capability?.handler === 'function') return capability.handler(args, { auth, capability, contractVersion: MCP_V3_CONTRACT })
  if (typeof capability?.execute === 'function') return capability.execute(args, { auth, capability, contractVersion: MCP_V3_CONTRACT })
  const builtin = await invokeBuiltinCapability(name, args, { auth, capability, runtime, contractVersion: MCP_V3_CONTRACT })
  if (builtin !== undefined) return builtin
  const error = new Error(`La capability ${name} está catalogada pero todavía necesita un ejecutor registrado.`)
  error.code = 'capability_executor_missing'
  error.status = 501
  error.retryable = false
  throw error
}

async function callCapability(catalog, auth, name, args, runtime) {
  if (name === 'capability.guide') return validateCapabilityResult(catalog, name, agentGuide(catalog, auth, args))
  if (name === 'capability.search') return validateCapabilityResult(catalog, name, searchCapabilities(catalog, auth, args))
  if (name === 'workflow.list') return validateCapabilityResult(catalog, name, listWorkflows(catalog, auth, args))
  if (name === 'workflow.get') {
    const workflow = findWorkflow(catalog, auth, args?.workflowId)
    if (!workflow) throw workflowError(`Flujo desconocido: ${args?.workflowId || ''}`, 'workflow_not_found', { workflowId: args?.workflowId })
    return validateCapabilityResult(catalog, name, { contractVersion: MCP_V3_CONTRACT, workflow })
  }
  if (name === 'workflow.next') return validateCapabilityResult(catalog, name, workflowNext(catalog, auth, args))
  if (name === 'capability.get') {
    const capability = findCapability(catalog, args?.capabilityId || args?.id)
    if (!capability || (args?.version && String(capability.version) !== String(args.version))) {
      const error = new Error(`Capability desconocida: ${args?.capabilityId || args?.id || ''}`)
      error.code = 'capability_not_found'
      error.status = 404
      throw error
    }
    if (!canUseCapability(auth, capability)) {
      const error = new Error(`El token no tiene permisos para ${args?.capabilityId || args?.id || ''}.`)
      error.code = 'capability_permission_missing'
      error.status = 403
      throw error
    }
    return validateCapabilityResult(catalog, name, { contractVersion: MCP_V3_CONTRACT, capability: publicCapabilityManifest(capability) })
  }
  if (name === 'recipe.list') return validateCapabilityResult(catalog, name, listRecipes(catalog, auth, args))
  if (name === 'recipe.get') {
    const recipe = findRecipe(catalog, args?.recipeId)
    if (!recipe) {
      const error = new Error(`Recipe desconocida: ${args?.recipeId || ''}`)
      error.code = 'recipe_not_found'
      error.status = 404
      throw error
    }
    if (!canUseCapability(auth, recipe)) {
      const error = new Error(`El token no tiene permisos para la recipe ${args?.recipeId || ''}.`)
      error.code = 'capability_permission_missing'
      error.status = 403
      throw error
    }
    return validateCapabilityResult(catalog, name, { contractVersion: MCP_V3_CONTRACT, recipe: publicCapabilityManifest(recipe) })
  }
  const capability = findCapability(catalog, name)
  if (!capability) {
    const error = new Error(`Capability desconocida: ${name}`)
    error.code = 'capability_not_found'
    error.status = 404
    throw error
  }
  if (!canUseCapability(auth, capability)) {
    const error = new Error(`El token no tiene permisos para ${name}.`)
    error.code = 'capability_permission_missing'
    error.status = 403
    error.retryable = false
    throw error
  }
  const inputErrors = validateInput(args, capability.inputSchema)
  if (inputErrors.length) {
    const error = new Error(`Los argumentos de ${name} no cumplen su inputSchema.`)
    error.code = 'capability_input_invalid'
    error.status = 422
    error.retryable = false
    error.action = 'fix_capability_arguments'
    error.details = { fields: inputErrors }
    throw error
  }
  if (name === 'recipe.get') return { contractVersion: MCP_V3_CONTRACT, recipe: publicCapabilityManifest(capability) }
  const result = await invokeRegisteredCapability(catalog, capability, name, args, auth, runtime)
  return validateCapabilityResult(catalog, name, result)
}

function resourceList(catalog, auth) {
  const resources = [...BUILTIN_RESOURCES]
  resources.push(...visibleCapabilities(catalog, auth).map((entry) => ({
    uri: `escarlet://capabilities/${encodeURIComponent(entry.id)}`,
    name: `Capability ${entry.id}`,
    mimeType: 'application/json'
  })))
  resources.push(...catalog.recipes.filter((entry) => canUseCapability(auth, entry)).map((entry) => ({
    uri: `escarlet://recipes/${encodeURIComponent(entry.id)}`,
    name: `Recipe ${entry.id}`,
    mimeType: 'application/json'
  })))
  const seen = new Set()
  return resources.concat(catalog.resources || []).filter((resource) => {
    const uri = String(resource?.uri || '')
    if (!uri || seen.has(uri)) return false
    seen.add(uri)
    return true
  })
}

function readResource(catalog, auth, uri) {
  if (uri === 'escarlet://capabilities/index') return { uri, mimeType: 'application/json', text: JSON.stringify({ contractVersion: MCP_V3_CONTRACT, capabilities: visibleCapabilities(catalog, auth).map(publicCapabilityManifest) }) }
  if (uri === 'escarlet://recipes/index') return { uri, mimeType: 'application/json', text: JSON.stringify({ contractVersion: MCP_V3_CONTRACT, recipes: catalog.recipes.filter((entry) => canUseCapability(auth, entry)).map(publicCapabilityManifest) }) }
  if (uri === 'escarlet://workflows/index') return { uri, mimeType: 'application/json', text: JSON.stringify(listWorkflows(catalog, auth)) }
  if (uri === 'escarlet://brand/kernel') return { uri, mimeType: 'application/json', text: JSON.stringify(brandKernelResource()) }
  const capabilityMatch = uri.match(/^escarlet:\/\/capabilities\/(.+)$/)
  if (capabilityMatch) {
    const capability = findCapability(catalog, decodeURIComponent(capabilityMatch[1]))
    if (!capability) throw Object.assign(new Error('Capability desconocida.'), { code: 'capability_not_found', status: 404 })
    if (!canUseCapability(auth, capability)) throw Object.assign(new Error('Capability no autorizada.'), { code: 'capability_permission_missing', status: 403 })
    return { uri, mimeType: 'application/json', text: JSON.stringify(publicCapabilityManifest(capability)) }
  }
  const recipeMatch = uri.match(/^escarlet:\/\/recipes\/(.+)$/)
  if (recipeMatch) {
    const recipe = findRecipe(catalog, decodeURIComponent(recipeMatch[1]))
    if (!recipe) throw Object.assign(new Error('Recipe desconocida.'), { code: 'recipe_not_found', status: 404 })
    if (!canUseCapability(auth, recipe)) throw Object.assign(new Error('Recipe no autorizada.'), { code: 'capability_permission_missing', status: 403 })
    return { uri, mimeType: 'application/json', text: JSON.stringify(publicCapabilityManifest(recipe)) }
  }
  throw Object.assign(new Error(`URI desconocida: ${uri}`), { code: 'resource_not_found', status: 404 })
}

function createServer(auth, catalog, runtime = null) {
  const server = new Server(
    { name: MCP_V3_SERVER_NAME, version: MCP_V3_SERVER_VERSION, title: 'Escarlet OS' },
    {
      capabilities: { tools: { listChanged: true }, resources: { subscribe: false, listChanged: true } },
      instructions: 'Escarlet OS expone capabilities namespaced y workflows interactivos. Para una experiencia guiada, llama workflow.list, workflow.get o workflow.next y transforma sus question, type, options y responseKey en selectores, campos y confirmaciones. Para una experiencia libre, usa capability.search y las capabilities directamente. Descubre primero y fija la marca y su Brand Kit. Para imágenes sociales, brand.generation.prepare solo prepara referencias y prompts: el agente debe usar su modelo de imágenes para generar cada PNG final con texto integrado y después subirlo con asset.upload. El CMS no dibuja, no compone y no sustituye esa generación con SVG, HTML, CSS ni plantillas locales. Registra procedencia y deja la publicación para el Publisher tras revisión humana.'
    }
  )

  server.setRequestHandler('tools/list', async () => ({ tools: visibleCapabilities(catalog, auth).map(publicToolManifest) }))
  server.setRequestHandler('resources/list', async () => ({ resources: resourceList(catalog, auth) }))
  server.setRequestHandler('resources/read', async (request) => ({ contents: [readResource(catalog, auth, request.params.uri)] }))
  server.setRequestHandler('tools/call', async (request) => {
    const name = String(request.params?.name || '')
    if (LEGACY_NAME.test(name) || !name.includes('.')) return errorResult(Object.assign(new Error(`La tool ${name} no pertenece al contrato MCP v3.`), { code: 'namespaced_tool_required', status: 400 }), 'namespaced_tool_required')
    try {
      const result = await callCapability(catalog, auth, name, request.params?.arguments || {}, runtime)
      return jsonResult(result)
    } catch (error) {
      return errorResult(error)
    }
  })
  return server
}

export function createMcpServerV3Sync(auth = { role: 'admin' }, { registry = {}, capabilities, recipes, resources, runtime = null } = {}) {
  return createServer(auth, mergeCatalog({ registry, capabilities, recipes, resources }), runtime)
}

export async function createMcpServerV3(auth = { role: 'admin' }, options = {}) {
  const registry = options.registry === undefined ? await loadOsRegistry() : options.registry
  return createMcpServerV3Sync(auth, { ...options, registry })
}

export const createMcpServer = createMcpServerV3

export async function invokeMcpToolV3(name, args = {}, auth = { role: 'admin' }, options = {}) {
  const server = await createMcpServerV3(auth, options)
  const handler = server._requestHandlers.get('tools/call')
  if (typeof handler !== 'function') throw new Error('El servidor MCP v3 no registró tools/call.')
  return handler({ method: 'tools/call', params: { name, arguments: args } }, { mcpReq: { requestState: () => undefined } })
}

export function catalogFromServer(server) {
  const list = server?._requestHandlers?.get('tools/list')
  if (typeof list !== 'function') throw new TypeError('Servidor MCP v3 inválido.')
  return list()
}
