import { loadSiteConfig, getCanonicalUrl, getSocialPackChannels } from './site-config.mjs'
import { countWords, stripHtml } from './post-utils.mjs'
import { renderPostBody } from './content-render.mjs'

/**
 * SEO validation for CMS posts.
 * Additive-only contract: validators may add checks; they must not move HTML ownership
 * into the CMS or change landing sync ownership (see templates/frontend/sync-blog-cms.mjs).
 */

function bodyTextForSeo(body = '') {
  return stripHtml(renderPostBody(body))
}

function hasForbiddenPunctuation(text) {
  const withoutUrls = String(text || '').replace(/https?:\/\/[^\s]+/g, ' ')
  return /[:;]/.test(withoutUrls)
}

function collectVisibleCopy(post) {
  const pack = post.socialPack || {}
  const slideText = Array.isArray(pack.instagramSlides)
    ? pack.instagramSlides
        .map((slide) => [slide?.headline, slide?.body, slide?.alt].filter(Boolean).join(' '))
        .join('\n')
    : ''
  const parts = [
    post.title,
    post.excerptEs,
    post.imageAlt,
    post.metaTitle?.es,
    post.metaDescription?.es,
    bodyTextForSeo(post.bodyHtml),
    pack.substackTitle,
    pack.substackBody,
    pack.linkedin,
    pack.x,
    pack.videoScript,
    pack.instagramCaption,
    slideText
  ]
  return parts.filter(Boolean).join('\n')
}

function countInternalLinks(bodyHtml) {
  const raw = String(bodyHtml || '')
  const htmlLinks = raw.match(/<a\s[^>]*href\s*=\s*["'](\/[^"']*)["']/gi) || []
  const mdLinks = raw.match(/\[[^\]]*\]\((\/[^)]+)\)/g) || []
  return htmlLinks.length + mdLinks.length
}

function socialPackHints(post, canonical, channels) {
  const pack = post.socialPack || {}
  const warnings = []
  const textFields = []
  if (channels.substack) {
    textFields.push(
      { key: 'substackTitle', needsLink: false },
      { key: 'substackBody', needsLink: true }
    )
  }
  if (channels.linkedin) textFields.push({ key: 'linkedin', needsLink: true })
  if (channels.x) textFields.push({ key: 'x', needsLink: true })
  if (channels.videoScript) textFields.push({ key: 'videoScript', needsLink: false })
  if (channels.instagramCarousel) textFields.push({ key: 'instagramCaption', needsLink: true })

  for (const { key, needsLink } of textFields) {
    const value = String(pack[key] || '').trim()
    if (!value || value.includes('Escribe aquí')) {
      warnings.push(`socialPack.${key} incompleto (recomendado).`)
      continue
    }
    if (needsLink && !value.includes(canonical)) {
      warnings.push(`socialPack.${key} sin backlink canónico (recomendado).`)
    }
  }

  if (channels.instagramCarousel) {
    const slides = Array.isArray(pack.instagramSlides) ? pack.instagramSlides : []
    const withImage = slides.filter((s) => String(s?.imageUrl || '').trim())
    if (withImage.length < 4) {
      warnings.push(
        `socialPack.instagramSlides tiene ${withImage.length} slides con imagen. Ideal 4-7 (recomendado).`
      )
    }
    for (const [i, slide] of withImage.entries()) {
      if (!String(slide.alt || '').trim()) {
        warnings.push(`socialPack.instagramSlides[${i}].alt incompleto (recomendado).`)
      }
    }
  }

  return warnings
}

export function validatePostSeo(post, siteHandle = post.site || 'escarlet') {
  const siteConfig = loadSiteConfig(siteHandle) || loadSiteConfig('escarlet')
  const seo = siteConfig.seo || {}
  const channels = getSocialPackChannels(siteConfig)
  const errors = []
  const warnings = []
  const canonical = getCanonicalUrl(siteConfig, post.slug)

  const minWords = seo.minWords ?? 300
  const wordCount = countWords(bodyTextForSeo(post.bodyHtml))
  if (wordCount < minWords) {
    errors.push(`El cuerpo tiene ${wordCount} palabras. Mínimo ${minWords}.`)
  }

  const metaTitle = String(post.metaTitle?.es || post.title || '')
  const titleMin = seo.metaTitleMin ?? 20
  const titleMax = seo.metaTitleMax ?? 70
  if (metaTitle.length < titleMin || metaTitle.length > titleMax) {
    warnings.push(`metaTitle.es tiene ${metaTitle.length} caracteres. Ideal ${titleMin}-${titleMax}.`)
  }

  const metaDesc = String(post.metaDescription?.es || '')
  const descMin = seo.metaDescriptionMin ?? 70
  const descMax = seo.metaDescriptionMax ?? 180
  if (!metaDesc.trim()) {
    warnings.push('Falta metaDescription.es (recomendado).')
  } else if (metaDesc.length < descMin || metaDesc.length > descMax) {
    warnings.push(`metaDescription.es tiene ${metaDesc.length} caracteres. Ideal ${descMin}-${descMax}.`)
  }

  const imageAlt = String(post.imageAlt || '')
  if (!imageAlt.trim()) {
    warnings.push('Falta imageAlt (recomendado).')
  } else if (imageAlt.length < 8 || imageAlt.length > 140) {
    warnings.push(`imageAlt tiene ${imageAlt.length} caracteres. Ideal 8-140.`)
  }

  const internalLinks = countInternalLinks(post.bodyHtml)
  const linksMin = seo.internalLinksMin ?? 1
  if (internalLinks < linksMin) {
    warnings.push(`Solo ${internalLinks} enlaces internos. Ideal al menos ${linksMin}.`)
  }

  const related = post.relatedSlugs || []
  const relatedIdeal = seo.relatedSlugsCount ?? 0
  if (relatedIdeal > 0 && related.length < relatedIdeal) {
    warnings.push(`relatedSlugs tiene ${related.length}. Ideal ${relatedIdeal}.`)
  }

  warnings.push(...socialPackHints(post, canonical, channels))

  if (siteConfig.copyRules?.noColonsSemicolons && hasForbiddenPunctuation(collectVisibleCopy(post))) {
    warnings.push('Copy con dos puntos o punto y coma. Mejor reescribir esas frases (recomendado).')
  }

  const allowedAuthors = siteConfig.authors || ['Charly', 'Silvia']
  if (!allowedAuthors.includes(post.authorName)) {
    errors.push(`authorName debe ser ${allowedAuthors.join(' o ')}.`)
  }

  if (!post.imageUrl?.trim()) {
    warnings.push('Falta imageUrl (recomendado para portada).')
  }

  if (!String(post.title || '').trim()) {
    errors.push('Falta title.')
  }

  if (!post.slug?.trim()) {
    errors.push('Falta slug.')
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    wordCount,
    internalLinks,
    canonical,
    readyToPublish: errors.length === 0,
    checklist: {
      blocking: errors,
      recommended: warnings
    }
  }
}
