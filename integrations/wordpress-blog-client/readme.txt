=== Escarlet Blog Client ===
Contributors: escarlet
Tags: blog, headless, escarlet, sync
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.1.0
License: GPLv2 or later

Sincroniza el blog público desde el CMS Escarlet y abre el panel editorial (packs incluidos) con el token de sitio.

== Description ==

* Fuente de verdad. CMS Escarlet (MCP + dashboard).
* WordPress recibe posts published vía sync / webhook en el blog nativo (`/blog`). Son posts estándar editables en Gutenberg.
* Las imágenes se descargan a la Media Library y se asignan como imagen destacada con texto alternativo.
* Packs sociales. Se usan en el CMS Escarlet (no se genera HTML estático como en landings Vite).
* Abrir panel. SSO de un solo uso desde wp-admin.

== Installation ==

1. Sube la carpeta `escarlet-blog-client` a `wp-content/plugins/`.
2. Activa el plugin.
3. Escarlet Blog → Ajustes. URL del CMS, handle y token de sitio.
4. Copia la URL de webhook + Bearer al CMS → Sitio.
5. Sincroniza o publica un post en el CMS.

== Changelog ==

= 1.1.0 =
* Posts nativos Gutenberg y sideload de imágenes a la Media Library.

= 1.0.0 =
* Sync a posts nativos, webhook, permalinks /blog, SSO al CMS.
