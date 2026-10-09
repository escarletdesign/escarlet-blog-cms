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
  assert.ok(guide.structuredContent.examples.some((example) => example.execute?.tool === 'recipe.run'))
  assert.ok(guide.structuredContent.examples.some((example) => example.execute?.arguments?.formatProfile === 'instagram_story'))

  const search = await call(server, 'capability.search', { query: 'food reel', type: 'recipe' })
  assert.equal(search.isError, false)
  assert.ok(search.structuredContent.capabilities.some((entry) => entry.id === 'recipe.food-to-reel'))

  const recipes = await call(server, 'recipe.list', { query: 'menu' })
  assert.equal(recipes.isError, false)
  assert.ok(recipes.structuredContent.recipes.some((entry) => entry.id === 'recipe.menu-to-reel'))

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
