// Tipos del dominio. Todo el estado de la simulación se describe aquí.

export type OrchId = 1 | 2;

/** Tipos de puerto que acepta `set maestro port <ID> type ...` */
export type PortType = 'management' | 'uplink' | 'downlink' | 'ssm_sync' | 'site_sync';

/** Modos que acepta `set maestro port <ID> qsfp-mode ...` en el MHO-140 */
export type PortMode = '1G' | '10G' | '25G' | '40G' | '100G' | '4x10G' | '4x25G';

/** Velocidad física de un cable o de un puerto (Gbps) */
export type Speed = 1 | 10 | 25 | 40 | 100;

export interface MhoPortDef {
  front: number;            // número en el panel frontal (1..56)
  defaultType: PortType;
  allowedTypes: PortType[];
  allowedModes: PortMode[];
  defaultMode: PortMode;
  /** Puerto de abajo que se deshabilita cuando este (de arriba) se divide con breakout */
  pairsWith?: number;
  /** Puerto de arriba que, si se divide, deshabilita a este */
  disabledBy?: number;
  /** sufijo del nombre de interfaz Gaia cuando no hay breakout */
  gaiaSuffix: string;
  formFactor: 'SFP' | 'QSFP28';
}

export interface MhoPortConfig {
  type: PortType;
  mode: PortMode;
}

/** Identificador de un extremo de cable. Formatos:
 *  - Puerto del MHO:     "mho:1/27/1"   (Orchestrator / puerto / sub-puerto)
 *  - Puerto de appliance:"app:<applianceId>:<portId>"
 *  - Puerto de un switch:"sw:<switchId>:<n>"
 */
export type EndpointId = string;

export type CableKind = 'dac' | 'fiber' | 'breakout' | 'rj45';

export interface CableSpec {
  id: string;               // id del catálogo
  label: string;
  kind: CableKind;
  speed: Speed;
}

export interface Cable {
  id: string;
  a: EndpointId;
  b: EndpointId;
  spec: string;             // id de CableSpec
}

export type AppliancePortRole = 'card' | 'onboard-sfp' | 'rj45' | 'mgmt' | 'sync';

export interface AppliancePortDef {
  id: string;               // p.ej. "c1", "mgmt"
  label: string;
  role: AppliancePortRole;
  speeds: Speed[];
}

export interface ApplianceModel {
  model: string;            // "9800"
  cardLabel: string;
  ports: AppliancePortDef[];
  source: string;
}

export interface Appliance {
  id: string;               // "a1"
  name: string;             // "9100-A"
  model: string;
  serial: string;           // serial ficticio para los comandos
  sg: number | null;        // Security Group asignado (null = sin asignar)
}

export interface SwitchDev {
  id: string;
  name: string;
  role: 'mgmt' | 'data';
  ports: number;
  speeds: Speed[];
}

export interface SecurityGroup {
  id: number;
  /** puertos de management asignados, como Port ID "1/1/1" */
  mgmtPorts: string[];
  /** puertos Uplink asignados (red del cliente), como Port ID "1/13/1" */
  uplinkPorts: string[];
}

export interface SimState {
  version: 2;
  ports: Record<string, MhoPortConfig>;   // clave "o/front" p.ej. "1/27"
  appliances: Appliance[];
  switches: SwitchDev[];
  sgs: SecurityGroup[];
  cables: Cable[];
}

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  rule: string;             // id de la regla, p.ej. "DL-SYM"
  severity: Severity;
  title: string;
  detail: string;
  source: string;           // referencia documental o [INF]
  refs: EndpointId[];       // extremos implicados (para resaltarlos)
  cables?: string[];
}
