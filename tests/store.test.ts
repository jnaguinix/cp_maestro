import { describe, expect, it } from 'vitest';
import { buildScenario } from '../src/model/scenarios';
import { Store } from '../src/model/store';

describe('Store: agregar y quitar appliances', () => {
  it('agrega un appliance con nombre, id y serial únicos', () => {
    const store = new Store(buildScenario('ok'));
    const a = store.addAppliance('9400', 2);
    expect(a.name).toBe('9400-C'); // 9400-A y 9400-B ya existen
    expect(a.sg).toBe(2);
    const b = store.addAppliance('9400', null);
    expect(b.name).toBe('9400-D');
    const ids = store.get().appliances.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(b.sg).toBeNull();
  });

  it('al quitar un appliance también se borran sus cables', () => {
    const store = new Store(buildScenario('ok'));
    const before = store.get().cables.length;
    const target = store.get().appliances[0];
    const prefix = `app:${target.id}:`;
    const touching = store.get().cables.filter((c) => c.a.startsWith(prefix) || c.b.startsWith(prefix)).length;
    expect(touching).toBeGreaterThan(0);
    store.removeAppliance(target.id);
    expect(store.get().appliances.some((a) => a.id === target.id)).toBe(false);
    expect(store.get().cables.length).toBe(before - touching);
  });

  it('asigna y quita un Uplink de un SG', () => {
    const store = new Store(buildScenario('empty'));
    store.toggleSgUplink(1, '1/5/1');
    expect(store.get().sgs[0].uplinkPorts).toEqual(['1/5/1']);
    store.toggleSgUplink(1, '1/5/1');
    expect(store.get().sgs[0].uplinkPorts).toEqual([]);
  });
});
