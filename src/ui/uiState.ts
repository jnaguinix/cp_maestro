// Estado de la interfaz (selección, cable activo, pestaña). No se persiste.
import type { Appliance, EndpointId } from '../model/types';

export type Tab = 'inspector' | 'issues' | 'sgs' | 'commands';

/** Qué appliances se muestran en el rack: todos, los de un SG, o los que no tienen SG. */
export type View = 'all' | 'none' | 1 | 2 | 3 | 4;

export const inView = (view: View, app: Appliance) =>
  view === 'all' || (view === 'none' ? app.sg === null : app.sg === view);

/** SG al que se asigna un appliance nuevo creado desde la vista actual. */
export const viewSg = (view: View): number | null => (typeof view === 'number' ? view : null);

export interface UiState {
  view: View;
  sideCollapsed: boolean;             // panel lateral plegado para dar más ancho al rack
  activeCable: string;
  pending: EndpointId | null;          // primer extremo elegido al cablear
  selected: { kind: 'endpoint'; id: EndpointId } | { kind: 'cable'; id: string } | null;
  highlight: Set<EndpointId>;          // extremos resaltados desde un hallazgo
  highlightCables: Set<string>;
  tab: Tab;
  toast: string | null;
}

type Listener = () => void;

export class Ui {
  state: UiState = {
    view: 'all',
    sideCollapsed: false,
    activeCable: 'dac25',
    pending: null,
    selected: null,
    highlight: new Set(),
    highlightCables: new Set(),
    tab: 'inspector',
    toast: null,
  };
  private listeners = new Set<Listener>();
  private toastTimer: number | undefined;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
  }

  set(patch: Partial<UiState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  toast(msg: string) {
    window.clearTimeout(this.toastTimer);
    this.set({ toast: msg });
    this.toastTimer = window.setTimeout(() => this.set({ toast: null }), 4200);
  }
}
