// Estado de la aplicación con suscriptores. Las acciones devuelven un mensaje si se rechazan.
import { cableSpec } from '../data/appliances';
import { isSplitMode, portDef, portKey } from '../data/mho140';
import { parseEndpoint } from './endpoints';
import { emptyProject } from './projectFile';
import { buildScenario, type ScenarioId } from './scenarios';
import type { Appliance, EndpointId, OrchId, PortMode, PortType, ProjectInfo, SimState } from './types';

const STORAGE_KEY = 'maestro-port-sim:v2';

type Listener = (s: SimState) => void;

export class Store {
  private state: SimState;
  private listeners = new Set<Listener>();

  constructor(initial?: SimState) {
    this.state = initial ?? Store.load() ?? buildScenario('ok');
  }

  get(): SimState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private commit(next: SimState) {
    this.state = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* almacenamiento no disponible: la app sigue funcionando en memoria */
    }
    this.listeners.forEach((fn) => fn(next));
  }

  static load(): SimState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SimState;
      if (parsed.version !== 2) return null;
      // Estados guardados antes de que existieran los uplinks por SG
      parsed.sgs = parsed.sgs.map((sg) => ({ ...sg, uplinkPorts: sg.uplinkPorts ?? [] }));
      return parsed;
    } catch {
      return null;
    }
  }

  cableAt(ep: EndpointId) {
    return this.state.cables.find((c) => c.a === ep || c.b === ep);
  }

  /** Conecta dos extremos. Solo rechaza lo físicamente imposible; el resto lo juzga el validador. */
  connect(a: EndpointId, b: EndpointId, spec: string): string | null {
    if (a === b) return 'No puedes conectar un puerto consigo mismo.';
    if (this.cableAt(a) || this.cableAt(b)) return 'Ese puerto ya tiene un cable. Desconéctalo primero.';
    const pa = parseEndpoint(a);
    const pb = parseEndpoint(b);
    if (pa.kind === pb.kind && pa.kind !== 'mho') {
      return 'Este simulador solo modela cables que llegan al Orchestrator.';
    }
    if (pa.kind !== 'mho' && pb.kind !== 'mho') return 'Uno de los extremos debe ser un puerto del Orchestrator.';
    const id = `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    cableSpec(spec); // valida el id
    this.commit({ ...this.state, cables: [...this.state.cables, { id, a, b, spec }] });
    return null;
  }

  disconnect(cableId: string) {
    this.commit({ ...this.state, cables: this.state.cables.filter((c) => c.id !== cableId) });
  }

  setPortType(o: OrchId, front: number, type: PortType): string | null {
    const def = portDef(front);
    if (!def.allowedTypes.includes(type)) return `El puerto ${front} no admite el tipo ${type}.`;
    const key = portKey(o, front);
    this.commit({ ...this.state, ports: { ...this.state.ports, [key]: { ...this.state.ports[key], type } } });
    return null;
  }

  setPortMode(o: OrchId, front: number, mode: PortMode): string | null {
    const def = portDef(front);
    if (!def.allowedModes.includes(mode)) return `El puerto ${front} no admite ${mode}.`;
    const key = portKey(o, front);
    const wasSplit = isSplitMode(this.state.ports[key].mode);
    let next: SimState = { ...this.state, ports: { ...this.state.ports, [key]: { ...this.state.ports[key], mode } } };
    // Al salir del breakout desaparecen los sub-puertos 2-4: se quitan sus cables y las
    // asignaciones de Uplink a esos sub-puertos, que si no quedarían ocultos en el rack.
    if (wasSplit && !isSplitMode(mode)) {
      const isGone = (id: string) => {
        const [po, pf, ps] = id.replace(/^mho:/, '').split('/').map(Number);
        return po === o && pf === front && ps > 1;
      };
      next = {
        ...next,
        cables: next.cables.filter((c) => !(c.a.startsWith('mho:') && isGone(c.a)) && !(c.b.startsWith('mho:') && isGone(c.b))),
        sgs: next.sgs.map((sg) => ({
          ...sg,
          uplinkPorts: sg.uplinkPorts.filter((p) => !isGone(p)),
          mgmtPorts: sg.mgmtPorts.filter((p) => !isGone(p)),
        })),
      };
    }
    this.commit(next);
    return null;
  }

  setApplianceSg(appId: string, sg: number | null) {
    this.commit({
      ...this.state,
      appliances: this.state.appliances.map((a) => (a.id === appId ? { ...a, sg } : a)),
    });
  }

  /** Agrega un appliance nuevo del modelo dado y devuelve el creado. */
  addAppliance(model: string, sg: number | null): Appliance {
    const { appliances } = this.state;
    const usedNames = new Set(appliances.map((a) => a.name));
    let letter = 'A';
    for (let code = 65; code < 91; code++) {
      letter = String.fromCharCode(code);
      if (!usedNames.has(`${model}-${letter}`)) break;
    }
    const seq = appliances.reduce((m, a) => Math.max(m, Number(a.id.replace(/\D/g, '')) || 0), 0) + 1;
    const app: Appliance = { id: `a${seq}`, name: `${model}-${letter}`, model, serial: `SN${model}${letter}0${seq}`, sg };
    this.commit({ ...this.state, appliances: [...appliances, app] });
    return app;
  }

  /** Quita un appliance junto con todos los cables que llegaban a él. */
  removeAppliance(appId: string) {
    const prefix = `app:${appId}:`;
    this.commit({
      ...this.state,
      appliances: this.state.appliances.filter((a) => a.id !== appId),
      cables: this.state.cables.filter((c) => !c.a.startsWith(prefix) && !c.b.startsWith(prefix)),
    });
  }

  /** Asigna o quita un puerto Uplink del MHO a un Security Group. */
  toggleSgUplink(sgId: number, portId: string) {
    this.commit({
      ...this.state,
      sgs: this.state.sgs.map((sg) => {
        if (sg.id !== sgId) return sg;
        const has = sg.uplinkPorts.includes(portId);
        return { ...sg, uplinkPorts: has ? sg.uplinkPorts.filter((p) => p !== portId) : [...sg.uplinkPorts, portId] };
      }),
    });
  }

  toggleSgMgmt(sgId: number, portId: string) {
    this.commit({
      ...this.state,
      sgs: this.state.sgs.map((sg) => {
        if (sg.id !== sgId) return sg;
        const has = sg.mgmtPorts.includes(portId);
        return { ...sg, mgmtPorts: has ? sg.mgmtPorts.filter((p) => p !== portId) : [...sg.mgmtPorts, portId] };
      }),
    });
  }

  loadScenario(id: ScenarioId) {
    // los datos del proyecto (nombre, cliente…) se conservan al cambiar de escenario
    this.commit({ ...buildScenario(id), project: this.state.project });
  }

  /** Reemplaza toda la topología (al abrir un proyecto). El estado debe venir ya validado. */
  replaceState(next: SimState) {
    this.commit(next);
  }

  setProject(patch: Partial<ProjectInfo>) {
    this.commit({ ...this.state, project: { ...emptyProject(), ...this.state.project, ...patch } });
  }
}
