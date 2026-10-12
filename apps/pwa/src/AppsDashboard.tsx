import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "./api";
import { Badge, Button, Card, EmptyState, Inline, PageHeader, Skeleton, Stack } from "./ui";
import { useNavigate } from "react-router-dom";

type AppsDashboardProps = { site: string; t: (key: string, fallback?: string) => string };
type CatalogEntry = Record<string, any> & {
  id?: string;
  description?: string;
  title?: string;
  tags?: string[];
  metadata?: { uiRoute?: string; uiApps?: Array<Record<string, any>> };
};

const appRoutes: Record<string, string> = {
  "recipe.food-to-reel": "/production/food-to-reel",
  "recipe.reel-from-image": "/production/reel-from-image",
  "recipe.menu-to-reel": "/production/menu-to-reel",
  "recipe.product-to-social": "/production/product-to-social",
  "publication.destination.list": "/publication/publisher",
};

function entryRoute(entry: CatalogEntry) {
  return String(entry.metadata?.uiRoute || appRoutes[entry.id || ""] || "").trim();
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

  const apps = useMemo<CatalogEntry[]>(() => {
    if (!catalog) return [];
    const recipes = catalog.recipes.map((entry) => ({ ...entry, kind: "recipe" }));
    const capabilityApps: CatalogEntry[] = catalog.capabilities.flatMap((entry): CatalogEntry[] => {
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
      return entry.metadata?.uiRoute || appRoutes[entry.id || ""] ? [{ ...entry, kind: "app" }] : [];
    });
    return [...recipes, ...capabilityApps];
  }, [catalog]);
  const availableRoutes = useMemo(() => new Set<string>(apps.map(entryRoute).filter(Boolean)), [apps]);
  const creationModes = useMemo(() => [
    { id: "idea", title: t("apps.modeIdea", "Desde una idea"), description: t("apps.modeIdeaHelp", "Convierte un objetivo y varios temas en una campaña lista para revisar."), route: "/plans", icon: "✦", available: true },
    { id: "image", title: t("apps.modeImage", "Desde una imagen"), description: t("apps.modeImageHelp", "Crea un Reel o Story a partir de una imagen y un guion."), route: "/production/reel-from-image", icon: "◒", available: availableRoutes.has("/production/reel-from-image") },
    { id: "menu", title: t("apps.modeMenu", "Desde un menú"), description: t("apps.modeMenuHelp", "Transforma el menú del día en una pieza social con el formato adecuado."), route: "/production/menu-to-reel", icon: "▤", available: availableRoutes.has("/production/menu-to-reel") },
    { id: "product", title: t("apps.modeProduct", "Desde un producto"), description: t("apps.modeProductHelp", "Adapta una imagen de producto a un canal social sin perder el original."), route: "/production/product-to-social", icon: "◇", available: availableRoutes.has("/production/product-to-social") },
    { id: "food", title: t("apps.modeFood", "Desde un plato"), description: t("apps.modeFoodHelp", "Prepara un Reel de comida con imagen, contexto y revisión de marca."), route: "/production/food-to-reel", icon: "◉", available: availableRoutes.has("/production/food-to-reel") },
    { id: "reuse", title: t("apps.modeReuse", "Reutilizar contenido"), description: t("apps.modeReuseHelp", "Abre tu bandeja para convertir una pieza existente en nuevas variantes."), route: "/plans", icon: "↻", available: true },
  ].filter((mode) => mode.available), [availableRoutes, t]);

  if (loading) {
    return <main className="ui-page"><PageHeader eyebrow={t("apps.eyebrow", "CREAR")} title={t("apps.title", "¿Qué quieres preparar?")} description={t("apps.description", "Elige una entrada. El resultado terminará en un mismo espacio de revisión.")} /><div className="os-app-grid">{[1, 2, 3, 4].map((item) => <Card key={item}><Stack gap="sm"><Skeleton width="55%" height="24px" /><Skeleton height="48px" /><Skeleton width="35%" height="34px" /></Stack></Card>)}</div></main>;
  }

  if (error) {
    return <main className="ui-page"><PageHeader eyebrow={t("apps.eyebrow", "CREAR")} title={t("apps.title", "¿Qué quieres preparar?")} description={t("apps.description", "Elige una entrada. El resultado terminará en un mismo espacio de revisión.")} /><Card><p className="ui-field-error" role="alert">{error}</p><Button variant="secondary" onClick={() => window.location.reload()}>{t("common.retry", "Reintentar")}</Button></Card></main>;
  }

  if (!catalog || !creationModes.length) {
    return <main className="ui-page"><PageHeader eyebrow={t("apps.eyebrow", "CREAR")} title={t("apps.title", "¿Qué quieres preparar?")} /><EmptyState title={t("apps.empty", "Todavía no hay entradas disponibles")} description={t("apps.emptyHelp", "Cuando una app esté disponible para esta marca, aparecerá aquí.")} /></main>;
  }

  return <main className="ui-page os-apps-page">
    <PageHeader eyebrow={t("apps.eyebrow", "CREAR")} title={t("apps.title", "¿Qué quieres preparar?")} description={t("apps.description", "Elige una entrada. El resultado terminará en un mismo espacio de revisión.")} actions={<Button variant="secondary" onClick={() => navigate("/plans")}>{t("apps.openContent", "Ver contenido")}</Button>} />
    <section className="os-create-intro" aria-labelledby="os-create-intro-title">
      <Card>
        <div className="os-create-intro-copy"><span className="ui-eyebrow">{t("apps.guideEyebrow", "UN MISMO RESULTADO")}</span><h2 id="os-create-intro-title">{t("apps.guideTitle", "Crea, revisa y publica sin perder el hilo")}</h2><p className="ui-muted">{t("apps.guideDescription", "Cada entrada conserva la marca, los assets y las variantes en un mismo espacio de revisión.")}</p></div>
        <Inline gap="sm"><Badge tone="success">Entrada clara</Badge><Badge tone="info">Revisión humana</Badge><Badge tone="neutral">Por canal</Badge></Inline>
      </Card>
    </section>
    <section aria-labelledby="os-create-modes-title">
      <div className="os-create-section-head"><div><span className="ui-eyebrow">{t("apps.modesEyebrow", "EMPEZAR")}</span><h2 id="os-create-modes-title">{t("apps.modesTitle", "Elige cómo quieres empezar")}</h2></div><span className="ui-muted">{creationModes.length} {t("apps.modesCount", "opciones disponibles")}</span></div>
      <div className="os-app-grid os-create-grid" aria-label={t("apps.gridLabel", "Formas de crear contenido")}>
        {creationModes.map((mode) => <Card className="os-app-card os-create-card" key={mode.id}>
          <span className="os-create-icon" aria-hidden="true">{mode.icon}</span>
          <div><h2>{mode.title}</h2><p className="ui-muted">{mode.description}</p></div>
          <Button onClick={() => navigate(mode.route)}>{t("apps.open", "Empezar")}</Button>
        </Card>)}
      </div>
    </section>
  </main>;
}
