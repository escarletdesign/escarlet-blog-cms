import { loadSiteConfig, getCanonicalUrl } from './site-config.mjs'
import { countWords, stripHtml } from './post-utils.mjs'

function hasForbiddenPunctuation(text) {
  const withoutUrls = String(text || '').replace(/https?:\/\/[^\s]+/g, ' ')
  return /[:;]/.test(withoutUrls)
}

function collectVisibleCopy(post) {
  const parts = [
    post.title,
    post.excerptEs,
    post.imageAlt,
    post.metaTitle?.es,
    post.metaDescription?.es,
    stripHtml(post.bodyHtml),
    post.socialPack?.substackTitle,
    post.socialPack?.substackBody,
    post.socialPack?.linkedin,
    post.socialPack?.x
  ]
  return parts.filter(Boolean).join('\n')
}

function countInternalLinks(bodyHtml) {
  const matches = String(bodyHtml || '').match(/<a\s[^>]*href\s*=\s*["'](\/[^"']*)["']/gi) || []
  return matches.length
}

function socialPackComplete(post, canonical) {
  const pack = post.socialPack || {}
  const fields = [
    { key: 'substackTitle', needsLink: false },
    { key: 'substackBody', needsLink: true },
    { key: 'linkedin', needsLink: true },
    { key: 'x', needsLink: true }
  ]
  const errors = []
  for (const { key, needsLink } of fields) {
    const value = String(pack[key] || '').trim()
    if (!value || value.includes('Escribe aquí')) {
      errors.push(`socialPack.${key} incompleto.`)
      continue
    }
    if (needsLink && !value.includes(canonical)) {
      errors.push(`socialPack.${key} debe incluir el backlink canónico ${canonical}`)
    }
  }
  return errors
}

export function validatePostSeo(post, siteHandle = post.site || 'escarlet') {
  const siteConfig = loadSiteConfig(siteHandle) || loadSiteConfig('escarlet')
  const seo = siteConfig.seo
  const errors = []
  const warnings = []
  const canonical = getCanonicalUrl(siteConfig, post.slug)

  const wordCount = countWords(post.bodyHtml)
  if (wordCount < seo.minWords) {
    errors.push(`El cuerpo tiene ${wordCount} palabras. Mínimo ${seo.minWords}.`)
  }

  const metaTitle = String(post.metaTitle?.es || post.title || '')
  if (metaTitle.length < seo.metaTitleMin || metaTitle.length > seo.metaTitleMax) {
    errors.push(`metaTitle.es tiene ${metaTitle.length} caracteres. Rango ${seo.metaTitleMin}-${seo.metaTitleMax}.`)
  }

  const metaDesc = String(post.metaDescription?.es || '')
  if (metaDesc.length < seo.metaDescriptionMin || metaDesc.length > seo.metaDescriptionMax) {
    errors.push(
      `metaDescription.es tiene ${metaDesc.length} caracteres. Rango ${seo.metaDescriptionMin}-${seo.metaDescriptionMax}.`
    )
  }

  const imageAlt = String(post.imageAlt || '')
  if (imageAlt.length < 10 || imageAlt.length > 125) {
    errors.push(`imageAlt tiene ${imageAlt.length} caracteres. Rango 10-125.`)
  }

  const internalLinks = countInternalLinks(post.bodyHtml)
  if (internalLinks < seo.internalLinksMin) {
    warnings.push(`Solo ${internalLinks} enlaces internos. Objetivo ${seo.internalLinksMin}-${seo.internalLinksMax}.`)
  }

  const related = post.relatedSlugs || []
  if (related.length < seo.relatedSlugsCount) {
    errors.push(`relatedSlugs necesita ${seo.relatedSlugsCount} entradas. Tiene ${related.length}.`)
  }

  errors.push(...socialPackComplete(post, canonical))

  if (siteConfig.copyRules?.noColonsSemicolons && hasForbiddenPunctuation(collectVisibleCopy(post))) {
    errors.push('Copy visible con dos puntos o punto y coma. Reescribe esas frases.')
  }

  const allowedAuthors = siteConfig.authors || ['Charly', 'Silvia']
  if (!allowedAuthors.includes(post.authorName)) {
    errors.push(`authorName debe ser ${allowedAuthors.join(' o ')}.`)
  }

  if (!post.imageUrl?.trim()) {
    errors.push('Falta imageUrl.')
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
    canonical
  }
}
