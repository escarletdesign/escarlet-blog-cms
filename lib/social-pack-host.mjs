/** CMS-canonical Social Pack payloads used by the PWA and MCP APIs. */
import { getCanonicalUrl, getSocialPackChannels } from './site-config.mjs'
import { isProductRestructureV1 } from './product-flags.mjs'

export const PACK_SOURCE_CMS = 'cms'

export function isCmsSocialPackHostEnabled() {
  return isProductRestructureV1()
}

/** @param {{ cmsHostEnabled?: boolean }} [opts] */
export function resolveSocialPackSource(opts = {}) {
  const enabled = Object.prototype.hasOwnProperty.call(opts, 'cmsHostEnabled')
    ? Boolean(opts.cmsHostEnabled)
    : isCmsSocialPackHostEnabled()
  return enabled ? PACK_SOURCE_CMS : null
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function text(value) {
  return String(value || '').trim()
}

function normalizeTextContent(frame) {
  const source = object(frame?.textContent)
  const copy = object(frame?.copy)
  return {
    headline: text(source.headline || copy.headline || frame?.headline),
    body: text(source.body || copy.body || frame?.body || frame?.text)
  }
}

function normalizeStoryFrame(frame) {
  const raw = object(frame)
  const render = object(raw.render)
  const textContent = normalizeTextContent(raw)
  return {
    ...(raw.id ? { id: text(raw.id) } : {}),
    ...(Number.isInteger(Number(raw.assetIndex)) ? { assetIndex: Number(raw.assetIndex) } : {}),
    imageUrl: text(raw.imageUrl || raw.url || raw.image),
    alt: text(raw.alt),
    headline: text(textContent.headline || raw.headline),
    body: text(textContent.body || raw.body),
    textContent,
    ...(raw.dimensions ? { dimensions: text(raw.dimensions) } : {}),
    ...(raw.aspectRatio ? { aspectRatio: text(raw.aspectRatio) } : {}),
    templateId: text(raw.templateId || render.templateId),
    renderedBy: text(raw.renderedBy || render.renderedBy),
    textRendered: raw.textRendered === true || render.textRendered === true,
    ...(raw.previewUrl || raw.imagePreviewUrl ? { previewUrl: text(raw.previewUrl || raw.imagePreviewUrl) } : {}),
    ...(raw.thumbUrl || raw.imageThumbUrl ? { thumbUrl: text(raw.thumbUrl || raw.imageThumbUrl) } : {}),
    ...(raw.media && typeof raw.media === 'object' && !Array.isArray(raw.media) ? { media: raw.media } : {}),
    ...(raw.mediaId ? { mediaId: text(raw.mediaId) } : {})
  }
}

function normalizeStory(rawStory) {
  const raw = object(rawStory)
  const hasFrames = Array.isArray(raw.frames)
  const legacyImage = raw.imageUrl || raw.url || raw.image || raw.alt || raw.text || raw.body
  const sourceFrames = hasFrames
    ? raw.frames
    : legacyImage
      ? [{ imageUrl: raw.imageUrl || raw.url || raw.image, alt: raw.alt, body: raw.text || raw.body }]
      : []
  const story = {
    imageUrl: text(raw.imageUrl || raw.url || raw.image),
    alt: text(raw.alt),
    text: text(raw.text || raw.body),
    linkUrl: text(raw.linkUrl || raw.url),
    ...(raw.previewUrl || raw.imagePreviewUrl ? { previewUrl: text(raw.previewUrl || raw.imagePreviewUrl) } : {}),
    ...(raw.thumbUrl || raw.imageThumbUrl ? { thumbUrl: text(raw.thumbUrl || raw.imageThumbUrl) } : {}),
    frames: sourceFrames.map(normalizeStoryFrame)
  }
  return story
}

function hasStoryContent(story) {
  const raw = object(story)
  return Boolean(
    (Array.isArray(raw.frames) && raw.frames.length) ||
    raw.imageUrl || raw.url || raw.image || raw.text || raw.body
  )
}

export function normalizeSocialPack(socialPack, title = '') {
  const raw = socialPack && typeof socialPack === 'object' ? socialPack : {}
  const slides = Array.isArray(raw.instagramSlides)
    ? raw.instagramSlides
        .map((slide) => ({
          ...(slide?.id ? { id: String(slide.id).trim() } : {}),
          ...(Number.isInteger(Number(slide?.assetIndex)) ? { assetIndex: Number(slide.assetIndex) } : {}),
          imageUrl: String(slide?.imageUrl || '').trim(),
          alt: String(slide?.alt || '').trim(),
          headline: String(slide?.headline || '').trim(),
          body: String(slide?.body || '').trim(),
          templateId: String(slide?.templateId || '').trim(),
          ...(slide?.dimensions ? { dimensions: String(slide.dimensions).trim() } : {}),
          ...(slide?.aspectRatio ? { aspectRatio: String(slide.aspectRatio).trim() } : {}),
          backgroundStyle: String(slide?.backgroundStyle || '').trim(),
          backgroundMediaId: String(slide?.backgroundMediaId || '').trim(),
          backgroundSource: String(slide?.backgroundSource || '').trim(),
          renderedBy: String(slide?.renderedBy || '').trim(),
          textRendered: slide?.textRendered === true,
          textContent: normalizeTextContent(slide)
        }))
        .filter((slide) => slide.imageUrl || slide.headline || slide.body)
    : []
  const story = raw.instagramStory && typeof raw.instagramStory === 'object'
    ? normalizeStory(raw.instagramStory)
    : undefined
  return {
    substackTitle: String(raw.substackTitle || title || '').trim(),
    substackBody: String(raw.substackBody || '').trim(),
    linkedin: String(raw.linkedin || '').trim(),
    x: String(raw.x || '').trim(),
    videoScript: String(raw.videoScript || '').trim(),
    instagramCaption: String(raw.instagramCaption || '').trim(),
    instagramSlides: slides,
    ...(story ? { instagramStory: story } : {}),
    visualSystem: raw.visualSystem && typeof raw.visualSystem === 'object' ? raw.visualSystem : undefined
  }
}

export function hasSocialPackContent(post, channels) {
  const pack = post?.socialPack || {}
  const slides = Array.isArray(pack.instagramSlides) ? pack.instagramSlides : []
  const active = channels || {}
  return Boolean(
    (active.substack && (pack.substackBody || pack.substackTitle)) ||
      (active.linkedin && pack.linkedin) ||
      (active.x && pack.x) ||
      (active.videoScript && pack.videoScript) ||
      (active.instagramCarousel && (pack.instagramCaption || slides.length)) ||
      (active.instagramStory && hasStoryContent(pack.instagramStory))
  )
}

function channelsPresent(pack, channels) {
  const slides = Array.isArray(pack.instagramSlides) ? pack.instagramSlides : []
  return {
    substack: Boolean(channels.substack && (pack.substackBody || pack.substackTitle)),
    linkedin: Boolean(channels.linkedin && pack.linkedin),
    x: Boolean(channels.x && pack.x),
    videoScript: Boolean(channels.videoScript && pack.videoScript),
    instagramCarousel: Boolean(channels.instagramCarousel && (pack.instagramCaption || slides.length)),
    instagramStory: Boolean(channels.instagramStory && hasStoryContent(pack.instagramStory))
  }
}

/**
 * Canonical CMS Social Pack payload for one post.
 * @returns {object|null} null when post has no pack content for enabled channels
 */
export function buildSocialPackPayload(post, siteConfig, options = {}) {
  if (!post) return null
  const channels = getSocialPackChannels(siteConfig)
  if (!hasSocialPackContent(post, channels) && !options.includeEmpty) return null
  const socialPack = normalizeSocialPack(post.socialPack, post.title)
  return {
    source: resolveSocialPackSource({ cmsHostEnabled: options.cmsHostEnabled }) || PACK_SOURCE_CMS,
    site: post.site,
    slug: post.slug,
    title: post.title || '',
    status: post.status || '',
    authorName: post.authorName || '',
    datePublished: post.datePublished || '',
    imageUrl: post.imageUrl || '',
    imageAlt: post.imageAlt || '',
    articleUrl: siteConfig ? getCanonicalUrl(siteConfig, post.slug) : '',
    socialPackChannels: channels,
    socialPack,
    channelsPresent: channelsPresent(socialPack, channels)
  }
}

export function listSocialPackSummaries(posts, siteConfig, options = {}) {
  const channels = getSocialPackChannels(siteConfig)
  const source = resolveSocialPackSource({ cmsHostEnabled: options.cmsHostEnabled }) || PACK_SOURCE_CMS
  return (posts || [])
    .filter((post) => hasSocialPackContent(post, channels))
    .map((post) => {
      const socialPack = normalizeSocialPack(post.socialPack, post.title)
      return {
        source,
        site: post.site,
        slug: post.slug,
        title: post.title || '',
        status: post.status || '',
        authorName: post.authorName || '',
        datePublished: post.datePublished || '',
        imageUrl: post.imageUrl || '',
        imageAlt: post.imageAlt || '',
        channelsPresent: channelsPresent(socialPack, channels)
      }
    })
}
