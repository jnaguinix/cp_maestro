// Panel frontal de un MHO-140: 48 puertos SFP + 8 QSFP28.
// Disposición: impares arriba y pares abajo [INF para 1-48]; en los QSFP28 la fila
// de arriba (49/51/53/55) y la de abajo (50/52/54/56) están documentadas (GSG p.124).
import { gaiaName, isSplitMode, mhoEndpoint, portDef, portKey, TYPE_LABEL } from '../data/mho140';
import { parseEndpoint } from '../model/endpoints';
import type { Appliance, OrchId } from '../model/types';
import type { Ctx } from './context';
import { h } from './dom';
import { inView } from './uiState';

/** Appliance conectado a este puerto del MHO (si lo hay). */
function ownerOf(ctx: Ctx, ep: string): Appliance | null {
  const cable = ctx.sim.cables.find((c) => c.a === ep || c.b === ep);
  if (!cable) return null;
  const other = parseEndpoint(cable.a === ep ? cable.b : cable.a);
  if (other.kind !== 'app') return null;
  return ctx.sim.appliances.find((a) => a.id === other.appId) ?? null;
}

function portButton(ctx: Ctx, o: OrchId, front: number, sub = 1, mini = false) {
  const cfg = ctx.sim.ports[portKey(o, front)];
  const def = portDef(front);
  const ep = mhoEndpoint(o, front, sub);
  const disabled = !!def.disabledBy && isSplitMode(ctx.sim.ports[portKey(o, def.disabledBy)].mode);
  const cabled = ctx.sim.cables.some((c) => c.a === ep || c.b === ep);
  const sev = ctx.epSeverity.get(ep);
  const owner = ownerOf(ctx, ep);
  const u = ctx.ui.state;
  // En la vista de un SG, el puerto que usa un appliance de otro SG se ve atenuado
  const foreign = owner && u.view !== 'all' && !inView(u.view, owner) ? owner : null;
  const isSel = u.selected?.kind === 'endpoint' && u.selected.id === ep;
  const cls = [
    'port', `t-${cfg.type}`, mini ? 'mini' : '', def.formFactor === 'QSFP28' && !mini ? 'qsfp' : '',
    cabled ? 'cabled' : '', disabled ? 'disabled' : '', sev ? `sev-${sev}` : '',
    // conectado a un appliance: relleno del color de su SG, como el puerto del firewall
    owner ? `by-sg sg-${owner.sg ?? 'none'}` : '', foreign ? 'foreign' : '',
    ctx.glow.has(ep) ? 'glow' : '',
    u.pending === ep ? 'pending' : '', isSel ? 'selected' : '', u.highlight.has(ep) ? 'hl' : '',
    cfg.type !== def.defaultType || cfg.mode !== def.defaultMode ? 'changed' : '',
  ].filter(Boolean).join(' ');
  const name = gaiaName(o, front, sub, cfg);
  const ownerTxt = owner ? ` · ${foreign ? 'ocupado por' : 'conectado a'} ${owner.name} (${owner.sg ? `SG${owner.sg}` : 'sin SG'})` : '';
  return h('button', {
    class: cls, type: 'button', 'data-ep': ep,
    title: `${o}/${front}/${sub} · ${name} · ${TYPE_LABEL[cfg.type]} · ${cfg.mode}${disabled ? ' · deshabilitado por breakout' : ''}${ownerTxt}`,
    'aria-label': `MHO${o} puerto ${front}${mini ? ` sub-puerto ${sub}` : ''}, ${TYPE_LABEL[cfg.type]}${ownerTxt}`,
    onclick: () => ctx.clickEndpoint(ep),
  }, mini ? String(sub) : '');
}

function slot(ctx: Ctx, o: OrchId, front: number) {
  const cfg = ctx.sim.ports[portKey(o, front)];
  const def = portDef(front);
  if (def.formFactor === 'QSFP28' && isSplitMode(cfg.mode)) {
    return h('div', { class: 'slot' },
      h('span', { class: 'pnum' }, front),
      h('div', { class: 'split' }, [1, 2, 3, 4].map((s) => portButton(ctx, o, front, s, true))),
    );
  }
  return h('div', { class: 'slot' }, h('span', { class: 'pnum' }, front), portButton(ctx, o, front));
}

function group(ctx: Ctx, o: OrchId, label: string, from: number, to: number, kind: string) {
  const cols: HTMLElement[] = [];
  for (let p = from; p <= to; p += 2) {
    cols.push(h('div', { class: 'col' }, slot(ctx, o, p), slot(ctx, o, p + 1)));
  }
  return h('div', { class: `pgroup g-${kind}` }, h('div', { class: 'glabel' }, label), h('div', { class: 'cols' }, cols));
}

export function renderFaceplate(ctx: Ctx, o: OrchId) {
  return h('section', { class: 'mho', 'aria-label': `Orchestrator ${o}` },
    h('header', { class: 'mho-head unit-id', title: `Orchestrator ID ${o} · interfaces eth${o}-XX · Port ID ${o}/X/X` },
      h('strong', { class: 'mho-name' }, `MHO${o}`),
      h('span', { class: 'unit-sub' }, 'Orchestrator 140'),
      h('span', { class: 'mho-id' }, `ID ${o} · eth${o}-XX`),
      h('span', { class: `mho-side side-${o === 1 ? 'l' : 'r'}` }, o === 1 ? '◀ cables por la izquierda' : 'cables por la derecha ▶'),
    ),
    h('div', { class: 'face' },
      group(ctx, o, 'Mgmt 1-4', 1, 4, 'mgmt'),
      group(ctx, o, 'Uplinks 5-26 · 1/10/25G', 5, 26, 'up'),
      group(ctx, o, 'Downlinks 27-47 · Sync 48', 27, 48, 'dl'),
      group(ctx, o, 'QSFP28 49-56 · 25/40/100G', 49, 56, 'qsfp'),
    ),
  );
}
