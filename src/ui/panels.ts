// Pestañas Validación, Security Groups y Comandos.
import { APPLIANCE_MODELS } from '../data/appliances';
import { MHO140_PORTS, gaiaName, portIdStr, portKey } from '../data/mho140';
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
    if (!members.length && !sg.mgmtPorts.length) continue;
    lines.push('', `# Security Group ${sg.id}`, `add maestro security-group id ${sg.id}`);
    for (const m of members) lines.push(`add maestro security-group id ${sg.id} serial ${m.serial}`);
    for (const p of sg.mgmtPorts) {
      const [o, f] = p.split('/').map(Number);
      lines.push(`add maestro security-group id ${sg.id} interface ${gaiaName(o as OrchId, f, 1, ctx.sim.ports[portKey(o as OrchId, f)])}`);
    }
  }
  lines.push('', 'show maestro security-group verify-new-config', 'set maestro security-group apply-new-config');
  lines.push('', '# Los downlinks no se configuran: el Orchestrator los detecta y los agrega solo.');
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
