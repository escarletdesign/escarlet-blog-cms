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

const LEGACY_NAME = /^(?:blog|social|content|video|brand)_/

function jsonResult(value) {
  return {
    isError: false,
    structuredContent: value,
    content: [{ type: 'text', text: JSON.stringify(value) }]
  }
}

function errorResult(error, fallbackCode = 'capability_failed') {
  const code = error?.code || fallbackCode
  const status = Number.isInteger(error?.status) ? error.status : 500
  const value = { error: { code, status, retryable: error?.retryable === true, message: String(error?.message || 'La capability no está disponible.') } }
  return { isError: true, structuredContent: value, content: [{ type: 'text', text: JSON.stringify(value) }] }
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
    const haystack = [entry.id, entry.description, ...(entry.tags || []), ...(entry.composesWith || [])].join(' ').toLowerCase()
    return queryTokens.every((token) => haystack.includes(token))
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
    .filter((entry) => !query || [entry.id, entry.description, ...(entry.tags || [])].join(' ').toLowerCase().includes(query))
    .map((entry) => {
      const publicEntry = publicCapabilityManifest(entry)
      const { inputSchema, outputSchema, ...summary } = publicEntry
      return { ...summary, inputKeys: Object.keys(inputSchema?.properties || {}), outputKeys: Object.keys(outputSchema?.properties || {}) }
    })
  return { contractVersion: MCP_V3_CONTRACT, recipes }
}

async function invokeRegisteredCapability(catalog, capability, name, args, auth) {
  if (typeof catalog.invoke === 'function') return catalog.invoke(name, args, { auth, capability, contractVersion: MCP_V3_CONTRACT })
  if (typeof capability?.handler === 'function') return capability.handler(args, { auth, capability, contractVersion: MCP_V3_CONTRACT })
  if (typeof capability?.execute === 'function') return capability.execute(args, { auth, capability, contractVersion: MCP_V3_CONTRACT })
  const builtin = await invokeBuiltinCapability(name, args, { auth, capability, contractVersion: MCP_V3_CONTRACT })
  if (builtin !== undefined) return builtin
  const error = new Error(`La capability ${name} está catalogada pero todavía necesita un ejecutor registrado.`)
  error.code = 'capability_executor_missing'
  error.status = 501
  error.retryable = false
  throw error
}

async function callCapability(catalog, auth, name, args) {
  if (name === 'capability.search') return searchCapabilities(catalog, auth, args)
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
    return { contractVersion: MCP_V3_CONTRACT, capability: publicCapabilityManifest(capability) }
  }
  if (name === 'recipe.list') return listRecipes(catalog, auth, args)
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
    return { contractVersion: MCP_V3_CONTRACT, recipe: publicCapabilityManifest(recipe) }
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
  if (name === 'recipe.get') return { contractVersion: MCP_V3_CONTRACT, recipe: publicCapabilityManifest(capability) }
  return invokeRegisteredCapability(catalog, capability, name, args, auth)
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
  return resources.concat(catalog.resources || [])
}

function readResource(catalog, auth, uri) {
  if (uri === 'escarlet://capabilities/index') return { uri, mimeType: 'application/json', text: JSON.stringify({ contractVersion: MCP_V3_CONTRACT, capabilities: visibleCapabilities(catalog, auth).map(publicCapabilityManifest) }) }
  if (uri === 'escarlet://recipes/index') return { uri, mimeType: 'application/json', text: JSON.stringify({ contractVersion: MCP_V3_CONTRACT, recipes: catalog.recipes.filter((entry) => canUseCapability(auth, entry)).map(publicCapabilityManifest) }) }
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

function createServer(auth, catalog) {
  const server = new Server(
    { name: MCP_V3_SERVER_NAME, version: MCP_V3_SERVER_VERSION, title: 'Escarlet OS' },
    {
      capabilities: { tools: { listChanged: true }, resources: { subscribe: false, listChanged: true } },
      instructions: 'Escarlet OS expone capabilities namespaced. Descubre primero, fija la marca y su Brand Kit, prepara el trabajo, registra procedencia y deja la publicación para el Publisher tras revisión humana.'
    }
  )

  server.setRequestHandler('tools/list', async () => ({ tools: visibleCapabilities(catalog, auth).map(publicToolManifest) }))
  server.setRequestHandler('resources/list', async () => ({ resources: resourceList(catalog, auth) }))
  server.setRequestHandler('resources/read', async (request) => ({ contents: [readResource(catalog, auth, request.params.uri)] }))
  server.setRequestHandler('tools/call', async (request) => {
    const name = String(request.params?.name || '')
    if (LEGACY_NAME.test(name) || !name.includes('.')) return errorResult(Object.assign(new Error(`La tool ${name} no pertenece al contrato MCP v3.`), { code: 'namespaced_tool_required', status: 400 }), 'namespaced_tool_required')
    try {
      const result = await callCapability(catalog, auth, name, request.params?.arguments || {})
      return jsonResult(result)
    } catch (error) {
      return errorResult(error)
    }
  })
  return server
}

export function createMcpServerV3Sync(auth = { role: 'admin' }, { registry = {}, capabilities, recipes, resources } = {}) {
  return createServer(auth, mergeCatalog({ registry, capabilities, recipes, resources }))
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
