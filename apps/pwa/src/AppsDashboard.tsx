import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "./api";
import { Button, Card, Field, Inline, PageHeader, Stack, Switch, TextField, Textarea } from "./ui";

type AppsDashboardProps = { site: string; t: (key: string, fallback?: string) => string };

const fallbackChannels = ["blog"] as const;
const channelLabels: Record<string, string> = { blog: "Blog", instagram: "Instagram", instagram_story: "Instagram Story", linkedin: "LinkedIn", substack: "Substack", video: "Vídeo", x: "X" };

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

export function AppsDashboard({ site, t }: AppsDashboardProps) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [availableChannels, setAvailableChannels] = useState<string[]>([...fallbackChannels]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([...fallbackChannels]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api.brandChannels(site, controller.signal).then(({ channels }) => {
      if (controller.signal.aborted) return;
      const enabled = channels.filter((channel) => channel.enabled).map((channel) => channel.channel);
      const next = enabled.length ? enabled : [...fallbackChannels];
      setAvailableChannels(next);
      setSelectedChannels((current) => {
        const kept = current.filter((channel) => next.includes(channel));
        return kept.length ? kept : [next[0]];
      });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [site]);

  const toggleChannel = (channel: string) => {
    setSelectedChannels((current) => current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel]);
  };

  const createPost = async () => {
    if (!title.trim() || !brief.trim() || !selectedChannels.length) return;
    setSaving(true);
    setError("");
    try {
      const result = await api.createContentBatch({
        site,
        title: title.trim(),
        topics: [{ title: title.trim(), brief: brief.trim() }],
        channels: selectedChannels,
        brief: { source: "pwa", externalGeneration: true },
      });
      navigate(`/content/${encodeURIComponent(result.itemIds[0])}`);
    } catch (cause) {
      setError(errorText(cause, t("apps.createError", "No se pudo crear el Post.")));
    } finally {
      setSaving(false);
    }
  };

  return <main className="ui-page v3-create-page">
    <PageHeader
      eyebrow={t("apps.eyebrow", "CREAR")}
      title={t("apps.title", "Crear un Post")}
      description={t("apps.description", "Define la intención y los canales. La generación de copy, imagen y vídeo se realiza fuera del servidor mediante MCP.")}
      actions={<Button variant="secondary" onClick={() => navigate("/content")}>{t("apps.openContent", "Ver contenido")}</Button>}
    />
    <Card>
      <Stack gap="lg">
        {error && <p className="ui-field-error" role="alert">{error}</p>}
        <Field label={t("apps.postTitle", "Título del Post")} hint={t("apps.postTitleHint", "Una frase breve para identificarlo en la bandeja editorial.")}>
          <TextField value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("apps.postTitlePlaceholder", "Ej. Lanzamiento de la nueva carta")} />
        </Field>
        <Field label={t("apps.postBrief", "Brief editorial")} hint={t("apps.postBriefHint", "Describe el objetivo, la audiencia o la idea que deberá desarrollar la IA externa.")}>
          <Textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder={t("apps.postBriefPlaceholder", "Qué queremos contar y qué debería hacer la persona que lo lee")} />
        </Field>
        <Field label={t("apps.channels", "Canales")} hint={t("apps.channelsHint", "Puedes añadir o editar variantes después desde el Post.")}>
          <Inline gap="sm">
            {availableChannels.map((value) => <Switch key={value} label={t(`channel.${value}`, channelLabels[value] || value)} checked={selectedChannels.includes(value)} onChange={() => toggleChannel(value)} />)}
          </Inline>
        </Field>
        <div className="ui-actions">
          <Button loading={saving} disabled={!title.trim() || !brief.trim() || !selectedChannels.length} onClick={() => void createPost()}>{t("apps.createPost", "Crear Post borrador")}</Button>
          <span className="ui-muted">{t("apps.externalAiHint", "Después podrás conectar una generación externa desde MCP v3.")}</span>
        </div>
      </Stack>
    </Card>
  </main>;
}
