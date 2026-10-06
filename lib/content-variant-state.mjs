// Same targets as compositionForAssetType. Kept here so validation does not load the brand kit.
const DIMENSIONS = {
  blog_cover: [1536, 1024],
  social_image: [1080, 1350],
  instagram_story: [1080, 1920],
  presentation: [1920, 1080]
}

function jsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function integer(value) {
  if (typeof value === 'boolean' || value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}

function groundingOf(media) {
  const grounding = jsonObject(jsonObject(media?.metadata).brandGrounding)
  return Object.keys(grounding).length ? grounding : null
}

function normalizeMedia(media, position) {
  const grounding = groundingOf(media)
  const metadata = jsonObject(media?.metadata)
  const attachmentIndex = integer(media?.assetIndex)
  const groundedIndex = integer(grounding?.assetIndex)
  return {
    position,
    id: media?.id || null,
    assetIndex: attachmentIndex ?? groundedIndex,
    groundedIndex,
    width: integer(media?.width) ?? integer(metadata.width) ?? integer(grounding?.generatedWidth),
    height: integer(media?.height) ?? integer(metadata.height) ?? integer(grounding?.generatedHeight),
    grounding
  }
}

// One reading of a variant row. Validation and MCP detail both call this.
export function canonicalVariantState(variant = {}) {
  const body = jsonObject(variant.body)
  const channel = String(variant.channel || '')
  const pack = jsonObject(body.socialPack)
  const instagramSlides = Array.isArray(pack.instagramSlides) ? pack.instagramSlides : []
  const frames = Array.isArray(jsonObject(pack.instagramStory).frames) ? jsonObject(pack.instagramStory).frames : []
  const bodySlides = Array.isArray(body.slides) ? body.slides : []
  const media = (Array.isArray(variant.media) ? variant.media : []).map(normalizeMedia)
  const declared = media.map((item) => integer(item.grounding?.expectedAssetCount)).filter((value) => value > 0)
  const expectedFromMedia = declared.length && declared.every((value) => value === declared[0]) ? declared[0] : null
  let expectedAssetCount = 1
  if (channel === 'instagram') {
    expectedAssetCount = expectedFromMedia || bodySlides.length || (instagramSlides.length > 1 ? instagramSlides.length : 1)
  } else if (channel === 'instagram_story') {
    expectedAssetCount = expectedFromMedia || frames.length || 1
  }
  return {
    id: variant.id || null,
    itemId: variant.itemId || variant.item_id || null,
    channel,
    status: variant.status || null,
    body,
    media,
    instagramSlides,
    frames,
    bodySlides,
    expectedAssetCount,
    assetIndexes: media.map((item) => item.assetIndex).filter((value) => value !== null),
    mediaCount: media.length
  }
}

function requiredText(missing, value, name) {
  if (!String(value || '').trim()) missing.push(name)
}

function mediaIssues(state, strict) {
  const missing = []
  const expected = strict ? state.expectedAssetCount : 1
  const seen = new Map()
  for (const media of state.media) {
    const index = media.assetIndex
    if (!Number.isInteger(index)) {
      missing.push(`media[${media.position}].assetIndex`)
      continue
    }
    if (seen.has(index)) missing.push(`media.assetIndex[${index}] duplicate`)
    else seen.set(index, media.position)
    if (strict && (index < 0 || index >= expected)) missing.push(`media.assetIndex[${index}]`)
    if (media.groundedIndex !== null && media.groundedIndex !== index) missing.push(`media[${media.position}].assetIndex`)
    const ground = media.grounding
    if (!ground) continue
    if (!String(ground.brandPreparationId || ground.preparationId || '').trim()) missing.push(`media[${media.position}].preparationId`)
    if (state.itemId && ground.itemId && ground.itemId !== state.itemId) missing.push(`media[${media.position}].itemId`)
    const channels = Array.isArray(ground.channels) ? ground.channels.map(String) : ground.channel ? [String(ground.channel)] : []
    if (channels.length && !channels.includes(state.channel)) missing.push(`media[${media.position}].channel`)
    const [width, height] = DIMENSIONS[String(ground.assetType || '')] || []
    if (width && (media.width !== width || media.height !== height)) missing.push(`media[${media.position}].dimensions`)
  }
  const declared = state.media.map((media) => integer(media.grounding?.expectedAssetCount)).filter((value) => value > 0)
  if (declared.length > 1 && declared.some((value) => value !== declared[0])) missing.push('media.expectedAssetCount')
  const preparations = new Set(state.media.map((media) => String(media.grounding?.brandPreparationId || media.grounding?.preparationId || '')).filter(Boolean))
  if (strict && preparations.size > 1) missing.push('media.preparationId')
  const slots = strict ? expected : (state.media.length ? 1 : 0)
  for (let index = 0; index < slots; index += 1) {
    if (!seen.has(index)) missing.push(`media.assetIndex[${index}]`)
  }
  return missing
}

export function assessVariant(variant) {
  const state = canonicalVariantState(variant)
  return { state, fields: fieldsFor(state) }
}

export function missingVariantFields(variant) {
  return assessVariant(variant).fields
}

function fieldsFor(state) {
  const missing = []
  if (state.channel === 'blog') {
    for (const field of ['title', 'slug', 'excerpt', 'bodyHtml', 'metaTitle', 'metaDescription', 'imageAlt', 'author']) requiredText(missing, state.body[field], field)
    if (!state.media.length) missing.push('media')
    else missing.push(...mediaIssues(state, false))
  } else if (state.channel === 'instagram') {
    requiredText(missing, jsonObject(state.body.socialPack).instagramCaption, 'socialPack.instagramCaption')
    const slides = state.instagramSlides
    const expected = state.expectedAssetCount
    if (expected > 1 || slides.length > 1) {
      for (let index = 0; index < expected; index += 1) {
        const slide = slides[index]
        if (!slide) {
          missing.push(`socialPack.instagramSlides[${index}]`)
          continue
        }
        for (const field of ['headline', 'body', 'alt']) requiredText(missing, slide[field], `socialPack.instagramSlides[${index}].${field}`)
      }
    } else if (slides.length === 1) {
      for (const field of ['headline', 'body', 'alt']) requiredText(missing, slides[0][field], `socialPack.instagramSlides[0].${field}`)
    }
    missing.push(...mediaIssues(state, true))
  } else if (state.channel === 'linkedin') {
    requiredText(missing, state.body.text, 'text')
    if (!state.media.length) missing.push('media')
    else missing.push(...mediaIssues(state, false))
  } else if (state.channel === 'instagram_story') {
    const story = jsonObject(jsonObject(state.body.socialPack).instagramStory)
    requiredText(missing, story.text, 'socialPack.instagramStory.text')
    requiredText(missing, story.linkUrl, 'socialPack.instagramStory.linkUrl')
    if (!state.frames.length) missing.push('socialPack.instagramStory.frames')
    for (let index = 0; index < state.expectedAssetCount; index += 1) {
      const frame = state.frames[index]
      if (!frame) missing.push(`socialPack.instagramStory.frames[${index}]`)
      else requiredText(missing, frame.alt, `socialPack.instagramStory.frames[${index}].alt`)
    }
    missing.push(...mediaIssues(state, true))
  } else if (state.channel === 'video') {
    const pack = jsonObject(state.body.socialPack)
    const copy = String(state.body.publishCopy || pack.videoCaption || pack.videoCopy || pack.videoScript || state.body.text || state.body.caption || '').trim()
    if (!copy) missing.push('publishCopy')
    if (!state.media.length) missing.push('media')
    else missing.push(...mediaIssues(state, false))
  } else if (!Object.keys(state.body).length) missing.push('body')
  return missing
}

export function validationDiagnostic(itemId, variant, fields) {
  const state = Array.isArray(variant?.assetIndexes) ? variant : canonicalVariantState(variant)
  return {
    event: 'content_validation_failed',
    itemId,
    channel: state.channel,
    variantId: state.id,
    expectedAssetCount: state.expectedAssetCount,
    mediaCount: state.mediaCount,
    mediaAssetIndexes: state.assetIndexes,
    bodySlidesCount: state.bodySlides.length,
    instagramSlidesCount: state.instagramSlides.length,
    missingFields: fields
  }
}

// Body updates replace the stored JSON. visualBrief alone patches that one key.
export function nextVariantBody({ currentBody, body, visualBrief } = {}) {
  if (body !== undefined) return jsonObject(body)
  const current = jsonObject(currentBody)
  if (visualBrief !== undefined) return { ...current, visualBrief: jsonObject(visualBrief) }
  return current
}

export function summarizeContentListItem(row = {}) {
  const metadata = jsonObject(row.metadata)
  const variants = Array.isArray(row.variants) ? row.variants : []
  const topic = String(row.topic || '').replace(/\s+/g, ' ').trim()
  const title = String(metadata.contentTitle || '').trim() || topic.slice(0, 120)
  return {
    id: row.id,
    batchId: row.batchId || row.batch_id || null,
    title,
    topic: topic.length > 180 ? `${topic.slice(0, 177).trim()}…` : topic,
    status: row.status,
    channels: variants.map((variant) => variant.channel).filter(Boolean),
    variantStatus: Object.fromEntries(variants.filter((variant) => variant.channel).map((variant) => [variant.channel, variant.status])),
    mediaCount: variants.reduce((sum, variant) => sum + Number(variant.mediaCount || 0), 0),
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null
  }
}
