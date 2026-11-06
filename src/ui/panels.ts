// Pestañas Validación, Security Groups y Comandos.
import { APPLIANCE_MODELS } from '../data/appliances';
import { MHO140_PORTS, gaiaName, isSplitMode, portIdStr, portKey } from '../data/mho140';
import type { OrchId } from '../model/types';
import { downlinksOf } from '../rules/validate';
import type { Ctx } from './context';
import { h } from './dom';

const SEV_LABEL = { error: 'Error', warning: 'Aviso', info: 'Info' } as const;

export function renderIssues(ctx: Ctx) {
  const counts = { error: 0, warning: 0, info: 0 };
  ctx.issues.forEach((i) => counts[i.severity]++);
  const verdict = counts.error === 0
    ? counts.warning === 0 ? 'El cableado cumple todas las reglas.' : 'Funciona, pero hay avisos que conviene revisar.'
    : `${counts.error} error(es) impiden que esto funcione como está.`;
  return h('div', { class: 'insp' },
    h('h2', {}, 'Validación'),
    h('p', { class: `verdict ${counts.error ? 'bad' : counts.warning ? 'meh' : 'good'}` }, verdict),
    h('p', { class: 'chip-row' },
      h('span', { class: 'chip sev-error' }, `${counts.error} errores`),
      h('span', { class: 'chip sev-warning' }, `${counts.warning} avisos`),
      h('span', { class: 'chip sev-info' }, `${counts.info} info`)),
    h('p', { class: 'muted' }, 'Haz clic en un hallazgo para resaltar los puertos implicados.'),
    h('ul', { class: 'issue-list' }, ctx.issues.map((i) =>
      h('li', {},
        h('button', {
          type: 'button', class: `issue sev-${i.severity}`,
          onclick: () => ctx.ui.set({ highlight: new Set(i.refs), highlightCables: new Set(i.cables ?? []) }),
        },
          h('span', { class: 'sev' }, SEV_LABEL[i.severity]),
          h('strong', {}, i.title),
          h('p', {}, i.detail),
          h('span', { class: 'src' }, `${i.rule} · ${i.source}`)),
      ))),
  );
}

/** Puertos del MHO que hoy son de tipo Uplink (con sus sub-puertos si están en breakout). */
function uplinkPorts(ctx: Ctx) {
  const out: { o: OrchId; front: number; sub: number; id: string; name: string; cabled: boolean }[] = [];
  for (const o of [1, 2] as OrchId[]) {
    for (const d of MHO140_PORTS) {
      const cfg = ctx.sim.ports[portKey(o, d.front)];
      if (cfg.type !== 'uplink') continue;
      if (d.disabledBy && isSplitMode(ctx.sim.ports[portKey(o, d.disabledBy)].mode)) continue;
      const subs = d.formFactor === 'QSFP28' && isSplitMode(cfg.mode) ? [1, 2, 3, 4] : [1];
      for (const s of subs) {
        const id = portIdStr(o, d.front, s);
        out.push({
          o, front: d.front, sub: s, id, name: gaiaName(o, d.front, s, cfg),
          cabled: ctx.sim.cables.some((c) => c.a === `mho:${id}` || c.b === `mho:${id}`),
        });
      }
    }
  }
  return out;
}

/** Bloque de Uplinks de un SG: los asignados y un selector para agregar más. */
function sgUplinks(ctx: Ctx, sgId: number, assigned: string[]) {
  const all = uplinkPorts(ctx);
  const nameOf = (id: string) => all.find((u) => u.id === id)?.name ?? id;
  const free = all.filter((u) => !assigned.includes(u.id));
  // pares: el mismo puerto libre en ambos MHOs
  const pairs = free.filter((u) => u.o === 1 && free.some((v) => v.o === 2 && v.front === u.front && v.sub === u.sub));
  const label = (u: (typeof all)[number]) => `${u.name} · MHO${u.o} puerto ${u.front}${u.cabled ? '' : ' · sin cable'}`;
  const sel = h('select', {
    'aria-label': `Agregar Uplink a SG${sgId}`,
    onchange: (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      if (!v) return;
      if (v.startsWith('pair:')) {
        const [front, s] = v.slice(5).split('/');
        ctx.store.toggleSgUplink(sgId, `1/${front}/${s}`);
        ctx.store.toggleSgUplink(sgId, `2/${front}/${s}`);
      } else ctx.store.toggleSgUplink(sgId, v);
    },
  },
  h('option', { value: '' }, 'Agregar Uplink…'),
  pairs.length ? h('optgroup', { label: 'En ambos MHOs (recomendado)' }, pairs.map((u) => {
    const twin = free.find((v) => v.o === 2 && v.front === u.front && v.sub === u.sub)!;
    return h('option', { value: `pair:${u.front}/${u.sub}` }, `${u.name} + ${twin.name}${u.cabled && twin.cabled ? '' : ' · falta cable'}`);
  })) : null,
  [1, 2].map((o) => h('optgroup', { label: `Solo MHO${o}` }, free.filter((u) => u.o === o).map((u) => h('option', { value: u.id }, label(u))))),
  );
  return h('div', { class: 'uplink-box' },
    h('span', { class: 'k' }, 'Uplinks asignados (red del cliente)'),
    assigned.length
      ? h('div', { class: 'chip-row' }, assigned.map((id) => h('span', { class: 'chip up-chip' },
        h('code', {}, nameOf(id)), ` ${id}`,
        h('button', { type: 'button', class: 'chip-x', 'aria-label': `Quitar ${nameOf(id)} de SG${sgId}`, onclick: () => ctx.store.toggleSgUplink(sgId, id) }, '×'))))
      : h('p', { class: 'muted' }, 'Ninguno: el SG no tiene salida a la red del cliente.'),
    sel,
  );
}

const MGMT_OPTIONS = [1, 2].flatMap((o) => [1, 2, 3, 4].map((p) => ({ o: o as OrchId, p, id: portIdStr(o as OrchId, p) })));

export function renderSgs(ctx: Ctx) {
  const dls = downlinksOf(ctx.sim);
  return h('div', { class: 'insp' },
    h('h2', {}, 'Security Groups'),
    h('details', { class: 'explain', open: true },
      h('summary', {}, 'Cómo funcionan los puertos Management'),
      h('ul', {},
        h('li', {}, 'Cada SG necesita al menos un puerto Management del Orchestrator. Por ahí el SMS/MDS habla con el SMO Master: SIC, instalación de política, logs, y también SSH y Gaia Portal del SG. (CB p.30, p.54)'),
        h('li', {}, 'En el MHO-140 son los puertos 1-4 (eth1-Mgmt1…4 en el MHO1, eth2-Mgmt1…4 en el MHO2). Solo esos admiten el tipo management.'),
        h('li', {}, 'Shared Management: un mismo puerto sirve a varios SGs; cada SG tiene ahí su propia IP y su propia MAC. No hace falta un puerto por SG. (GSG p.128)'),
        h('li', {}, 'Con dos MHOs, asigna el puerto de ambos y júntalos en el SG en un bond magg (eth1-Mgmt1 + eth2-Mgmt1). Si cae un MHO, la gestión sigue. (GSG p.126; AG p.118-119)'),
        h('li', {}, 'No es un Uplink: no lleva producción, no admite Hide NAT ni VPN, y el paso de datos a management viene deshabilitado por defecto. (CB p.173)'),
        h('li', {}, 'No confundir con el puerto MGMT RJ45 de cada MHO (en la parte trasera del MHO-140), que solo sirve para administrar el propio Orchestrator. (CB p.107)'),
      ),
    ),
    h('details', { class: 'explain' },
      h('summary', {}, 'Cómo funcionan los Uplinks'),
      h('ul', {},
        h('li', {}, 'Los Uplinks son las interfaces de datos del SG hacia la red del cliente. Sin al menos uno asignado, el SG no pasa tráfico de producción.'),
        h('li', {}, 'En el MHO-140 son los puertos 5-26 y 49-56 por defecto. Se asignan con add maestro security-group id <ID> interface ethX-YY.'),
        h('li', {}, 'Asigna como mínimo uno de cada MHO, mejor el mismo número de puerto (eth1-13 y eth2-13). Si cae un Orchestrator, el SG sigue saliendo por el otro. (GSG p.126)'),
        h('li', {}, 'Dentro del SG decides cómo usarlos: interfaces sueltas, en bond entre los dos MHOs o con VLANs. El simulador solo comprueba que estén asignados y cableados.'),
        h('li', {}, 'Para asignar uno, usa el selector de cada SG o haz clic en un puerto Uplink del MHO.'),
      ),
    ),
    ctx.sim.sgs.map((sg) => {
      const members = ctx.sim.appliances.filter((a) => a.sg === sg.id);
      return h('section', { class: `sg-card sg-${sg.id}` },
        h('h3', {}, `SG${sg.id}`, h('span', { class: 'muted' }, members.length ? ` · ${members.length} appliance(s)` : ' · sin appliances')),
        members.length
          ? h('table', { class: 'mini-table' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Appliance'), h('th', {}, 'Modelo'), h('th', {}, 'DL MHO1'), h('th', {}, 'DL MHO2'))),
            h('tbody', {}, members.map((m) => h('tr', {},
              h('td', {}, m.name), h('td', {}, APPLIANCE_MODELS[m.model].model),
              h('td', { class: 'num' }, dls.filter((d) => d.app.id === m.id && d.mho.orch === 1).length),
              h('td', { class: 'num' }, dls.filter((d) => d.app.id === m.id && d.mho.orch === 2).length)))))
          : h('p', { class: 'muted' }, 'Asigna appliances desde el selector de cada tarjeta.'),
        sgUplinks(ctx, sg.id, sg.uplinkPorts),
        h('fieldset', { class: 'mgmt-pick' },
          h('legend', {}, 'Puertos Management asignados'),
          MGMT_OPTIONS.map((opt) => {
            const id = `mg-${sg.id}-${opt.o}-${opt.p}`;
            return h('label', { for: id, class: 'check' },
              h('input', {
                type: 'checkbox', id, checked: sg.mgmtPorts.includes(opt.id),
                onchange: () => ctx.store.toggleSgMgmt(sg.id, opt.id),
              }),
              h('code', {}, gaiaName(opt.o, opt.p, 1, ctx.sim.ports[portKey(opt.o, opt.p)])));
          }),
        ),
      );
    }),
  );
}

export function buildCommands(ctx: Ctx): string {
  const lines: string[] = ['# ===== En un Orchestrator (Gaia Clish) ====='];
  const portLines: string[] = [];
  for (const o of [1, 2] as OrchId[]) {
    for (const d of MHO140_PORTS) {
      const cfg = ctx.sim.ports[portKey(o, d.front)];
      const id = portIdStr(o, d.front);
      if (cfg.mode !== d.defaultMode) portLines.push(`set maestro port ${id} qsfp-mode ${cfg.mode}`);
      if (cfg.type !== d.defaultType) portLines.push(`set maestro port ${id} type ${cfg.type}`);
    }
  }
  if (portLines.length) lines.push('', '# Velocidad y tipo de puertos (sin auto-negociación)', ...portLines);
  for (const sg of ctx.sim.sgs) {
    const members = ctx.sim.appliances.filter((a) => a.sg === sg.id);
    if (!members.length && !sg.mgmtPorts.length && !sg.uplinkPorts.length) continue;
    lines.push('', `# Security Group ${sg.id}`, `add maestro security-group id ${sg.id}`);
    for (const m of members) lines.push(`add maestro security-group id ${sg.id} serial ${m.serial}`);
    for (const p of sg.mgmtPorts) {
      const [o, f] = p.split('/').map(Number);
      lines.push(`add maestro security-group id ${sg.id} interface ${gaiaName(o as OrchId, f, 1, ctx.sim.ports[portKey(o as OrchId, f)])}`);
    }
    if (sg.uplinkPorts.length) lines.push(`# Uplinks (red del cliente)`);
    for (const p of sg.uplinkPorts) {
      const [o, f, s] = p.split('/').map(Number);
      lines.push(`add maestro security-group id ${sg.id} interface ${gaiaName(o as OrchId, f, s || 1, ctx.sim.ports[portKey(o as OrchId, f)])}`);
    }
  }
  lines.push('', 'show maestro security-group verify-new-config', 'set maestro security-group apply-new-config');
  lines.push('', '# Los downlinks no se configuran: el Orchestrator los detecta y los agrega solo.');
  lines.push('# Los Uplinks asignados aparecen como interfaces en el Gaia del SG: allí decides si van sueltos, en bond o con VLANs.');
  lines.push('# Los serials son ficticios: en el equipo real usa TAB para listarlos.');
  return lines.join('\n');
}

export function renderCommands(ctx: Ctx) {
  const text = buildCommands(ctx);
  const pre = h('pre', { class: 'cmd tall', id: 'cmd-out' }, text);
  return h('div', { class: 'insp' },
    h('h2', {}, 'Comandos generados'),
    h('p', { class: 'muted' }, 'Se generan a partir del estado actual. Sintaxis: AG p.67-80 y p.85; CB p.78-79. Ojo: el simulador asume que los SGs aún no existen.'),
    h('button', {
      type: 'button', class: 'btn',
      onclick: async (e: Event) => {
        const btn = e.currentTarget as HTMLButtonElement;
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = 'Copiado';
        } catch {
          const r = document.createRange();
          r.selectNodeContents(pre);
          const s = window.getSelection();
          s?.removeAllRanges();
          s?.addRange(r);
          btn.textContent = 'Texto seleccionado: copia con Ctrl+C';
        }
      },
    }, 'Copiar comandos'),
    pre,
  );
}
