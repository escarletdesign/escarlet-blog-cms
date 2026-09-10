/**
 * Framework-agnostic SEO integration helpers.
 *
 * The same contract can be consumed by Vite/Vue static builds, plain HTML
 * landings and WordPress adapters. It deliberately produces HTML and text
 * artifacts at build time so crawlers do not depend on client-side rendering.
 */

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const escapeXml = (value = '') => escapeHtml(value)

export function normalizeSeoPage(input = {}, defaults = {}) {
  const page = { ...defaults, ...input }
  const canonical = String(page.canonical || page.url || '').trim()
  const title = String(page.title || '').trim()
  const description = String(page.description || '').trim()
  return {
    ...page,
    title,
    description,
    canonical,
    robots: String(page.robots || (page.noindex ? 'noindex, follow' : 'index, follow')),
    locale: String(page.locale || 'es_ES'),
    language: String(page.language || 'es-ES'),
    type: String(page.type || 'website'),
    image: String(page.image || '').trim(),
    imageAlt: String(page.imageAlt || '').trim(),
    siteName: String(page.siteName || '').trim()
  }
}

export function renderSeoHead(input = {}) {
  const page = normalizeSeoPage(input)
  const tags = [
    `<title>${escapeHtml(page.title)}</title>`,
    `<meta name="description" content="${escapeHtml(page.description)}" />`,
    `<meta name="robots" content="${escapeHtml(page.robots)}" />`,
    page.canonical ? `<link rel="canonical" href="${escapeHtml(page.canonical)}" />` : '',
    page.siteName ? `<meta property="og:site_name" content="${escapeHtml(page.siteName)}" />` : '',
    `<meta property="og:type" content="${escapeHtml(page.type)}" />`,
    `<meta property="og:locale" content="${escapeHtml(page.locale)}" />`,
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    page.canonical ? `<meta property="og:url" content="${escapeHtml(page.canonical)}" />` : '',
    page.image ? `<meta property="og:image" content="${escapeHtml(page.image)}" />` : '',
    page.imageAlt ? `<meta property="og:image:alt" content="${escapeHtml(page.imageAlt)}" />` : '',
    `<meta name="twitter:card" content="${page.image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${escapeHtml(page.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(page.description)}" />`,
    page.image ? `<meta name="twitter:image" content="${escapeHtml(page.image)}" />` : '',
    page.imageAlt ? `<meta name="twitter:image:alt" content="${escapeHtml(page.imageAlt)}" />` : ''
  ]
  if (page.alternates && typeof page.alternates === 'object') {
    for (const [hreflang, href] of Object.entries(page.alternates)) {
      if (href) tags.push(`<link rel="alternate" hreflang="${escapeHtml(hreflang)}" href="${escapeHtml(href)}" />`)
    }
  }
  return tags.filter(Boolean).join('\n')
}

export function buildJsonLd(input = {}) {
  const page = normalizeSeoPage(input)
  const graph = []
  if (page.organization) graph.push({ '@type': page.organization.type || 'Organization', '@id': `${page.organization.url || page.canonical}/#organization`, ...page.organization })
  if (page.localBusiness) graph.push({ '@type': ['LocalBusiness', ...(page.localBusiness.type ? [page.localBusiness.type] : [])], '@id': `${page.localBusiness.url || page.canonical}/#business`, ...page.localBusiness })
  graph.push({ '@type': 'WebPage', '@id': `${page.canonical}#webpage`, url: page.canonical, name: page.title, description: page.description, inLanguage: page.language })
  if (page.article) graph.push({ '@type': 'Article', '@id': `${page.canonical}#article`, mainEntityOfPage: { '@id': `${page.canonical}#webpage` }, headline: page.article.headline || page.title, description: page.article.description || page.description, image: page.article.image || page.image, datePublished: page.article.datePublished, dateModified: page.article.dateModified, author: page.article.author, publisher: page.article.publisher })
  if (Array.isArray(page.breadcrumbs) && page.breadcrumbs.length) graph.push({ '@type': 'BreadcrumbList', itemListElement: page.breadcrumbs.map((item, position) => ({ '@type': 'ListItem', position: position + 1, name: item.name, item: item.url })) })
  if (Array.isArray(page.faqs) && page.faqs.length) graph.push({ '@type': 'FAQPage', mainEntity: page.faqs.map(([name, text]) => ({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })) })
  return { '@context': 'https://schema.org', '@graph': graph }
}

export function renderJsonLd(input = {}) {
  return `<script type="application/ld+json">${JSON.stringify(buildJsonLd(input))}</script>`
}

export function buildSitemapXml(entries = []) {
  const urls = entries.filter((entry) => entry && entry.url).map((entry) => {
    const lastmod = entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : ''
    const changefreq = entry.changefreq ? `<changefreq>${escapeXml(entry.changefreq)}</changefreq>` : ''
    const priority = entry.priority != null ? `<priority>${escapeXml(entry.priority)}</priority>` : ''
    return `  <url><loc>${escapeXml(entry.url)}</loc>${lastmod}${changefreq}${priority}</url>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

export function buildRobotsTxt({ sitemapUrl, disallow = [], allow = [] } = {}) {
  const lines = ['User-agent: *', ...allow.map((path) => `Allow: ${path}`), ...disallow.map((path) => `Disallow: ${path}`)]
  if (sitemapUrl) lines.push(`Sitemap: ${sitemapUrl}`)
  return `${lines.join('\n')}\n`
}

export function buildAgentNavigation({ site, name, language = 'es-ES', sections = [], primaryAction, legal = [] } = {}) {
  return { version: '1.0', site, name, language, ...(primaryAction ? { primary_action: primaryAction } : {}), sections, legal }
}

export function validateSeoPage(input = {}) {
  const page = normalizeSeoPage(input)
  const errors = []
  const warnings = []
  if (!page.title) errors.push('Falta title.')
  else if (page.title.length < 20 || page.title.length > 70) warnings.push('title recomendado entre 20 y 70 caracteres.')
  if (!page.description) errors.push('Falta description.')
  else if (page.description.length < 70 || page.description.length > 180) warnings.push('description recomendada entre 70 y 180 caracteres.')
  if (!page.canonical) errors.push('Falta canonical.')
  if (!page.h1) errors.push('Falta h1 visible en el HTML inicial.')
  if (page.image && !page.imageAlt) warnings.push('Falta alt para la imagen social.')
  if (page.noindex && page.sitemap !== false) errors.push('Una página noindex no debe entrar en sitemap.')
  return { ok: errors.length === 0, errors, warnings }
}
