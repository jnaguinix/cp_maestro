// Cables del rack: trazos ortogonales con esquinas redondeadas.
//
// Cada unidad del rack (switch, MHO, appliance) tiene debajo un canal. Un cable sale por el
// borde inferior de su equipo, en la columna de su puerto, y corre por un carril propio del
// canal. Si los dos equipos son vecinos, el cable va directo por el canal que los separa.
// Si no, sube o baja por un organizador lateral: los cables del MHO1 por la izquierda y los
// del MHO2 por la derecha, así un appliance bien cableado muestra un cable a cada lado.
// La capa SVG queda por debajo de los equipos, que son opacos: solo se ven los tramos que
// recorren canales y organizadores.
import { cableSpec } from '../data/appliances';
import { portKey } from '../data/mho140';
import { parseEndpoint } from '../model/endpoints';
import type { Cable } from '../model/types';
import type { Ctx } from './context';
import { svg } from './dom';

const LANE = 6;       // separación entre carriles
const PAD = 7;        // aire entre el borde de un equipo y el primer carril
const CHAN_MIN = 12;  // alto de un canal sin cables
const MGR_MIN = 18;   // ancho de un organizador sin cables

/** Tamaños de la última pasada. El rack los usa al dibujarse para no parpadear. */
export const rackSizes: { left: number; right: number; chans: number[] } = { left: MGR_MIN, right: MGR_MIN, chans: [] };

type Pt = [number, number];
type Side = 'l' | 'r';

function roundedPath(points: Pt[], r = 6): string {
  const p = points.filter((q, i) => i === 0 || q[0] !== points[i - 1][0] || q[1] !== points[i - 1][1]);
  if (p.length < 2) return '';
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [x0, y0] = p[i - 1];
    const [x1, y1] = p[i];
    const [x2, y2] = p[i + 1];
    const l1 = Math.hypot(x1 - x0, y1 - y0);
    const l2 = Math.hypot(x2 - x1, y2 - y1);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    d += ` L${x1 + ((x0 - x1) / l1) * rr},${y1 + ((y0 - y1) / l1) * rr}`;
    d += ` Q${x1},${y1} ${x1 + ((x2 - x1) / l2) * rr},${y1 + ((y2 - y1) / l2) * rr}`;
  }
  const last = p[p.length - 1];
  return `${d} L${last[0]},${last[1]}`;
}

/** Reparte intervalos en carriles: cada uno toma el primer carril donde no choca con otro. */
function packLanes<T extends { lo: number; hi: number }>(items: T[], gap: number): { lane: Map<T, number>; count: number } {
  const lanes: { lo: number; hi: number }[][] = [];
  const lane = new Map<T, number>();
  for (const it of items) {
    let l = lanes.findIndex((occ) => occ.every((o) => it.hi + gap < o.lo || it.lo - gap > o.hi));
    if (l < 0) { l = lanes.length; lanes.push([]); }
    lanes[l].push(it);
    lane.set(it, l);
  }
  return { lane, count: lanes.length };
}

interface End { el: HTMLElement; u: number; x: number; y: number }
interface Route {
  c: Cable;
  a: End;
  b: End;
  side: Side | null;   // null = equipos vecinos, va directo por el canal entre ambos
  mType: string;
  appSg: number | null | undefined;
}
/** Tramo horizontal dentro de un canal */
interface ChanSeg { r: Route; end: 'a' | 'b' | 'direct'; lo: number; hi: number; order: number }
/** Tramo vertical dentro de un organizador (en índices de unidad) */
interface MgrSeg { r: Route; lo: number; hi: number }

export function drawCables(ctx: Ctx, stage: HTMLElement, layer: SVGSVGElement) {
  while (layer.firstChild) layer.removeChild(layer.firstChild);
  const found = stage.querySelector<HTMLElement>('.rack');
  if (!found) return;
  const rack: HTMLElement = found;
  const u = ctx.ui.state;

  const box = (el: Element) => {
    const sr = stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const left = r.left - sr.left + stage.scrollLeft;
    const top = r.top - sr.top + stage.scrollTop;
    return { left, top, right: left + r.width, bottom: top + r.height, cx: left + r.width / 2, cy: top + r.height / 2 };
  };
  const find = (ep: string) => stage.querySelector<HTMLElement>(`[data-ep="${CSS.escape(ep)}"]`);
  const unitOf = (el: HTMLElement) => Number(el.closest<HTMLElement>('.u')?.dataset.u ?? -1);
  const chans = [...rack.querySelectorAll<HTMLElement>('.chan')];

  // 1) Cables con ambos extremos a la vista
  const routes: Route[] = [];
  for (const c of ctx.sim.cables) {
    const ea = find(c.a);
    const eb = find(c.b);
    if (!ea || !eb) continue;
    const pa = parseEndpoint(c.a);
    const pb = parseEndpoint(c.b);
    const mho = pa.kind === 'mho' ? pa : pb.kind === 'mho' ? pb : null;
    const other = mho === pa ? pb : pa;
    const end = (el: HTMLElement): End => ({ el, u: unitOf(el), x: 0, y: 0 });
    const a = end(ea);
    const b = end(eb);
    if (a.u < 0 || b.u < 0) continue;
    const adjacent = Math.abs(a.u - b.u) <= 1;
    // MHO↔MHO (sync) entre MHO1 y MHO2: son vecinos y van directo
    const side: Side | null = adjacent ? null : mho && mho.kind === 'mho' && mho.orch === 2 ? 'r' : 'l';
    routes.push({
      c, a, b, side,
      mType: mho && mho.kind === 'mho' ? ctx.sim.ports[portKey(mho.orch, mho.front)].type : 'uplink',
      appSg: other.kind === 'app' ? (ctx.sim.appliances.find((x) => x.id === other.appId)?.sg ?? null) : undefined,
    });
  }

  // 2) Planificar con las posiciones actuales; si cambian los tamaños, se repite una vez
  let plan = makePlan();
  if (applySizes(plan)) plan = makePlan();

  function makePlan() {
    for (const r of routes) {
      for (const e of [r.a, r.b]) { const b = box(e.el); e.x = b.cx; e.y = b.cy; }
    }
    // separar extremos que caen en la misma columna del mismo canal
    const cols = new Map<string, End[]>();
    for (const r of routes) for (const e of [r.a, r.b]) {
      const k = `${e.u}:${Math.round(e.x)}`;
      (cols.get(k) ?? cols.set(k, []).get(k)!).push(e);
    }
    for (const list of cols.values()) list.forEach((e, i) => { e.x += (i - (list.length - 1) / 2) * 5; });

    const units = [...rack.querySelectorAll<HTMLElement>('.u')];
    const inner = units.length ? box(units[0]) : box(rack);
    const edge = { l: inner.left, r: inner.right };

    // tramos en canales
    const chanSegs = new Map<number, ChanSeg[]>();
    const push = (ch: number, s: ChanSeg) => (chanSegs.get(ch) ?? chanSegs.set(ch, []).get(ch)!).push(s);
    for (const r of routes) {
      if (r.side === null) {
        const ch = Math.min(r.a.u, r.b.u);
        push(ch, { r, end: 'direct', lo: Math.min(r.a.x, r.b.x), hi: Math.max(r.a.x, r.b.x), order: 2 });
      } else {
        for (const k of ['a', 'b'] as const) {
          const e = r[k];
          const lo = r.side === 'l' ? edge.l : e.x;
          const hi = r.side === 'l' ? e.x : edge.r;
          push(e.u, { r, end: k, lo, hi, order: r.side === 'l' ? 0 : 1 });
        }
      }
    }
    const chanLane = new Map<ChanSeg, number>();
    const chanCount: number[] = chans.map(() => 0);
    for (const [ch, segs] of chanSegs) {
      // hacia la izquierda: el puerto más a la izquierda va en el carril más alto (no se cruzan);
      // hacia la derecha, al revés.
      segs.sort((s, t) => s.order - t.order || (s.order === 0 ? s.hi - t.hi : s.order === 1 ? t.lo - s.lo : s.lo - t.lo));
      const { lane, count } = packLanes(segs, 4);
      lane.forEach((l, s) => chanLane.set(s, l));
      chanCount[ch] = count;
    }

    // tramos en organizadores: los más cortos más cerca del rack
    const mgr: Record<Side, MgrSeg[]> = { l: [], r: [] };
    for (const r of routes) if (r.side) mgr[r.side].push({ r, lo: Math.min(r.a.u, r.b.u), hi: Math.max(r.a.u, r.b.u) });
    const mgrLane = new Map<Route, number>();
    const mgrCount: Record<Side, number> = { l: 0, r: 0 };
    for (const s of ['l', 'r'] as Side[]) {
      const segs = mgr[s].sort((p, q) => (p.hi - p.lo) - (q.hi - q.lo) || p.lo - q.lo);
      const { lane, count } = packLanes(segs, 0);
      lane.forEach((l, seg) => mgrLane.set(seg.r, l));
      mgrCount[s] = count;
    }
    return { chanSegs, chanLane, chanCount, mgrLane, mgrCount, edge };
  }

  function applySizes(p: ReturnType<typeof makePlan>): boolean {
    const chanH = p.chanCount.map((n) => (n ? Math.max(CHAN_MIN, 2 * PAD + (n - 1) * LANE) : CHAN_MIN));
    const left = p.mgrCount.l ? 2 * PAD + p.mgrCount.l * LANE : MGR_MIN;
    const right = p.mgrCount.r ? 2 * PAD + p.mgrCount.r * LANE : MGR_MIN;
    const changed = left !== rackSizes.left || right !== rackSizes.right || chanH.some((hh, i) => hh !== rackSizes.chans[i]);
    rackSizes.left = left;
    rackSizes.right = right;
    rackSizes.chans = chanH;
    rack.style.setProperty('--ml', `${left}px`);
    rack.style.setProperty('--mr', `${right}px`);
    chans.forEach((el, i) => { el.style.height = `${chanH[i]}px`; });
    return changed;
  }

  // 3) Trazar
  const chanBox = chans.map((el) => box(el));
  const laneY = (ch: number, l: number) => chanBox[ch].top + PAD + l * LANE;
  const mgrX = (s: Side, l: number) => (s === 'l' ? plan.edge.l - PAD - l * LANE : plan.edge.r + PAD + l * LANE);
  const segOf = (r: Route, end: ChanSeg['end']) => {
    const ch = end === 'direct' ? Math.min(r.a.u, r.b.u) : r[end].u;
    const seg = plan.chanSegs.get(ch)?.find((s) => s.r === r && s.end === end);
    return { ch, l: seg ? plan.chanLane.get(seg) ?? 0 : 0 };
  };

  layer.setAttribute('width', String(stage.scrollWidth));
  layer.setAttribute('height', String(stage.scrollHeight));

  const focusIds = new Set<string>();
  if (u.selected?.kind === 'cable') focusIds.add(u.selected.id);
  if (u.selected?.kind === 'endpoint') {
    const sel = u.selected.id;
    for (const c of ctx.sim.cables) if (c.a === sel || c.b === sel) focusIds.add(c.id);
  }
  layer.classList.toggle('has-focus', focusIds.size > 0);

  let selectedG: SVGGElement | null = null;
  for (const r of routes) {
    let pts: Pt[];
    if (r.side === null) {
      const { ch, l } = segOf(r, 'direct');
      const y = laneY(ch, l);
      pts = [[r.a.x, r.a.y], [r.a.x, y], [r.b.x, y], [r.b.x, r.b.y]];
    } else {
      const sa = segOf(r, 'a');
      const sb = segOf(r, 'b');
      const ya = laneY(sa.ch, sa.l);
      const yb = laneY(sb.ch, sb.l);
      const x = mgrX(r.side, plan.mgrLane.get(r) ?? 0);
      pts = [[r.a.x, r.a.y], [r.a.x, ya], [x, ya], [x, yb], [r.b.x, yb], [r.b.x, r.b.y]];
    }
    const d = roundedPath(pts);
    if (!d) continue;
    const c = r.c;
    const sev = ctx.cableSeverity.get(c.id);
    const selected = u.selected?.kind === 'cable' && u.selected.id === c.id;
    const g = svg('g', {
      class: [
        'cable', `t-${r.mType}`, `k-${cableSpec(c.spec).kind}`,
        typeof r.appSg === 'number' ? `sg-${r.appSg}` : '', r.appSg === null ? 'sg-none' : '',
        sev ? `sev-${sev}` : '', selected ? 'selected' : '',
        focusIds.has(c.id) ? 'focus neon' : '', u.highlightCables.has(c.id) ? 'hl' : '',
      ].filter(Boolean).join(' '),
    });
    const title = svg('title');
    title.textContent = `${cableSpec(c.spec).label}: ${c.a.replace(/^\w+:/, '')} ↔ ${c.b.replace(/^\w+:/, '')}`;
    g.append(title, svg('path', { d, class: 'hit' }), svg('path', { d, class: 'line' }));
    // Un clic selecciona el cable; otro clic sobre el mismo lo deselecciona.
    // Si ya brilla (seleccionado directamente o por uno de sus puertos), el clic lo apaga.
    g.addEventListener('click', () => ctx.ui.set(selected || focusIds.has(c.id)
      ? { selected: null, pending: null }
      : { selected: { kind: 'cable', id: c.id }, tab: 'inspector', pending: null }));
    if (focusIds.has(c.id)) selectedG = g;
    else layer.appendChild(g);
  }
  // El seleccionado se dibuja al final para quedar por encima de los demás
  if (selectedG) layer.appendChild(selectedG);

  if (u.pending) {
    const el = find(u.pending);
    if (el) {
      const b = box(el);
      layer.appendChild(svg('circle', { cx: b.cx, cy: b.cy, r: 14, class: 'pending-ring' }));
    }
  }
}
