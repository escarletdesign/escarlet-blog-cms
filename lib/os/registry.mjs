import {
  CAPABILITY_KINDS,
  CAPABILITY_VISIBILITIES,
  CapabilityManifestError,
  capabilityKey,
  compareCapabilityVersions,
  hasCapabilityPermissions,
  normalizeCapabilityManifest
} from './contracts.mjs'

export class CapabilityRegistryError extends Error {
  constructor(message, code = 'CAPABILITY_REGISTRY_ERROR', details = {}) {
    super(message)
    this.name = 'CapabilityRegistryError'
    this.code = code
    this.details = details
  }
}

function registryFail(message, code, details) {
  throw new CapabilityRegistryError(message, code, details)
}

function permissionList(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((permission) => typeof permission !== 'string' || !permission.trim())) {
    registryFail('permissions debe ser una lista de nombres no vacíos.', 'CAPABILITY_PERMISSIONS_INVALID')
  }
  return [...new Set(value.map((permission) => permission.trim()))]
}

function booleanOption(value, field, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') registryFail(`${field} debe ser booleano.`, 'CAPABILITY_FILTER_INVALID', { field })
  return value
}

function normalizedKind(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !CAPABILITY_KINDS.includes(value)) registryFail('kind no está soportado.', 'CAPABILITY_FILTER_INVALID', { field: 'kind', value })
  return value
}

function normalizedTags(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string' || !tag.trim())) registryFail('tags debe ser una lista de nombres no vacíos.', 'CAPABILITY_FILTER_INVALID', { field: 'tags' })
  return [...new Set(value.map((tag) => tag.trim().toLowerCase()))]
}

function normalizedQuery(value) {
  if (value === undefined || value === null || value === '') return []
  if (typeof value !== 'string') registryFail('query debe ser texto.', 'CAPABILITY_FILTER_INVALID', { field: 'query' })
  return [...new Set(value.trim().toLowerCase().split(/\s+/).filter(Boolean))]
}

function normalizedLimit(value) {
  if (value === undefined) return 50
  if (!Number.isInteger(value) || value < 1 || value > 100) registryFail('limit debe ser un entero entre 1 y 100.', 'CAPABILITY_FILTER_INVALID', { field: 'limit' })
  return value
}

function normalizedVisibility(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !CAPABILITY_VISIBILITIES.includes(value)) registryFail('visibility no está soportada.', 'CAPABILITY_FILTER_INVALID', { field: 'visibility', value })
  return value
}

function normalizedFilter(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) registryFail('El filtro debe ser un objeto.', 'CAPABILITY_FILTER_INVALID')
  return {
    permissions: permissionList(options.permissions),
    includeInternal: booleanOption(options.includeInternal, 'includeInternal', false),
    includeDeprecated: booleanOption(options.includeDeprecated, 'includeDeprecated', false),
    includeVersions: booleanOption(options.includeVersions, 'includeVersions', false),
    kind: normalizedKind(options.kind),
    tags: normalizedTags(options.tags),
    visibility: normalizedVisibility(options.visibility),
    queryTokens: normalizedQuery(options.query),
    limit: normalizedLimit(options.limit)
  }
}

function isVisible(manifest, filter) {
  if (!filter.includeInternal && manifest.visibility === 'internal') return false
  if (filter.visibility && manifest.visibility !== filter.visibility) return false
  if (!filter.includeDeprecated && manifest.deprecated) return false
  if (filter.kind && manifest.kind !== filter.kind) return false
  if (!hasCapabilityPermissions(manifest, filter.permissions)) return false
  if (filter.tags.length && !filter.tags.every((tag) => manifest.tags.some((candidate) => candidate.toLowerCase() === tag))) return false
  return true
}

function searchScore(manifest, tokens) {
  if (!tokens.length) return 0
  const id = manifest.id.toLowerCase()
  const fields = [id, manifest.title.toLowerCase(), manifest.description.toLowerCase(), ...manifest.tags.map((tag) => tag.toLowerCase()), ...manifest.useCases.map((useCase) => useCase.toLowerCase())]
  let score = 0
  for (const token of tokens) {
    if (id === token) score += 100
    else if (id.startsWith(token)) score += 50
    if (fields.some((field) => field.includes(token))) score += 10
  }
  return score
}

function latestVersion(records) {
  let latest = null
  for (const manifest of records.values()) {
    if (!latest || compareCapabilityVersions(manifest.version, latest.version) > 0) latest = manifest
  }
  return latest
}

export class CapabilityRegistry {
  #records = new Map()

  constructor(manifests = []) {
    this.registerMany(manifests)
  }

  register(input) {
    let manifest
    try {
      manifest = normalizeCapabilityManifest(input)
    } catch (error) {
      if (error instanceof CapabilityManifestError) throw error
      throw error
    }
    const versions = this.#records.get(manifest.id) || new Map()
    if (versions.has(manifest.version)) {
      registryFail(`La capability ${capabilityKey(manifest.id, manifest.version)} ya está registrada.`, 'CAPABILITY_ALREADY_REGISTERED', {
        id: manifest.id,
        version: manifest.version
      })
    }
    versions.set(manifest.version, manifest)
    this.#records.set(manifest.id, versions)
    return manifest
  }

  registerMany(inputs = []) {
    if (!Array.isArray(inputs)) registryFail('manifests debe ser una lista.', 'CAPABILITY_MANIFESTS_INVALID')
    const manifests = inputs.map((input) => normalizeCapabilityManifest(input))
    const keys = new Set()
    for (const manifest of manifests) {
      const key = capabilityKey(manifest.id, manifest.version)
      if (keys.has(key) || this.#records.get(manifest.id)?.has(manifest.version)) {
        registryFail(`La capability ${key} ya está registrada.`, 'CAPABILITY_ALREADY_REGISTERED', { id: manifest.id, version: manifest.version })
      }
      keys.add(key)
    }
    for (const manifest of manifests) {
      const versions = this.#records.get(manifest.id) || new Map()
      versions.set(manifest.version, manifest)
      this.#records.set(manifest.id, versions)
    }
    return manifests
  }

  get(id, options = {}) {
    if (typeof id !== 'string' || !id.trim()) registryFail('id es obligatorio.', 'CAPABILITY_ID_INVALID')
    if (!options || typeof options !== 'object' || Array.isArray(options)) registryFail('Las opciones deben ser un objeto.', 'CAPABILITY_FILTER_INVALID')
    const versions = this.#records.get(id.trim())
    if (!versions) return null
    const requestedVersion = options.version === undefined ? null : String(options.version).trim()
    const manifest = requestedVersion ? versions.get(requestedVersion) : latestVersion(versions)
    if (!manifest) return null
    const filter = normalizedFilter(options)
    if (!isVisible(manifest, filter)) return null
    return manifest
  }

  list(options = {}) {
    const filter = normalizedFilter(options)
    const manifests = []
    for (const versions of this.#records.values()) {
      if (filter.includeVersions) {
        manifests.push(...versions.values())
      } else {
        const latest = latestVersion(versions)
        if (latest) manifests.push(latest)
      }
    }
    return manifests
      .filter((manifest) => isVisible(manifest, filter))
      .sort((left, right) => left.id.localeCompare(right.id) || compareCapabilityVersions(right.version, left.version))
  }

  search(options = {}) {
    const filter = normalizedFilter(options)
    const candidates = this.list(filter)
    return candidates
      .map((manifest) => ({ manifest, score: searchScore(manifest, filter.queryTokens) }))
      .filter(({ score }) => !filter.queryTokens.length || score > 0)
      .sort((left, right) => right.score - left.score || left.manifest.id.localeCompare(right.manifest.id) || compareCapabilityVersions(right.manifest.version, left.manifest.version))
      .slice(0, filter.limit)
      .map(({ manifest }) => manifest)
  }

  toJSON(options = {}) {
    return this.list(options).map((manifest) => manifest)
  }

  get size() {
    let count = 0
    for (const versions of this.#records.values()) count += versions.size
    return count
  }
}

const objectSchema = (properties = {}, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: true
})

const idSchema = { type: 'string', minLength: 1 }
const assetRefSchema = { type: 'object', properties: { assetId: idSchema, role: { type: 'string' }, sha256: { type: 'string' } }, required: ['assetId', 'role'] }

export const DEFAULT_CAPABILITY_MANIFESTS = Object.freeze([
  {
    id: 'brand.context.get', version: '1.0.0', kind: 'primitive', handler: 'brand-kernel/context.get', title: 'Obtener contexto de marca',
    description: 'Devuelve un snapshot versionado y autorizado del contexto de marca.', tags: ['brand', 'context'], useCases: ['Preparar una generación con identidad de marca'], permissions: ['brand:read'],
    inputSchema: objectSchema({ brandId: idSchema, brandKitVersionId: idSchema }, ['brandId']), outputSchema: objectSchema({ brandKitVersionId: idSchema, snapshotHash: { type: 'string' }, context: { type: 'object' } }, ['brandKitVersionId', 'snapshotHash', 'context'])
  },
  {
    id: 'brand.voice.get', version: '1.0.0', kind: 'primitive', handler: 'brand-kernel/voice.get', title: 'Obtener voz de marca',
    description: 'Proyecta únicamente las reglas de voz autorizadas para una ejecución.', tags: ['brand', 'voice', 'copy'], useCases: ['Escribir un guion', 'Validar un copy'], permissions: ['brand:read'],
    inputSchema: objectSchema({ brandId: idSchema, brandKitVersionId: idSchema }, ['brandId']), outputSchema: objectSchema({ brandKitVersionId: idSchema, voice: { type: 'object' } }, ['brandKitVersionId', 'voice'])
  },
  {
    id: 'brand.visual_style.get', version: '1.0.0', kind: 'primitive', handler: 'brand-kernel/visual-style.get', title: 'Obtener estilo visual',
    description: 'Proyecta color, tipografía, composición y referencias visuales autorizadas.', tags: ['brand', 'visual', 'image'], useCases: ['Preparar una imagen', 'Componer un vídeo'], permissions: ['brand:read'],
    inputSchema: objectSchema({ brandId: idSchema, brandKitVersionId: idSchema }, ['brandId']), outputSchema: objectSchema({ brandKitVersionId: idSchema, visualStyle: { type: 'object' } }, ['brandKitVersionId', 'visualStyle'])
  },
  {
    id: 'brand.references.resolve', version: '1.0.0', kind: 'primitive', handler: 'brand-kernel/references.resolve', title: 'Resolver referencias de marca',
    description: 'Resuelve referencias visuales concretas y devuelve sus hashes de procedencia.', tags: ['brand', 'references', 'asset'], useCases: ['Usar referencias en una generación'], permissions: ['brand:read', 'asset:read'],
    inputSchema: objectSchema({ brandId: idSchema, brandKitVersionId: idSchema, referenceIds: { type: 'array' } }, ['brandId', 'brandKitVersionId']), outputSchema: objectSchema({ references: { type: 'array' } }, ['references'])
  },
  {
    id: 'brand.generation.prepare', version: '1.0.0', kind: 'primitive', handler: 'brand-kernel/generation.prepare', title: 'Preparar generación de marca',
    description: 'Crea una preparación inmutable para una generación externa con Brand Kit y referencias fijados.', tags: ['brand', 'generation', 'provenance'], useCases: ['Preparar una imagen generativa'], permissions: ['brand:read', 'asset:read'],
    inputSchema: objectSchema({ brandId: idSchema, brandKitVersionId: idSchema, assetType: { type: 'string' }, references: { type: 'array' } }, ['brandId', 'brandKitVersionId', 'assetType']), outputSchema: objectSchema({ preparationId: idSchema, snapshotHash: { type: 'string' }, expiresAt: { type: 'string' } }, ['preparationId', 'snapshotHash', 'expiresAt'])
  },
  {
    id: 'copy.validate', version: '1.0.0', kind: 'primitive', handler: 'copy/validate', title: 'Validar copy',
    description: 'Comprueba voz, claims, términos prohibidos y requisitos editoriales sin generar texto.', tags: ['copy', 'validation', 'brand'], useCases: ['Validar un guion', 'Revisar un caption'], permissions: ['brand:read', 'copy:validate'], reviewPolicy: 'human_required',
    inputSchema: objectSchema({ brandId: idSchema, brandKitVersionId: idSchema, text: { type: 'string' }, purpose: { type: 'string' } }, ['brandId', 'brandKitVersionId', 'text']), outputSchema: objectSchema({ valid: { type: 'boolean' }, findings: { type: 'array' } }, ['valid', 'findings'])
  },
  {
    id: 'asset.register', version: '1.0.0', kind: 'primitive', handler: 'asset/register', title: 'Registrar asset',
    description: 'Registra un asset ya recibido y conserva su hash, origen y pertenencia.', tags: ['asset', 'storage', 'provenance'], useCases: ['Guardar una imagen aportada por el usuario'], permissions: ['asset:write'],
    inputSchema: objectSchema({ workspaceId: idSchema, brandId: idSchema, contentType: { type: 'string' }, sha256: { type: 'string' }, source: { type: 'string' } }, ['workspaceId', 'brandId', 'contentType', 'sha256']), outputSchema: objectSchema({ assetId: idSchema, sha256: { type: 'string' } }, ['assetId', 'sha256'])
  },
  {
    id: 'production.image.product.transform', version: '1.0.0', kind: 'primitive', handler: 'production/image-product-transform', title: 'Transformar imagen de producto',
    description: 'Crea una variante visual de un producto usando el estilo fijado de la marca sin modificar el original.', tags: ['image', 'product', 'brand', 'transform'], useCases: ['Preparar un plato para redes', 'Adaptar un producto a Story'], permissions: ['asset:read', 'asset:write', 'brand:read'], sideEffects: ['asset_write'], reviewPolicy: 'human_required',
    inputSchema: objectSchema({ sourceAsset: assetRefSchema, brandId: idSchema, brandKitVersionId: idSchema, formatProfile: { type: 'string' }, instructions: { type: 'string' } }, ['sourceAsset', 'brandId', 'brandKitVersionId', 'formatProfile']), outputSchema: objectSchema({ assets: { type: 'array' }, provenance: { type: 'object' } }, ['assets', 'provenance'])
  },
  {
    id: 'production.motion.compose', version: '1.0.0', kind: 'primitive', handler: 'production/motion-compose', title: 'Componer motion graphics',
    description: 'Compone un vídeo corto a partir de assets, copy, audio y un perfil de formato.', tags: ['motion', 'video', 'reel', 'story'], useCases: ['Generar un Reel', 'Generar una Story animada'], permissions: ['asset:read', 'brand:read', 'production:motion'], sideEffects: ['asset_write', 'job_create'], reviewPolicy: 'human_required',
    inputSchema: objectSchema({ brandId: idSchema, brandKitVersionId: idSchema, inputs: { type: 'array' }, formatProfile: { type: 'string' }, script: { type: 'string' }, audioAsset: assetRefSchema }, ['brandId', 'brandKitVersionId', 'inputs', 'formatProfile']), outputSchema: objectSchema({ jobId: idSchema, assets: { type: 'array' }, composition: { type: 'object' } }, ['jobId', 'assets', 'composition']), errors: [{ code: 'FORMAT_UNSUPPORTED', retryable: false }, { code: 'RENDER_TEMPORARY_FAILURE', retryable: true }]
  },
  {
    id: 'publication.destination.list', version: '1.0.0', kind: 'primitive', handler: 'publication/destination-list', title: 'Listar destinos de publicación',
    description: 'Devuelve canales y herramientas de publicación disponibles para el usuario y la marca.', tags: ['publication', 'publisher', 'channel'], useCases: ['Elegir dónde publicar un Reel'], permissions: ['publication:read'],
    inputSchema: objectSchema({ workspaceId: idSchema, brandId: idSchema, formatProfile: { type: 'string' } }, ['workspaceId', 'brandId']), outputSchema: objectSchema({ destinations: { type: 'array' } }, ['destinations']), metadata: { channels: ['instagram_reel', 'instagram_story', 'linkedin', 'wordpress'], providers: ['buffer', 'postiz', 'planable', 'metricool', 'wordpress'] }
  },
  {
    id: 'publication.validate', version: '1.0.0', kind: 'primitive', handler: 'publication/validate', title: 'Validar publicación',
    description: 'Comprueba formato, conexión, permisos y revisión antes de enviar un bundle a un destino.', tags: ['publication', 'validation', 'publisher'], useCases: ['Verificar que un Reel se puede publicar'], permissions: ['publication:read', 'asset:read'],
    inputSchema: objectSchema({ bundle: { type: 'object' }, destinationId: idSchema }, ['bundle', 'destinationId']), outputSchema: objectSchema({ valid: { type: 'boolean' }, findings: { type: 'array' } }, ['valid', 'findings'])
  },
  {
    id: 'publication.route', version: '1.0.0', kind: 'primitive', handler: 'publication/route', title: 'Elegir ruta de publicación',
    description: 'Selecciona un canal y una herramienta compatibles con un bundle aprobado.', tags: ['publication', 'publisher', 'routing'], useCases: ['Recomendar Buffer para un Reel de Instagram'], permissions: ['publication:write'],
    inputSchema: objectSchema({ bundle: { type: 'object' }, channel: { type: 'string' }, provider: { type: 'string' } }, ['bundle']), outputSchema: objectSchema({ destinationId: idSchema, channel: { type: 'string' }, provider: { type: 'string' } }, ['destinationId', 'channel', 'provider'])
  },
  {
    id: 'publication.prepare', version: '1.0.0', kind: 'primitive', handler: 'publication/prepare', title: 'Preparar publicación para revisión',
    description: 'Construye y persiste un bundle listo para revisión humana sin contactar proveedores.', tags: ['publication', 'publisher', 'prepare'], useCases: ['Preparar un Reel para aprobación'], permissions: ['publication:write'], sideEffects: ['audit'], reviewPolicy: 'human_required',
    inputSchema: objectSchema({ bundle: { type: 'object' }, channel: { type: 'string' }, provider: { type: 'string' } }, ['bundle']), outputSchema: objectSchema({ publicationId: idSchema, state: { type: 'string' }, bundle: { type: 'object' } }, ['publicationId', 'state'])
  },
  {
    id: 'publication.schedule', version: '1.0.0', kind: 'primitive', handler: 'publication/schedule', title: 'Programar publicación',
    description: 'Programa un bundle aprobado en el canal y herramienta elegidos.', tags: ['publication', 'publisher', 'schedule'], useCases: ['Programar un Reel revisado'], permissions: ['publication:write', 'publication:publish'], sideEffects: ['external_publish'], reviewPolicy: 'human_required',
    inputSchema: objectSchema({ bundle: { type: 'object' }, destinationId: idSchema, scheduledAt: { type: 'string' } }, ['bundle', 'destinationId', 'scheduledAt']), outputSchema: objectSchema({ publicationId: idSchema, status: { type: 'string' } }, ['publicationId', 'status'])
  },
  {
    id: 'publication.publish', version: '1.0.0', kind: 'primitive', handler: 'publication/publish', title: 'Publicar bundle aprobado',
    description: 'Envía un bundle aprobado a la herramienta y canal elegidos.', tags: ['publication', 'publisher', 'external'], useCases: ['Publicar un Reel aprobado'], permissions: ['publication:write', 'publication:publish'], sideEffects: ['external_publish'], reviewPolicy: 'human_required',
    inputSchema: objectSchema({ bundle: { type: 'object' }, destinationId: idSchema, idempotencyKey: idSchema }, ['bundle', 'destinationId', 'idempotencyKey']), outputSchema: objectSchema({ publicationId: idSchema, status: { type: 'string' }, externalId: { type: 'string' } }, ['publicationId', 'status'])
  },
  {
    id: 'publication.status.get', version: '1.0.0', kind: 'primitive', handler: 'publication/status.get', title: 'Consultar publicación',
    description: 'Consulta el estado interno y externo de una publicación.', tags: ['publication', 'publisher', 'status'], useCases: ['Comprobar si un Reel ya está publicado'], permissions: ['publication:read'],
    inputSchema: objectSchema({ publicationId: idSchema }, ['publicationId']), outputSchema: objectSchema({ publicationId: idSchema, status: { type: 'string' }, externalStatus: { type: 'string' } }, ['publicationId', 'status'])
  },
  {
    id: 'recipe.food-to-reel', version: '1.0.0', kind: 'recipe', handler: 'recipes/food-to-reel', title: 'Imagen y texto a Reel',
    description: 'Combina contexto de marca, validación de copy y motion para convertir una imagen de comida y su explicación en un Reel revisable.', tags: ['recipe', 'food', 'reel', 'motion'], useCases: ['Crear un Reel del plato del día'], permissions: ['brand:read', 'asset:read', 'copy:validate', 'production:motion'], dependencies: ['brand.context.get', 'copy.validate', 'production.motion.compose'], sideEffects: ['asset_write', 'job_create'], reviewPolicy: 'human_required',
    inputSchema: objectSchema({ brandId: idSchema, brandKitVersionId: idSchema, image: assetRefSchema, text: { type: 'string' }, formatProfile: { type: 'string' } }, ['brandId', 'brandKitVersionId', 'image', 'text']), outputSchema: objectSchema({ runId: idSchema, assets: { type: 'array' }, copy: { type: 'object' }, review: { type: 'object' } }, ['runId', 'assets', 'copy', 'review'])
  },
  {
    id: 'recipe.product-to-social', version: '1.0.0', kind: 'recipe', handler: 'recipes/product-to-social', title: 'Producto a publicación social',
    description: 'Adapta un asset de producto al formato elegido, valida el copy y devuelve destinos de publicación compatibles para revisión.', tags: ['recipe', 'product', 'social', 'publisher'], useCases: ['Preparar un producto para Feed o Story'], permissions: ['brand:read', 'asset:read', 'asset:write', 'copy:validate', 'publication:read'], dependencies: ['brand.context.get', 'production.image.product.transform', 'copy.validate', 'publication.destination.list'], sideEffects: ['asset_write'], reviewPolicy: 'human_required',
    inputSchema: objectSchema({ brandId: idSchema, brandKitVersionId: idSchema, sourceAsset: assetRefSchema, text: { type: 'string' }, formatProfile: { type: 'string' } }, ['brandId', 'brandKitVersionId', 'sourceAsset', 'text', 'formatProfile']), outputSchema: objectSchema({ runId: idSchema, assets: { type: 'array' }, destinations: { type: 'array' }, review: { type: 'object' } }, ['runId', 'assets', 'destinations', 'review'])
  },
  {
    id: 'recipe.menu-to-reel', version: '1.0.0', kind: 'recipe', handler: 'recipes/menu-to-reel', title: 'Menú del día a Reel',
    description: 'Combina una imagen, el texto del menú y las reglas de marca para producir un Reel listo para revisión y posterior publicación.', tags: ['recipe', 'menu', 'reel', 'publisher'], useCases: ['Convertir el menú diario en una pieza social'], permissions: ['brand:read', 'asset:read', 'copy:validate', 'production:motion', 'publication:read'], dependencies: ['brand.context.get', 'copy.validate', 'production.motion.compose', 'publication.destination.list'], sideEffects: ['asset_write', 'job_create'], reviewPolicy: 'human_required',
    inputSchema: objectSchema({ brandId: idSchema, brandKitVersionId: idSchema, image: assetRefSchema, menuText: { type: 'string' } }, ['brandId', 'brandKitVersionId', 'image', 'menuText']), outputSchema: objectSchema({ runId: idSchema, assets: { type: 'array' }, destinations: { type: 'array' }, review: { type: 'object' } }, ['runId', 'assets', 'destinations', 'review'])
  }
])

export function createDefaultCapabilityRegistry() {
  return new CapabilityRegistry(DEFAULT_CAPABILITY_MANIFESTS)
}

export function listCapabilities(options = {}) {
  return createDefaultCapabilityRegistry().list(options)
}

export function searchCapabilities(options = {}) {
  return createDefaultCapabilityRegistry().search(options)
}
