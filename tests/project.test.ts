import { describe, expect, it } from 'vitest';
import { buildCablePlan, cablePlanCsv } from '../src/model/cablePlan';
import { exportProject, fileBaseName, importProject } from '../src/model/projectFile';
import { buildScenario } from '../src/model/scenarios';
import { validate } from '../src/rules/validate';

describe('archivo de proyecto .maestro.json', () => {
  it('exportar e importar devuelve la misma topología', () => {
    const s = { ...buildScenario('broken'), project: { name: 'Core DC', client: 'ACME', author: 'JP', notes: 'Rack 3' } };
    const { state, warnings } = importProject(exportProject(s));
    expect(warnings).toEqual([]);
    expect(state).toEqual(s);
    expect(validate(state).map((i) => i.rule)).toEqual(validate(s).map((i) => i.rule));
  });

  it('acepta también el estado guardado "a pelo" (version 2)', () => {
    const s = buildScenario('ok');
    const { state } = importProject(JSON.stringify(s));
    expect(state.cables).toEqual(s.cables);
  });

  it('rechaza archivos que no son un proyecto', () => {
    expect(() => importProject('no es json')).toThrow(/JSON/);
    expect(() => importProject('{"hola":1}')).toThrow(/formato/);
    expect(() => importProject(JSON.stringify({ format: 'maestro-port-lab', fileVersion: 99, topology: {} }))).toThrow(/versión/);
  });

  it('descarta con aviso lo que no encaja en vez de romper', () => {
    const file = JSON.parse(exportProject(buildScenario('ok')));
    file.topology.cables.push({ id: 'x1', a: 'app:noexiste:c1', b: 'mho:1/40/1', spec: 'dac25' });  // appliance inexistente
    file.topology.cables.push({ id: 'x2', a: 'sw:datasw:9', b: 'mho:1/41/1', spec: 'cable-raro' }); // cable desconocido
    file.topology.cables.push({ id: 'x3', a: 'sw:datasw:10', b: 'mho:1/5/1', spec: 'dac10' });      // puerto ya ocupado
    file.topology.cables.push({ id: 'x4', a: 'sw:datasw:11', b: 'mho:1/20/3', spec: 'dac10' });     // sub-puerto sin breakout
    file.topology.ports['1/48'] = { type: 'uplink', mode: '10G' };                                 // tipo no admitido
    file.topology.appliances.push({ id: 'z9', name: 'X', model: '9999', serial: 's', sg: 1 });      // modelo desconocido
    const { state, warnings } = importProject(JSON.stringify(file));
    expect(state.cables).toHaveLength(buildScenario('ok').cables.length);
    expect(state.ports['1/48'].type).toBe('ssm_sync');
    expect(state.appliances).toHaveLength(8);
    expect(warnings.length).toBeGreaterThanOrEqual(6);
  });

  it('nombre de archivo a partir del cliente y el proyecto', () => {
    const s = { ...buildScenario('empty'), project: { name: 'Núcleo DC', client: 'Banco Ñandú', author: '', notes: '' } };
    expect(fileBaseName(s, new Date('2026-11-05T10:00:00Z'))).toBe('banco-nandu-nucleo-dc-2026-11-05');
    expect(fileBaseName(buildScenario('empty'), new Date('2026-11-05T10:00:00Z'))).toBe('maestro-topologia-2026-11-05');
  });
});

describe('plan de cableado', () => {
  it('una fila por cable, con Port ID y nombre Gaia del lado del MHO', () => {
    const s = buildScenario('ok');
    const rows = buildCablePlan(s);
    expect(rows).toHaveLength(s.cables.length);
    const dl = rows.find((r) => r.fromDevice.startsWith('9100-A') && r.toDevice === 'MHO1')!;
    expect(dl).toMatchObject({ sg: 'SG1', fromPort: 'Slot de expansión puerto 1', toPort: '27', portId: '1/27/1', gaia: 'dl27', cable: 'DAC 25G' });
    const up = rows.find((r) => r.portId === '2/5/1')!;
    expect(up).toMatchObject({ sg: 'SG1', gaia: 'eth2-05', mhoType: 'Uplink' });
    const sync = rows.find((r) => r.portId === '2/48/1')!;
    expect(sync).toMatchObject({ fromDevice: 'MHO1', toDevice: 'MHO2', gaia: 'SYNC-INT' });
  });

  it('CSV con ";" y BOM, y celdas con comillas escapadas', () => {
    const s = buildScenario('ok');
    s.appliances[0].name = '9100-A; "core"';
    const csv = cablePlanCsv(s);
    expect(csv.startsWith('﻿N°;SG;')).toBe(true);
    expect(csv).toContain('"9100-A; ""core"" (Quantum Force 9100)"');
    expect(csv.trim().split('\r\n')).toHaveLength(s.cables.length + 1);
  });
});
