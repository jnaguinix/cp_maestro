// Rack: cada equipo ocupa 1U. Arriba el switch del cliente (management + producción), luego los dos Orchestrators y debajo
// los appliances de la vista actual, agrupados por Security Group. Debajo de cada unidad hay
// un canal por donde los cables corren en horizontal hasta los organizadores laterales
// (MHO1 a la izquierda, MHO2 a la derecha). cables.ts ajusta el tamaño de canales y organizadores.
import { rackSizes } from './cables';
import { acceptModelDrop, addFromCatalog } from './catalog';
import type { Ctx } from './context';
import { renderApplianceUnit, renderSwitchUnit } from './devices';
import { h } from './dom';
import { renderFaceplate } from './faceplate';
import { inView, viewSg } from './uiState';

export function renderRack(ctx: Ctx) {
  const view = ctx.ui.state.view;
  const apps = ctx.sim.appliances
    .filter((a) => inView(view, a))
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.sg ?? 99) - (y.a.sg ?? 99) || x.i - y.i)
    .map((x) => x.a);

  const units: HTMLElement[] = [
    renderSwitchUnit(ctx, ctx.sim.switches),
    renderFaceplate(ctx, 1),
    renderFaceplate(ctx, 2),
    ...apps.map((a) => renderApplianceUnit(ctx, a)),
  ];

  const rack = h('div', {
    class: 'rack',
    style: `--ml:${rackSizes.left}px;--mr:${rackSizes.right}px`,
  },
  h('div', { class: 'mgr l', 'aria-hidden': 'true', title: 'Organizador izquierdo: cables del MHO1' }),
  h('div', { class: 'mgr r', 'aria-hidden': 'true', title: 'Organizador derecho: cables del MHO2' }),
  );
  units.forEach((u, i) => {
    u.classList.add('u');
    u.dataset.u = String(i);
    rack.append(u, h('div', { class: 'chan', 'data-chan': String(i), style: `height:${rackSizes.chans[i] ?? 12}px` }));
  });
  if (!apps.length) {
    rack.append(h('p', { class: 'empty-view' },
      view === 'none' ? 'No hay appliances sin SG.' : view === 'all' ? 'No hay appliances.' : `No hay appliances en SG${view}.`,
      ' Agrégalos desde el catálogo o arrástralos hasta aquí.'));
  }
  acceptModelDrop(rack, (model) => addFromCatalog(ctx, model, viewSg(view)));
  return rack;
}
