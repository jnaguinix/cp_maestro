// Selector de cable: un botón con el cable activo que despliega las opciones agrupadas por tipo.
import { CABLES, cableSpec } from '../data/appliances';
import type { CableKind, CableSpec } from '../model/types';
import type { Ctx } from './context';
import { h } from './dom';

const GROUPS: { kind: CableKind; label: string }[] = [
  { kind: 'dac', label: 'DAC (cobre twinax)' },
  { kind: 'fiber', label: 'Fibra' },
  { kind: 'breakout', label: 'Breakout (un ramal)' },
  { kind: 'rj45', label: 'Cobre' },
];

/** Nombre corto dentro de su grupo: "25G", "1G (SFP)", "4×10G", "RJ45 1G" */
function shortLabel(c: CableSpec): string {
  if (c.kind === 'breakout') return `4×${c.speed}G`;
  if (c.kind === 'rj45') return `RJ45 ${c.speed}G`;
  if (c.id === 'fib1') return '1G (SFP)';
  return `${c.speed}G`;
}

export function renderCablePicker(ctx: Ctx) {
  const open = ctx.ui.state.cableOpen;
  const active = cableSpec(ctx.ui.state.activeCable);
  return h('div', { class: `cable-picker ${open ? 'open' : ''}` },
    h('span', { class: 'bar-label' }, 'Cable'),
    h('button', {
      type: 'button', class: 'picker-btn', 'aria-haspopup': 'true', 'aria-expanded': String(open),
      title: 'Tipo de cable que se usa al conectar dos puertos',
      onclick: () => ctx.ui.set({ cableOpen: !open, addOpen: false, projectOpen: false }),
    }, h('span', { class: `cable-swatch k-${active.kind}`, 'aria-hidden': 'true' }), active.label, ' ▾'),
    open
      ? h('div', { class: 'popover cable-pop', role: 'menu', 'aria-label': 'Tipo de cable' },
        GROUPS.map((g) => {
          const items = CABLES.filter((c) => c.kind === g.kind);
          return h('div', { class: 'pop-group' },
            h('span', { class: 'pop-title' }, g.label),
            h('div', { class: 'pop-items' }, items.map((c) => h('button', {
              type: 'button', role: 'menuitemradio', 'aria-checked': String(c.id === active.id),
              class: `pop-item ${c.id === active.id ? 'on' : ''}`, title: c.label,
              onclick: () => ctx.ui.set({ activeCable: c.id, cableOpen: false }),
            }, shortLabel(c)))));
        }))
      : null,
  );
}
