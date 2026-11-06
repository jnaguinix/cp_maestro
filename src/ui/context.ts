import type { Store } from '../model/store';
import type { EndpointId, Issue, SimState } from '../model/types';
import type { Ui } from './uiState';

export interface Ctx {
  store: Store;
  ui: Ui;
  sim: SimState;
  issues: Issue[];
  /** severidad más alta por extremo y por cable, para pintar estados */
  epSeverity: Map<EndpointId, Issue['severity']>;
  cableSeverity: Map<string, Issue['severity']>;
  /** Extremos del cable seleccionado: se dibujan con brillo neón */
  glow: Set<EndpointId>;
  /** Acción común: clic en un extremo (cablear o inspeccionar) */
  clickEndpoint: (ep: EndpointId) => void;
}
