# Integraciones Escarlet

Este repositorio conserva tres integraciones complementarias:

1. `integrations/wordpress-blog-client/` es el plugin WordPress principal. Sin Elementor: sincroniza posts `post` nativos editables en Gutenberg, descarga las imágenes a Media Library y las asigna como imagen destacada. El ZIP se genera con `integrations/wordpress-blog-client/build.sh`.
2. `integrations/wordpress/` contiene el plugin **Escarlet Elementor Bridge 0.2.0** recuperado de `Documents/ChatGPT/WP bridge/wordpress-plugin`. Es opcional para webs que ya trabajan con Elementor; no es necesario para el CMS ni para publicar posts.
3. `integrations/seo/index.mjs` es el contrato común para landings estáticas, Vite/Vue y adaptadores WordPress. Genera metadatos HTML, JSON-LD, sitemap, robots y navegación para agentes, además de validar que exista contenido indexable en el HTML inicial.

## Plugin de WordPress para Gutenberg

```bash
cd integrations/wordpress-blog-client
./build.sh
```

Instala el ZIP en `wp-content/plugins/` y configúralo desde **Escarlet Blog → Ajustes**. El flujo no crea HTML propietario: escribe `post_content`, `post_excerpt`, fechas y slug de WordPress. La portada se importa como attachment local con `_wp_attachment_image_alt` y `set_post_thumbnail`, por lo que el editor Gutenberg puede seguir editando el post.

La sincronización conserva metadatos SEO (title, description, canonical, Open Graph) y el permalink `/blog/{slug}`. El webhook solo dispara la sincronización; el CMS continúa siendo la fuente de verdad.

## Bridge opcional de Elementor

```bash
cd integrations/wordpress
./build.sh
```

Instala el ZIP generado en `integrations/wordpress/build/` desde WordPress. Elementor es opcional para activar el plugin; Elementor Pro solo es necesario para Theme Builder. Usa HTTPS, Application Password y un usuario dedicado. Las escrituras externas deben habilitarse primero en staging.

La API no debe tratarse como un editor HTML genérico. El flujo esperado es descubrir capabilities, leer el documento, modificar un subconjunto permitido y guardar con checkpoint/version hash.

## Contrato SEO para cualquier landing

La página debe producir `title`, `description`, `canonical` y un `h1` visible en el HTML entregado por el servidor o por prerender. Para compartir y enriquecer resultados se pueden añadir `image`, `organization`, `localBusiness`, `article`, `breadcrumbs` y `faqs`.

```js
import {
  renderSeoHead,
  renderJsonLd,
  buildSitemapXml,
  buildRobotsTxt,
  validateSeoPage
} from './integrations/seo/index.mjs'

const page = {
  title: 'Osteopatía en El Ejido | María Morales',
  description: 'Tratamientos manuales personalizados para dolor de espalda, cuello y articulaciones en El Ejido.',
  canonical: 'https://www.mariamoralesosteopatia.com/',
  h1: 'Osteopatía personalizada en El Ejido',
  image: 'https://www.mariamoralesosteopatia.com/assets/image.webp',
  imageAlt: 'María Morales, osteópata en El Ejido',
  localBusiness: { name: 'María Morales Osteopatía', url: 'https://www.mariamoralesosteopatia.com/' }
}

if (!validateSeoPage(page).ok) throw new Error('La página no pasa el contrato SEO')
const head = `${renderSeoHead(page)}\n${renderJsonLd(page)}`
const sitemap = buildSitemapXml([{ url: page.canonical, changefreq: 'weekly', priority: '1.0' }])
const robots = buildRobotsTxt({ sitemapUrl: `${page.canonical}sitemap.xml` })
```

### Adaptadores previstos

- **Vite/Vue**: ejecutar el helper durante `build` y usar la salida para prerender de cada ruta, como hace `escarlet002` con `postbuild-seo.mjs`.
- **HTML estático**: insertar `renderSeoHead` y `renderJsonLd` en la plantilla, y escribir `sitemap.xml`, `robots.txt` y `agent-navigation.json` en `public/`.
- **WordPress/Elementor**: el plugin mantiene la edición visual; el CMS debe enviar estas mismas propiedades al adaptador de metadatos. El contenido visible, `h1`, enlaces internos y alt siguen siendo parte de la página publicada.
- **CMS Blog**: los posts ya pasan por `lib/seo-validator.mjs`; este contrato permite que una landing y WordPress usen las mismas reglas y artefactos.

### Instalación en una landing que no usa WordPress

Para una landing Node/Vite/Vue/HTML con scripts de build:

```bash
npm run integration:install -- --target ../mi-landing
```

El instalador copia el hook del blog, los wrappers de sync, el helper `escarlet-seo.mjs` y un `seo-manifest.json` inicial. Solo hay que ajustar `BLOG_CMS_URL`, `BLOG_CMS_SITE`, `BLOG_SITE_URL` y las rutas SEO. No instala dependencias ni impone framework.

## Qué se hereda de María Morales y landing Escarlet

- prerender de fichas y artículos para que Google vea el contenido sin ejecutar JavaScript;
- canonical, robots, Open Graph, Twitter Card y alternates;
- JSON-LD de negocio local, página, artículo, FAQ y breadcrumbs;
- sitemap con `lastmod`, `changefreq` y `priority` coherentes;
- `llms.txt`, `agent-navigation.json` y enlaces legales como artefactos descubribles;
- separación entre contenido semántico y layout visual.

El comando `seo:build` lee un manifiesto de rutas de cada landing y escribe estos artefactos automáticamente:

```bash
node scripts/build-seo-artifacts.mjs \
  --manifest integrations/seo/site-manifest.example.json \
  --out /tmp/site-public
```

En cada landing se puede copiar el manifiesto, apuntar `SEO_MANIFEST` y añadir `npm run seo:build` antes de `vite build`. El HTML de cada ruta sigue siendo responsabilidad del adaptador de la landing, que debe usar `renderSeoHead` y `renderJsonLd`.
