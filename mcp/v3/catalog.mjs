import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ARTIFACT_REFERENCE_SCHEMA } from '../../lib/os/artifacts.mjs'

export const MCP_V3_SERVER_NAME = 'escarlet-os'
export const MCP_V3_SERVER_VERSION = '0.1.0'
export const MCP_V3_CONTRACT = 'os.production.v1'

const objectSchema = {
  type: 'object',
  additionalProperties: false
}

const assetReferenceSchema = ARTIFACT_REFERENCE_SCHEMA

const runSchema = {
  type: 'object',
  properties: {
    contractVersion: { type: 'string', const: MCP_V3_CONTRACT },
    runId: { type: 'string' },
    status: { type: 'string', enum: ['queued', 'running', 'awaiting_provider', 'awaiting_human_approval', 'ready_for_review', 'approved', 'scheduled', 'published', 'failed', 'cancelled', 'blocked'] },
    capability: { type: 'string' },
    brandKitVersionId: { type: 'string' },
    outputs: { type: 'array', items: assetReferenceSchema },
    error: { type: 'object' }
  },
  required: ['contractVersion', 'status'],
  additionalProperties: true
}

const namespaced = (name) => {
  if (!/^[a-z][a-z0-9]*(?:\.[a-z0-9_-]+)+$/.test(name)) {
    throw new TypeError(`La capability debe usar un nombre namespaced: ${name}`)
  }
  return name
}

function manifest({
  id,
  description,
  inputSchema = objectSchema,
  outputSchema = runSchema,
  permissions = ['capabilities:read'],
  sideEffects = 'none',
  composesWith = [],
  humanReviewRequired = false,
  type = 'primitive',
  version = '1.0.0',
  tags = [],
  aliases = [],
  useCases = [],
  metadata = {}
}) {
  return Object.freeze({
    id: namespaced(id),
    type,
    version,
    description,
    inputSchema,
    outputSchema,
    permissions,
    sideEffects,
    composesWith,
    humanReviewRequired,
    tags,
    aliases,
    useCases,
    metadata
  })
}

export const BUILTIN_CAPABILITIES = Object.freeze([
  manifest({
    id: 'capability.guide',
    description: 'Explica a un agente nuevo cómo descubrir la marca, elegir una recipe y dejar el resultado para revisión humana.',
    inputSchema: { type: 'object', properties: { goal: { type: 'string', maxLength: 160 } }, additionalProperties: false },
    outputSchema: { type: 'object', properties: { firstSteps: { type: 'array' }, rules: { type: 'array' }, examples: { type: 'array' } }, required: ['firstSteps', 'rules', 'examples'], additionalProperties: true },
    permissions: [],
    tags: ['discovery', 'onboarding', 'agent']
  }),
  manifest({
    id: 'capability.search',
    description: 'Busca capabilities autorizadas por propósito, input, output o etiqueta.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', maxLength: 160 }, type: { type: 'string', enum: ['primitive', 'recipe'] }, tag: { type: 'string', maxLength: 80 } },
      additionalProperties: false
    },
    outputSchema: { type: 'object', properties: { capabilities: { type: 'array' } }, required: ['capabilities'], additionalProperties: true },
    permissions: [],
    tags: ['discovery']
  }),
  manifest({
    id: 'capability.get',
    description: 'Devuelve el manifest completo de una capability autorizada, incluidos sus schemas y efectos.',
    inputSchema: { type: 'object', properties: { capabilityId: { type: 'string', minLength: 1 }, version: { type: 'string' } }, required: ['capabilityId'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { capability: { type: 'object' } }, required: ['capability'], additionalProperties: true },
    permissions: [],
    tags: ['discovery']
  }),
  manifest({
    id: 'recipe.list',
    description: 'Lista recetas autorizadas sin ejecutar ningún paso.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 160 }, tag: { type: 'string', maxLength: 80 } }, additionalProperties: false },
    outputSchema: { type: 'object', properties: { recipes: { type: 'array' } }, required: ['recipes'], additionalProperties: true },
    permissions: [],
    tags: ['discovery', 'composition']
  }),
  manifest({
    id: 'recipe.get',
    description: 'Devuelve una receta registrada y sus dependencias declaradas.',
    inputSchema: { type: 'object', properties: { recipeId: { type: 'string', minLength: 1 } }, required: ['recipeId'], additionalProperties: false },
    outputSchema: { type: 'object', required: ['recipe'], additionalProperties: true },
    permissions: [],
    tags: ['discovery', 'composition']
  }),
  manifest({
    id: 'recipe.run',
    description: 'Ejecuta una recipe compuesta y devuelve sus trabajos, validaciones y siguiente revisión.',
    inputSchema: { type: 'object', properties: { recipeId: { type: 'string' }, site: { type: 'string' }, brandId: { type: 'string' }, workspaceId: { type: 'string' }, siteId: { type: 'string' }, brandKitVersionId: { type: 'string' }, inputs: { type: 'array', items: assetReferenceSchema }, sourceMediaId: { type: 'string' }, audioAssetId: { type: 'string' }, contentItemId: { type: 'string' }, text: { type: 'string', maxLength: 50000 }, script: { type: 'string', maxLength: 50000 }, menuText: { type: 'string', maxLength: 50000 }, purpose: { type: 'string' }, audience: { type: 'string' }, cta: { type: 'string' }, formatProfile: { type: 'string' }, channel: { type: 'string' }, provider: { type: 'string' }, idempotencyKey: { type: 'string' }, createContentIfMissing: { type: 'boolean' } }, additionalProperties: false },
    outputSchema: { type: 'object', required: ['recipe', 'runId', 'status', 'review'], additionalProperties: true },
    permissions: ['brand:read', 'asset:read', 'asset:write', 'copy:validate', 'production:motion', 'publication:read'],
    sideEffects: 'write',
    humanReviewRequired: true,
    tags: ['composition', 'recipe', 'workflow']
  }),
  manifest({
    id: 'brand.context.get',
    description: 'Lee un snapshot versionado del contexto de marca sin exponer archivos privados.',
    inputSchema: { type: 'object', properties: { site: { type: 'string' }, brandId: { type: 'string' }, brandKitVersionId: { type: 'string' } }, oneOf: [{ required: ['site'] }, { required: ['brandId'] }], additionalProperties: false },
    outputSchema: { type: 'object', properties: { contractVersion: { type: 'string', const: MCP_V3_CONTRACT }, site: { type: 'string' }, brandKitVersionId: { type: 'string' }, brandKitSnapshotHash: { type: 'string' } }, required: ['contractVersion', 'site', 'brandKitVersionId', 'brandKitSnapshotHash'], additionalProperties: true },
    permissions: ['brand:read'],
    tags: ['brand', 'kernel', 'read']
  }),
  manifest({
    id: 'brand.voice.get',
    description: 'Lee la proyección de voz de marca del snapshot seleccionado.',
    inputSchema: { type: 'object', properties: { site: { type: 'string' }, brandId: { type: 'string' }, brandKitVersionId: { type: 'string' } }, oneOf: [{ required: ['site'] }, { required: ['brandId'] }], additionalProperties: false },
    outputSchema: { type: 'object', properties: { contractVersion: { type: 'string', const: MCP_V3_CONTRACT }, site: { type: 'string' }, brandKitVersionId: { type: 'string' }, brandKitSnapshotHash: { type: 'string' }, voice: { type: 'string' } }, required: ['contractVersion', 'site', 'brandKitVersionId', 'brandKitSnapshotHash', 'voice'], additionalProperties: true },
    permissions: ['brand:read'],
    tags: ['brand', 'kernel', 'read']
  }),
  manifest({
    id: 'brand.visual_style.get',
    description: 'Lee la proyección de estilo visual de marca del snapshot seleccionado.',
    inputSchema: { type: 'object', properties: { site: { type: 'string' }, brandId: { type: 'string' }, brandKitVersionId: { type: 'string' } }, oneOf: [{ required: ['site'] }, { required: ['brandId'] }], additionalProperties: false },
    outputSchema: { type: 'object', properties: { contractVersion: { type: 'string', const: MCP_V3_CONTRACT }, site: { type: 'string' }, brandKitVersionId: { type: 'string' }, brandKitSnapshotHash: { type: 'string' }, visualStyle: { type: 'object' } }, required: ['contractVersion', 'site', 'brandKitVersionId', 'brandKitSnapshotHash', 'visualStyle'], additionalProperties: true },
    permissions: ['brand:read'],
    tags: ['brand', 'kernel', 'read']
  }),
  manifest({
    id: 'brand.rules.get',
    description: 'Lee reglas publicables y restricciones de contenido del snapshot seleccionado.',
    inputSchema: { type: 'object', properties: { site: { type: 'string' }, brandId: { type: 'string' }, brandKitVersionId: { type: 'string' } }, oneOf: [{ required: ['site'] }, { required: ['brandId'] }], additionalProperties: false },
    outputSchema: { type: 'object', properties: { contractVersion: { type: 'string', const: MCP_V3_CONTRACT }, site: { type: 'string' }, brandKitVersionId: { type: 'string' }, brandKitSnapshotHash: { type: 'string' }, sharedEditorialPolicy: { type: 'object' } }, required: ['contractVersion', 'site', 'brandKitVersionId', 'brandKitSnapshotHash'], additionalProperties: true },
    permissions: ['brand:read'],
    tags: ['brand', 'kernel', 'read']
  }),
  manifest({
    id: 'brand.references.resolve',
    description: 'Resuelve referencias visuales permitidas para una operación de generación.',
    inputSchema: { type: 'object', properties: { site: { type: 'string' }, brandId: { type: 'string' }, brandKitVersionId: { type: 'string' }, purpose: { type: 'string' }, formatProfile: { type: 'string' } }, oneOf: [{ required: ['site', 'purpose'] }, { required: ['brandId', 'purpose'] }], additionalProperties: false },
    outputSchema: { type: 'object', properties: { contractVersion: { type: 'string', const: MCP_V3_CONTRACT }, references: { type: 'array' }, brandKitVersionId: { type: 'string' }, brandKitSnapshotHash: { type: 'string' }, generationBlocked: { type: 'boolean' } }, required: ['contractVersion', 'references', 'brandKitVersionId', 'brandKitSnapshotHash', 'generationBlocked'], additionalProperties: true },
    permissions: ['brand:read'],
    tags: ['brand', 'kernel', 'read', 'provenance']
  }),
  manifest({
    id: 'brand.generation.prepare',
    description: 'Prepara un envelope versionado para generación externa, sin generar contenido ni revelar secretos.',
    inputSchema: {
      type: 'object',
      properties: { site: { type: 'string' }, brandId: { type: 'string' }, brandKitVersionId: { type: 'string' }, purpose: { type: 'string' }, formatProfile: { type: 'string' }, inputs: { type: 'array', items: assetReferenceSchema }, prompt: { type: 'string', maxLength: 12000 } },
      oneOf: [{ required: ['site', 'purpose'] }, { required: ['brandId', 'purpose'] }],
      additionalProperties: false
    },
    outputSchema: { type: 'object', properties: { contractVersion: { type: 'string', const: MCP_V3_CONTRACT }, preparationId: { type: 'string' }, brandKitVersionId: { type: 'string' }, resolvedReferences: { type: 'array' }, generationBlocked: { type: 'boolean' }, preparation: { type: 'object' } }, required: ['contractVersion', 'brandKitVersionId', 'generationBlocked'], additionalProperties: true },
    permissions: ['brand:read', 'generation:prepare'],
    tags: ['brand', 'kernel', 'preparation', 'provenance']
  }),
  manifest({
    id: 'brand.generation.receipt.issue',
    description: 'Registra la procedencia de un resultado generado por un agente externo.',
    inputSchema: { type: 'object', properties: { preparationId: { type: 'string' }, outputAssetId: { type: 'string' }, outputSha256: { type: 'string' }, provider: { type: 'string' }, metadata: { type: 'object' } }, required: ['preparationId', 'outputAssetId', 'outputSha256'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { receiptId: { type: 'string' }, preparationId: { type: 'string' } }, required: ['receiptId', 'preparationId'], additionalProperties: false },
    permissions: ['generation:provenance'],
    sideEffects: 'audit',
    tags: ['brand', 'kernel', 'provenance']
  }),
  manifest({
    id: 'copy.validate',
    description: 'Valida copy frente a las reglas del snapshot de marca antes de producir un artefacto.',
    inputSchema: { type: 'object', properties: { site: { type: 'string' }, brandId: { type: 'string' }, brandKitVersionId: { type: 'string' }, text: { type: 'string', maxLength: 50000 }, channel: { type: 'string' }, purpose: { type: 'string' }, audience: { type: 'string' }, cta: { type: 'string' } }, required: ['text'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { valid: { type: 'boolean' }, findings: { type: 'array' } }, required: ['valid', 'findings'], additionalProperties: false },
    permissions: ['brand:read'],
    tags: ['copy', 'validation']
  }),
  manifest({
    id: 'asset.register',
    description: 'Registra una referencia de asset ya autorizada por el control plane.',
    inputSchema: { type: 'object', properties: { assetId: { type: 'string' }, brandId: { type: 'string' }, sha256: { type: 'string' }, mimeType: { type: 'string' } }, required: ['assetId'], additionalProperties: false },
    permissions: ['asset:write'],
    sideEffects: 'write',
    tags: ['asset', 'provenance']
  }),
  manifest({
    id: 'production.image.product.transform',
    description: 'Transforma un producto manteniendo el original y creando un asset derivado con procedencia.',
    inputSchema: { type: 'object', properties: { sourceAssetId: { type: 'string' }, sourceAsset: assetReferenceSchema, workspaceId: { type: 'string' }, siteId: { type: 'string' }, site: { type: 'string' }, brandId: { type: 'string' }, brandKitVersionId: { type: 'string' }, formatProfile: { type: 'string' }, preserveProduct: { type: 'boolean' }, title: { type: 'string' }, topic: { type: 'string' }, instructions: { type: 'string' } }, required: ['formatProfile'], oneOf: [{ required: ['sourceAssetId'] }, { required: ['sourceAsset'] }], additionalProperties: false },
    permissions: ['asset:read', 'generation:run'],
    sideEffects: 'write',
    humanReviewRequired: true,
    tags: ['production', 'image', 'product']
  }),
  manifest({
    id: 'production.motion.compose',
    description: 'Compone un reel, story u otro vídeo corto a partir de assets y un perfil de formato.',
    inputSchema: { type: 'object', properties: { brandId: { type: 'string' }, workspaceId: { type: 'string' }, siteId: { type: 'string' }, brandKitVersionId: { type: 'string' }, inputs: { type: 'array', items: assetReferenceSchema }, sourceMediaId: { type: 'string' }, contentItemId: { type: 'string' }, formatProfile: { type: 'string' }, channel: { type: 'string' }, format: { type: 'string' }, provider: { type: 'string' }, objective: { type: 'string' }, topic: { type: 'string' }, text: { type: 'string', maxLength: 50000 }, script: { type: 'string', maxLength: 50000 }, audioAssetId: { type: 'string' }, runId: { type: 'string' }, correlationId: { type: 'string' }, idempotencyKey: { type: 'string' }, createContentIfMissing: { type: 'boolean' } }, required: ['formatProfile'], oneOf: [{ required: ['inputs'] }, { required: ['sourceMediaId'] }], additionalProperties: false },
    permissions: ['asset:read', 'generation:run'],
    sideEffects: 'write',
    humanReviewRequired: true,
    tags: ['production', 'motion', 'video']
  }),
  manifest({
    id: 'publication.destination.list',
    description: 'Lista destinos y proveedores de publicación compatibles con los assets aprobados.',
    inputSchema: { type: 'object', properties: { brandId: { type: 'string' }, workspaceId: { type: 'string' }, siteId: { type: 'string' }, assetIds: { type: 'array', items: { type: 'string' } }, assets: { type: 'array', items: { type: 'object' } }, channel: { type: 'string' }, provider: { type: 'string' }, connections: { type: 'array', items: { type: 'object' } }, text: { type: 'string' } }, additionalProperties: false },
    outputSchema: { type: 'object', properties: { destinations: { type: 'array' } }, required: ['destinations'], additionalProperties: false },
    permissions: ['publication:read'],
    metadata: {
      uiApps: [
        { id: 'publication.publisher', title: 'Publisher', description: 'Elige canal, proveedor y asset antes de preparar una publicación.', route: '/publication/publisher', tags: ['publication', 'publisher'] },
        { id: 'publication.blog', title: 'Publicar blog', description: 'Prepara una entrada para WordPress y conserva la revisión antes de publicar.', route: '/publication/publisher?channel=wordpress_post', tags: ['blog', 'wordpress', 'publication'] }
      ]
    },
    tags: ['publication', 'publisher', 'discovery']
  }),
  manifest({
    id: 'publication.validate',
    description: 'Comprueba compatibilidad, permisos y aprobación antes de enrutar una publicación.',
    inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, siteId: { type: 'string' }, assetIds: { type: 'array', items: { type: 'string' } }, assets: { type: 'array', items: { type: 'object' } }, channel: { type: 'string' }, provider: { type: 'string' }, runId: { type: 'string' }, text: { type: 'string' }, connections: { type: 'array', items: { type: 'object' } } }, required: ['assetIds', 'channel'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { valid: { type: 'boolean' }, findings: { type: 'array' } }, required: ['valid', 'findings'], additionalProperties: false },
    permissions: ['publication:read'],
    tags: ['publication', 'publisher', 'validation']
  }),
  manifest({
    id: 'publication.route',
    description: 'Selecciona explícita o recomendadamente el proveedor para un canal.',
    inputSchema: { type: 'object', properties: { channel: { type: 'string' }, provider: { type: 'string' }, assetIds: { type: 'array', items: { type: 'string' } }, runId: { type: 'string' } }, required: ['channel', 'assetIds'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { channel: { type: 'string' }, provider: { type: 'string' }, destinationId: { type: 'string' } }, required: ['channel', 'provider'], additionalProperties: false },
    permissions: ['publication:write'],
    sideEffects: 'audit',
    humanReviewRequired: true,
    tags: ['publication', 'publisher', 'routing']
  }),
  manifest({
    id: 'publication.prepare',
    description: 'Construye y persiste un bundle listo para revisión humana sin contactar proveedores.',
    inputSchema: { type: 'object', properties: { runId: { type: 'string' }, channel: { type: 'string' }, provider: { type: 'string' }, assetIds: { type: 'array', items: { type: 'string' } }, text: { type: 'string' } }, required: ['channel', 'provider', 'assetIds'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { publicationId: { type: 'string' }, state: { type: 'string' }, bundle: { type: 'object' } }, required: ['publicationId', 'state'], additionalProperties: false },
    permissions: ['publication:write'],
    sideEffects: 'audit',
    humanReviewRequired: true,
    tags: ['publication', 'publisher', 'prepare']
  }),
  manifest({
    id: 'publication.schedule',
    description: 'Programa un bundle aprobado usando el adaptador de destino seleccionado.',
    inputSchema: { type: 'object', properties: { runId: { type: 'string' }, channel: { type: 'string' }, provider: { type: 'string' }, publicationDate: { type: 'string' }, timezone: { type: 'string' } }, required: ['runId', 'channel', 'provider', 'publicationDate'], additionalProperties: false },
    permissions: ['publication:write'],
    sideEffects: 'external',
    humanReviewRequired: true,
    tags: ['publication', 'publisher', 'schedule']
  }),
  manifest({
    id: 'publication.publish',
    description: 'Publica un bundle aprobado mediante el adaptador seleccionado.',
    inputSchema: { type: 'object', properties: { runId: { type: 'string' }, channel: { type: 'string' }, provider: { type: 'string' } }, required: ['runId', 'channel', 'provider'], additionalProperties: false },
    permissions: ['publication:write'],
    sideEffects: 'external',
    humanReviewRequired: true,
    tags: ['publication', 'publisher', 'publish']
  }),
  manifest({
    id: 'publication.status.get',
    description: 'Consulta el estado interno y externo de una publicación. Si no existe un runId o publicationId persistido, devuelve status unknown y terminal false para indicar que el estado no está confirmado.',
    inputSchema: { type: 'object', properties: { runId: { type: 'string' }, publicationId: { type: 'string' } }, additionalProperties: false },
    outputSchema: { type: 'object', properties: { contractVersion: { type: 'string' }, operation: { type: 'string' }, publicationId: { type: ['string', 'null'] }, status: { type: 'string' }, providerStatus: { type: ['string', 'null'] }, terminal: { type: 'boolean' }, persisted: { type: 'boolean' } }, required: ['contractVersion', 'status', 'terminal'], additionalProperties: true },
    permissions: ['publication:read'],
    tags: ['publication', 'publisher', 'status']
  })
])

export const BUILTIN_RECIPES = Object.freeze([
  Object.freeze({
    id: 'recipe.reel-from-image',
    version: '1.0.0',
    type: 'recipe',
    description: 'Convierte una imagen y un guion en un Reel o Story usando el Brand Kit activo.',
    steps: ['brand.context.get', 'copy.validate', 'production.motion.compose', 'publication.destination.list'],
    humanReviewRequired: true,
    tags: ['recipe', 'reel', 'video', 'motion', 'image', 'content'],
    aliases: ['imagen y guion a reel', 'image to reel', 'generic reel'],
    useCases: ['Crear un Reel genérico desde una imagen y un script'],
    metadata: { uiRoute: '/production/food-to-reel' }
  }),
  Object.freeze({
    id: 'food-to-reel',
    version: '1.0.0',
    type: 'recipe',
    description: 'Convierte una imagen de plato y un texto en un reel revisable y publicable.',
    steps: ['copy.validate', 'production.motion.compose', 'publication.destination.list', 'publication.route', 'publication.schedule'],
    humanReviewRequired: true,
    tags: ['recipe', 'food', 'reel', 'video', 'motion', 'content', 'image'],
    aliases: ['plato a reel', 'imagen y texto a video', 'food to video', 'generación de contenido'],
    useCases: ['Crear un Reel de comida', 'Generar contenido con una imagen y texto'],
    metadata: { uiRoute: '/production/food-to-reel' }
  }),
  Object.freeze({
    id: 'menu-to-reel',
    version: '1.0.0',
    type: 'recipe',
    description: 'Compone un reel o story del menú del día con imagen, texto y audio opcional.',
    steps: ['copy.validate', 'production.motion.compose', 'publication.destination.list', 'publication.route', 'publication.publish'],
    humanReviewRequired: true,
    tags: ['recipe', 'menu', 'reel', 'story', 'video', 'content', 'publisher'],
    aliases: ['menu a reel', 'menu a story', 'menú del día', 'daily menu video'],
    useCases: ['Convertir el menú en contenido social', 'Publicar una Story del menú'],
    metadata: { uiRoute: '/production/menu-to-reel' }
  }),
  Object.freeze({
    id: 'product-to-social',
    version: '1.0.0',
    type: 'recipe',
    description: 'Adapta un producto a un formato social y lo entrega al Publisher para revisión.',
    steps: ['production.image.product.transform', 'copy.validate', 'publication.destination.list', 'publication.route'],
    humanReviewRequired: true,
    tags: ['recipe', 'product', 'social', 'image', 'content', 'publisher'],
    aliases: ['producto a imagen', 'product image', 'product to post'],
    useCases: ['Generar una imagen de producto', 'Publicar contenido de producto'],
    metadata: { uiRoute: '/production/product-to-social' }
  })
])

export const BUILTIN_RESOURCES = Object.freeze([
  Object.freeze({ uri: 'escarlet://capabilities/index', name: 'Escarlet OS capability index', mimeType: 'application/json' }),
  Object.freeze({ uri: 'escarlet://recipes/index', name: 'Escarlet OS recipe index', mimeType: 'application/json' }),
  Object.freeze({ uri: 'escarlet://brand/kernel', name: 'Escarlet OS Brand Kernel contract', mimeType: 'application/json' })
])

function registryValue(candidate) {
  if (!candidate) return {}
  if (Array.isArray(candidate)) return { capabilities: candidate }
  if (typeof candidate !== 'object') throw new TypeError('El registro OS debe ser un objeto o una lista de manifests.')
  return candidate
}

function canonicalRecipeId(value) {
  const id = String(value || '').trim()
  return id.startsWith('recipe.') ? id : `recipe.${id}`
}

function recipeKey(value) {
  return canonicalRecipeId(value).slice('recipe.'.length)
}

function normalizedSideEffects(value) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  const effects = Array.isArray(value) ? value.map((entry) => String(entry).toLowerCase()) : []
  if (effects.some((entry) => entry === 'external' || entry.includes('external'))) return 'external'
  if (effects.some((entry) => entry === 'write' || entry.includes('asset_write') || entry.includes('job_create'))) return 'write'
  if (effects.length) return 'audit'
  return 'none'
}

export function normalizeOsRegistry(candidate) {
  const source = registryValue(candidate)
  const capabilities = source.capabilities || source.tools || []
  const recipes = source.recipes || []
  if (!Array.isArray(capabilities)) throw new TypeError('El registro OS debe exponer capabilities como lista.')
  if (!Array.isArray(recipes)) throw new TypeError('El registro OS debe exponer recipes como lista.')
  const normalizedCapabilities = capabilities.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new TypeError('Cada capability del registro OS debe ser un objeto.')
    const id = namespaced(String(entry.id || entry.name || ''))
    return {
      ...entry,
      id,
      type: entry.type || entry.kind || 'primitive',
      version: entry.version || '1.0.0',
      sideEffects: normalizedSideEffects(entry.sideEffects),
      humanReviewRequired: entry.humanReviewRequired === true || entry.reviewPolicy === 'human_required',
      composesWith: Array.isArray(entry.composesWith) ? entry.composesWith : (Array.isArray(entry.dependencies) ? entry.dependencies : [])
    }
  })
  const normalizedRecipes = recipes.map((entry) => {
    if (!entry || typeof entry !== 'object' || !entry.id) throw new TypeError('Cada recipe del registro OS debe tener id.')
    return {
      ...entry,
      id: canonicalRecipeId(entry.id),
      type: 'recipe',
      version: entry.version || '1.0.0',
      sideEffects: normalizedSideEffects(entry.sideEffects),
      humanReviewRequired: entry.humanReviewRequired === true || entry.reviewPolicy === 'human_required',
      composesWith: Array.isArray(entry.composesWith) ? entry.composesWith : (Array.isArray(entry.dependencies) ? entry.dependencies : [])
    }
  })
  return {
    capabilities: normalizedCapabilities,
    recipes: normalizedRecipes,
    resources: Array.isArray(source.resources) ? source.resources : [],
    invoke: typeof source.invoke === 'function' ? source.invoke : typeof source.dispatch === 'function' ? source.dispatch : null
  }
}

const osRegistryCandidates = [
  fileURLToPath(new URL('../../lib/os.mjs', import.meta.url)),
  fileURLToPath(new URL('../../lib/os/index.mjs', import.meta.url))
]

async function importOsRegistry(path) {
  const module = await import(pathToFileURL(path).href)
  let candidate = module.getOsRegistry || module.loadOsRegistry || module.capabilityRegistry || module.registry || module.default
  if (typeof candidate === 'function') candidate = await candidate()
  if (!candidate && typeof module.listCapabilities === 'function') candidate = { capabilities: await module.listCapabilities() }
  return candidate
}

export async function loadOsRegistry() {
  const path = osRegistryCandidates.find((candidate) => existsSync(candidate))
  if (!path) return normalizeOsRegistry(null)
  return normalizeOsRegistry(await importOsRegistry(path))
}

export function mergeCatalog({ registry = {}, capabilities = BUILTIN_CAPABILITIES, recipes = BUILTIN_RECIPES, resources = BUILTIN_RESOURCES } = {}) {
  const extra = normalizeOsRegistry(registry)
  const capabilitiesById = new Map(capabilities.map((entry) => [entry.id, entry]))
  for (const entry of extra.capabilities) capabilitiesById.set(entry.id, entry)
  const recipesById = new Map(recipes.map((entry) => [recipeKey(entry.id), entry]))
  for (const entry of extra.recipes) recipesById.set(recipeKey(entry.id), entry)
  return {
    capabilities: [...capabilitiesById.values()],
    recipes: [...recipesById.values()],
    resources: [...resources, ...extra.resources],
    invoke: extra.invoke
  }
}

export function publicCapabilityManifest(entry) {
  const { handler, execute, invoke, ...publicEntry } = entry
  return publicEntry
}

export function publicToolManifest(entry) {
  const manifest = publicCapabilityManifest(entry)
  return {
    name: manifest.id,
    description: manifest.description,
    inputSchema: manifest.inputSchema || objectSchema,
    annotations: {
      readOnlyHint: manifest.sideEffects === 'none',
      destructiveHint: manifest.sideEffects === 'external',
      openWorldHint: manifest.sideEffects === 'external'
    },
    _meta: {
      contractVersion: MCP_V3_CONTRACT,
      capabilityVersion: manifest.version,
      type: manifest.type,
      permissions: manifest.permissions,
      sideEffects: manifest.sideEffects,
      humanReviewRequired: manifest.humanReviewRequired,
      composesWith: manifest.composesWith,
      tags: manifest.tags
    }
  }
}

export function brandKernelResource() {
  return {
    contractVersion: MCP_V3_CONTRACT,
    policy: 'read_preparation_provenance',
    principles: [
      'El contexto de marca siempre se fija a una versión explícita.',
      'La preparación no genera contenido ni devuelve secretos.',
      'Los resultados externos se registran mediante procedencia y hash.',
      'La publicación requiere validación y revisión humana.'
    ]
  }
}

export function assertNamespacedTools(tools) {
  for (const tool of tools) namespaced(tool.name)
  return tools
}
