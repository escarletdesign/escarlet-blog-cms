# Regla para agente. Post de blog en escarlet.design y pack de redes

Documento autocontenido. Pégalo a un agente cuando cree o publique un artículo del blog Escarlet.

Reproduce el flujo real del repo `escarlet002`. Proyecto Engram. **escarlet**.

El blog **no vive en WordPress**. La fuente canónica SEO es el array `posts` en `src/data/blog-articles.js`. La URL pública es `https://escarlet.design/blog/{slug}`.

Substack, X y LinkedIn se publican **a mano** con el pack admin. No hay API de escritura conectada.

---

## Orden de trabajo

1. Redactar y guardar el post en `src/data/blog-articles.js` (esto es lo que sale en escarlet.design).
2. Añadir portada en `public/images/blog/`.
3. Añadir `socialPack` en el mismo objeto del post.
4. Relacionados en `relatedPostSlugs`.
5. `npm run blog:packs` + `npm run sitemap && npm run llms`.
6. Commit y push a `master` (Coolify publica escarlet.design).
7. Entregar al usuario las URLs del artículo y del pack.

---

# A. Publicar el post en escarlet.design

## 1. Dónde se crea

Archivo único. `src/data/blog-articles.js`

Inserta el objeto **al principio** del array `posts` (el listado ordena por `datePublished`, más reciente primero). No crees una página Vue nueva. El router ya tiene `/blog/:slug`.

No uses el MCP de WordPress para el blog.

## 2. Campos del objeto

```js
{
  slug: 'kebab-case-sin-tildes',
  title: 'Titular visible. Punto o coma. Sin dos puntos',
  metaTitle: {
    es: 'Keyword + beneficio | Escarlet',
    en: 'English meta title | Escarlet'
  },
  metaDescription: {
    es: 'Hasta ~155 caracteres. Sin dos puntos ni punto y coma.',
    en: 'English description for the object. The site is Spanish-only in the UI.'
  },
  datePublished: '2026-09-01',
  dateModified: '2026-09-01',
  imageUrl: '/images/blog/{slug}.webp',
  imageAlt: 'Qué se ve en la foto. Palabra clave si encaja.',
  substackUrl: 'https://brugiafredo.substack.com', // o URL /p/slug si ya existe el newsletter
  authorName: 'Silvia', // o 'Charly'. Nunca "Carlos Brugiafredo"
  excerptEs: 'Lead corto para el listado /blog.',
  socialPack: { /* ver sección B */ },
  bodyHtml: ` ... HTML del artículo ... `
}
```

### Slug y URL

- Minúsculas, kebab-case, sin tildes, sin espacios.
- Canónica. `https://escarlet.design/blog/{slug}`
- El `title` de la página y el `h1` salen de `title` / `metaTitle.es`. Conserva keywords en title, h1, description.

### Autoría

Un solo enfoque principal.

- **Charly**. Diseño visual, UI, UX, branding visual, desarrollo, implementación, performance, oficio desde ejecución.
- **Silvia**. Estrategia, posicionamiento, mensaje, comunicación, SEO, contenidos, conversión, captación local.

### Substack en la ficha del post

- Si **no** hay artículo en Substack, deja `substackUrl` en `https://brugiafredo.substack.com` (home). El sitio **no** muestra «También en Substack» salvo que la URL coincida con `/p/...`.
- Si más tarde existe el post en Substack, cambia a `https://brugiafredo.substack.com/p/{slug-substack}`.

### Copy del artículo (`title`, `excerptEs`, `bodyHtml`, `imageAlt`)

Lee `data/docs/escarlet-identidad-verbal.md`.

- Directo, oral, humano. Tratamiento tú.
- Sin dos puntos (`:`) ni punto y coma (`;`) en texto visible. En HTML los `:` de URLs (`https://`) y atributos sí valen.
- Sin em dashes. Sin listas simétricas de tres. Sin jerga de IA.
- Evita «no» salvo para prevenir error, falsa promesa o confusión grave.
- Una idea por párrafo. CTA real al final (home, precios, contacto). Sin prometer ventas.

`bodyHtml` es HTML. Usa `<p>`, `<h2>`, `<ul>`, `<ol>`, `<strong>`, `<em>`, `<a href="/ruta-interna">`. Enlaces internos a servicios, precios o home cuando ayuden.

Opcional. Embed de Instagram u otro medio, copiando el patrón `figure.blog-embed` del post más reciente.

### Relacionados

Al final del archivo, mapa `relatedPostSlugs`. Añade una entrada para el slug nuevo con **3** slugs existentes que encajen. El sitio inyecta el bloque «Lecturas relacionadas».

## 3. Imagen del artículo

- `public/images/blog/{slug}.webp` (canónica SEO)
- `public/images/blog/{slug}.jpg` si hay (el pack admin la usa para descargar)
- kebab-case, minúsculas, sin EXIF
- `imageUrl` apunta al `.webp`
- `imageAlt` describe lo que se ve. Punto o coma. Sin `:` ni `;`

## 4. SEO y discovery tras guardar el post

```bash
npm run sitemap && npm run llms
```

El prerender (`scripts/postbuild-seo.mjs`) recorre `getAllBlogPosts()` en el build. No hace falta registrar la ruta a mano.

## 5. Publicar en producción

Push a `origin/master`. Coolify despliega escarlet.design.

Comprueba.

- Listado. `https://escarlet.design/blog`
- Artículo. `https://escarlet.design/blog/{slug}`

---

# B. Pack de redes (Substack, X, LinkedIn)

Solo posts con `socialPack`. Los artículos viejos **no** generan pack con excerpt de fallback.

## Campos

```js
socialPack: {
  substackTitle: '...',
  substackBody: '...',
  linkedin: '...',
  x: '...'
}
```

### Copy del pack

Misma voz que el artículo. Sin `:` ni `;`.

Cada canal lleva el backlink canónico `https://escarlet.design/blog/{slug}`.

- **Substack.** Título corto + 4–8 párrafos. Distinto del `bodyHtml`. Enlace al final.
- **LinkedIn.** Más comercial, saltos cortos. Enlace al final.
- **X.** Gancho + idea + enlace. ~280 caracteres. Cada URL cuenta 23.

Misma idea. Tres redacciones distintas.

## Generar la página admin

```bash
npm run blog:packs
```

Salida.

- Índice. `https://escarlet.design/admin/blog-packs`
- Pack. `https://escarlet.design/admin/blog-packs/{slug}`

`noindex`. Bajo `/admin`.

**Rutas absolutas.** El servidor quita la barra final. No uses `./slug/` ni `./imagen.jpg` (dan 404). El generador ya escribe rutas absolutas.

El `build` de producción también corre `blog:packs` antes de Vite.

---

# C. Checklist

Post en escarlet.design

- [ ] Objeto nuevo al inicio de `posts` en `src/data/blog-articles.js`
- [ ] slug, title, metaTitle.es, metaDescription.es, fechas, excerpt, bodyHtml
- [ ] Autor Charly o Silvia
- [ ] Imagen webp (y jpg si aplica) + imageAlt
- [ ] `relatedPostSlugs` con 3 lecturas
- [ ] `substackUrl` correcto (home o `/p/...`)
- [ ] Copy visible sin `:` ni `;`
- [ ] `npm run sitemap && npm run llms`
- [ ] Push a `master`
- [ ] URL del artículo enviada al usuario

Pack

- [ ] `socialPack` completo
- [ ] `npm run blog:packs`
- [ ] Pack abre, imagen se ve y se descarga
- [ ] URL del pack enviada al usuario

---

# D. Ejemplo de forma (post real)

Campos del pack. El resto del objeto sigue el patrón del primer ítem de `posts`.

```js
socialPack: {
  substackTitle: 'No estaba esperando a que mi negocio estuviera listo',
  substackBody: `Durante mucho tiempo tuve una explicación bastante razonable para seguir guardando lo que hacía.

“Todavía no está listo.”

La foto podía ser mejor. La frase no terminaba de convencerme. La web necesitaba otro ajuste.

Tardé en ver que el perfeccionismo era el escondite más elegante para el miedo.

Una base clara responde a cuatro preguntas. Qué haces. A quién ayudas. Por qué debería importarle. Qué tiene que hacer para hablar contigo.

El artículo completo está en el blog de Escarlet.

https://escarlet.design/blog/como-mostrar-tu-negocio-aunque-no-este-perfecto`,
  linkedin: `Durante mucho tiempo repetí que mi negocio “aún no estaba listo”.

Lo que me frenaba no era la calidad. Era el miedo a mostrarlo.

Mostrarlo forma parte de la construcción.

Artículo completo en el blog de Escarlet.
https://escarlet.design/blog/como-mostrar-tu-negocio-aunque-no-este-perfecto`,
  x: `No estaba esperando a que mi negocio estuviera listo.
Estaba evitando mostrarlo.

El perfeccionismo a veces es miedo con buena cara.

Artículo completo
https://escarlet.design/blog/como-mostrar-tu-negocio-aunque-no-este-perfecto`
}
```

---

## Referencias en el repo

- Posts. `src/data/blog-articles.js`
- Vista. `src/views/BlogPostView.vue` + ruta `/blog/:slug` en `src/router/index.js`
- Autoría. `.cursor/rules/blog-authorship.mdc`
- Packs. `.cursor/rules/blog-social-packs.mdc`
- Identidad verbal. `data/docs/escarlet-identidad-verbal.md`
- Imágenes SEO. `data/seo/imagenes-nombres-y-alt.md`
- Generador packs. `scripts/generate-blog-social-packs.mjs`
- Sitemap / llms. `npm run sitemap` y `npm run llms`
- Salida packs. `public/admin/blog-packs/`
