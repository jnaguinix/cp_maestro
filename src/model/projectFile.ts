// Archivo de proyecto .maestro.json: exportar e importar una topología completa.
//
// Formato:
//   {
//     "format": "maestro-port-lab", "fileVersion": 1, "exportedAt": "...",
//     "project":  { name, client, author, notes },
//     "topology": { version: 2, ports, appliances, switches, sgs, cables }
//   }
// Al importar se valida todo y se descarta lo que no encaja (con un aviso por cada cosa),
// para que un archivo editado a mano o de otra versión nunca rompa el rack.
import { APPLIANCE_MODELS, CABLES, DEFAULT_SWITCHES } from '../data/appliances';
import { MHO140_PORTS, defaultPortConfig, isSplitMode, portKey } from '../data/mho140';
import { parseEndpoint } from './endpoints';
import type { Appliance, Cable, OrchId, PortMode, PortType, ProjectInfo, SecurityGroup, SimState } from './types';

export const FILE_FORMAT = 'maestro-port-lab';
export const FILE_VERSION = 1;
export const FILE_EXTENSION = '.maestro.json';

export interface ProjectFile {
  format: typeof FILE_FORMAT;
  fileVersion: number;
  exportedAt: string;
  project: ProjectInfo;
  topology: Omit<SimState, 'project'>;
}

export interface ImportResult {
  state: SimState;
  /** Lo que se corrigió o descartó al importar */
  warnings: string[];
}

export const emptyProject = (): ProjectInfo => ({ name: '', client: '', author: '', notes: '' });

export function exportProject(state: SimState, now = new Date()): string {
  const { project, ...topology } = state;
  const file: ProjectFile = {
    format: FILE_FORMAT,
    fileVersion: FILE_VERSION,
    exportedAt: now.toISOString(),
    project: { ...emptyProject(), ...project },
    topology,
  };
  return JSON.stringify(file, null, 2);
}

/** Nombre de archivo a partir del proyecto: "cliente-proyecto-2026-11-05" */
export function fileBaseName(state: SimState, now = new Date()): string {
  const p = state.project;
  const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const parts = [p?.client, p?.name].map((s) => slug(s ?? '')).filter(Boolean);
  const date = now.toISOString().slice(0, 10);
  return [...(parts.length ? parts : ['maestro-topologia']), date].join('-');
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');

const PORT_TYPES: PortType[] = ['management', 'uplink', 'downlink', 'ssm_sync', 'site_sync'];
const PORT_MODES: PortMode[] = ['1G', '10G', '25G', '40G', '100G', '4x10G', '4x25G'];

/** Lee y valida un archivo de proyecto. Lanza un Error con un mensaje claro si no se puede usar. */
export function importProject(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  if (!isObj(raw)) throw new Error('El archivo no tiene el formato de un proyecto de Maestro Port Lab.');

  // Se acepta el archivo de proyecto o, por comodidad, el estado "a pelo" (version 2)
  let topo: unknown;
  let projectRaw: unknown;
  if (raw.format === FILE_FORMAT) {
    if (typeof raw.fileVersion !== 'number' || raw.fileVersion > FILE_VERSION) {
      throw new Error(`El archivo es de una versión más nueva (${String(raw.fileVersion)}) que esta app (${FILE_VERSION}).`);
    }
    topo = raw.topology;
    projectRaw = raw.project;
  } else if (raw.version === 2 && Array.isArray(raw.cables)) {
    topo = raw;
    projectRaw = raw.project;
  } else {
    throw new Error('El archivo no tiene el formato de un proyecto de Maestro Port Lab.');
  }
  if (!isObj(topo)) throw new Error('El archivo no contiene una topología.');

  const warnings: string[] = [];
  const warn = (s: string) => { if (warnings.length < 50) warnings.push(s); };

  // ---- Puertos: se parte de los valores por defecto y se aplica lo válido del archivo ----
  const ports: SimState['ports'] = {};
  const rawPorts = isObj(topo.ports) ? topo.ports : {};
  for (const o of [1, 2] as OrchId[]) {
    for (const d of MHO140_PORTS) {
      const key = portKey(o, d.front);
      const cfg = defaultPortConfig(d.front);
      const r = rawPorts[key];
      if (isObj(r)) {
        if (PORT_TYPES.includes(r.type as PortType) && d.allowedTypes.includes(r.type as PortType)) cfg.type = r.type as PortType;
        else if (r.type !== undefined && r.type !== cfg.type) warn(`Puerto ${key}: tipo "${String(r.type)}" no admitido, se deja ${cfg.type}.`);
        if (PORT_MODES.includes(r.mode as PortMode) && d.allowedModes.includes(r.mode as PortMode)) cfg.mode = r.mode as PortMode;
        else if (r.mode !== undefined && r.mode !== cfg.mode) warn(`Puerto ${key}: modo "${String(r.mode)}" no admitido, se deja ${cfg.mode}.`);
      }
      ports[key] = cfg;
    }
  }

  // ---- Appliances ----
  const appliances: Appliance[] = [];
  const seenIds = new Set<string>();
  for (const a of Array.isArray(topo.appliances) ? topo.appliances : []) {
    if (!isObj(a) || typeof a.id !== 'string' || !/^[\w-]{1,40}$/.test(a.id)) { warn('Se descartó un appliance sin id válido.'); continue; }
    if (seenIds.has(a.id)) { warn(`Appliance ${a.id} repetido: se descartó el duplicado.`); continue; }
    if (typeof a.model !== 'string' || !APPLIANCE_MODELS[a.model]) { warn(`Appliance ${a.id}: modelo "${String(a.model)}" desconocido, se descartó.`); continue; }
    const sg = typeof a.sg === 'number' && Number.isInteger(a.sg) && a.sg >= 1 && a.sg <= 4 ? a.sg : null;
    if (a.sg !== null && a.sg !== undefined && sg === null) warn(`Appliance ${a.id}: SG "${String(a.sg)}" no válido, queda sin SG.`);
    seenIds.add(a.id);
    appliances.push({
      id: a.id, model: a.model, sg,
      name: str(a.name, 40) || `${a.model}-${a.id}`,
      serial: str(a.serial, 40) || `SN${a.model}${a.id}`,
    });
  }

  // ---- Switches: el simulador tiene siempre los mismos dos ----
  const switches = DEFAULT_SWITCHES.map((s) => ({ ...s }));

  // ---- Security Groups 1-4 ----
  const rawSgs = Array.isArray(topo.sgs) ? topo.sgs : [];
  const portIdOk = (p: unknown): p is string => {
    if (typeof p !== 'string' || !/^[12]\/\d{1,2}\/[1-4]$/.test(p)) return false;
    const [o, f, s] = p.split('/').map(Number);
    if (f < 1 || f > 56) return false;
    return s === 1 || isSplitMode(ports[portKey(o as OrchId, f)].mode);
  };
  const sgs: SecurityGroup[] = [1, 2, 3, 4].map((id) => {
    const r = rawSgs.find((x) => isObj(x) && x.id === id);
    const list = (v: unknown, what: string) => {
      const arr = Array.isArray(v) ? v : [];
      const ok = [...new Set(arr.filter(portIdOk))];
      if (ok.length !== arr.length) warn(`SG${id}: se descartaron puertos de ${what} que no existen.`);
      return ok;
    };
    return {
      id,
      mgmtPorts: isObj(r) ? list(r.mgmtPorts, 'management').filter((p) => Number(p.split('/')[1]) <= 4) : [],
      uplinkPorts: isObj(r) ? list(r.uplinkPorts, 'uplink') : [],
    };
  });

  // ---- Cables: extremos que existen, sin repetir puertos, tipo de cable conocido ----
  const cables: Cable[] = [];
  const usedEp = new Set<string>();
  const appPortOk = (appId: string, portId: string) => {
    const app = appliances.find((x) => x.id === appId);
    return !!app && APPLIANCE_MODELS[app.model].ports.some((p) => p.id === portId);
  };
  const epOk = (ep: unknown): ep is string => {
    if (typeof ep !== 'string') return false;
    try {
      const p = parseEndpoint(ep);
      if (p.kind === 'mho') return portIdOk(`${p.orch}/${p.front}/${p.sub}`);
      if (p.kind === 'app') return appPortOk(p.appId, p.portId);
      const sw = switches.find((s) => s.id === p.swId);
      return !!sw && Number.isInteger(p.n) && p.n >= 1 && p.n <= sw.ports;
    } catch {
      return false;
    }
  };
  let n = 0;
  for (const c of Array.isArray(topo.cables) ? topo.cables : []) {
    n++;
    if (!isObj(c) || !epOk(c.a) || !epOk(c.b) || c.a === c.b) { warn(`Cable ${n}: un extremo no existe, se descartó.`); continue; }
    if (typeof c.spec !== 'string' || !CABLES.some((k) => k.id === c.spec)) { warn(`Cable ${n}: tipo de cable "${String(c.spec)}" desconocido, se descartó.`); continue; }
    const kinds = [parseEndpoint(c.a).kind, parseEndpoint(c.b).kind];
    if (!kinds.includes('mho')) { warn(`Cable ${n}: ningún extremo llega al Orchestrator, se descartó.`); continue; }
    if (usedEp.has(c.a) || usedEp.has(c.b)) { warn(`Cable ${n}: el puerto ya tenía otro cable, se descartó.`); continue; }
    usedEp.add(c.a);
    usedEp.add(c.b);
    const id = typeof c.id === 'string' && /^[\w-]{1,40}$/.test(c.id) && !cables.some((k) => k.id === c.id) ? c.id : `imp${n}`;
    cables.push({ id, a: c.a, b: c.b, spec: c.spec });
  }

  const project = isObj(projectRaw)
    ? { name: str(projectRaw.name, 120), client: str(projectRaw.client, 120), author: str(projectRaw.author, 120), notes: str(projectRaw.notes, 4000) }
    : emptyProject();

  return { state: { version: 2, project, ports, appliances, switches, sgs, cables }, warnings };
}
