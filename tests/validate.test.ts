import { describe, expect, it } from 'vitest';
import { gaiaName, portDef } from '../src/data/mho140';
import { buildScenario } from '../src/model/scenarios';
import type { SimState } from '../src/model/types';
import { validate } from '../src/rules/validate';

const rules = (s: SimState) => validate(s).map((i) => i.rule);
const errors = (s: SimState) => validate(s).filter((i) => i.severity === 'error');

describe('catálogo MHO-140', () => {
  it('nombres Gaia de los QSFP28 (GSG p.231-233)', () => {
    const cfg = { type: 'uplink' as const, mode: '100G' as const };
    expect(gaiaName(1, 49, 1, cfg)).toBe('eth1-49');
    expect(gaiaName(1, 50, 1, cfg)).toBe('eth1-51');
    expect(gaiaName(2, 55, 1, cfg)).toBe('eth2-61');
  });
  it('breakout del 49 da eth1-49..eth1-52 (GSG p.124)', () => {
    const cfg = { type: 'uplink' as const, mode: '4x10G' as const };
    expect([1, 2, 3, 4].map((s) => gaiaName(1, 49, s, cfg))).toEqual(['eth1-49', 'eth1-50', 'eth1-51', 'eth1-52']);
  });
  it('downlinks se llaman dlNN y management ethX-MgmtY', () => {
    expect(gaiaName(1, 27, 1, { type: 'downlink', mode: '10G' })).toBe('dl27');
    expect(gaiaName(2, 1, 1, { type: 'management', mode: '10G' })).toBe('eth2-Mgmt1');
  });
  it('tipos por defecto', () => {
    expect(portDef(4).defaultType).toBe('management');
    expect(portDef(26).defaultType).toBe('uplink');
    expect(portDef(27).defaultType).toBe('downlink');
    expect(portDef(48).defaultType).toBe('ssm_sync');
    expect(portDef(56).defaultType).toBe('site_sync');
  });
});

describe('escenarios', () => {
  it('el escenario correcto no tiene errores ni avisos', () => {
    const s = buildScenario('ok');
    expect(validate(s).filter((i) => i.severity !== 'info')).toEqual([]);
    expect(rules(s)).toContain('MGMT-SHARED');
  });
  it('el escenario con errores detecta cada fallo plantado', () => {
    const r = rules(buildScenario('broken'));
    for (const rule of ['SPEED-MISMATCH', 'DL-SYM-APP', 'APP-PORT-SLOW', 'SG-NO-MGMT', 'SG-MGMT-ONE-MHO', 'APP-NOT-DOWNLINK', 'SG-MIXED', 'SYNC-MISSING', 'DL-SYM-SG', 'DL-PORT-PARITY', 'SG-NO-UPLINK', 'SG-UPLINK-ONE-MHO']) {
      expect(r, rule).toContain(rule);
    }
  });
  it('sin cables, cada appliance asignado reporta APP-NO-DL', () => {
    const s = buildScenario('empty');
    expect(errors(s).filter((i) => i.rule === 'APP-NO-DL')).toHaveLength(8);
  });
});

describe('uplinks por Security Group', () => {
  it('cada SG con miembros necesita al menos un Uplink', () => {
    const s = buildScenario('ok');
    s.sgs[0].uplinkPorts = [];
    expect(errors(s).map((i) => i.rule)).toContain('SG-NO-UPLINK');
  });
  it('un Uplink sin cable al switch del cliente da aviso', () => {
    const s = buildScenario('ok');
    s.sgs[0].uplinkPorts.push('1/20/1', '2/20/1');
    expect(validate(s).filter((i) => i.rule === 'SG-UPLINK-NOCABLE')).toHaveLength(2);
  });
  it('asignar un puerto que no es de tipo Uplink es un error', () => {
    const s = buildScenario('ok');
    s.sgs[0].uplinkPorts.push('1/27/1');
    expect(errors(s).map((i) => i.rule)).toContain('SG-UPLINK-TYPE');
  });
  it('un Uplink en dos SGs da aviso', () => {
    const s = buildScenario('ok');
    s.sgs[1].uplinkPorts.push('1/5/1');
    expect(rules(s)).toContain('UPLINK-SHARED');
  });
});

describe('reglas puntuales', () => {
  it('puertos de la tarjeta: impares al MHO1 y pares al MHO2 (GSG p.132-133)', () => {
    const s = buildScenario('ok');
    expect(rules(s)).not.toContain('DL-PORT-PARITY');
    // 9100-A: cruzar los cables (el 1 al MHO2 y el 2 al MHO1)
    s.cables = s.cables.map((c) =>
      c.a === 'app:a1:c1' ? { ...c, b: 'mho:2/27/1' } : c.a === 'app:a1:c2' ? { ...c, b: 'mho:1/27/1' } : c);
    const found = validate(s).filter((i) => i.rule === 'DL-PORT-PARITY');
    expect(found).toHaveLength(2);
    expect(found.every((i) => i.severity === 'warning')).toBe(true);
  });
  it('más de 2 downlinks a un MHO', () => {
    const s = buildScenario('ok');
    s.ports['1/45'].mode = '25G';
    s.ports['1/46'].mode = '25G';
    s.cables.push({ id: 'x1', a: 'app:a1:c3', b: 'mho:1/45/1', spec: 'dac25' });
    s.cables.push({ id: 'x2', a: 'app:a1:c4', b: 'mho:1/46/1', spec: 'dac25' });
    expect(rules(s)).toContain('DL-MAX');
  });
  it('cable en el puerto inferior cuando el superior está dividido', () => {
    const s = buildScenario('ok');
    s.ports['1/49'].mode = '4x10G';
    s.cables.push({ id: 'x', a: 'sw:datasw:9', b: 'mho:1/50/1', spec: 'dac100' });
    expect(rules(s)).toContain('PORT-DISABLED');
  });
  it('breakout correcto en sub-puerto no da errores de cable', () => {
    const s = buildScenario('ok');
    s.ports['1/49'].mode = '4x10G';
    s.cables.push({ id: 'x', a: 'sw:datasw:9', b: 'mho:1/49/3', spec: 'bo10' });
    expect(errors(s)).toEqual([]);
  });
  it('switch en un downlink', () => {
    const s = buildScenario('ok');
    s.ports['1/47'].mode = '25G';
    s.cables.push({ id: 'x', a: 'sw:datasw:9', b: 'mho:1/47/1', spec: 'dac25' });
    expect(rules(s)).toContain('SW-ON-DOWNLINK');
  });
  it('un uplink convertido en downlink sirve para un appliance', () => {
    const s = buildScenario('ok');
    s.cables = s.cables.filter((c) => c.a !== 'app:a1:c1');
    s.ports['1/20'] = { type: 'downlink', mode: '25G' };
    s.cables.push({ id: 'x', a: 'app:a1:c1', b: 'mho:1/20/1', spec: 'dac25' });
    const r = rules(s);
    expect(r).not.toContain('APP-NOT-DOWNLINK');
    expect(r).toContain('DL-SAME-PORT');
  });
});
