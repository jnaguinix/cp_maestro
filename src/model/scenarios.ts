// Escenarios precargados. Son ejemplos, no la configuración real de ningún cliente.
import { DEFAULT_SWITCHES } from '../data/appliances';
import { MHO140_PORTS, defaultPortConfig, mhoEndpoint, portKey } from '../data/mho140';
import { appEndpoint, swEndpoint } from './endpoints';
import type { Appliance, Cable, OrchId, SimState } from './types';

export type ScenarioId = 'ok' | 'broken' | 'empty';

export const SCENARIOS: { id: ScenarioId; label: string; hint: string }[] = [
  { id: 'ok', label: 'Ejemplo bien cableado', hint: '4 SGs, 1 downlink por MHO en cada appliance, management compartido' },
  { id: 'broken', label: 'Ejemplo con errores', hint: 'Encuentra y corrige los fallos que marca el validador' },
  { id: 'empty', label: 'Sin cables', hint: 'Solo el hardware: cablea tú desde cero' },
];

function baseAppliances(): Appliance[] {
  const models = ['9100', '9100', '9200', '9200', '9400', '9400', '9800', '9800'];
  return models.map((m, i) => {
    const letter = i % 2 === 0 ? 'A' : 'B';
    return {
      id: `a${i + 1}`, name: `${m}-${letter}`, model: m,
      serial: `SN${m}${letter}0${i + 1}`, sg: Math.floor(i / 2) + 1,
    };
  });
}

function basePorts() {
  const ports: SimState['ports'] = {};
  for (const o of [1, 2] as OrchId[]) {
    for (const d of MHO140_PORTS) ports[portKey(o, d.front)] = defaultPortConfig(d.front);
  }
  return ports;
}

let seq = 0;
const cable = (a: string, b: string, spec: string): Cable => ({ id: `k${++seq}`, a, b, spec });

export function buildScenario(id: ScenarioId): SimState {
  seq = 0;
  const state: SimState = {
    version: 2,
    ports: basePorts(),
    appliances: baseAppliances(),
    switches: DEFAULT_SWITCHES.map((s) => ({ ...s })),
    sgs: [1, 2, 3, 4].map((n) => ({ id: n, mgmtPorts: [] })),
    cables: [],
  };
  if (id === 'empty') return state;

  const setMode = (o: OrchId, f: number, mode: '10G' | '25G') => {
    state.ports[portKey(o, f)] = { ...state.ports[portKey(o, f)], mode };
  };

  // Sync interno 48 <-> 48 y management compartido en el puerto 1 de cada MHO
  if (id === 'ok') state.cables.push(cable(mhoEndpoint(1, 48), mhoEndpoint(2, 48), 'dac10'));
  state.cables.push(cable(swEndpoint('mgmtsw', 1), mhoEndpoint(1, 1), 'fib10'));
  state.cables.push(cable(swEndpoint('mgmtsw', 2), mhoEndpoint(2, 1), 'fib10'));
  for (const sg of state.sgs) sg.mgmtPorts = ['1/1/1', '2/1/1'];

  // Downlinks: appliance i -> puerto 27+i en ambos MHOs, a 25G con el DAC del bundle
  state.appliances.forEach((app, i) => {
    const port = 27 + i;
    setMode(1, port, '25G');
    setMode(2, port, '25G');
    state.cables.push(cable(appEndpoint(app.id, 'c1'), mhoEndpoint(1, port), 'dac25'));
    state.cables.push(cable(appEndpoint(app.id, 'c2'), mhoEndpoint(2, port), 'dac25'));
  });

  // Uplinks hacia el switch del cliente (se usan en la fase de bonds)
  state.cables.push(cable(swEndpoint('datasw', 1), mhoEndpoint(1, 13), 'dac10'));
  state.cables.push(cable(swEndpoint('datasw', 2), mhoEndpoint(2, 13), 'dac10'));

  if (id === 'broken') {
    // 1) 9800-A: el puerto 33 del MHO1 quedó a 10G con un DAC de 25G
    setMode(1, 33, '10G');
    // 2) 9800-B: un segundo downlink solo hacia el MHO1 (asimetría)
    state.cables.push(cable(appEndpoint('a8', 'c3'), mhoEndpoint(1, 40), 'dac25'));
    setMode(1, 40, '25G');
    // 3) 9200-A: además conectado desde un RJ45 a un downlink
    state.cables.push(cable(appEndpoint('a3', 'r1'), mhoEndpoint(1, 41), 'rj45'));
    // 4) SG2 sin puerto de management asignado
    state.sgs[1].mgmtPorts = [];
    // 5) SG3 con management solo en el MHO1
    state.sgs[2].mgmtPorts = ['1/1/1'];
    // 6) 9100-B conectado a un puerto Uplink en lugar de un Downlink (en el MHO2)
    state.cables = state.cables.filter((c) => c.a !== appEndpoint('a2', 'c2'));
    state.cables.push(cable(appEndpoint('a2', 'c2'), mhoEndpoint(2, 10), 'dac10'));
    // 7) 9400-B movido al SG1, donde hay 9100 (modelos mezclados)
    state.appliances[5].sg = 1;
    // 8) 9400-A con los puertos de la tarjeta cruzados: el 1 (impar) al MHO2 y el 2 (par) al MHO1
    state.cables = state.cables.filter((c) => !c.a.startsWith(`${appEndpoint('a5', '')}`));
    state.cables.push(cable(appEndpoint('a5', 'c1'), mhoEndpoint(2, 31), 'dac25'));
    state.cables.push(cable(appEndpoint('a5', 'c2'), mhoEndpoint(1, 31), 'dac25'));
    // (además falta el cable de sync interno 48 <-> 48)
  }
  return state;
}
