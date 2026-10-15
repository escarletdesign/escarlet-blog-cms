-- Generated content is never brand guidance. Keep only the v3 Escarlet kit assets.
DELETE FROM brand_assets ba
USING brand_kit_versions bkv, brand_kits bk, sites s
WHERE ba.brand_kit_version_id = bkv.id
  AND bkv.brand_kit_id = bk.id
  AND bkv.id = bk.active_version_id
  AND bk.site_id = s.id
  AND s.handle = 'escarlet'
  AND regexp_replace(ba.name, '^.*/', '') NOT IN (
    'style-board.png',
    'character-silvia.webp',
    'character-charly.png',
    'fondo-escarlet.png',
    'logo-official-blue.png'
  );
