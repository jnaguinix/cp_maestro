// Appliances (SGMs) y switches externos, dibujados como equipos de rack de 1U.
import { APPLIANCE_MODELS, ROLE_LABEL, cardPortNumber, expectedOrchForCardPort } from '../data/appliances';
import { appEndpoint, swEndpoint } from '../model/endpoints';
import type { Appliance, AppliancePortDef, EndpointId, SwitchDev } from '../model/types';
import type { Ctx } from './context';
import { h } from './dom';
import { inView } from './uiState';

function epClasses(ctx: Ctx, ep: EndpointId, base: string) {
  const u = ctx.ui.state;
  const cabled = ctx.sim.cables.some((c) => c.a === ep || c.b === ep);
  const sev = ctx.epSeverity.get(ep);
  return [
    base, cabled ? 'cabled' : '', sev ? `sev-${sev}` : '', u.pending === ep ? 'pending' : '',
    u.selected?.kind === 'endpoint' && u.selected.id === ep ? 'selected' : '', u.highlight.has(ep) ? 'hl' : '',
    ctx.glow.has(ep) ? 'glow' : '',
  ].filter(Boolean).join(' ');
}

function appPort(ctx: Ctx, app: Appliance, p: AppliancePortDef, shape: string) {
  const ep = appEndpoint(app.id, p.id);
  const n = cardPortNumber(p.id);
  const hint = n !== null ? ` · según la guía va al MHO${expectedOrchForCardPort(n)}` : '';
  const name = n !== null ? `Slot de expansión · puerto ${n}` : `Puerto ${p.label}`;
  return h('button', {
    type: 'button', class: epClasses(ctx, ep, `aport r-${p.role} ${shape}`), 'data-ep': ep,
    title: `${app.name} · ${name} · ${ROLE_LABEL[p.role]} · ${p.speeds.join('/')}G${hint}`,
    'aria-label': `${app.name} ${name}`,
    onclick: () => ctx.clickEndpoint(ep),
  });
}

/** Columna de dos puertos (arriba / abajo) con su número, igual que en el panel del MHO. */
function pairCol(ctx: Ctx, app: Appliance, top: AppliancePortDef | undefined, bottom: AppliancePortDef | undefined, shape: string, label = (p: AppliancePortDef) => p.label) {
  const slot = (p: AppliancePortDef | undefined) => (p
    ? h('div', { class: 'slot' }, h('span', { class: 'pnum' }, label(p)), appPort(ctx, app, p, shape))
    : h('div', { class: 'slot' }));
  return h('div', { class: 'col' }, slot(top), slot(bottom));
}

/** Puertos agrupados en columnas: impares arriba, pares abajo. */
function pairs(ctx: Ctx, app: Appliance, ports: AppliancePortDef[], shape: string, label?: (p: AppliancePortDef) => string) {
  const cols: HTMLElement[] = [];
  for (let i = 0; i < ports.length; i += 2) cols.push(pairCol(ctx, app, ports[i], ports[i + 1], shape, label));
  return h('div', { class: 'cols' }, cols);
}

const vents = () => h('div', { class: 'vents', 'aria-hidden': 'true' });

/** Puertos frontales que no intervienen en Maestro: solo para reconocer el equipo. */
function decoIo() {
  const d = (cls: string, label: string) => h('span', { class: 'deco-port' }, h('i', { class: cls }), h('span', {}, label));
  return h('div', { class: 'fw-io', 'aria-hidden': 'true', title: 'Consola, USB y Lights-Out Management: no intervienen en el cableado de Maestro' },
    d('rj', 'CON'), h('span', { class: 'deco-port' }, h('i', { class: 'usb' }), h('i', { class: 'usb' }), h('span', {}, 'USB')), d('rj', 'LOM'), d('usbc', 'CON-C'),
  );
}

export function renderApplianceUnit(ctx: Ctx, app: Appliance) {
  const model = APPLIANCE_MODELS[app.model];
  const card = model.ports.filter((p) => p.role === 'card');
  const rj45 = model.ports.filter((p) => p.role === 'rj45');
  const sfp = model.ports.filter((p) => p.role === 'onboard-sfp');
  const sync = model.ports.find((p) => p.role === 'sync');
  const mgmt = model.ports.find((p) => p.role === 'mgmt');
  const sgOptions = [null, 1, 2, 3, 4];
  const cardLabel = (p: AppliancePortDef) => String(cardPortNumber(p.id) ?? p.label);
  return h('article', { class: `appliance sg-${app.sg ?? 'none'}`, 'aria-label': `${app.name}, Quantum Force ${app.model}` },
    // Tapa ciega de la izquierda: identificación y controles del simulador
    h('div', { class: 'fw-blank' },
      h('div', { class: 'sg-strip' }, app.sg ? `SG${app.sg}` : '—'),
      h('div', { class: 'unit-id' },
        h('strong', {}, app.name),
        h('span', { class: 'unit-sub' }, `Quantum Force ${app.model}`),
      ),
      h('div', { class: 'app-tools' },
      h('label', { class: 'sg-pick' },
        h('span', { class: 'visually-hidden' }, `Security Group de ${app.name}`),
        h('select', {
          id: `sg-${app.id}`,
          onchange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            const sg = v === '' ? null : Number(v);
            ctx.store.setApplianceSg(app.id, sg);
            if (!inView(ctx.ui.state.view, { ...app, sg })) ctx.ui.toast(`${app.name} pasó a ${sg ? `SG${sg}` : 'Sin SG'}.`);
          },
        }, sgOptions.map((v) => h('option', { value: v === null ? '' : String(v), selected: app.sg === v }, v === null ? 'Sin SG' : `SG${v}`))),
      ),
      h('button', {
        type: 'button', class: 'app-x', title: `Quitar ${app.name} y sus cables`, 'aria-label': `Quitar ${app.name}`,
        onclick: () => {
          ctx.store.removeAppliance(app.id);
          ctx.ui.set({ selected: null, pending: null });
          ctx.ui.toast(`${app.name} quitado, con sus cables.`);
        },
      }, '×'),
      ),
    ),
    // Slot de expansión con la tarjeta 4x 10/25G SFP28: lo único que va al Orchestrator
    h('div', { class: 'fw-slot', title: 'Slot de expansión con la tarjeta 4x 10/25G SFP28. Sus puertos son los que se cablean a los downlinks del MHO: impares al MHO1, pares al MHO2 (GSG p.132-133).' },
      h('span', { class: 'screw l', 'aria-hidden': 'true' }),
      h('span', { class: 'screw r', 'aria-hidden': 'true' }),
      h('div', { class: 'fw-slot-body' },
        pairs(ctx, app, card, 'cage', cardLabel),
        h('div', { class: 'fw-dir', 'aria-hidden': 'true' },
          h('span', { class: 'to-1' }, '◀ MHO1'),
          h('span', { class: 'to-2' }, 'MHO2 ▶'),
        ),
      ),
      h('span', { class: 'fw-cap' }, `${model.cardLabel} · hacia Maestro`),
    ),
    // Puertos onboard: Maestro no los usa
    h('div', { class: 'fw-group fw-onboard', title: 'Puertos propios del appliance. En Maestro no se cablean: el tráfico entra por los Uplinks del Orchestrator.' },
      pairs(ctx, app, rj45, 'rj'),
      h('span', { class: 'fw-cap' }, 'On-board RJ45 · no usados'),
    ),
    sfp.length
      ? h('div', { class: 'fw-group fw-onboard', title: 'SFP+ 1/10G onboard. El uso como downlink no está documentado.' },
        pairs(ctx, app, sfp, 'cage small'),
        h('span', { class: 'fw-cap' }, 'SFP+ 1/10G'),
      )
      : null,
    h('div', { class: 'fw-group fw-onboard', title: 'SYNC y MGMT propios del appliance. En Maestro no se usan.' },
      h('div', { class: 'cols' }, pairCol(ctx, app, sync, mgmt, 'rj dashed')),
      h('span', { class: 'fw-cap' }, ' '),
    ),
    decoIo(),
    vents(),
    h('div', { class: 'fw-brand', 'aria-hidden': 'true' },
      h('span', { class: 'leds' }, h('i'), h('i')),
      h('span', { class: 'fw-model' }, h('b', {}, 'Quantum Force'), app.model),
    ),
  );
}

export function renderSwitchUnit(ctx: Ctx, sw: SwitchDev) {
  const ports = Array.from({ length: sw.ports }, (_, i) => {
    const ep = swEndpoint(sw.id, i + 1);
    return h('button', {
      type: 'button', class: epClasses(ctx, ep, `sport sw-${sw.role}`), 'data-ep': ep,
      title: `${sw.name} · puerto ${i + 1} · ${sw.speeds.join('/')}G`,
      'aria-label': `${sw.name} puerto ${i + 1}`,
      onclick: () => ctx.clickEndpoint(ep),
    }, String(i + 1));
  });
  return h('article', { class: `switch sw-${sw.role}`, 'aria-label': sw.name },
    h('div', { class: 'unit-id' },
      h('strong', {}, sw.role === 'mgmt' ? 'Switch management' : 'Switch cliente'),
      h('span', { class: 'unit-sub' }, sw.role === 'mgmt' ? 'Hacia SMS / MDS' : 'Producción · redes del cliente'),
    ),
    h('div', { class: 'sw-ports' }, ports),
    vents(),
    h('span', { class: 'leds', 'aria-hidden': 'true' }, h('i'), h('i')),
  );
}
