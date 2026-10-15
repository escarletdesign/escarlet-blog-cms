import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "./api";
import type { MediaItem } from "./types";
import { Badge, Button, Card, EmptyState, Field, FileDropzone, IconButton, Inline, Modal, PageHeader, Select, Skeleton, Stack, TextField } from "./ui";

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

function fileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("No se pudo leer el archivo."));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

function blockerLabel(blocker: string, t: MediaManagerProps["t"]) {
  const labels: Record<string, string> = {
    content_linked: t("media.blockerPost", "Usado en un Post"),
    video_job_linked: t("media.blockerVideo", "Usado por un vídeo"),
    brand_asset_linked: t("media.blockerBrand", "Usado en el Brand Kit"),
    generation_receipt_linked: t("media.blockerReceipt", "Con procedencia de generación")
  };
  return labels[blocker] || t("media.blockerUnknown", "Tiene vínculos internos");
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("button, video, a, input, select, textarea"));
}

function chunk<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

type DragSelection = { mode: "add" | "remove" } | null;

export function MediaManager({ site, t }: MediaManagerProps) {
  const [assets, setAssets] = useState<MediaItem[]>([]);
  const [query, setQuery] = useState("");
  const [linkFilter, setLinkFilter] = useState<"all" | "linked" | "unlinked">("all");
  const [publishedFilter, setPublishedFilter] = useState<"all" | "published" | "unpublished">("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dragSelection, setDragSelection] = useState<DragSelection>(null);
  const selectionAnchor = useRef<string | null>(null);

  const load = () => {
    setLoading(true);
    setError("");
    return api.managedProductionAssets(site, "all", 1000, { linked: linkFilter, published: publishedFilter })
      .then((response) => setAssets(response.assets || []))
      .catch((cause) => setError(errorText(cause, t("media.error", "No se pudo cargar la biblioteca de medios."))))
      .finally(() => setLoading(false));
  };

  useEffect(() => { void load(); }, [site, linkFilter, publishedFilter]);
  useEffect(() => {
    const stopDrag = () => setDragSelection(null);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
    return () => {
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };
  }, []);

  const visibleAssets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return assets;
    return assets.filter((asset) => [mediaLabel(asset), asset.id, asset.alt, asset.metadata?.kind, asset.metadata?.usage].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized));
  }, [assets, query]);
  const visibleIds = visibleAssets.map((asset) => String(asset.id || "")).filter(Boolean);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const selectedAssets = useMemo(() => assets.filter((asset) => selectedIds.includes(String(asset.id || ""))), [assets, selectedIds]);
  const linkedSelectedAssets = selectedAssets.filter((asset) => (asset.deleteBlockers || []).length);
  const linkedSelectedBlockers = [...new Set(linkedSelectedAssets.flatMap((asset) => asset.deleteBlockers || []))];

  const selectRange = (id: string, additive: boolean) => {
    const anchor = selectionAnchor.current;
    const start = anchor ? visibleIds.indexOf(anchor) : -1;
    const end = visibleIds.indexOf(id);
    if (start < 0 || end < 0) return [id];
    const [from, to] = start <= end ? [start, end] : [end, start];
    const range = visibleIds.slice(from, to + 1);
    return additive ? [...new Set([...selectedIds, ...range])] : range;
  };

  const selectCard = (id: string, options: { additive?: boolean; range?: boolean } = {}) => {
    if (!id) return;
    const currentSelected = selectedIds.includes(id);
    if (options.range) {
      setSelectedIds(selectRange(id, options.additive === true));
    } else if (options.additive) {
      setSelectedIds((current) => currentSelected ? current.filter((value) => value !== id) : [...current, id]);
    } else {
      setSelectedIds(currentSelected ? selectedIds.filter((value) => value !== id) : [id]);
    }
    selectionAnchor.current = id;
  };

  const selectVisible = () => setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])]);

  const handleCardPointerDown = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;
    event.preventDefault();
    event.currentTarget.focus();
    const additive = event.metaKey || event.ctrlKey;
    const range = event.shiftKey;
    selectCard(id, { additive, range });
    setDragSelection({ mode: selectedIds.includes(id) && !range && !additive ? "remove" : "add" });
  };

  const handleCardPointerEnter = (id: string) => {
    if (!dragSelection) return;
    setSelectedIds((current) => dragSelection.mode === "add" ? [...new Set([...current, id])] : current.filter((value) => value !== id));
  };

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLElement>, id: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectCard(id, { additive: event.ctrlKey || event.metaKey, range: event.shiftKey });
  };

  const handleGalleryKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectVisible();
    } else if (event.key === "Escape") {
      setSelectedIds([]);
    } else if (event.key === "Delete" && selectedIds.length) {
      event.preventDefault();
      setDeleteOpen(true);
    }
  };

  const deleteSelected = async () => {
    if (!selectedIds.length) return;
    setBusy(true);
    setError("");
    const deletedIds: string[] = [];
    try {
      for (const assetIds of chunk(selectedIds, 100)) {
        await api.deleteProductionAssets({ site, assetIds, force: true });
        deletedIds.push(...assetIds);
      }
      setAssets((current) => current.filter((asset) => !deletedIds.includes(String(asset.id || ""))));
      setSelectedIds([]);
      setDeleteOpen(false);
    } catch (cause) {
      setAssets((current) => current.filter((asset) => !deletedIds.includes(String(asset.id || ""))));
      setSelectedIds((current) => current.filter((id) => !deletedIds.includes(id)));
      setDeleteOpen(false);
      setError(errorText(cause, t("media.deleteError", "No se pudieron eliminar los medios seleccionados.")));
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (!files.length || busy || uploading) return;
    setUploading(true);
    setError("");
    try {
      for (const file of files) {
        if (!file.type.startsWith("image/")) throw new Error(t("media.imageOnly", "Solo puedes subir imágenes."));
        if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name} supera el límite de 12 MB.`);
        await api.uploadProductionAsset({
          site,
          filename: file.name,
          contentBase64: await fileAsDataUrl(file),
          alt: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
          kind: "post",
          manualUpload: true
        });
      }
      await load();
    } catch (cause) {
      setError(errorText(cause, t("media.uploadError", "No se pudieron subir los medios.")));
    } finally {
      setUploading(false);
    }
  };

  return <main className="ui-page ui-media-manager">
    <PageHeader
      eyebrow={t("media.eyebrow", "MEDIOS")}
      title={t("media.title", "Biblioteca de medios")}
      description={t("media.description", "Selecciona imágenes y vídeos como en una galería. Los medios usados en Posts, vídeos o Brand Kit se marcan antes de eliminar.")}
      actions={<Link className="ui-button ui-button-secondary" to="/publication">{t("media.backPublication", "Volver a publicación")}</Link>}
    />
    {error && <Card><p className="ui-field-error" role="alert">{error}</p></Card>}
    <Card><div className="ui-media-manager-gallery" tabIndex={-1} onKeyDown={handleGalleryKeyDown}><Stack gap="md">
      <Inline gap="md" className="ui-media-manager-toolbar">
        <Field label={t("media.searchLabel", "Buscar medios")}><TextField value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("media.searchPlaceholder", "Nombre, tipo o uso")} /></Field>
        <Field label={t("media.linkFilter", "Vínculo")}><Select value={linkFilter} onChange={(event) => setLinkFilter(event.target.value as typeof linkFilter)}><option value="all">{t("media.filterAll", "Todos")}</option><option value="linked">{t("media.filterLinked", "Vinculados")}</option><option value="unlinked">{t("media.filterUnlinked", "Sin vínculos")}</option></Select></Field>
        <Field label={t("media.publishedFilter", "Publicación")}><Select value={publishedFilter} onChange={(event) => setPublishedFilter(event.target.value as typeof publishedFilter)}><option value="all">{t("media.filterAll", "Todos")}</option><option value="published">{t("media.filterPublished", "Publicados")}</option><option value="unpublished">{t("media.filterUnpublished", "No publicados")}</option></Select></Field>
        <FileDropzone disabled={busy || uploading} label={uploading ? t("media.uploading", "Subiendo…") : t("media.upload", "Subir imágenes")} hint={t("media.uploadHint", "Arrastra una o varias imágenes aquí.")} onFiles={uploadFiles} />
        <Badge tone="info">{visibleAssets.length} {t("media.count", "medios")}</Badge>
        <Inline gap="sm" className="ui-media-manager-selection-actions"><IconButton label={allVisibleSelected ? t("media.clearVisible", "Limpiar visibles") : t("media.selectVisible", "Seleccionar visibles")} disabled={!visibleIds.length || busy} onClick={selectVisible}>{allVisibleSelected ? "☑" : "☐"}</IconButton>{selectedIds.length > 0 && <IconButton label={t("media.clearSelection", "Limpiar selección")} disabled={busy} onClick={() => setSelectedIds([])}>×</IconButton>}</Inline>
        <Button variant="danger" disabled={!selectedIds.length || busy} loading={busy} onClick={() => setDeleteOpen(true)}>{t("media.deleteSelected", "Eliminar seleccionados")} {selectedIds.length ? `(${selectedIds.length})` : ""}</Button>
        <p className="ui-media-manager-hint">{t("media.selectionHelp", "Clic selecciona. Shift amplía el rango. Ctrl o ⌘ permite sumar. También puedes arrastrar por la galería. Escape limpia la selección.")}</p>
      </Inline>
      {loading ? <div className="ui-media-manager-grid"><Skeleton height="220px" /><Skeleton height="220px" /><Skeleton height="220px" /></div> : !visibleAssets.length ? <EmptyState title={t("media.empty", "No hay medios en la biblioteca")} description={t("media.emptyHelp", "Los medios sin Post y los medios vinculados aparecen aquí para que puedas administrarlos.")} /> : <div className="ui-media-manager-grid" role="listbox" aria-multiselectable="true" aria-label={t("media.galleryLabel", "Galería de medios")}>
        {visibleAssets.map((asset) => {
          const id = String(asset.id || "");
          const url = mediaUrl(asset);
          const blockers = asset.deleteBlockers || [];
          const selected = Boolean(id && selectedIds.includes(id));
          const blockerNames = blockers.map((blocker) => blockerLabel(blocker, t));
          return <article className={`ui-media-manager-card${selected ? " selected" : ""}${blockers.length ? " linked" : ""}`} key={id || asset.path || asset.url} role="option" aria-selected={selected} aria-label={`${mediaLabel(asset)}${blockers.length ? `. ${blockerNames.join(", ")}` : ""}`} tabIndex={id ? 0 : -1} onPointerDown={(event) => handleCardPointerDown(event, id)} onPointerEnter={() => handleCardPointerEnter(id)} onKeyDown={(event) => handleCardKeyDown(event, id)}>
            {url ? isVideo(asset) ? <video className="ui-media-manager-visual" src={url} controls muted preload="metadata" aria-label={mediaLabel(asset)} /> : <img className="ui-media-manager-visual" src={url} alt={asset.alt || mediaLabel(asset)} loading="lazy" decoding="async" /> : <div className="ui-media-manager-visual ui-content-library-placeholder" role="img" aria-label={t("media.noPreview", "Medio sin vista previa")}>{t("media.noPreview", "Sin vista previa")}</div>}
            <div className="ui-media-manager-meta"><div className="ui-media-manager-card-title"><strong>{mediaLabel(asset)}</strong>{selected && <Badge tone="success">{t("media.selected", "Seleccionado")}</Badge>}</div><span className="ui-muted">{asset.contentType || asset.kind || t("media.file", "Archivo")}</span>{blockers.length ? <div className="ui-media-manager-link-warning"><Badge tone="warning">{t("media.linked", "Usado en contenido")}</Badge><span>{blockerNames.join(" · ")}</span></div> : <Badge tone="neutral">{t("media.unlinked", "Sin vínculos")}</Badge>}</div>
          </article>;
        })}
      </div>}
    </Stack></div></Card>
    <Modal open={deleteOpen} title={t("media.deleteTitle", "Eliminar medios definitivamente")} onClose={() => setDeleteOpen(false)}>
      <Stack gap="md"><p>{t("media.deleteConfirm", "Se eliminarán los medios seleccionados y se quitarán sus vínculos internos. Esta acción no se puede deshacer.")}</p>{linkedSelectedAssets.length > 0 && <div className="ui-media-manager-delete-warning" role="alert"><strong>{t("media.deleteLinkedTitle", "Hay medios usados por el producto")}</strong><p>{t("media.deleteLinkedHelp", "Si continúas, los Posts, vídeos o Brand Kit que los usan quedarán sin ese recurso y podrían no publicarse correctamente.")}</p><span>{linkedSelectedAssets.length} {t("media.linkedSelected", "seleccionados con vínculos")}: {linkedSelectedBlockers.map((blocker) => blockerLabel(blocker, t)).join(" · ")}</span></div>}<Inline gap="md"><Button variant="ghost" onClick={() => setDeleteOpen(false)}>{t("common.cancel", "Cancelar")}</Button><Button variant="danger" loading={busy} onClick={() => void deleteSelected()}>{t("media.deleteConfirmAction", "Eliminar definitivamente")}</Button></Inline></Stack>
    </Modal>
  </main>;
}
