// Same targets as compositionForAssetType. Kept here so validation does not load the brand kit.
const DIMENSIONS = {
  blog_cover: [1536, 1024],
  social_image: [1080, 1350],
  instagram_story: [1080, 1920],
  presentation: [1920, 1080]
}

export const FINAL_IMAGE_RENDERER = 'chatgpt-image-generation'

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

function textContentOf(value) {
  const source = jsonObject(value?.textContent)
  const copy = jsonObject(value?.copy)
  return {
    headline: String(source.headline || copy.headline || value?.headline || '').trim(),
    body: String(source.body || copy.body || value?.body || value?.text || '').trim()
  }
}

function renderMetadataOf(value) {
  const source = jsonObject(value)
  const nested = jsonObject(source.render)
  const metadata = jsonObject(source.metadata)
  const grounding = jsonObject(metadata.brandGrounding)
  const textSource = Object.keys(jsonObject(source.textContent)).length
    ? source
    : Object.keys(jsonObject(nested.textContent)).length
      ? nested
      : Object.keys(jsonObject(grounding.textContent || grounding.socialTextContent)).length
        ? grounding
        : source
  return {
    textRendered: source.textRendered === true || nested.textRendered === true || grounding.textRendered === true,
    templateId: String(source.templateId || nested.templateId || grounding.templateId || '').trim(),
    renderedBy: String(source.renderedBy || nested.renderedBy || grounding.renderedBy || '').trim(),
    textContent: textContentOf(textSource)
  }
}

function hasTextContent(value) {
  const source = textContentOf(value)
  return Boolean(source.headline && source.body)
}

function expectedDimensionsForChannel(channel) {
  if (channel === 'instagram') return DIMENSIONS.social_image
  if (channel === 'instagram_story') return DIMENSIONS.instagram_story
  return null
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
    copyStale: metadata.contentCopyStale === true,
    grounding,
    render: renderMetadataOf({ ...metadata, ...grounding })
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
    expectedAssetCount = bodySlides.length || instagramSlides.length || expectedFromMedia || 1
  } else if (channel === 'instagram_story') {
    expectedAssetCount = frames.length || expectedFromMedia || 1
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

function blogEditorialFields(body) {
  const source = jsonObject(body)
  const localized = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value.es || value.en || ''
    return value || ''
  }
  return {
    title: source.title,
    slug: source.slug,
    excerpt: source.excerpt || source.excerptEs,
    bodyHtml: source.bodyHtml || source.body,
    metaTitle: localized(source.metaTitle || source.metaTitleEs),
    metaDescription: localized(source.metaDescription || source.metaDescriptionEs),
    imageAlt: source.imageAlt || source.imageAltText || source.heroImageAlt || source.coverImageAlt,
    author: source.author || source.authorName
  }
}

function renderIssues(missing, value, name) {
  const render = renderMetadataOf(value)
  if (render.textRendered !== true) missing.push(`${name}.textRendered`)
  if (!render.templateId) missing.push(`${name}.templateId`)
  if (render.renderedBy !== FINAL_IMAGE_RENDERER) missing.push(`${name}.renderedBy`)
  if (!hasTextContent(value)) {
    missing.push(`${name}.textContent`)
    return render
  }
  const textContent = textContentOf(value)
  requiredText(missing, textContent.headline, `${name}.textContent.headline`)
  requiredText(missing, textContent.body, `${name}.textContent.body`)
  return render
}

function compareMediaRender(missing, media, frame, name) {
  if (!media) return
  const frameRender = renderMetadataOf(frame)
  const mediaRender = media.render
  if (mediaRender.templateId && frameRender.templateId && mediaRender.templateId !== frameRender.templateId) missing.push(`${name}.templateId`)
  if (mediaRender.renderedBy && frameRender.renderedBy && mediaRender.renderedBy !== frameRender.renderedBy) missing.push(`${name}.renderedBy`)
  const frameText = frameRender.textContent
  const mediaText = mediaRender.textContent
  if (mediaText.headline && mediaText.body && frameText.headline && frameText.body && (mediaText.headline !== frameText.headline || mediaText.body !== frameText.body)) missing.push(`${name}.textContent`)
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
    if (media.copyStale && ['instagram', 'instagram_story'].includes(state.channel)) missing.push(`media[${media.position}].contentCopyStale`)
    const channelDimensions = expectedDimensionsForChannel(state.channel)
    if (channelDimensions && (media.width !== channelDimensions[0] || media.height !== channelDimensions[1])) {
      missing.push(`media[${media.position}].dimensions`)
    }
    if (!ground) {
      if (channelDimensions) missing.push(`media[${media.position}].render`)
      continue
    }
    if (!String(ground.brandPreparationId || ground.preparationId || '').trim()) missing.push(`media[${media.position}].preparationId`)
    if (state.itemId && ground.itemId && ground.itemId !== state.itemId) missing.push(`media[${media.position}].itemId`)
    const channels = Array.isArray(ground.channels) ? ground.channels.map(String) : ground.channel ? [String(ground.channel)] : []
    if (channels.length && !channels.includes(state.channel)) missing.push(`media[${media.position}].channel`)
    const [width, height] = DIMENSIONS[String(ground.assetType || '')] || []
    if (width && (media.width !== width || media.height !== height)) missing.push(`media[${media.position}].dimensions`)
    if (channelDimensions) {
      const render = media.render
      if (render.textRendered !== true) missing.push(`media[${media.position}].textRendered`)
      if (!render.templateId) missing.push(`media[${media.position}].templateId`)
      if (render.renderedBy !== FINAL_IMAGE_RENDERER) missing.push(`media[${media.position}].renderedBy`)
      const directTextContent = jsonObject(ground.textContent)
      const textContent = Object.keys(directTextContent).length ? directTextContent : jsonObject(ground.socialTextContent)
      if (!Object.keys(textContent).length || !String(textContent.headline || '').trim() || !String(textContent.body || '').trim()) missing.push(`media[${media.position}].textContent`)
    }
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

function reviewCopy(state, fallback = '') {
  const pack = jsonObject(state.body.socialPack)
  if (state.channel === 'instagram') return String(pack.instagramCaption || pack.caption || state.body.caption || state.body.text || state.body.body || fallback).trim()
  if (state.channel === 'instagram_story') {
    const story = jsonObject(pack.instagramStory)
    return String(story.text || story.caption || state.body.text || state.body.caption || fallback).trim()
  }
  if (state.channel === 'video') return String(state.body.publishCopy || state.body.caption || state.body.text || pack.videoCaption || pack.videoCopy || state.body.videoScript || state.body.script || fallback).trim()
  return String(state.body.text || state.body.caption || state.body.body || state.body.bodyHtml || fallback).trim()
}

// Review only needs editorial copy and usable media. Render provenance remains enforced when assets enter the canonical store.
export function reviewMissingVariantFields(variant) {
  const state = canonicalVariantState(variant)
  const missing = []
  if (state.channel === 'blog') {
    const fields = blogEditorialFields(state.body)
    for (const field of ['title', 'slug', 'excerpt', 'bodyHtml', 'metaTitle', 'metaDescription', 'imageAlt', 'author']) requiredText(missing, fields[field], field)
    if (!state.media.length) missing.push('media')
  } else if (state.channel === 'instagram') {
    requiredText(missing, reviewCopy(state), 'socialPack.instagramCaption')
    if (!state.media.length) missing.push('media')
    if (state.expectedAssetCount > 1 && state.media.length < state.expectedAssetCount) missing.push('media.count')
  } else if (state.channel === 'instagram_story') {
    requiredText(missing, reviewCopy(state), 'socialPack.instagramStory.text')
    if (!state.media.length) missing.push('media')
    if (state.expectedAssetCount > 1 && state.media.length < state.expectedAssetCount) missing.push('media.count')
  } else if (state.channel === 'video') {
    requiredText(missing, reviewCopy(state), 'publishCopy')
    if (!state.media.length) missing.push('media')
  } else if (!Object.keys(state.body).length) missing.push('body')
  return missing
}

function fieldsFor(state) {
  const missing = []
  if (state.channel === 'blog') {
    const fields = blogEditorialFields(state.body)
    for (const field of ['title', 'slug', 'excerpt', 'bodyHtml', 'metaTitle', 'metaDescription', 'imageAlt', 'author']) requiredText(missing, fields[field], field)
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
        renderIssues(missing, slide, `socialPack.instagramSlides[${index}]`)
        compareMediaRender(missing, state.media.find((media) => media.assetIndex === index), slide, `media[${index}]`)
      }
    } else if (slides.length === 1) {
      for (const field of ['headline', 'body', 'alt']) requiredText(missing, slides[0][field], `socialPack.instagramSlides[0].${field}`)
      renderIssues(missing, slides[0], 'socialPack.instagramSlides[0]')
      compareMediaRender(missing, state.media.find((media) => media.assetIndex === 0), slides[0], 'media[0]')
    }
    missing.push(...mediaIssues(state, true))
  } else if (state.channel === 'linkedin') {
    requiredText(missing, state.body.text, 'text')
    if (!state.media.length) missing.push('media')
    else missing.push(...mediaIssues(state, false))
  } else if (state.channel === 'instagram_story') {
    const story = jsonObject(jsonObject(state.body.socialPack).instagramStory)
    requiredText(missing, story.linkUrl, 'socialPack.instagramStory.linkUrl')
    if (!state.frames.length) missing.push('socialPack.instagramStory.frames')
    for (let index = 0; index < state.expectedAssetCount; index += 1) {
      const frame = state.frames[index]
      if (!frame) missing.push(`socialPack.instagramStory.frames[${index}]`)
      else {
        requiredText(missing, frame.alt, `socialPack.instagramStory.frames[${index}].alt`)
        renderIssues(missing, frame, `socialPack.instagramStory.frames[${index}]`)
        compareMediaRender(missing, state.media.find((media) => media.assetIndex === index), frame, `media[${index}]`)
      }
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
