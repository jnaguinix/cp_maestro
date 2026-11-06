// Plan de cableado: una fila por cable, pensado para imprimirlo y cablear el rack real.
// Se exporta como CSV con ";" (Excel en español usa la coma como separador decimal) y BOM UTF-8
// para que los acentos se vean bien al abrirlo.
import { APPLIANCE_MODELS, cableSpec, cardPortNumber } from '../data/appliances';
import { TYPE_LABEL, gaiaName, portIdStr, portKey } from '../data/mho140';
import { parseEndpoint } from './endpoints';
import type { SimState } from './types';

export interface CablePlanRow {
  n: number;
  sg: string;
  fromDevice: string;
  fromPort: string;
  toDevice: string;
  toPort: string;
  portId: string;
  gaia: string;
  mhoType: string;
  cable: string;
  speed: string;
}

export const CABLE_PLAN_HEADERS = [
  'N°', 'SG', 'Equipo origen', 'Puerto origen', 'Equipo destino', 'Puerto destino',
  'Port ID (MHO)', 'Interfaz Gaia', 'Tipo de puerto MHO', 'Cable', 'Velocidad',
];

function endLabel(state: SimState, ep: string): { device: string; port: string; sg: number | null; order: string } {
  const p = parseEndpoint(ep);
  if (p.kind === 'mho') {
    return { device: `MHO${p.orch}`, port: `${p.front}${p.sub > 1 || isSplit(state, p.orch, p.front) ? `/${p.sub}` : ''}`, sg: null, order: `1-${p.orch}` };
  }
  if (p.kind === 'app') {
    const app = state.appliances.find((a) => a.id === p.appId);
    const def = app ? APPLIANCE_MODELS[app.model].ports.find((x) => x.id === p.portId) : undefined;
    const n = cardPortNumber(p.portId);
    return {
      device: app ? `${app.name} (Quantum Force ${app.model})` : p.appId,
      port: n !== null ? `Slot de expansión puerto ${n}` : def?.label ?? p.portId,
      sg: app?.sg ?? null,
      order: `3-${app?.name ?? p.appId}`,
    };
  }
  const sw = state.switches.find((s) => s.id === p.swId);
  return { device: sw?.name ?? p.swId, port: String(p.n), sg: null, order: `0-${p.swId}` };
}

const isSplit = (state: SimState, o: 1 | 2, front: number) => {
  const m = state.ports[portKey(o, front)]?.mode;
  return m === '4x10G' || m === '4x25G';
};

export function buildCablePlan(state: SimState): CablePlanRow[] {
  const sgOfPort = (pid: string) => state.sgs.filter((sg) => sg.uplinkPorts.includes(pid) || sg.mgmtPorts.includes(pid)).map((sg) => `SG${sg.id}`);
  const rows = state.cables.map((c) => {
    const pa = parseEndpoint(c.a);
    const pb = parseEndpoint(c.b);
    // origen = el equipo que no es MHO (o el MHO1 en los cables entre Orchestrators); destino = el MHO
    const aIsMho = pa.kind === 'mho';
    const bIsMho = pb.kind === 'mho';
    let from = c.a;
    let to = c.b;
    if (aIsMho && !bIsMho) [from, to] = [c.b, c.a];
    else if (aIsMho && bIsMho && pa.kind === 'mho' && pb.kind === 'mho' && pa.orch > pb.orch) [from, to] = [c.b, c.a];
    const f = endLabel(state, from);
    const t = endLabel(state, to);
    const mho = parseEndpoint(to);
    const spec = cableSpec(c.spec);
    let portId = '';
    let gaia = '';
    let mhoType = '';
    let sgs: string[] = [];
    if (mho.kind === 'mho') {
      const cfg = state.ports[portKey(mho.orch, mho.front)];
      portId = portIdStr(mho.orch, mho.front, mho.sub);
      gaia = gaiaName(mho.orch, mho.front, mho.sub, cfg);
      mhoType = TYPE_LABEL[cfg.type];
      sgs = sgOfPort(portId);
    }
    const sg = f.sg !== null ? `SG${f.sg}` : sgs.join(', ');
    return { sort: `${f.order}|${f.port.padStart(30, ' ')}`, row: {
      n: 0, sg, fromDevice: f.device, fromPort: f.port, toDevice: t.device, toPort: t.port,
      portId, gaia, mhoType, cable: spec.label, speed: `${spec.speed}G`,
    } };
  });
  rows.sort((a, b) => a.sort.localeCompare(b.sort, 'es', { numeric: true }));
  return rows.map((r, i) => ({ ...r.row, n: i + 1 }));
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function cablePlanCsv(state: SimState): string {
  const rows = buildCablePlan(state);
  const lines = [
    CABLE_PLAN_HEADERS.map(csvCell).join(';'),
    ...rows.map((r) => [r.n, r.sg, r.fromDevice, r.fromPort, r.toDevice, r.toPort, r.portId, r.gaia, r.mhoType, r.cable, r.speed].map(csvCell).join(';')),
  ];
  return `﻿${lines.join('\r\n')}\r\n`;
}
