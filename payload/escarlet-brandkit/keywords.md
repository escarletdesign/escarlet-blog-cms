# Keyword research Escarlet (Semrush + Search Console)

Uso interno para titles y schema. La API key no se expone en frontend.

## Semrush API

La key de `.env` es un token PAT v4 (`semrtkn-pat-…`).

- El plan Guru incluye 50.000 unidades para Semrush MCP.
- La llamada REST directa a `/apis/v4/keywords/v1/metrics` responde **403 Forbidden** con este acceso.
- La misma key funciona mediante `https://mcp.semrush.com/v2/mcp` y permite ejecutar los informes de Keyword Analytics.
- `npm run seo:keywords` usa el flujo MCP oficial: descubrimiento, esquema y ejecución.
- El resultado generado se guarda en `data/seo/semrush-keywords.md`.

Comprobación en la base española: `diseño web El Ejido` tiene volumen 90 y KD 6. Search Console sigue siendo la fuente para conocer las impresiones y posiciones reales de escarlet.design.

## Search Console (feb–ago 2026, España)

Consultas con más impresiones en `sc-domain:escarlet.design`:

| Query | Impresiones | Posición media |
|---|---:|---:|
| diseño web el ejido | 131 | 13.9 |
| escarlet | 51 | 8.1 |
| branding almeria | 32 | 69.2 |
| diseño de marca almeria | 19 | 12.3 |
| diseño landing page almería | 16 | 39.5 |
| diseño web | 11 | 16.3 |
| cuánto cuesta una página web almería | 10 | 6.4 |
| diseño paginas web el ejido | 4 | 8.5 |

## Keywords elegidas (sin canibalizar)

| URL | Keyword principal | Secundarias | Nota |
|---|---|---|---|
| `/` | branding + diseño web + profesionales con experiencia | diseño web El Ejido, Almería | H1 de marca (experiencia → negocio). Title de demanda. |
| `/proyectos` | proyectos branding diseño web | casos, identidad visual | CollectionPage |
| `/blog` | diseño, marca y web | SEO local Almería, diseño web El Ejido | Hub editorial |

Las landings `/lp/*` (restaurantes, startups, menú QR, oficios) se retiraron. 301 a la home. No se indexan ni se enlazan.

No se fuerza “agencia de lanzamiento” como query: no aparece en GSC y Semrush no pudo medirla.

## Criterio

- H1 del hero = posicionamiento de marca.
- Title/description = demanda que GSC ya muestra (`diseño web El Ejido`, `branding Almería`, `diseño de marca`).
- La autoridad se concentra en home, servicios, zona (Almería / El Ejido) y blog.
