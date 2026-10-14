import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "./api";
import type { MediaItem } from "./types";
import { Badge, Button, Card, EmptyState, Field, Inline, Modal, PageHeader, Skeleton, Stack, Switch, TextField } from "./ui";

type MediaManagerProps = { site: string; t: (key: string, fallback?: string) => string };

function mediaLabel(asset: MediaItem) {
  return asset.filename || asset.alt || asset.id || "Asset sin nombre";
}
function mediaUrl(asset: MediaItem) {
  return asset.thumbUrl || asset.previewUrl || asset.url || asset.publicUrl || asset.path || "";
}

function isVideo(asset: MediaItem) {
  return String(asset.contentType || asset.kind || asset.metadata?.mimeType || "").toLowerCase().includes("video") || /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(mediaUrl(asset));
}

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

export function MediaManager({ site, t }: MediaManagerProps) {
  const [assets, setAssets] = useState<MediaItem[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = () => {
    setLoading(true);
    setError("");
    return api.managedProductionAssets(site, "all")
      .then((response) => setAssets(response.assets || []))
      .catch((cause) => setError(errorText(cause, t("media.error", "No se pudo cargar la biblioteca de medios."))))
      .finally(() => setLoading(false));
  };

  useEffect(() => { void load(); }, [site]);

  const visibleAssets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return assets;
    return assets.filter((asset) => [mediaLabel(asset), asset.id, asset.alt, asset.metadata?.kind, asset.metadata?.usage].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized));
  }, [assets, query]);
  const visibleIds = visibleAssets.map((asset) => String(asset.id || "")).filter(Boolean);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  const toggle = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const selectVisible = () => setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])]);

  const deleteSelected = async () => {
    if (!selectedIds.length) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteProductionAssets({ site, assetIds: selectedIds, force: true });
      setAssets((current) => current.filter((asset) => !selectedIds.includes(String(asset.id || ""))));
      setSelectedIds([]);
      setDeleteOpen(false);
    } catch (cause) {
      setError(errorText(cause, t("media.deleteError", "No se pudieron eliminar los medios seleccionados.")));
    } finally {
      setBusy(false);
    }
  };

  return <main className="ui-page ui-media-manager">
    <PageHeader
      eyebrow={t("media.eyebrow", "MEDIOS")}
      title={t("media.title", "Biblioteca de medios")}
      description={t("media.description", "Administra imágenes y vídeos de esta marca. Los vínculos no bloquean una eliminación administrativa confirmada.")}
      actions={<Link className="ui-button ui-button-secondary" to="/publication">{t("media.backPublication", "Volver a publicación")}</Link>}
    />
    {error && <Card><p className="ui-field-error" role="alert">{error}</p></Card>}
    <Card><Stack gap="md">
      <Inline gap="md" className="ui-media-manager-toolbar">
        <Field label={t("media.searchLabel", "Buscar medios")}><TextField value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("media.searchPlaceholder", "Nombre, tipo o uso")} /></Field>
        <Badge tone="info">{visibleAssets.length} {t("media.count", "medios")}</Badge>
        <Switch label={t("media.selectVisible", "Seleccionar visibles")} checked={allVisibleSelected} onChange={selectVisible} disabled={!visibleIds.length || busy} />
        <Button variant="danger" disabled={!selectedIds.length || busy} loading={busy} onClick={() => setDeleteOpen(true)}>{t("media.deleteSelected", "Eliminar seleccionados")} {selectedIds.length ? `(${selectedIds.length})` : ""}</Button>
      </Inline>
      {loading ? <div className="ui-media-manager-grid"><Skeleton height="220px" /><Skeleton height="220px" /><Skeleton height="220px" /></div> : !visibleAssets.length ? <EmptyState title={t("media.empty", "No hay medios en la biblioteca")} description={t("media.emptyHelp", "Los medios sin Post y los medios vinculados aparecen aquí para que puedas administrarlos.")} /> : <div className="ui-media-manager-grid">
        {visibleAssets.map((asset) => {
          const id = String(asset.id || "");
          const url = mediaUrl(asset);
          const blockers = (asset.deleteBlockers || []).length;
          return <article className="ui-media-manager-card" key={id || asset.path || asset.url}>
            {url ? isVideo(asset) ? <video className="ui-media-manager-visual" src={url} controls muted preload="metadata" aria-label={mediaLabel(asset)} /> : <img className="ui-media-manager-visual" src={url} alt={asset.alt || mediaLabel(asset)} loading="lazy" decoding="async" /> : <div className="ui-media-manager-visual ui-content-library-placeholder" role="img" aria-label={t("media.noPreview", "Medio sin vista previa")}>{t("media.noPreview", "Sin vista previa")}</div>}
            <div className="ui-media-manager-meta"><Switch label={mediaLabel(asset)} checked={Boolean(id && selectedIds.includes(id))} onChange={() => id && toggle(id)} disabled={!id || busy} /><span className="ui-muted">{asset.contentType || asset.kind || t("media.file", "Archivo")}</span>{blockers ? <Badge tone="warning">{t("media.linked", "Vinculado, se puede eliminar")}</Badge> : <Badge tone="neutral">{t("media.unlinked", "Sin vínculos")}</Badge>}</div>
          </article>;
        })}
      </div>}
    </Stack></Card>
    <Modal open={deleteOpen} title={t("media.deleteTitle", "Eliminar medios definitivamente")} onClose={() => setDeleteOpen(false)}>
      <Stack gap="md"><p>{t("media.deleteConfirm", "Se eliminarán los medios seleccionados y se quitarán sus vínculos internos. Esta acción no se puede deshacer y puede dejar Posts o vídeos sin ese recurso.")}</p><Inline gap="md"><Button variant="ghost" onClick={() => setDeleteOpen(false)}>{t("common.cancel", "Cancelar")}</Button><Button variant="danger" loading={busy} onClick={() => void deleteSelected()}>{t("media.deleteConfirmAction", "Eliminar definitivamente")}</Button></Inline></Stack>
    </Modal>
  </main>;
}
