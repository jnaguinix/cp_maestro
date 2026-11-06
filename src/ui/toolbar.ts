import { CABLES } from '../data/appliances';
import { SCENARIOS, type ScenarioId } from '../model/scenarios';
import { portUsage } from '../rules/validate';
import type { Ctx } from './context';
import { h } from './dom';

export function renderToolbar(ctx: Ctx) {
  const usage = portUsage(ctx.sim);
  const counts = { error: 0, warning: 0 };
  ctx.issues.forEach((i) => { if (i.severity !== 'info') counts[i.severity]++; });
  return h('div', { class: 'toolbar' },
    h('div', { class: 'tool-group' },
      h('span', { class: 'tool-label' }, 'Cable'),
      h('div', { class: 'cable-chips', role: 'radiogroup', 'aria-label': 'Tipo de cable' },
        CABLES.map((c) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(ctx.ui.state.activeCable === c.id),
          class: `cable-chip k-${c.kind} ${ctx.ui.state.activeCable === c.id ? 'on' : ''}`,
          onclick: () => ctx.ui.set({ activeCable: c.id }),
        }, c.label))),
    ),
    h('div', { class: 'tool-group' },
      h('label', { class: 'tool-label', for: 'scenario' }, 'Escenario'),
      h('select', {
        id: 'scenario',
        onchange: (e: Event) => {
          const v = (e.target as HTMLSelectElement).value as ScenarioId;
          if (!v) return;
          ctx.store.loadScenario(v);
          ctx.ui.set({ selected: null, pending: null, highlight: new Set(), highlightCables: new Set(), tab: v === 'broken' ? 'issues' : 'inspector' });
          (e.target as HTMLSelectElement).value = '';
        },
      }, h('option', { value: '' }, 'Cargar…'), SCENARIOS.map((s) => h('option', { value: s.id, title: s.hint }, s.label))),
    ),
    h('div', { class: 'tool-group stats' },
      h('span', { class: 'stat' }, h('b', {}, `${usage[1].downlinkFree}/${usage[1].downlinkTotal}`), ' downlinks libres MHO1'),
      h('span', { class: 'stat' }, h('b', {}, `${usage[2].downlinkFree}/${usage[2].downlinkTotal}`), ' MHO2'),
      h('button', {
        type: 'button', class: `stat-btn ${counts.error ? 'bad' : counts.warning ? 'meh' : 'good'}`,
        onclick: () => ctx.ui.set({ tab: 'issues' }),
      }, counts.error ? `${counts.error} errores` : counts.warning ? `${counts.warning} avisos` : 'Todo correcto'),
    ),
  );
}
