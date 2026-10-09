import test from 'node:test'
import assert from 'node:assert/strict'
import { createMcpServerV3 } from './server.mjs'

async function call(server, name, arguments_ = {}) {
  return server._requestHandlers.get('tools/call')({
    method: 'tools/call',
    params: { name, arguments: arguments_ }
  }, { mcpReq: { requestState: () => undefined } })
}

test('simulación de un agente nuevo: el MCP explica, descubre e inspecciona antes de ejecutar', async () => {
  const user = await createMcpServerV3({ role: 'viewer', site: 'escarlet' })
  const userGuide = await call(user, 'capability.guide')
  assert.equal(userGuide.isError, false)
  const userTools = await user._requestHandlers.get('tools/list')({ method: 'tools/list', params: {} })
  assert.equal(userTools.tools.some((tool) => tool.name === 'recipe.run'), false)
  const denied = await call(user, 'recipe.run', { recipeId: 'recipe.food-to-reel' })
  assert.equal(denied.structuredContent.error.code, 'capability_permission_missing')

  const server = await createMcpServerV3({ role: 'agent', site: 'escarlet' })
  const listed = await server._requestHandlers.get('tools/list')({ method: 'tools/list', params: {} })
  assert.ok(listed.tools.some((tool) => tool.name === 'capability.guide'))

  const coldStart = await call(server, 'capability.guide')
  assert.equal(coldStart.isError, false)
  assert.equal(coldStart.structuredContent.goal, null)
  assert.ok(coldStart.structuredContent.rules.some((rule) => rule.includes('nombres namespaced')))

  const guide = await call(server, 'capability.guide', { goal: 'crear un reel del menú del día' })
  assert.equal(guide.isError, false)
  assert.equal(guide.structuredContent.goal, 'crear un reel del menú del día')
  assert.ok(guide.structuredContent.firstSteps.some((step) => step.includes('recipe.list')))
  assert.ok(guide.structuredContent.firstSteps.some((step) => step.includes('brand.generation.prepare')))
  assert.ok(guide.structuredContent.firstSteps.some((step) => step.includes('asset.upload')))
  assert.ok(guide.structuredContent.rules.some((rule) => rule.includes('no compone imágenes sociales')))
  assert.ok(guide.structuredContent.rules.some((rule) => rule.includes('assetId y url')))
  assert.ok(guide.structuredContent.rules.some((rule) => rule.includes('chatgpt-image-generation')))
  assert.ok(guide.structuredContent.examples.some((example) => example.execute?.tool === 'recipe.run'))
  assert.ok(guide.structuredContent.examples.some((example) => example.execute?.arguments?.formatProfile === 'instagram_story'))
  const carousel = guide.structuredContent.examples.find((example) => example.intent === 'Crear un carrusel de Instagram')
  assert.equal(carousel?.execute?.tool, 'brand.generation.prepare')
  assert.equal(carousel?.execute?.arguments?.assetType, 'social_image')
  const preparedCarousel = await call(server, 'brand.generation.prepare', {
    site: 'escarlet',
    purpose: 'instagram-carousel',
    assetType: 'social_image',
    formatProfile: 'instagram_post',
    expectedAssetCount: 6,
    channel: 'instagram',
    topic: 'Una idea sobre diseño de marca'
  })
  assert.equal(preparedCarousel.isError, false)
  assert.equal(preparedCarousel.structuredContent.preparation.expectedAssetCount, 6)
  assert.equal(preparedCarousel.structuredContent.composition.dimensions, '1080x1350')
  assert.equal(preparedCarousel.structuredContent.brandPreparation.finalTextRenderer, 'chatgpt-image-generation')

  const search = await call(server, 'capability.search', { query: 'food reel', type: 'recipe' })
  assert.equal(search.isError, false)
  assert.ok(search.structuredContent.capabilities.some((entry) => entry.id === 'recipe.food-to-reel'))

  const recipes = await call(server, 'recipe.list', { query: 'menu' })
  assert.equal(recipes.isError, false)
  assert.ok(recipes.structuredContent.recipes.some((entry) => entry.id === 'recipe.menu-to-reel'))
  const generic = await call(server, 'recipe.list', { query: 'imagen y guion a reel' })
  assert.equal(generic.isError, false)
  assert.ok(generic.structuredContent.recipes.some((entry) => entry.id === 'recipe.reel-from-image'))

  const recipe = await call(server, 'recipe.get', { recipeId: 'recipe.food-to-reel' })
  assert.equal(recipe.isError, false)
  assert.deepEqual(recipe.structuredContent.recipe.dependencies, ['brand.context.get', 'copy.validate', 'production.motion.compose'])

  const publisher = await call(server, 'capability.get', { capabilityId: 'publication.destination.list' })
  assert.equal(publisher.isError, false)
  assert.ok(publisher.structuredContent.capability.metadata.uiApps.some((app) => app.id === 'publication.blog'))

  const missingInput = await call(server, 'recipe.run', { recipeId: 'recipe.food-to-reel' })
  assert.equal(missingInput.isError, true)
  assert.equal(missingInput.structuredContent.error.code, 'recipe_text_required')

  const missingProduct = await call(server, 'recipe.run', { recipeId: 'recipe.product-to-social', site: 'escarlet', text: 'Novedad de temporada' })
  assert.equal(missingProduct.isError, true)
  assert.equal(missingProduct.structuredContent.error.code, 'product_source_required')
})
