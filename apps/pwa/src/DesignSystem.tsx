import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  ChannelBadge,
  Checkbox,
  Drawer,
  EmptyState,
  Field,
  Inline,
  Modal,
  PageHeader,
  Progress,
  Select,
  Skeleton,
  Stack,
  StatusBadge,
  Tabs,
  Textarea,
  TextField,
  Toast,
} from "./ui";

const colorTokens = [
  ["--ui-bg", "Fondo"],
  ["--ui-surface", "Superficie"],
  ["--ui-surface-raised", "Elevada"],
  ["--ui-accent", "Acento"],
  ["--ui-danger", "Peligro"],
  ["--ui-muted", "Texto secundario"],
] as const;

const tabs = [
  { id: "foundations", label: "Fundamentos" },
  { id: "patterns", label: "Patrones" },
  { id: "states", label: "Estados" },
] as const;

export function DesignSystem() {
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("foundations");
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  return (
    <main className="ui-ds-page">
      <div className="ui-ds-shell">
        <header className="ui-ds-hero">
          <div>
            <span className="ui-eyebrow">Escarlet UI · Showcase público</span>
            <h1>Un sistema visible para construir sin improvisar.</h1>
            <p>Componentes, tokens y patrones que sirven como referencia común para producto, diseño y agentes.</p>
          </div>
          <div className="ui-ds-hero-meta">
            <Badge tone="success">Activo</Badge>
            <span className="ui-ds-version">PWA / UI 1.0</span>
          </div>
        </header>

        <section className="ui-ds-section ui-ds-intro-grid" aria-labelledby="ui-ds-overview-title">
          <Card>
            <span className="ui-eyebrow">Contrato</span>
            <h2 id="ui-ds-overview-title">La fuente de verdad</h2>
            <p className="ui-muted">Los componentes viven en <code>src/ui</code>, los tokens en <code>tokens.css</code> y esta página comprueba su composición real.</p>
            <Inline gap="sm"><Badge tone="info">Tokens --ui-*</Badge><Badge tone="neutral">React primitives</Badge><Badge tone="success">Responsive</Badge></Inline>
          </Card>
          <Card>
            <span className="ui-eyebrow">Regla rápida</span>
            <h2>Si aparece dos veces, se comparte.</h2>
            <p className="ui-muted">Una nueva variante debe entrar primero en el componente reusable. Las pantallas consumen la API, no duplican estilos.</p>
          </Card>
        </section>

        <section className="ui-ds-section" aria-labelledby="ui-ds-library-title">
          <PageHeader eyebrow="Biblioteca" title="Componentes y patrones" description="Prueba los estados principales sin necesidad de iniciar sesión." />
          <Tabs items={[...tabs]} value={tab} onChange={setTab} idPrefix="ui-ds-tabs" panelIdPrefix="ui-ds-panel" ariaLabel="Secciones del sistema de diseño" />
          <div className="ui-ds-panel" id={`ui-ds-panel-${tab}`} role="tabpanel" aria-labelledby={`ui-ds-tabs-${tab}`} tabIndex={0}>
            {tab === "foundations" && <Foundations />}
            {tab === "patterns" && <Patterns onModal={() => setModalOpen(true)} onDrawer={() => setDrawerOpen(true)} />}
            {tab === "states" && <States onToast={() => setToastVisible(true)} />}
          </div>
        </section>

        <footer className="ui-ds-footer">
          <span>Escarlet UI</span>
          <span>Ruta pública: <code>/design-system</code></span>
          <span>Actualizado con la API compartida</span>
        </footer>
      </div>

      <Modal open={modalOpen} title="Modal de referencia" onClose={() => setModalOpen(false)}>
        <Stack gap="md">
          <p className="ui-muted">Los modales mantienen el contexto y se cierran con Escape o con el botón de cierre.</p>
          <Inline gap="sm"><Button variant="ghost" onClick={() => setModalOpen(false)}>Cancelar</Button><Button onClick={() => setModalOpen(false)}>Confirmar</Button></Inline>
        </Stack>
      </Modal>
      <Drawer open={drawerOpen} title="Drawer de referencia" onClose={() => setDrawerOpen(false)}>
        <Stack gap="md"><p className="ui-muted">Los drawers sirven para tareas secundarias que no necesitan una página completa.</p><Button onClick={() => setDrawerOpen(false)}>Cerrar drawer</Button></Stack>
      </Drawer>
      {toastVisible && <div className="ui-ds-toast-wrap"><Toast className="ui-toast-demo" tone="success" message="Conexión guardada" /><Toast className="ui-toast-demo" tone="info" message="Canales cargados" /><Toast className="ui-toast-demo" tone="danger" message="No se pudo conectar con Buffer" /><Button size="sm" variant="ghost" onClick={() => setToastVisible(false)}>Ocultar</Button></div>}
    </main>
  );
}

function Foundations() {
  return <div className="ui-ds-grid">
    <Card className="ui-ds-span-2"><div className="ui-card-head"><div><span className="ui-eyebrow">Color</span><h2>Tokens semánticos</h2></div><code>--ui-*</code></div><div className="ui-ds-token-grid">{colorTokens.map(([token, label]) => <div className="ui-ds-token" key={token}><span className="ui-ds-swatch" style={{ background: `var(${token})` }} /><div><strong>{label}</strong><code>{token}</code></div></div>)}</div></Card>
    <Card><span className="ui-eyebrow">Tipografía</span><h2>Escala de lectura</h2><div className="ui-ds-type-sample"><span className="ui-ds-type-display">Aa</span><strong>Inter para producto</strong><p className="ui-muted">Jerarquía clara, textos cortos y estados que se entienden de un vistazo.</p></div></Card>
    <Card><span className="ui-eyebrow">Ritmo</span><h2>Espaciado compartido</h2><div className="ui-ds-spacing">{["--ui-space-1", "--ui-space-2", "--ui-space-3", "--ui-space-4", "--ui-space-6", "--ui-space-8"].map((token) => <div key={token}><span style={{ width: `var(${token})` }} /><code>{token}</code></div>)}</div></Card>
    <Card className="ui-ds-span-2"><span className="ui-eyebrow">Acciones</span><h2>Button e IconButton</h2><Inline gap="sm"><Button>Primaria</Button><Button variant="secondary">Secundaria</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Peligro</Button><Button size="sm">Compacta</Button></Inline><p className="ui-muted ui-ds-note">Todas las acciones tienen foco visible, estados disabled y type seguro por defecto.</p></Card>
    <Card className="ui-ds-span-2"><span className="ui-eyebrow">Estados y canales</span><h2>Badges consistentes</h2><Inline gap="sm"><Badge>Neutral</Badge><Badge tone="info">Info</Badge><Badge tone="success">Éxito</Badge><Badge tone="warning">Aviso</Badge><Badge tone="danger">Error</Badge><StatusBadge status="scheduled" /><StatusBadge status="failed" /><ChannelBadge channel="blog" /><ChannelBadge channel="instagram" /><ChannelBadge channel="linkedin" /></Inline></Card>
  </div>;
}

function Patterns({ onModal, onDrawer }: { onModal: () => void; onDrawer: () => void }) {
  const [channel, setChannel] = useState("blog");
  return <div className="ui-ds-grid">
    <Card><span className="ui-eyebrow">Formulario</span><h2>Field y controles</h2><Stack gap="md"><Field label="Nombre" hint="Texto de ayuda"><TextField defaultValue="Escarlet" /></Field><Field label="Canal"><Select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="blog">Blog</option><option value="instagram">Instagram</option><option value="linkedin">LinkedIn</option></Select></Field><Field label="Brief"><Textarea defaultValue="Una idea breve para probar el sistema." rows={3} /></Field><Checkbox label="Usar como preferencia" defaultChecked /></Stack></Card>
    <Card><span className="ui-eyebrow">Overlay</span><h2>Contexto sin perder la página</h2><p className="ui-muted">Modal y Drawer comparten foco, Escape y título accesible.</p><Inline gap="sm"><Button onClick={onModal}>Abrir modal</Button><Button variant="secondary" onClick={onDrawer}>Abrir drawer</Button></Inline><div className="ui-ds-mini-preview"><span>Canal seleccionado</span><strong>{channel}</strong></div></Card>
    <Card className="ui-ds-span-2"><span className="ui-eyebrow">Composición</span><h2>Card de contenido</h2><div className="ui-ds-card-row"><Card className="ui-plan-card"><div className="ui-card-head"><div><span className="ui-eyebrow">Campaña</span><h3>Campaña de septiembre</h3></div><StatusBadge status="approved" /></div><Progress value={7} max={10} /><div className="ui-card-meta"><span>7/10 publicaciones generadas</span><span>3 pendientes</span></div></Card><Card className="ui-publication-card"><div className="ui-card-head"><div><h3>Cómo ordenar un sistema de UI</h3><div className="ui-channel-list"><ChannelBadge channel={channel} /></div></div><StatusBadge status="draft" /></div><div className="ui-card-actions"><Button size="sm">Revisar</Button><Button variant="ghost" size="sm">Editar</Button></div></Card></div></Card>
  </div>;
}

function States({ onToast }: { onToast: () => void }) {
  return <div className="ui-ds-grid">
    <Card><span className="ui-eyebrow">Carga</span><h2>Skeleton</h2><Stack gap="sm"><Skeleton height="1.2rem" /><Skeleton width="72%" /><Skeleton width="48%" /></Stack></Card>
    <Card><span className="ui-eyebrow">Progreso</span><h2>Feedback continuo</h2><Progress value={64} /><p className="ui-muted ui-ds-note">64% completado</p><Button onClick={onToast}>Mostrar toast</Button></Card>
    <Card className="ui-ds-span-2"><EmptyState title="Estado vacío" description="Explica qué falta y ofrece el siguiente paso con una acción clara." action={<Button>Crear primera campaña</Button>} /></Card>
  </div>;
}
