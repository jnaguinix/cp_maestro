// Punto de entrada: monta la interfaz y la vuelve a dibujar ante cada cambio.
import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';

import { Store } from './model/store';
import type { EndpointId, Issue } from './model/types';
import { validate } from './rules/validate';
import { drawCables } from './ui/cables';
import { renderCatalog, renderViewTabs } from './ui/catalog';
import type { Ctx } from './ui/context';
import { clear, h, svg } from './ui/dom';
import { renderRack } from './ui/rack';
import { renderInspector } from './ui/inspector';
import { renderCommands, renderIssues, renderSgs } from './ui/panels';
import { renderToolbar } from './ui/toolbar';
import { Ui, type Tab } from './ui/uiState';

const store = new Store();
const ui = new Ui();

const toolbarHost = document.getElementById('toolbar')!;
const stage = document.getElementById('stage')!;
const workspace = document.querySelector<HTMLElement>('.workspace')!;
const viewTabsHost = document.getElementById('view-tabs')!;
const catalogHost = document.getElementById('catalog')!;
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
      ui.set({ selected: null });
      return;
    }
    // Un puerto libre empieza un cable; uno ocupado se inspecciona.
    ui.set({ selected: { kind: 'endpoint', id: ep }, tab: 'inspector', pending: busy ? null : ep, highlight: new Set(), highlightCables: new Set() });
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
  const ctx: Ctx = { store, ui, sim, issues, epSeverity: maps.ep, cableSeverity: maps.cab, glow, clickEndpoint };

  clear(toolbarHost);
  toolbarHost.appendChild(renderToolbar(ctx));

  const scrollLeft = stage.scrollLeft;
  clear(stage);
  layer = svg('svg', { class: 'cable-layer', 'aria-hidden': 'true' }) as SVGSVGElement;
  stage.append(renderRack(ctx), layer);
  workspace.classList.toggle('side-collapsed', ui.state.sideCollapsed);
  clear(viewTabsHost);
  viewTabsHost.appendChild(renderViewTabs(ctx));
  clear(catalogHost);
  catalogHost.appendChild(renderCatalog(ctx));
  stage.scrollLeft = scrollLeft;
  stage.classList.toggle('is-pending', !!ui.state.pending);

  const errCount = issues.filter((i) => i.severity === 'error').length;
  clear(sideTabs);
  sideTabs.append(...TABS.map((t) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(ui.state.tab === t.id),
    class: `tab ${ui.state.tab === t.id ? 'on' : ''}`, onclick: () => ui.set({ tab: t.id }),
  }, t.label, t.id === 'issues' && errCount ? h('span', { class: 'badge' }, errCount) : null)));

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

  requestAnimationFrame(() => drawCables(ctx, stage, layer));
  lastCtx = ctx;
}

let lastCtx: Ctx | null = null;
const redrawCables = () => { if (lastCtx) drawCables(lastCtx, stage, layer); };

store.subscribe(render);
ui.subscribe(render);
window.addEventListener('resize', redrawCables);
document.fonts?.ready.then(redrawCables);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const sel = ui.state.selected;
    ui.set({ pending: null, highlight: new Set(), highlightCables: new Set(), selected: sel?.kind === 'cable' ? null : sel });
  }
});

render();
