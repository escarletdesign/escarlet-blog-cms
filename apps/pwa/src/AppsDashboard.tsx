import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "./api";
import { Badge, Button, Card, EmptyState, Inline, PageHeader, Skeleton, Stack } from "./ui";
import { useNavigate } from "react-router-dom";

type AppsDashboardProps = { site: string; t: (key: string, fallback?: string) => string };
type CatalogEntry = Record<string, any> & {
  id: string;
  description?: string;
  title?: string;
  tags?: string[];
  metadata?: { uiRoute?: string; uiApps?: Array<Record<string, any>> };
};

const appRoutes: Record<string, string> = {
  "recipe.food-to-reel": "/production/food-to-reel",
  "recipe.menu-to-reel": "/production/menu-to-reel",
  "recipe.product-to-social": "/production/product-to-social",
  "publication.destination.list": "/publication/publisher",
};

const appLabels: Record<string, string> = {
  "recipe.food-to-reel": "Food to Reel",
  "recipe.menu-to-reel": "Menú del día a Reel",
  "recipe.product-to-social": "Producto a publicación social",
  "publication.destination.list": "Publisher",
};

function entryLabel(entry: CatalogEntry) {
  return appLabels[entry.id] || entry.title || entry.id;
}

function entryRoute(entry: CatalogEntry) {
  return String(entry.metadata?.uiRoute || appRoutes[entry.id] || "").trim();
}

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

export function AppsDashboard({ site, t }: AppsDashboardProps) {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<{ guide: { firstSteps: string[]; rules: string[] }; capabilities: CatalogEntry[]; recipes: CatalogEntry[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void api.capabilityCatalog(site, t("apps.goal", "elegir una app de producción"))
      .then((response) => {
        if (active) setCatalog(response);
      })
      .catch((cause) => {
        if (active) setError(errorText(cause, t("apps.loadError", "No se pudo cargar el catálogo de apps.")));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [site, t]);

  const apps = useMemo(() => {
    if (!catalog) return [];
    const recipes = catalog.recipes.map((entry) => ({ ...entry, kind: "recipe" }));
    const capabilityApps = catalog.capabilities.flatMap((entry) => {
      const uiApps = Array.isArray(entry.metadata?.uiApps) ? entry.metadata.uiApps : [];
      if (uiApps.length) {
        return uiApps.map((app) => ({
          ...entry,
          ...app,
          kind: "app",
          parentCapability: entry.id,
          metadata: { ...entry.metadata, uiRoute: app.route || app.uiRoute },
        }));
      }
      return entry.metadata?.uiRoute || appRoutes[entry.id] ? [{ ...entry, kind: "app" }] : [];
    });
    return [...recipes, ...capabilityApps];
  }, [catalog]);

  if (loading) {
    return <main className="ui-page"><PageHeader eyebrow={t("apps.eyebrow", "ESCARLET OS")} title={t("apps.title", "Apps y recipes")} description={t("apps.description", "Elige una tarea. Cada app combina capabilities pequeñas y deja el resultado listo para revisar.")} /><div className="os-app-grid">{[1, 2, 3].map((item) => <Card key={item}><Stack gap="sm"><Skeleton width="55%" height="24px" /><Skeleton height="48px" /><Skeleton width="35%" height="34px" /></Stack></Card>)}</div></main>;
  }

  if (error) {
    return <main className="ui-page"><PageHeader eyebrow={t("apps.eyebrow", "ESCARLET OS")} title={t("apps.title", "Apps y recipes")} description={t("apps.description", "Elige una tarea. Cada app combina capabilities pequeñas y deja el resultado listo para revisar.")} /><Card><p className="ui-field-error" role="alert">{error}</p><Button variant="secondary" onClick={() => window.location.reload()}>{t("common.retry", "Reintentar")}</Button></Card></main>;
  }

  if (!catalog || !apps.length) {
    return <main className="ui-page"><PageHeader eyebrow={t("apps.eyebrow", "ESCARLET OS")} title={t("apps.title", "Apps y recipes")} /><EmptyState title={t("apps.empty", "Todavía no hay apps disponibles")} description={t("apps.emptyHelp", "Cuando una capability tenga manifest y permisos, aparecerá aquí automáticamente.")} /></main>;
  }

  return <main className="ui-page os-apps-page">
    <PageHeader eyebrow={t("apps.eyebrow", "ESCARLET OS")} title={t("apps.title", "Apps y recipes")} description={t("apps.description", "Elige una tarea. Cada app combina capabilities pequeñas y deja el resultado listo para revisar.")} />
    <section className="os-app-guide" aria-labelledby="os-app-guide-title">
      <Card>
        <div className="ui-card-head"><div><span className="ui-eyebrow">{t("apps.guideEyebrow", "CÓMO FUNCIONA")}</span><h2 id="os-app-guide-title">{t("apps.guideTitle", "Una tarea, una entrada clara")}</h2></div><Badge tone="info">MCP v3</Badge></div>
        <p className="ui-muted">{t("apps.guideDescription", "El sistema descubre la app, fija la marca y conserva cada resultado como un artefacto revisable.")}</p>
        <ol className="os-app-steps">{catalog.guide.firstSteps.slice(0, 4).map((step) => <li key={step}>{step}</li>)}</ol>
      </Card>
    </section>
    <div className="os-app-grid" aria-label={t("apps.gridLabel", "Apps disponibles")}>
      {apps.map((entry) => {
        const route = entryRoute(entry);
        const isRecipe = entry.kind === "recipe";
        return <Card className="os-app-card" key={entry.id}>
          <div className="ui-card-head"><div><span className="ui-eyebrow">{isRecipe ? t("apps.recipe", "RECIPE") : t("apps.capability", "CAPABILITY")}</span><h2>{entryLabel(entry)}</h2></div><Badge tone={isRecipe ? "success" : "info"}>{entry.id}</Badge></div>
          <p className="ui-muted">{entry.description || t("apps.noDescription", "Capability disponible desde el MCP.")}</p>
          <div className="os-app-tags">{(entry.tags || []).slice(0, 4).map((tag) => <Badge key={tag} tone="neutral">{tag}</Badge>)}</div>
          <Inline gap="sm"><Button disabled={!route} onClick={() => route && navigate(route)}>{route ? t("apps.open", "Abrir app") : t("apps.mcpOnly", "Usar desde MCP")}</Button>{entry.reviewPolicy === "human_required" || entry.humanReviewRequired ? <Badge tone="warning">{t("apps.review", "Revisión humana")}</Badge> : null}</Inline>
        </Card>;
      })}
    </div>
  </main>;
}
