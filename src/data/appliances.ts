// Appliances Quantum Force en configuración Maestro / MHS (bundle con MHO-140).
// Fuente: datasheet Maestro Hyperscale Orchestrator (Rev. Nov 2026) y datasheets 9100/9200.
// Todos traen una tarjeta 4x 10/25G SFP28 y 2 DAC de 25G para conectar al Orchestrator.
// La tarjeta es la única vía documentada para los downlinks (GSG 2026: solo puertos de 10G
// o más y sin mezclar una tarjeta de 10G con una de 25/40/100G en los downlinks).
import type { ApplianceModel, AppliancePortDef, CableSpec, SwitchDev } from '../model/types';

const card = (): AppliancePortDef[] =>
  [1, 2, 3, 4].map((n) => ({ id: `c${n}`, label: `Slot ${n}`, role: 'card' as const, speeds: [10, 25] }));

/** Número de puerto dentro del slot de expansión (1-4) para un id "c1".."c4"; null si no es de la tarjeta. */
export const cardPortNumber = (portId: string): number | null => (/^c[1-4]$/.test(portId) ? Number(portId.slice(1)) : null);

/** MHO al que debe ir cada puerto de la tarjeta: impares al MHO1, pares al MHO2 (GSG p.132-133). */
export const expectedOrchForCardPort = (n: number): 1 | 2 => (n % 2 === 1 ? 1 : 2);

const common = (): AppliancePortDef[] => [
  { id: 'mgmt', label: 'MGMT', role: 'mgmt', speeds: [1] },
  { id: 'sync', label: 'SYNC', role: 'sync', speeds: [1] },
];

const rj45 = (n: number): AppliancePortDef[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, label: `${i + 1}`, role: 'rj45' as const, speeds: [1] }));

const sfp = (n: number): AppliancePortDef[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, label: `S${i + 1}`, role: 'onboard-sfp' as const, speeds: [1, 10] }));

export const APPLIANCE_MODELS: Record<string, ApplianceModel> = {
  '9100': {
    model: '9100', cardLabel: '4x 10/25G SFP28',
    ports: [...card(), ...common(), ...rj45(8)],
    source: 'Datasheet Quantum Force 9100 (Maestro/MHS: 8x RJ45, 4x 10/25G, 2x DAC 25G)',
  },
  '9200': {
    model: '9200', cardLabel: '4x 10/25G SFP28',
    ports: [...card(), ...common(), ...rj45(8)],
    source: 'Datasheet Quantum Force 9200 (Maestro/MHS: 8x RJ45, 4x 10/25G, 2x DAC 25G)',
  },
  '9400': {
    model: '9400', cardLabel: '4x 10/25G SFP28',
    ports: [...card(), ...common(), ...rj45(8), ...sfp(4)],
    source: 'Datasheet MHO (Maestro/MHS 9400: 8x RJ45, 4x 1/10G SFP+ onboard, 4x 10/25G, 2x DAC 25G)',
  },
  '9800': {
    model: '9800', cardLabel: '4x 10/25G SFP28',
    ports: [...card(), ...common(), ...rj45(4), ...sfp(4)],
    source: 'Datasheet MHO (Maestro/MHS 9800: 4x RJ45, 4x 1/10G SFP+ onboard, 4x 10/25G, 2x DAC 25G)',
  },
};

export const ROLE_LABEL: Record<string, string> = {
  card: 'Slot de expansión 4x 10/25G SFP28 (hacia Maestro)',
  'onboard-sfp': 'SFP+ 1/10G onboard',
  rj45: 'RJ45 1G onboard',
  mgmt: 'MGMT RJ45 del appliance',
  sync: 'SYNC RJ45 del appliance',
};

export const CABLES: CableSpec[] = [
  { id: 'dac25', label: 'DAC 25G', kind: 'dac', speed: 25 },
  { id: 'dac10', label: 'DAC 10G', kind: 'dac', speed: 10 },
  { id: 'fib10', label: 'Fibra 10G', kind: 'fiber', speed: 10 },
  { id: 'fib1', label: 'Fibra/SFP 1G', kind: 'fiber', speed: 1 },
  { id: 'dac40', label: 'DAC 40G', kind: 'dac', speed: 40 },
  { id: 'dac100', label: 'DAC 100G', kind: 'dac', speed: 100 },
  { id: 'bo10', label: 'Breakout 4x10G (un ramal)', kind: 'breakout', speed: 10 },
  { id: 'bo25', label: 'Breakout 4x25G (un ramal)', kind: 'breakout', speed: 25 },
  { id: 'rj45', label: 'Cobre RJ45 1G', kind: 'rj45', speed: 1 },
];

export const cableSpec = (id: string): CableSpec => {
  const c = CABLES.find((x) => x.id === id);
  if (!c) throw new Error(`Cable desconocido: ${id}`);
  return c;
};

export const DEFAULT_SWITCHES: SwitchDev[] = [
  { id: 'mgmtsw', name: 'Switch de management (hacia SMS)', role: 'mgmt', ports: 8, speeds: [1, 10] },
  { id: 'datasw', name: 'Switch del cliente (producción)', role: 'data', ports: 16, speeds: [10, 25, 40, 100] },
];
