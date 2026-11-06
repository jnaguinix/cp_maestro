// Punto de entrada: monta la interfaz y la vuelve a dibujar ante cada cambio.
import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';

import { Store } from './model/store';
import type { EndpointId, Issue } from './model/types';
import { validate } from './rules/validate';
import { drawCables } from './ui/cables';
import { renderRackBar } from './ui/catalog';
import type { Ctx } from './ui/context';
import { clear, h, svg } from './ui/dom';
import { renderRack } from './ui/rack';
import { renderInspector } from './ui/inspector';
import { renderCommands, renderIssues, renderSgs } from './ui/panels';
import { renderToolbar } from './ui/toolbar';
import { Ui, type Tab } from './ui/uiState';
import { fitZoom } from './ui/viewport';
import { maybeStartTour } from './ui/tour';

const store = new Store();
const ui = new Ui();

const toolbarHost = document.getElementById('toolbar')!;
const stage = document.getElementById('stage')!;
const workspace = document.querySelector<HTMLElement>('.workspace')!;
const viewTabsHost = document.getElementById('view-tabs')!;
const sideTabs = document.getElementById('side-tabs')!;
const sideBody = document.getElementById('side-body')!;
const toastHost = document.getElementById('toast')!;

const SEV_RANK: Record<Issue['severity'], number> = { error: 3, warning: 2, info: 1 };

function severityMaps(issues: Issue[]) {
  const ep = new Map<EndpointId, Issue['severity']>();
  const cab = new Map<string, Issue['severity']>();
  for (const i of issues) {
    if (i.severity === 'info') continue;
    for (const r of i.refs) if (!ep.has(r) || SEV_RANK[i.severity] > SEV_RANK[ep.get(r)!]) ep.set(r, i.severity);
    for (const c of i.cables ?? []) if (!cab.has(c) || SEV_RANK[i.severity] > SEV_RANK[cab.get(c)!]) cab.set(c, i.severity);
  }
  return { ep, cab };
}

function clickEndpoint(ep: EndpointId) {
  const { pending } = ui.state;
  if (!pending) {
    const busy = store.cableAt(ep);
    const sel = ui.state.selected;
    // Otro clic sobre un puerto cuyo cable ya brilla (por el cable o por cualquiera de sus
    // dos extremos) lo deselecciona.
    const litCableId = sel?.kind === 'cable' ? sel.id : sel?.kind === 'endpoint' ? store.cableAt(sel.id)?.id : undefined;
    if (busy && litCableId === busy.id) {
      ui.set({ selected: null, drawer: false });
      return;
    }
    // Un puerto libre empieza un cable; uno ocupado se inspecciona (en modo compacto abre el panel).
    ui.set({
      selected: { kind: 'endpoint', id: ep }, tab: 'inspector', pending: busy ? null : ep,
      highlight: new Set(), highlightCables: new Set(), drawer: !!busy,
    });
    return;
  }
  if (pending === ep) {
    ui.set({ pending: null });
    return;
  }
  const err = store.connect(pending, ep, ui.state.activeCable);
  if (err) {
    ui.toast(err);
    ui.set({ pending: null, selected: { kind: 'endpoint', id: ep } });
  } else {
    ui.set({ pending: null, selected: { kind: 'endpoint', id: ep } });
  }
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'inspector', label: 'Detalle' },
  { id: 'issues', label: 'Validación' },
  { id: 'sgs', label: 'Security Groups' },
  { id: 'commands', label: 'Comandos' },
];

let layer: SVGSVGElement;
let refitting = false;

function render() {
  const sim = store.get();
  const issues = validate(sim);
  const maps = severityMaps(issues);
  // Extremos del cable seleccionado (o del cable del puerto seleccionado): se iluminan en neón
  const sel = ui.state.selected;
  const selCable = sel?.kind === 'cable'
    ? sim.cables.find((c) => c.id === sel.id)
    : sel?.kind === 'endpoint' ? sim.cables.find((c) => c.a === sel.id || c.b === sel.id) : undefined;
  const glow = new Set<EndpointId>(selCable ? [selCable.a, selCable.b] : []);
  const ctx: Ctx = { store, ui, sim, issues, epSeverity: maps.ep, cableSeverity: maps.cab, glow, zoom: 1, clickEndpoint };

  // El menú Proyecto guarda mientras escribes: se conserva el foco y el cursor al redibujar
  const focused = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const focusId = focused && toolbarHost.contains(focused) && focused.id ? focused.id : null;
  const caret = focusId && 'selectionStart' in focused! ? [focused!.selectionStart, focused!.selectionEnd] as const : null;
  clear(toolbarHost);
  toolbarHost.appendChild(renderToolbar(ctx));
  if (focusId) {
    const el = document.getElementById(focusId) as HTMLInputElement | null;
    el?.focus();
    if (el && caret && caret[0] !== null) el.setSelectionRange(caret[0], caret[1]);
  }

  const scrollLeft = stage.scrollLeft;
  const scrollTop = stage.scrollTop;
  workspace.classList.toggle('side-collapsed', ui.state.sideCollapsed);
  workspace.classList.toggle('drawer-open', ui.state.drawer);
  clear(stage);
  layer = svg('svg', { class: 'cable-layer', 'aria-hidden': 'true' }) as SVGSVGElement;
  // El rack y la capa de cables comparten un contenedor que se escala junto (zoom CSS)
  const rackEl = renderRack(ctx);
  const zoomWrap = h('div', { class: 'rack-zoom' }, rackEl, layer);
  stage.append(zoomWrap);
  const z = ui.state.zoomPref === 'fit' ? fitZoom(stage, rackEl) : ui.state.zoomPref;
  zoomWrap.style.zoom = z === 1 ? '' : String(z);
  ctx.zoom = z;
  // Alto disponible para el rack (lo usa el CSS del modo compacto)
  document.documentElement.style.setProperty('--stage-top', `${Math.round(stage.getBoundingClientRect().top + window.scrollY)}px`);
  clear(viewTabsHost);
  viewTabsHost.appendChild(renderRackBar(ctx));
  stage.scrollLeft = scrollLeft;
  stage.scrollTop = scrollTop;
  stage.classList.toggle('is-pending', !!ui.state.pending);

  const errCount = issues.filter((i) => i.severity === 'error').length;
  clear(sideTabs);
  sideTabs.append(...TABS.map((t) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(ui.state.tab === t.id), title: t.label,
    class: `tab ${ui.state.tab === t.id ? 'on' : ''}`, onclick: () => ui.set({ tab: t.id }),
  }, t.label, t.id === 'issues' && errCount ? h('span', { class: 'badge' }, errCount) : null)),
  // Solo se ve en modo compacto, donde el panel es un cajón
  h('button', { type: 'button', class: 'side-close', 'aria-label': 'Cerrar panel', title: 'Cerrar panel (Esc)', onclick: () => ui.set({ drawer: false }) }, '×'));

  const sideScroll = sideBody.scrollTop;
  clear(sideBody);
  sideBody.appendChild(
    ui.state.tab === 'issues' ? renderIssues(ctx)
      : ui.state.tab === 'sgs' ? renderSgs(ctx)
        : ui.state.tab === 'commands' ? renderCommands(ctx)
          : renderInspector(ctx),
  );
  sideBody.scrollTop = sideScroll;

  toastHost.hidden = !ui.state.toast;
  toastHost.textContent = ui.state.toast ?? '';

  requestAnimationFrame(() => {
    drawCables(ctx, stage, layer);
    // Los organizadores laterales toman su ancho al dibujar los cables: si con "Ajustar" eso cambia
    // la escala que cabe, se vuelve a dibujar una vez con la escala correcta.
    if (ui.state.zoomPref === 'fit' && !refitting) {
      const z2 = fitZoom(stage, rackEl);
      if (Math.abs(z2 - z) >= 0.01) {
        refitting = true;
        render();
        refitting = false;
      }
    }
  });
  lastCtx = ctx;
}

let lastCtx: Ctx | null = null;
const redrawCables = () => { if (lastCtx) drawCables(lastCtx, stage, layer); };

store.subscribe(render);
ui.subscribe(render);
// Al cambiar el tamaño de la ventana (o el zoom del navegador) se recalcula la escala del rack
let resizeTimer: number | undefined;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(render, 80);
});
document.fonts?.ready.then(redrawCables);
// Los menús desplegables (proyecto, cable, agregar) se cierran al hacer clic fuera
document.addEventListener('click', (e) => {
  const t = e.target as Element;
  const patch: Partial<typeof ui.state> = {};
  if (ui.state.projectOpen && !t.closest?.('.project-menu')) { patch.projectOpen = false; patch.confirmOpen = null; }
  if (ui.state.cableOpen && !t.closest?.('.cable-picker')) patch.cableOpen = false;
  if (ui.state.addOpen && !t.closest?.('.add-equip')) patch.addOpen = false;
  if (Object.keys(patch).length) ui.set(patch);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (ui.state.projectOpen || ui.state.cableOpen || ui.state.addOpen)) {
    ui.set({ projectOpen: false, cableOpen: false, addOpen: false, confirmOpen: null });
    return;
  }
  if (e.key === 'Escape') {
    const sel = ui.state.selected;
    ui.set({ pending: null, highlight: new Set(), highlightCables: new Set(), selected: sel?.kind === 'cable' ? null : sel, drawer: false });
  }
});

render();
// La primera vez que alguien abre la app, se muestra el recorrido guiado
maybeStartTour();
