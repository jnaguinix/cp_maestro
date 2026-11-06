// Barra del rack: pestañas por Security Group, cable, catálogo de appliances (miniaturas para
// agregar) y tamaño del rack.
import { APPLIANCE_MODELS } from '../data/appliances';
import type { Ctx } from './context';
import { h } from './dom';
import { renderCablePicker } from './cablePicker';
import { viewSg, type View } from './uiState';
import { ZOOM_MAX, ZOOM_MIN, isCompact, saveZoomPref, stepZoom, type ZoomPref } from './viewport';

const DRAG_MIME = 'text/plain';
const DRAG_PREFIX = 'maestro-model:';

/** Agrega un appliance en el SG indicado y avisa. */
export function addFromCatalog(ctx: Ctx, model: string, sg: number | null) {
  const app = ctx.store.addAppliance(model, sg);
  ctx.ui.toast(`${app.name} agregado ${sg ? `a SG${sg}` : 'sin SG'}.`);
}

function droppedModel(e: DragEvent): string | null {
  const raw = e.dataTransfer?.getData(DRAG_MIME) ?? '';
  return raw.startsWith(DRAG_PREFIX) ? raw.slice(DRAG_PREFIX.length) : null;
}

/** Permite soltar una miniatura del catálogo sobre un elemento. */
export function acceptModelDrop(el: HTMLElement, onModel: (model: string) => void) {
  el.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes(DRAG_MIME)) {
      e.preventDefault();
      el.classList.add('drop-ok');
    }
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-ok'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop-ok');
    const m = droppedModel(e);
    if (m) onModel(m);
  });
}

/** Tamaño del rack: − / porcentaje / + y "Ajustar" (cabe a lo ancho). */
function zoomControl(ctx: Ctx) {
  const pref = ctx.ui.state.zoomPref;
  const set = (p: ZoomPref) => { saveZoomPref(p); ctx.ui.set({ zoomPref: p }); };
  const pct = Math.round(ctx.zoom * 100);
  return h('div', { class: 'zoom-ctl', role: 'group', 'aria-label': 'Tamaño del rack' },
    h('button', { type: 'button', class: 'zoom-btn', title: 'Más pequeño', 'aria-label': 'Reducir el rack', disabled: ctx.zoom <= ZOOM_MIN, onclick: () => set(stepZoom(ctx.zoom, -1)) }, '−'),
    h('span', { class: 'zoom-val', 'aria-live': 'polite' }, `${pct}%`),
    h('button', { type: 'button', class: 'zoom-btn', title: 'Más grande', 'aria-label': 'Ampliar el rack', disabled: ctx.zoom >= ZOOM_MAX, onclick: () => set(stepZoom(ctx.zoom, 1)) }, '+'),
    h('button', {
      type: 'button', class: `zoom-fit ${pref === 'fit' ? 'on' : ''}`, 'aria-pressed': String(pref === 'fit'),
      title: 'Ajustar el rack al ancho de la pantalla (máximo 100 %)', onclick: () => set('fit'),
    }, 'Ajustar'),
  );
}

/** Barra del rack: vista por SG · cable · agregar equipos · tamaño del rack · panel. */
export function renderRackBar(ctx: Ctx) {
  const { sim } = ctx;
  const view = ctx.ui.state.view;
  const unassigned = sim.appliances.filter((a) => a.sg === null).length;
  const entries: { id: View; label: string; count: number; cls: string }[] = [
    { id: 'all', label: 'Todos', count: sim.appliances.length, cls: '' },
    ...sim.sgs.map((sg) => ({
      id: sg.id as View, label: `SG${sg.id}`, count: sim.appliances.filter((a) => a.sg === sg.id).length, cls: `sg-${sg.id}`,
    })),
  ];
  if (unassigned > 0 || view === 'none') entries.push({ id: 'none', label: 'Sin SG', count: unassigned, cls: 'sg-none' });

  const tabs = h('nav', { class: 'view-tabs', role: 'tablist', 'aria-label': 'Vista del rack por Security Group' },
    entries.map((t) => {
      const btn = h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(view === t.id),
        class: `view-tab ${t.cls} ${view === t.id ? 'on' : ''}`,
        title: t.id === 'all'
          ? 'Ver todos los appliances'
          : 'Ver solo estos appliances (los puertos del MHO que usan otros SG se ven atenuados). Suelta aquí una miniatura para agregarla.',
        onclick: () => ctx.ui.set({ view: t.id }),
      }, h('span', { class: 'vt-dot' }), t.label, h('span', { class: 'vt-count' }, t.count));
      acceptModelDrop(btn, (model) => {
        addFromCatalog(ctx, model, typeof t.id === 'number' ? t.id : null);
        ctx.ui.set({ view: t.id });
      });
      return btn;
    }));

  const compact = isCompact();
  const panelBtn = compact
    // Pantalla angosta: el panel es un cajón que se abre por encima del rack
    ? h('button', {
      type: 'button', class: 'side-toggle', 'aria-pressed': String(ctx.ui.state.drawer),
      onclick: () => ctx.ui.set({ drawer: !ctx.ui.state.drawer }),
    }, ctx.ui.state.drawer ? 'Cerrar panel' : 'Panel ▸')
    : h('button', {
      type: 'button', class: 'side-toggle', 'aria-pressed': String(!ctx.ui.state.sideCollapsed),
      onclick: () => ctx.ui.set({ sideCollapsed: !ctx.ui.state.sideCollapsed }),
    }, ctx.ui.state.sideCollapsed ? 'Mostrar panel' : 'Ocultar panel');

  return h('div', { class: 'rack-bar' },
    tabs,
    h('div', { class: 'bar-group' }, renderCablePicker(ctx)),
    h('div', { class: 'bar-group' }, renderAdd(ctx)),
    h('div', { class: 'bar-group bar-end' }, zoomControl(ctx), panelBtn),
  );
}
function thumb(ctx: Ctx, model: string) {
  const def = APPLIANCE_MODELS[model];
  const rj = def.ports.filter((p) => p.role === 'rj45').length;
  const sfp = def.ports.filter((p) => p.role === 'onboard-sfp').length;
  const sg = viewSg(ctx.ui.state.view);
  const btn = h('button', {
    type: 'button', class: 'thumb', draggable: 'true',
    title: `Agregar un Quantum Force ${model} (${rj}× RJ45${sfp ? `, ${sfp}× SFP+` : ''})${sg ? ` a SG${sg}` : ' sin SG'}. También puedes arrastrarlo a una pestaña.`,
    onclick: () => addFromCatalog(ctx, model, sg),
    ondragstart: (e: Event) => {
      const dt = (e as DragEvent).dataTransfer;
      if (!dt) return;
      dt.setData(DRAG_MIME, `${DRAG_PREFIX}${model}`);
      dt.effectAllowed = 'copy';
    },
  },
  h('span', { class: 'thumb-face', 'aria-hidden': 'true' },
    h('span', { class: 'thumb-led' }),
    h('span', { class: 'thumb-ports' }, [1, 2, 3, 4].map(() => h('i'))),
  ),
  h('span', { class: 'thumb-name' }, model),
  );
  return btn;
}

/** Agregar equipos: miniaturas en línea; en pantallas angostas, un botón con un menú. */
function renderAdd(ctx: Ctx) {
  const sg = viewSg(ctx.ui.state.view);
  const target = sg ? `a SG${sg}` : 'sin SG';
  const thumbs = () => Object.keys(APPLIANCE_MODELS).map((m) => thumb(ctx, m));
  const open = ctx.ui.state.addOpen;
  return h('div', { class: `add-equip ${open ? 'open' : ''}` },
    h('span', { class: 'bar-label', title: `Los equipos nuevos se agregan ${target}` }, 'Agregar'),
    h('div', { class: 'thumbs add-inline' }, thumbs()),
    h('button', {
      type: 'button', class: 'picker-btn add-menu-btn', 'aria-haspopup': 'true', 'aria-expanded': String(open),
      onclick: () => ctx.ui.set({ addOpen: !open, cableOpen: false, projectOpen: false }),
    }, '+ Firewall ▾'),
    open
      ? h('div', { class: 'popover add-pop', role: 'menu', 'aria-label': 'Agregar firewall' },
        h('span', { class: 'pop-title' }, `Se agrega ${target} · también puedes arrastrarlo a una pestaña`),
        h('div', { class: 'thumbs' }, thumbs()))
      : null,
  );
}
