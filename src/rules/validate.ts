// Motor de validación. Función pura: recibe el estado y devuelve la lista de hallazgos.
// Cada regla cita su fuente. Lo que no está documentado se marca [INF].
import { APPLIANCE_MODELS, cableSpec, cardPortNumber, expectedOrchForCardPort, switchPortLabel } from '../data/appliances';
import { gaiaName, isSplitMode, modeSpeed, portDef, portIdStr, portKey } from '../data/mho140';
import { parseEndpoint, type ParsedEndpoint } from '../model/endpoints';
import type { Appliance, Cable, Issue, OrchId, Severity, SimState } from '../model/types';

type MhoEnd = Extract<ParsedEndpoint, { kind: 'mho' }>;

const SEV_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function mhoLabel(state: SimState, e: MhoEnd): string {
  const cfg = state.ports[portKey(e.orch, e.front)];
  return `MHO${e.orch} puerto ${e.front} (${portIdStr(e.orch, e.front, e.sub)}, ${gaiaName(e.orch, e.front, e.sub, cfg)})`;
}

/** Un downlink "válido" según el Orchestrator: puerto de tarjeta -> puerto MHO tipo downlink habilitado */
export interface Downlink {
  cable: Cable;
  app: Appliance;
  portId: string;
  mho: MhoEnd;
  speed: number;
}

function isDisabled(state: SimState, e: MhoEnd): boolean {
  const d = portDef(e.front);
  if (!d.disabledBy) return false;
  return isSplitMode(state.ports[portKey(e.orch, d.disabledBy)].mode);
}

export function downlinksOf(state: SimState): Downlink[] {
  const out: Downlink[] = [];
  for (const c of state.cables) {
    const pa = parseEndpoint(c.a);
    const pb = parseEndpoint(c.b);
    const app = pa.kind === 'app' ? pa : pb.kind === 'app' ? pb : null;
    const mho = pa.kind === 'mho' ? pa : pb.kind === 'mho' ? pb : null;
    if (!app || !mho || app.kind !== 'app' || mho.kind !== 'mho') continue;
    const appliance = state.appliances.find((a) => a.id === app.appId);
    if (!appliance) continue;
    const role = APPLIANCE_MODELS[appliance.model].ports.find((p) => p.id === app.portId)?.role;
    const cfg = state.ports[portKey(mho.orch, mho.front)];
    if (role !== 'card' || cfg.type !== 'downlink' || isDisabled(state, mho)) continue;
    out.push({ cable: c, app: appliance, portId: app.portId, mho, speed: cableSpec(c.spec).speed });
  }
  return out;
}

export function validate(state: SimState): Issue[] {
  const issues: Issue[] = [];
  const add = (i: Issue) => issues.push(i);

  // ---------- Reglas por cable ----------
  for (const c of state.cables) {
    const spec = cableSpec(c.spec);
    const ends = [parseEndpoint(c.a), parseEndpoint(c.b)];
    const mhoEnds = ends.filter((e): e is MhoEnd => e.kind === 'mho');
    const other = ends.find((e) => e.kind !== 'mho');

    for (const m of mhoEnds) {
      const def = portDef(m.front);
      const cfg = state.ports[portKey(m.orch, m.front)];
      const label = mhoLabel(state, m);
      const ref = `mho:${portIdStr(m.orch, m.front, m.sub)}`;

      if (isDisabled(state, m)) {
        add({
          rule: 'PORT-DISABLED', severity: 'error',
          title: `Cable en un puerto deshabilitado: MHO${m.orch} puerto ${m.front}`,
          detail: `El puerto ${def.disabledBy} de arriba está en modo breakout (${state.ports[portKey(m.orch, def.disabledBy!)].mode}), así que el puerto ${m.front} de abajo queda deshabilitado.`,
          source: 'GSG p.124', refs: [ref], cables: [c.id],
        });
        continue;
      }
      const split = isSplitMode(cfg.mode);
      if (!split && m.sub > 1) {
        add({
          rule: 'PORT-SUB', severity: 'error',
          title: `El sub-puerto ${portIdStr(m.orch, m.front, m.sub)} ya no existe`,
          detail: `El puerto ${m.front} ya no está en modo breakout. Solo existe ${portIdStr(m.orch, m.front, 1)}.`,
          source: 'GSG p.124', refs: [ref], cables: [c.id],
        });
        continue;
      }
      if (split && spec.kind !== 'breakout') {
        add({
          rule: 'BREAKOUT-NEEDED', severity: 'error',
          title: `${label} está dividido y necesita un cable breakout`,
          detail: `En modo ${cfg.mode} el puerto QSFP28 se reparte en 4 sub-puertos; cada ramal del cable breakout va a uno de ellos.`,
          source: 'GSG p.118, p.124', refs: [ref], cables: [c.id],
        });
      } else if (!split && spec.kind === 'breakout') {
        add({
          rule: 'BREAKOUT-UNUSED', severity: 'error',
          title: `Cable breakout en un puerto sin dividir: ${label}`,
          detail: `Para usar un breakout configura antes el modo 4x10G o 4x25G (solo en los puertos 49, 51, 53 y 55).`,
          source: 'GSG p.48, p.124', refs: [ref], cables: [c.id],
        });
      }
      const portSpeed = modeSpeed(cfg.mode);
      if (portSpeed !== spec.speed) {
        add({
          rule: 'SPEED-MISMATCH', severity: 'error',
          title: `Velocidad distinta en ${label}`,
          detail: `El puerto está configurado a ${cfg.mode} y el cable es de ${spec.speed}G. No hay auto-negociación: el enlace no levanta. Corrige con: set maestro port ${portIdStr(m.orch, m.front, 1)} qsfp-mode ${spec.speed}G`,
          source: 'CB p.67; AG p.85', refs: [ref], cables: [c.id],
        });
      }
    }

    // Cable entre los dos Orchestrators
    if (mhoEnds.length === 2) {
      const [x, y] = mhoEnds;
      if (x.front === 48 && y.front === 48 && x.orch !== y.orch) continue; // correcto
      if (x.front === 56 && y.front === 56 && x.orch !== y.orch) {
        add({
          rule: 'SITE-SYNC-LOCAL', severity: 'warning',
          title: 'Puerto 56 usado entre MHOs del mismo site',
          detail: 'El 56 es el sync externo para Dual Site. Entre los dos MHOs del mismo site el sync va por el puerto 48.',
          source: 'GSG p.46, p.165', refs: [c.a, c.b], cables: [c.id],
        });
        continue;
      }
      add({
        rule: 'MHO-MHO', severity: 'error',
        title: 'Cable entre Orchestrators en puertos que no son de sync',
        detail: 'Los Orchestrators del mismo site solo se unen por el puerto 48 (Sync interno) de cada uno, con un cable directo.',
        source: 'GSG p.46, p.126', refs: [c.a, c.b], cables: [c.id],
      });
      continue;
    }

    const m = mhoEnds[0];
    if (!m || !other) continue;
    const cfg = state.ports[portKey(m.orch, m.front)];
    const label = mhoLabel(state, m);
    const ref = `mho:${portIdStr(m.orch, m.front, m.sub)}`;

    if (cfg.type === 'ssm_sync' || cfg.type === 'site_sync') {
      add({
        rule: 'SYNC-MISUSE', severity: 'error',
        title: `El puerto de sync ${m.front} está conectado a otro equipo`,
        detail: m.front === 48
          ? 'El puerto 48 (ssm_sync) solo se conecta al puerto 48 del otro Orchestrator, directo o por una red aislada dedicada. No admite cambiar su tipo.'
          : 'El puerto 56 (site_sync) solo se conecta al Orchestrator del otro site.',
        source: 'GSG p.46, p.126', refs: [ref, c.a === ref ? c.b : c.a], cables: [c.id],
      });
      continue;
    }

    if (other.kind === 'app') {
      const appliance = state.appliances.find((a) => a.id === other.appId)!;
      const pdef = APPLIANCE_MODELS[appliance.model].ports.find((p) => p.id === other.portId)!;
      const appRef = `app:${other.appId}:${other.portId}`;
      if (!pdef.speeds.includes(spec.speed)) {
        add({
          rule: 'APP-SPEED', severity: 'error',
          title: `${appliance.name} ${pdef.label}: no admite ${spec.speed}G`,
          detail: `Ese puerto del appliance trabaja a ${pdef.speeds.join('/')}G.`,
          source: APPLIANCE_MODELS[appliance.model].source, refs: [appRef], cables: [c.id],
        });
      }
      if (cfg.type !== 'downlink') {
        add({
          rule: 'APP-NOT-DOWNLINK', severity: 'error',
          title: `${appliance.name} conectado a un puerto ${cfg.type}: ${label}`,
          detail: 'Los appliances (SGMs) solo se conectan a puertos de tipo Downlink. En el MHO-140 son los 27-47 por defecto; otro puerto sirve solo si lo cambias con set maestro port <ID> type downlink.',
          source: 'GSG p.28, p.46; CB p.51', refs: [appRef, ref], cables: [c.id],
        });
      }
      if (pdef.role === 'rj45' || pdef.role === 'mgmt' || pdef.role === 'sync') {
        add({
          rule: 'APP-PORT-SLOW', severity: 'error',
          title: `${appliance.name}: el puerto ${pdef.label} no sirve para Maestro`,
          detail: pdef.role === 'rj45'
            ? 'Maestro solo admite puertos del appliance de 10G o más. Usa la tarjeta 4x 10/25G.'
            : `El ${pdef.label} RJ45 del appliance no se conecta al Orchestrator. En Maestro la gestión del SG entra por los puertos Management del MHO (1-4) y la sync entre SGMs viaja por los downlinks (VLAN 3800+SG#). [INF: el puerto queda sin uso]`,
          source: 'GSG p.28 (≥10G); CB p.50, p.54', refs: [appRef], cables: [c.id],
        });
      } else if (pdef.role === 'onboard-sfp') {
        add({
          rule: 'APP-ONBOARD', severity: 'warning',
          title: `${appliance.name}: downlink desde un SFP+ onboard`,
          detail: 'Los bundles Maestro usan la tarjeta 4x 10/25G para los downlinks y la guía prohíbe mezclar downlinks de tarjetas de distinta velocidad. El uso del SFP+ onboard como downlink no está documentado. [INF]',
          source: 'Datasheet MHO; GSG 2026', refs: [appRef], cables: [c.id],
        });
      }
    } else if (other.kind === 'sw') {
      const sw = state.switches.find((s) => s.id === other.swId)!;
      const swRef = `sw:${other.swId}:${other.n}`;
      if (!sw.speeds.includes(spec.speed)) {
        add({
          rule: 'SW-SPEED', severity: 'error',
          title: `${switchPortLabel(state.switches, other.swId, other.n)}: no admite ${spec.speed}G`,
          detail: `Este switch del simulador trabaja a ${sw.speeds.join('/')}G.`,
          source: 'Simulador', refs: [swRef], cables: [c.id],
        });
      }
      if (cfg.type === 'downlink') {
        add({
          rule: 'SW-ON-DOWNLINK', severity: 'error',
          title: `Un switch conectado a un Downlink: ${label}`,
          detail: 'Los Downlinks llevan las VLANs internas del Security Group y solo admiten appliances con cable directo, sin equipos intermedios.',
          source: 'GSG p.126; CB p.50', refs: [swRef, ref], cables: [c.id],
        });
      } else if (sw.role === 'data' && cfg.type === 'management') {
        add({
          rule: 'PROD-ON-MGMT', severity: 'warning',
          title: `Red de producción en un puerto Management: ${label}`,
          detail: 'El puerto Management del SG es para la conexión con el SMS/MDS (política, logs, SSH). No sustituye a un Uplink: no admite Hide NAT ni VPN y el paso de datos a management viene deshabilitado por defecto.',
          source: 'CB p.173; sk179005', refs: [swRef, ref], cables: [c.id],
        });
      } else if (sw.role === 'mgmt' && cfg.type === 'uplink') {
        add({
          rule: 'MGMT-ON-UPLINK', severity: 'info',
          title: `La red de management llega a un Uplink: ${label}`,
          detail: 'Es una opción válida cuando se necesita enrutar por esa interfaz, pero entonces ese Uplink se asigna al SG como interfaz de datos. Lo habitual es usar los puertos 1-4.',
          source: 'CheckMates (Maestro SG Management Interfaces) [INF]', refs: [swRef, ref], cables: [c.id],
        });
      }
    }
  }

  // ---------- Sync interno entre Orchestrators ----------
  const hasSync = state.cables.some((c) => {
    const ends = [c.a, c.b].sort();
    return ends[0] === 'mho:1/48/1' && ends[1] === 'mho:2/48/1';
  });
  if (!hasSync) {
    add({
      rule: 'SYNC-MISSING', severity: 'error',
      title: 'Falta el cable de sync interno entre los MHOs',
      detail: 'Con dos Orchestrators en el mismo site hay que unir los puertos 48 de ambos (directo o por una red aislada). Sin él, los cambios de configuración de los SGs no se sincronizan entre MHOs.',
      source: 'GSG p.46, p.126; CB p.55', refs: ['mho:1/48/1', 'mho:2/48/1'],
    });
  }

  // ---------- Reglas por appliance (downlinks) ----------
  const dls = downlinksOf(state);
  const countFor = (appId: string, o: OrchId) => dls.filter((d) => d.app.id === appId && d.mho.orch === o).length;

  for (const app of state.appliances) {
    const mine = dls.filter((d) => d.app.id === app.id);
    const refs = mine.map((d) => `mho:${portIdStr(d.mho.orch, d.mho.front, d.mho.sub)}`);
    const n1 = countFor(app.id, 1);
    const n2 = countFor(app.id, 2);

    if (app.sg !== null && mine.length === 0) {
      add({
        rule: 'APP-NO-DL', severity: 'error',
        title: `${app.name} (SG${app.sg}) no tiene ningún downlink válido`,
        detail: 'El Orchestrator no ve el appliance: no aparecerá en la lista de serials y no podrá recibir tráfico. Conecta un puerto de la tarjeta a un Downlink de cada MHO.',
        source: 'GSG p.28, p.131', refs: [`app:${app.id}:c1`],
      });
      continue;
    }
    if (mine.length === 0) continue;

    for (const o of [1, 2] as OrchId[]) {
      const n = o === 1 ? n1 : n2;
      if (n > 2) {
        add({
          rule: 'DL-MAX', severity: 'error',
          title: `${app.name}: ${n} downlinks hacia el MHO${o}`,
          detail: 'Como máximo se conectan 2 Downlinks de cada Orchestrator a cada appliance.',
          source: 'GSG p.131', refs,
        });
      }
    }
    if (n1 !== n2) {
      add({
        rule: 'DL-SYM-APP', severity: 'error',
        title: `${app.name}: ${n1} downlink(s) al MHO1 y ${n2} al MHO2`,
        detail: 'Cada appliance debe tener el mismo número de cables hacia cada Orchestrator. Si falta uno, se pierde la redundancia y la distribución del tráfico no es pareja.',
        source: 'GSG p.131-133', refs,
      });
    }
    for (const d of mine) {
      const n = cardPortNumber(d.portId);
      if (n === null) continue;
      const expected = expectedOrchForCardPort(n);
      if (d.mho.orch !== expected) {
        add({
          rule: 'DL-PORT-PARITY', severity: 'warning',
          title: `${app.name}: el puerto ${n} del slot va al MHO${d.mho.orch}`,
          detail: `Según el patrón de la guía, los puertos impares de la tarjeta (1 y 3) van al MHO1 y los pares (2 y 4) al MHO2. El puerto ${n} debería ir al MHO${expected}. El enlace funciona igual, pero rompe la simetría esperada y complica el troubleshooting.`,
          source: 'GSG p.132-133 [INF para la serie 9000]',
          refs: [`app:${app.id}:${d.portId}`, `mho:${portIdStr(d.mho.orch, d.mho.front, d.mho.sub)}`],
          cables: [d.cable.id],
        });
      }
    }
    const speeds = new Set(mine.map((d) => d.speed));
    if (speeds.size > 1) {
      add({
        rule: 'DL-SPEED-MIX', severity: 'warning',
        title: `${app.name}: downlinks a velocidades distintas (${[...speeds].join('G y ')}G)`,
        detail: 'Mantén todos los downlinks de los appliances a la misma velocidad. La guía no permite mezclar downlinks de tarjetas de 10G y de 25G o más.',
        source: 'GSG 2026 [INF para la mezcla dentro de la misma tarjeta]', refs,
      });
    }
    const p1 = mine.filter((d) => d.mho.orch === 1).map((d) => d.mho.front).sort().join(',');
    const p2 = mine.filter((d) => d.mho.orch === 2).map((d) => d.mho.front).sort().join(',');
    if (n1 === n2 && p1 !== p2) {
      add({
        rule: 'DL-SAME-PORT', severity: 'info',
        title: `${app.name}: puertos distintos en cada MHO (${p1 || '—'} / ${p2 || '—'})`,
        detail: 'Funciona, pero la buena práctica es usar el mismo número de puerto en los dos Orchestrators: facilita el monitoreo y el troubleshooting.',
        source: 'GSG p.126; CB p.67', refs,
      });
    }
    if (app.sg === null) {
      add({
        rule: 'APP-UNASSIGNED', severity: 'info',
        title: `${app.name} está cableado pero sin Security Group`,
        detail: `El Orchestrator lo detecta y aparece al pulsar TAB en: add maestro security-group id <ID> serial (serial ${app.serial}).`,
        source: 'AG p.73-74', refs,
      });
    }
  }

  // ---------- Reglas por Security Group ----------
  const mgmtUse = new Map<string, number[]>();
  const uplinkUse = new Map<string, number[]>();
  for (const sg of state.sgs) {
    const members = state.appliances.filter((a) => a.sg === sg.id);
    for (const p of sg.mgmtPorts) mgmtUse.set(p, [...(mgmtUse.get(p) ?? []), sg.id]);
    for (const p of sg.uplinkPorts) uplinkUse.set(p, [...(uplinkUse.get(p) ?? []), sg.id]);

    const models = new Set(members.map((m) => m.model));
    if (models.size > 1) {
      add({
        rule: 'SG-MIXED', severity: 'error',
        title: `SG${sg.id} mezcla modelos (${[...models].join(', ')})`,
        detail: 'Solo se asignan appliances del mismo modelo a un Security Group.',
        source: 'AG p.74 (assign only appliances of the same model)', refs: members.map((m) => `app:${m.id}:c1`),
      });
    }

    const withDl = members.filter((m) => dls.some((d) => d.app.id === m.id));
    if (withDl.length > 1) {
      const sig = (id: string) => `${countFor(id, 1)}+${countFor(id, 2)}`;
      const sigs = new Set(withDl.map((m) => sig(m.id)));
      if (sigs.size > 1) {
        add({
          rule: 'DL-SYM-SG', severity: 'error',
          title: `SG${sg.id}: los appliances no tienen el mismo número de downlinks`,
          detail: `${withDl.map((m) => `${m.name}: ${countFor(m.id, 1)} al MHO1 + ${countFor(m.id, 2)} al MHO2`).join(' · ')}. Sin la misma cantidad, los Orchestrators no pueden repartir el tráfico por igual entre los miembros.`,
          source: 'GSG p.131', refs: dls.filter((d) => d.app.sg === sg.id).map((d) => `mho:${portIdStr(d.mho.orch, d.mho.front, d.mho.sub)}`),
        });
      }
    }

    if (members.length === 0) {
      if (sg.mgmtPorts.length || sg.uplinkPorts.length) {
        add({
          rule: 'SG-EMPTY', severity: 'info',
          title: `SG${sg.id} no tiene appliances`,
          detail: 'El Security Group existe y tiene puertos asignados, pero sin miembros no procesa tráfico.',
          source: 'AG p.39-40', refs: [],
        });
      }
      continue;
    }

    if (sg.mgmtPorts.length === 0) {
      add({
        rule: 'SG-NO-MGMT', severity: 'error',
        title: `SG${sg.id} no tiene puerto de Management asignado`,
        detail: 'Cada Security Group necesita un puerto Management del Orchestrator para hablar con el SMS/MDS (SIC, política, logs) y para administrarlo por SSH o Gaia Portal. Asígnalo en el panel del SG.',
        source: 'CB p.30, p.54; AG p.40', refs: [],
      });
    } else {
      const orchs = new Set(sg.mgmtPorts.map((p) => p.split('/')[0]));
      if (orchs.size === 1) {
        add({
          rule: 'SG-MGMT-ONE-MHO', severity: 'warning',
          title: `SG${sg.id}: management solo en el MHO${[...orchs][0]}`,
          detail: 'Si cae ese Orchestrator, se pierde la gestión del SG. Asigna también el puerto equivalente del otro MHO y júntalos en un bond magg (por ejemplo eth1-Mgmt1 + eth2-Mgmt1).',
          source: 'GSG p.126; AG p.118-119; CB p.57', refs: sg.mgmtPorts.map((p) => `mho:${p}`),
        });
      }
      for (const p of sg.mgmtPorts) {
        const c = state.cables.find((k) => k.a === `mho:${p}` || k.b === `mho:${p}`);
        const otherEnd = c ? (c.a === `mho:${p}` ? c.b : c.a) : null;
        const toMgmtSw = otherEnd?.startsWith('sw:mgmtsw');
        if (!toMgmtSw) {
          add({
            rule: 'SG-MGMT-NOCABLE', severity: 'warning',
            title: `SG${sg.id}: el puerto Management ${p} no llega a la red de management`,
            detail: 'El puerto está asignado al SG pero no tiene un cable hacia la zona Management del switch del cliente, así que el SMS no alcanzará al SMO.',
            source: 'GSG p.128', refs: [`mho:${p}`],
          });
        }
      }
    }

    // Uplinks: la salida del SG hacia la red del cliente
    if (sg.uplinkPorts.length === 0) {
      add({
        rule: 'SG-NO-UPLINK', severity: 'error',
        title: `SG${sg.id} no tiene Uplinks asignados`,
        detail: 'Sin un puerto Uplink del Orchestrator asignado, el Security Group no tiene interfaces de datos hacia la red del cliente y no puede pasar tráfico de producción. Asigna al menos uno de cada MHO (desde el panel del SG o desde el detalle del puerto).',
        source: 'GSG p.126; AG (add maestro security-group … interface)', refs: [],
      });
    } else {
      const orchs = new Set(sg.uplinkPorts.map((p) => p.split('/')[0]));
      if (orchs.size === 1) {
        add({
          rule: 'SG-UPLINK-ONE-MHO', severity: 'warning',
          title: `SG${sg.id}: Uplinks solo en el MHO${[...orchs][0]}`,
          detail: 'Si cae ese Orchestrator, el SG se queda sin salida a la red del cliente. Asigna también el puerto equivalente del otro MHO (por ejemplo eth1-13 y eth2-13); dentro del SG puedes dejarlos sueltos, en bond o con VLANs.',
          source: 'GSG p.126 [INF para Uplinks]', refs: sg.uplinkPorts.map((p) => `mho:${p}`),
        });
      }
      for (const p of sg.uplinkPorts) {
        const [o, f] = p.split('/').map(Number);
        const cfg = state.ports[portKey(o as OrchId, f)];
        if (!cfg || cfg.type !== 'uplink') {
          add({
            rule: 'SG-UPLINK-TYPE', severity: 'error',
            title: `SG${sg.id}: el puerto ${p} asignado como Uplink es de tipo ${cfg?.type ?? 'desconocido'}`,
            detail: 'Solo los puertos de tipo Uplink se asignan a un SG como interfaces de datos. Cambia el tipo con set maestro port <ID> type uplink o asigna otro puerto.',
            source: 'GSG p.46; AG p.85', refs: [`mho:${p}`],
          });
          continue;
        }
        const c = state.cables.find((k) => k.a === `mho:${p}` || k.b === `mho:${p}`);
        const otherEnd = c ? (c.a === `mho:${p}` ? c.b : c.a) : null;
        if (!otherEnd?.startsWith('sw:datasw')) {
          add({
            rule: 'SG-UPLINK-NOCABLE', severity: 'warning',
            title: `SG${sg.id}: el Uplink ${p} no llega a la red del cliente`,
            detail: 'El puerto está asignado al SG pero no tiene un cable hacia la zona Producción del switch del cliente, así que esa interfaz no tendrá enlace.',
            source: 'GSG p.126', refs: [`mho:${p}`],
          });
        }
      }
    }
  }

  for (const [port, sgIds] of uplinkUse) {
    if (sgIds.length > 1) {
      add({
        rule: 'UPLINK-SHARED', severity: 'warning',
        title: `Uplink ${port} asignado a varios SGs (SG${sgIds.join(', SG')})`,
        detail: 'A diferencia del Management, lo normal es que cada Uplink pertenezca a un solo Security Group. Si de verdad lo compartes, separa el tráfico de cada SG con VLANs distintas en ese puerto. [INF: revisa la versión y la guía antes de hacerlo]',
        source: 'AG (asignación de interfaces a SGs) [INF]', refs: [`mho:${port}`],
      });
    }
  }

  for (const [port, sgIds] of mgmtUse) {
    if (sgIds.length > 1) {
      add({
        rule: 'MGMT-SHARED', severity: 'info',
        title: `Management compartido en ${port} (SG${sgIds.join(', SG')})`,
        detail: 'Es válido (Shared Management): el mismo puerto ethX-MgmtY sirve a varios SGs, con una IP y una MAC distintas en cada uno.',
        source: 'GSG p.128; CB p.173', refs: [`mho:${port}`],
      });
    }
  }

  return issues.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}

/** Resumen de uso de puertos para los contadores de la cabecera */
export function portUsage(state: SimState) {
  const used = new Set(state.cables.flatMap((c) => [c.a, c.b]));
  const res = { 1: { downlinkFree: 0, downlinkTotal: 0 }, 2: { downlinkFree: 0, downlinkTotal: 0 } } as Record<OrchId, { downlinkFree: number; downlinkTotal: number }>;
  for (const o of [1, 2] as OrchId[]) {
    for (let f = 1; f <= 56; f++) {
      const cfg = state.ports[portKey(o, f)];
      if (cfg.type !== 'downlink' || isDisabled(state, { kind: 'mho', orch: o, front: f, sub: 1 })) continue;
      res[o].downlinkTotal++;
      if (!used.has(`mho:${portIdStr(o, f, 1)}`)) res[o].downlinkFree++;
    }
  }
  return res;
}
