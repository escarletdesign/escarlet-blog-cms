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

export function normalizeSocialPack(socialPack, title = '') {
  const raw = socialPack && typeof socialPack === 'object' ? socialPack : {}
  const slides = Array.isArray(raw.instagramSlides)
    ? raw.instagramSlides
        .map((slide) => ({
          imageUrl: String(slide?.imageUrl || '').trim(),
          alt: String(slide?.alt || '').trim(),
          headline: String(slide?.headline || '').trim(),
          body: String(slide?.body || '').trim(),
          templateId: String(slide?.templateId || '').trim(),
          backgroundStyle: String(slide?.backgroundStyle || '').trim(),
          backgroundMediaId: String(slide?.backgroundMediaId || '').trim(),
          backgroundSource: String(slide?.backgroundSource || '').trim(),
          renderedBy: String(slide?.renderedBy || '').trim(),
          textRendered: slide?.textRendered === true
        }))
        .filter((slide) => slide.imageUrl || slide.headline || slide.body)
    : []
  return {
    substackTitle: String(raw.substackTitle || title || '').trim(),
    substackBody: String(raw.substackBody || '').trim(),
    linkedin: String(raw.linkedin || '').trim(),
    x: String(raw.x || '').trim(),
    videoScript: String(raw.videoScript || '').trim(),
    instagramCaption: String(raw.instagramCaption || '').trim(),
    instagramSlides: slides,
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
      (active.instagramCarousel && (pack.instagramCaption || slides.length))
  )
}

function channelsPresent(pack, channels) {
  const slides = Array.isArray(pack.instagramSlides) ? pack.instagramSlides : []
  return {
    substack: Boolean(channels.substack && (pack.substackBody || pack.substackTitle)),
    linkedin: Boolean(channels.linkedin && pack.linkedin),
    x: Boolean(channels.x && pack.x),
    videoScript: Boolean(channels.videoScript && pack.videoScript),
    instagramCarousel: Boolean(channels.instagramCarousel && (pack.instagramCaption || slides.length))
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
