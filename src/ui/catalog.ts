// Pestañas por Security Group y catálogo de appliances (miniaturas para agregar).
import { APPLIANCE_MODELS } from '../data/appliances';
import type { Ctx } from './context';
import { h } from './dom';
import { inView, viewSg, type View } from './uiState';

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

export function renderViewTabs(ctx: Ctx) {
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

  const nav = h('nav', { class: 'view-tabs', role: 'tablist', 'aria-label': 'Vista del rack por Security Group' },
    entries.map((t) => {
      const btn = h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(view === t.id),
        class: `view-tab ${t.cls} ${view === t.id ? 'on' : ''}`,
        title: t.id === 'all' ? 'Ver todos los appliances' : 'Ver solo estos appliances. Suelta aquí una miniatura para agregarla.',
        onclick: () => ctx.ui.set({ view: t.id }),
      }, h('span', { class: 'vt-dot' }), t.label, h('span', { class: 'vt-count' }, t.count));
      acceptModelDrop(btn, (model) => {
        addFromCatalog(ctx, model, typeof t.id === 'number' ? t.id : null);
        ctx.ui.set({ view: t.id });
      });
      return btn;
    }),
    h('span', { class: 'view-hint' }, view === 'all'
      ? 'Vista general'
      : 'Los puertos del MHO que usan otros SG se ven atenuados'),
    h('button', {
      type: 'button', class: 'side-toggle', 'aria-pressed': String(ctx.ui.state.sideCollapsed),
      onclick: () => ctx.ui.set({ sideCollapsed: !ctx.ui.state.sideCollapsed }),
    }, ctx.ui.state.sideCollapsed ? 'Mostrar panel' : 'Ocultar panel'),
  );
  return nav;
}

function thumb(ctx: Ctx, model: string) {
  const def = APPLIANCE_MODELS[model];
  const rj = def.ports.filter((p) => p.role === 'rj45').length;
  const sfp = def.ports.filter((p) => p.role === 'onboard-sfp').length;
  const sg = viewSg(ctx.ui.state.view);
  const btn = h('button', {
    type: 'button', class: 'thumb', draggable: 'true',
    title: `Agregar un Quantum Force ${model}${sg ? ` a SG${sg}` : ' (sin SG)'}. También puedes arrastrarlo a una pestaña.`,
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
  h('span', { class: 'thumb-sub' }, `${rj}× RJ45${sfp ? ` · ${sfp}× SFP+` : ''}`),
  );
  return btn;
}

export function renderCatalog(ctx: Ctx) {
  const sg = viewSg(ctx.ui.state.view);
  const inScope = ctx.sim.appliances.filter((a) => inView(ctx.ui.state.view, a)).length;
  return h('div', { class: 'catalog', 'aria-label': 'Catálogo de appliances' },
    h('div', { class: 'catalog-head' },
      h('span', { class: 'tool-label' }, 'Catálogo'),
      h('span', { class: 'note' }, sg ? `Se agregan a SG${sg}` : 'Se agregan sin SG'),
    ),
    h('div', { class: 'thumbs' }, Object.keys(APPLIANCE_MODELS).map((m) => thumb(ctx, m))),
    h('span', { class: 'note catalog-count' }, `${inScope} en esta vista`),
  );
}
