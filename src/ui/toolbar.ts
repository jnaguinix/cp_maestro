// Cabecera: a la izquierda el proyecto (junto al título de la app) y a la derecha su estado.
import { portUsage } from '../rules/validate';
import type { Ctx } from './context';
import { h } from './dom';
import { renderProjectMenu } from './projectMenu';

export function renderToolbar(ctx: Ctx) {
  const usage = portUsage(ctx.sim);
  const counts = { error: 0, warning: 0 };
  ctx.issues.forEach((i) => { if (i.severity !== 'info') counts[i.severity]++; });
  const free = (o: 1 | 2) => `${usage[o].downlinkFree}/${usage[o].downlinkTotal}`;
  return h('div', { class: 'toolbar' },
    h('div', { class: 'crumb' },
      h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '/'),
      renderProjectMenu(ctx),
      h('span', { class: 'crumb-sub' }, '2× MHO-140 · Quantum Force · R82'),
    ),
    h('div', { class: 'status' },
      h('span', { class: 'stat', title: `Downlinks libres: ${free(1)} en el MHO1 y ${free(2)} en el MHO2` },
        'Downlinks libres ', h('b', {}, `${free(1)} · ${free(2)}`)),
      h('button', {
        type: 'button', class: `stat-btn ${counts.error ? 'bad' : counts.warning ? 'meh' : 'good'}`,
        title: 'Ver la validación',
        onclick: () => ctx.ui.set({ tab: 'issues', drawer: true }),
      }, counts.error ? `${counts.error} errores` : counts.warning ? `${counts.warning} avisos` : '✓ Todo correcto'),
    ),
  );
}
