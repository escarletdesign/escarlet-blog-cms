import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildJsonLd,
  buildRobotsTxt,
  buildSitemapXml,
  renderSeoHead,
  validateSeoPage
} from '../integrations/seo/index.mjs'

const page = {
  title: 'Diseño web y SEO para negocios locales | Escarlet',
  description: 'Diseño web, contenido y SEO técnico para negocios locales que necesitan captar visitas y contactos cualificados.',
  canonical: 'https://example.com/servicios/seo',
  h1: 'SEO que ayuda a que te encuentren',
  siteName: 'Escarlet',
  image: 'https://example.com/og.webp',
  imageAlt: 'Ejemplo de estrategia SEO para negocios locales',
  organization: { name: 'Escarlet', url: 'https://example.com' },
  breadcrumbs: [{ name: 'Inicio', url: 'https://example.com/' }, { name: 'SEO', url: 'https://example.com/servicios/seo' }]
}

test('renders crawlable head metadata and JSON-LD', () => {
  const head = renderSeoHead(page)
  assert.match(head, /rel="canonical"/)
  assert.match(head, /og:title/)
  assert.match(JSON.stringify(buildJsonLd(page)), /BreadcrumbList/)
})

test('builds sitemap and robots artifacts', () => {
  assert.match(buildSitemapXml([{ url: page.canonical, priority: '0.8' }]), /<loc>https:\/\/example\.com\/servicios\/seo<\/loc>/)
  assert.match(buildRobotsTxt({ sitemapUrl: 'https://example.com/sitemap.xml' }), /Sitemap:/)
})

test('validates required SEO contract', () => {
  assert.equal(validateSeoPage(page).ok, true)
  assert.equal(validateSeoPage({ title: 'x', noindex: true, sitemap: true }).ok, false)
})
