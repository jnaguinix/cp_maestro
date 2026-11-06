// Panel lateral: detalle del puerto o cable seleccionado.
import { APPLIANCE_MODELS, CABLES, ROLE_LABEL, SWITCH_UNIT_NAME, SWITCH_ZONE_LABEL, cableSpec, cardPortNumber, expectedOrchForCardPort, switchPortLabel, switchPortNumber } from '../data/appliances';
import {
  TYPE_HELP, TYPE_LABEL, gaiaName, isSplitMode, portDef, portIdStr, portKey,
} from '../data/mho140';
import { parseEndpoint } from '../model/endpoints';
import type { Cable, EndpointId, Issue, PortMode, PortType } from '../model/types';
import type { Ctx } from './context';
import { h } from './dom';

const ROLE_HELP: Record<string, string> = {
  card: 'Puerto de la tarjeta del slot de expansión: es el que va al Orchestrator. Patrón documentado para tarjetas de 4 puertos: el 1 al MHO1 y el 2 al MHO2; con dos downlinks por MHO, 1 y 3 al MHO1, 2 y 4 al MHO2. Impares al MHO1, pares al MHO2. (GSG p.132-133; para la serie 9000 es [INF])',
  'onboard-sfp': 'Puerto de datos del appliance. En Maestro el appliance no se conecta directo a la red: todo el tráfico entra por los Uplinks del Orchestrator. [INF]',
  rj45: 'Puerto de cobre a 1G. Maestro solo admite downlinks de 10G o más. (GSG p.28)',
  mgmt: 'En Maestro este puerto no se usa para gestionar el SG: el SMO Master se gestiona por el puerto Management del Orchestrator (1-4). [INF: el puerto queda sin uso]',
  sync: 'En Maestro la sincronización entre miembros viaja por los downlinks en la VLAN 3800+SG#, no por este puerto. (CB p.50) [INF: el puerto queda sin uso]',
};

function issuesFor(ctx: Ctx, pred: (i: Issue) => boolean) {
  const list = ctx.issues.filter(pred);
  if (!list.length) return h('p', { class: 'ok-line' }, 'Sin hallazgos para este elemento.');
  return h('ul', { class: 'issue-list compact' }, list.map((i) =>
    h('li', { class: `issue sev-${i.severity}` },
      h('strong', {}, i.title), h('p', {}, i.detail), h('span', { class: 'src' }, i.source))));
}

function cableBlock(ctx: Ctx, c: Cable | undefined, here: EndpointId) {
  if (!c) return h('p', { class: 'muted' }, 'Sin cable. Para conectar, elige un cable arriba y haz clic en este puerto y luego en el otro extremo.');
  const other = c.a === here ? c.b : c.a;
  return h('div', { class: 'cable-box' },
    h('div', {}, h('span', { class: 'k' }, 'Cable'), ' ', cableSpec(c.spec).label),
    h('div', {}, h('span', { class: 'k' }, 'Otro extremo'), ' ', h('button', { class: 'linkish', type: 'button', onclick: () => ctx.ui.set({ selected: { kind: 'endpoint', id: other } }) }, describeEndpoint(ctx, other))),
    h('button', { class: 'btn danger', type: 'button', onclick: () => { ctx.store.disconnect(c.id); ctx.ui.set({ selected: { kind: 'endpoint', id: here } }); } }, 'Desconectar cable'),
  );
}

export function describeEndpoint(ctx: Ctx, ep: EndpointId): string {
  const p = parseEndpoint(ep);
  if (p.kind === 'mho') {
    const cfg = ctx.sim.ports[portKey(p.orch, p.front)];
    return `MHO${p.orch} · ${portIdStr(p.orch, p.front, p.sub)} · ${gaiaName(p.orch, p.front, p.sub, cfg)}`;
  }
  if (p.kind === 'app') {
    const app = ctx.sim.appliances.find((a) => a.id === p.appId);
    const port = app && APPLIANCE_MODELS[app.model].ports.find((x) => x.id === p.portId);
    return `${app?.name ?? p.appId} · ${port?.label ?? p.portId}`;
  }
  return switchPortLabel(ctx.sim.switches, p.swId, p.n);
}

function kv(k: string, v: Node | string) {
  return h('div', { class: 'kv' }, h('dt', {}, k), h('dd', {}, v));
}

/** Casillas para asignar este Uplink a uno o varios Security Groups. */
function uplinkAssign(ctx: Ctx, pid: string) {
  return h('fieldset', { class: 'mgmt-pick uplink-pick' },
    h('legend', {}, 'Asignar este Uplink al Security Group'),
    ctx.sim.sgs.map((sg) => {
      const id = `up-${sg.id}-${pid.replace(/\//g, '-')}`;
      return h('label', { for: id, class: `check sg-${sg.id}` },
        h('input', { type: 'checkbox', id, checked: sg.uplinkPorts.includes(pid), onchange: () => ctx.store.toggleSgUplink(sg.id, pid) }),
        h('span', { class: 'sg-dot' }), `SG${sg.id}`);
    }),
  );
}

function mhoInspector(ctx: Ctx, ep: EndpointId) {
  const p = parseEndpoint(ep);
  if (p.kind !== 'mho') return h('div');
  const def = portDef(p.front);
  const cfg = ctx.sim.ports[portKey(p.orch, p.front)];
  const pid = portIdStr(p.orch, p.front, p.sub);
  const cable = ctx.sim.cables.find((c) => c.a === ep || c.b === ep);
  const sgs = ctx.sim.sgs.filter((sg) => sg.mgmtPorts.includes(pid)).map((sg) => `SG${sg.id}`);
  const disabled = !!def.disabledBy && isSplitMode(ctx.sim.ports[portKey(p.orch, def.disabledBy)].mode);
  const pidBase = portIdStr(p.orch, p.front, 1);

  const typeSel = h('select', {
    id: 'insp-type', disabled: def.allowedTypes.length === 1,
    onchange: (e: Event) => {
      const err = ctx.store.setPortType(p.orch, p.front, (e.target as HTMLSelectElement).value as PortType);
      if (err) ctx.ui.toast(err);
    },
  }, def.allowedTypes.map((t) => h('option', { value: t, selected: t === cfg.type }, TYPE_LABEL[t])));
  const modeSel = h('select', {
    id: 'insp-mode', disabled: def.allowedModes.length === 1,
    onchange: (e: Event) => {
      const before = ctx.sim.cables.length;
      const err = ctx.store.setPortMode(p.orch, p.front, (e.target as HTMLSelectElement).value as PortMode);
      if (err) { ctx.ui.toast(err); return; }
      const removed = before - ctx.store.get().cables.length;
      if (p.sub > 1 && !isSplitMode(ctx.store.get().ports[portKey(p.orch, p.front)].mode)) {
        // el sub-puerto seleccionado ya no existe: se vuelve al puerto base
        ctx.ui.set({ selected: { kind: 'endpoint', id: `mho:${portIdStr(p.orch, p.front, 1)}` } });
      }
      if (removed > 0) {
        ctx.ui.toast(`Se quitó${removed > 1 ? 'ron' : ''} ${removed} cable${removed > 1 ? 's' : ''} de los sub-puertos que ya no existen.`);
      }
    },
  }, def.allowedModes.map((m) => h('option', { value: m, selected: m === cfg.mode }, m)));

  const cmds: string[] = [];
  if (cfg.mode !== def.defaultMode) cmds.push(`set maestro port ${pidBase} qsfp-mode ${cfg.mode}`);
  if (cfg.type !== def.defaultType) cmds.push(`set maestro port ${pidBase} type ${cfg.type}`);
  cmds.push(`show maestro port ${pidBase} qsfp-mode`, `show maestro port ${pidBase} type`);

  return h('div', { class: 'insp' },
    h('p', { class: 'eyebrow' }, `Orchestrator ${p.orch}`),
    h('h2', {}, `Puerto ${p.front}${isSplitMode(cfg.mode) ? ` · sub-puerto ${p.sub}` : ''}`),
    h('p', { class: 'chip-row' },
      h('span', { class: `chip t-${cfg.type}` }, TYPE_LABEL[cfg.type]),
      disabled ? h('span', { class: 'chip sev-error' }, `Deshabilitado: el ${def.disabledBy} está en breakout`) : null),
    h('dl', { class: 'ident' },
      kv('Panel frontal', String(p.front)),
      kv('Port ID (Clish MHO)', h('code', {}, pid)),
      kv('Interfaz Gaia', h('code', {}, gaiaName(p.orch, p.front, p.sub, cfg))),
      kv('Formato', def.formFactor === 'QSFP28' ? 'QSFP28' : 'SFP28 / SFP+'),
    ),
    h('p', { class: 'help' }, TYPE_HELP[cfg.type]),
    cfg.type === 'downlink' && p.front <= 47
      ? h('p', { class: 'note' }, 'El nombre dlNN es el que muestra la tabla del GSG para los Downlinks. No se usa en el Gaia del SG: allí el appliance no "ve" sus downlinks como interfaces.')
      : null,
    h('div', { class: 'controls' },
      h('label', { for: 'insp-type' }, 'Tipo (set maestro port … type)'), typeSel,
      h('label', { for: 'insp-mode' }, 'Velocidad (set maestro port … qsfp-mode)'), modeSel,
    ),
    def.allowedTypes.length === 1 ? h('p', { class: 'note' }, p.front === 48
      ? 'El puerto 48 (ssm_sync) no admite cambiar su tipo (GSG p.46).'
      : p.front <= 4 ? 'Solo los puertos 1-4 admiten el tipo management, y este simulador no los cambia a otro tipo.'
        : 'Puerto de sync Dual Site. El simulador no permite cambiarle el tipo.') : null,
    sgs.length ? h('p', { class: 'note' }, `Asignado como Management a: ${sgs.join(', ')}${sgs.length > 1 ? ' (Shared Management)' : ''}`) : null,
    cfg.type === 'uplink' && !disabled ? uplinkAssign(ctx, pid) : null,
    h('h3', {}, 'Cable'), cableBlock(ctx, cable, ep),
    h('h3', {}, 'Comandos (MHO, Gaia Clish)'), h('pre', { class: 'cmd' }, cmds.join('\n')),
    h('h3', {}, 'Validación'), issuesFor(ctx, (i) => i.refs.includes(ep) || (!!cable && !!i.cables?.includes(cable.id))),
  );
}

function appInspector(ctx: Ctx, ep: EndpointId) {
  const p = parseEndpoint(ep);
  if (p.kind !== 'app') return h('div');
  const app = ctx.sim.appliances.find((a) => a.id === p.appId)!;
  const model = APPLIANCE_MODELS[app.model];
  const port = model.ports.find((x) => x.id === p.portId)!;
  const cable = ctx.sim.cables.find((c) => c.a === ep || c.b === ep);
  return h('div', { class: 'insp' },
    h('p', { class: 'eyebrow' }, `${app.name} · ${app.sg ? `SG${app.sg}` : 'sin SG'}`),
    h('h2', {}, cardPortNumber(port.id) !== null ? `Slot de expansión · puerto ${cardPortNumber(port.id)}` : `Puerto ${port.label}`),
    h('dl', { class: 'ident' },
      kv('Función', ROLE_LABEL[port.role]),
      kv('Velocidades', `${port.speeds.join(' / ')}G`),
      cardPortNumber(port.id) !== null
        ? kv('Según la guía va al', `MHO${expectedOrchForCardPort(cardPortNumber(port.id)!)} (${cardPortNumber(port.id)! % 2 ? 'impar' : 'par'})`)
        : null,
      kv('Serial (ficticio)', h('code', {}, app.serial)),
    ),
    h('p', { class: 'help' }, ROLE_HELP[port.role]),
    h('p', { class: 'note' }, `Fuente del hardware: ${model.source}.`),
    h('h3', {}, 'Cable'), cableBlock(ctx, cable, ep),
    h('h3', {}, 'Validación'), issuesFor(ctx, (i) => i.refs.includes(ep) || (!!cable && !!i.cables?.includes(cable.id))),
  );
}

function swInspector(ctx: Ctx, ep: EndpointId) {
  const p = parseEndpoint(ep);
  if (p.kind !== 'sw') return h('div');
  const sw = ctx.sim.switches.find((s) => s.id === p.swId)!;
  const cable = ctx.sim.cables.find((c) => c.a === ep || c.b === ep);
  return h('div', { class: 'insp' },
    h('p', { class: 'eyebrow' }, `${SWITCH_UNIT_NAME} · zona ${SWITCH_ZONE_LABEL[sw.role]}`),
    h('h2', {}, `Puerto ${switchPortNumber(ctx.sim.switches, p.swId, p.n)}`),
    h('p', { class: 'help' }, sw.role === 'mgmt'
      ? 'Zona de management: aquí vive el SMS/MDS. Se conecta a los puertos Management (1-4) de cada Orchestrator. El SG obtiene en ese puerto su IP de management (y una MAC propia si el puerto es compartido).'
      : 'Zona de producción del cliente. Se conecta a los Uplinks del Orchestrator; los bonds y las VLANs de esos Uplinks se configuran después en el Gaia del Security Group.'),
    h('p', { class: 'note' }, 'Es un solo switch físico con dos zonas. En una red real, la de management va en su propia VLAN o segmento, separada de la producción.'),
    h('h3', {}, 'Cable'), cableBlock(ctx, cable, ep),
    h('h3', {}, 'Validación'), issuesFor(ctx, (i) => i.refs.includes(ep) || (!!cable && !!i.cables?.includes(cable.id))),
  );
}

function cableInspector(ctx: Ctx, id: string) {
  const c = ctx.sim.cables.find((k) => k.id === id);
  if (!c) return intro(ctx);
  return h('div', { class: 'insp' },
    h('p', { class: 'eyebrow' }, 'Cable'),
    h('h2', {}, cableSpec(c.spec).label),
    h('dl', { class: 'ident' },
      kv('Extremo A', h('button', { class: 'linkish', type: 'button', onclick: () => ctx.ui.set({ selected: { kind: 'endpoint', id: c.a } }) }, describeEndpoint(ctx, c.a))),
      kv('Extremo B', h('button', { class: 'linkish', type: 'button', onclick: () => ctx.ui.set({ selected: { kind: 'endpoint', id: c.b } }) }, describeEndpoint(ctx, c.b))),
    ),
    h('button', { class: 'btn danger', type: 'button', onclick: () => { ctx.store.disconnect(c.id); ctx.ui.set({ selected: null }); } }, 'Desconectar cable'),
    h('h3', {}, 'Validación'), issuesFor(ctx, (i) => !!i.cables?.includes(c.id)),
  );
}

function intro(_ctx: Ctx) {
  return h('div', { class: 'insp intro' },
    h('h2', {}, 'Cómo se usa'),
    h('ol', {},
      h('li', {}, 'Elige un tipo de cable en la barra superior (por defecto, el DAC 25G que trae el bundle).'),
      h('li', {}, 'Agrega appliances desde el catálogo (clic o arrastrar a una pestaña) y míralos por Security Group con las pestañas.'),
      h('li', {}, 'Haz clic en un puerto y luego en el otro extremo para conectar. Esc cancela.'),
      h('li', {}, 'Haz clic en un puerto o en un cable para ver sus datos, cambiar tipo o velocidad y desconectar.'),
      h('li', {}, 'La pestaña Validación lista lo que está mal y por qué, con la fuente de cada regla.'),
    ),
    h('h3', {}, 'Las 4 identidades de un puerto'),
    h('p', {}, 'El mismo puerto tiene un número en el panel frontal, un Port ID en el Clish del Orchestrator (Orchestrator/puerto/sub-puerto), un nombre de interfaz en Gaia y un tipo. Selecciona cualquier puerto del MHO para verlas juntas.'),
    h('h3', {}, 'Cables disponibles'),
    h('p', { class: 'muted' }, CABLES.map((c) => c.label).join(' · ')),
  );
}

export function renderInspector(ctx: Ctx) {
  const sel = ctx.ui.state.selected;
  if (!sel) return intro(ctx);
  if (sel.kind === 'cable') return cableInspector(ctx, sel.id);
  const kind = sel.id.split(':')[0];
  if (kind === 'mho') return mhoInspector(ctx, sel.id);
  if (kind === 'app') return appInspector(ctx, sel.id);
  return swInspector(ctx, sel.id);
}
