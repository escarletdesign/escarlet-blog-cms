# Escarlet V3: contrato de contenido

## Post

```ts
type Post = {
  id: string
  brandId: string
  campaignId: string | null
  title: string
  status: PostStatus
  brandKitVersionId: string | null
  provenance: Provenance
  variants: PostVariant[]
  generationRunId: string | null
}
```

## Variante

```ts
type PostVariant = {
  id: string
  postId: string
  channel: ContentChannel
  body: Record<string, unknown>
  media: MediaReference[]
  status: VariantStatus
  destinationId: string | null
  publicationRunId: string | null
}
```

## Campaña y contenido sin campaña

La base de datos mantiene `batch_id` para preservar integridad referencial. Cuando el usuario no elige campaña, el dominio usa una campaña del sistema llamada `Inbox editorial`, marcada con `metadata.system = true`. Esa agrupación no aparece como campaña normal en la navegación.

## Reglas de assets

- `reference` es un asset de Brand Kit y no se asocia directamente a un Post.
- Un asset generado para publicación necesita `postId` o crea un Post borrador automáticamente.
- Un asset publicable no puede terminar en estado huérfano.
- La asociación se registra en `content_variant_media` y en `audit_log`.

## Respuestas de escritura

Las operaciones de creación, edición, asociación y publicación devuelven referencias estables:

```json
{
  "postId": "...",
  "variantId": "...",
  "brandKitVersionId": "...",
  "generationRunId": "...",
  "publicationRunId": "...",
  "nextAction": "human_review"
}
```
