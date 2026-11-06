// Foto de la topología: captura el rack (HTML + capa SVG de cables) y le añade una cabecera
// con los datos del proyecto y un pie con la leyenda y el resumen por Security Group.
import { toCanvas } from 'html-to-image';
import { gaiaName, portKey } from '../data/mho140';
import type { OrchId, SimState } from '../model/types';
import type { Ctx } from './context';

const PIXEL_RATIO = 2;

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Espera a que la interfaz se vuelva a dibujar (incluida la capa de cables). */
const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))));

function sgSummary(state: SimState): string[] {
  const nameOf = (pid: string) => {
    const [o, f, s] = pid.split('/').map(Number);
    return gaiaName(o as OrchId, f, s, state.ports[portKey(o as OrchId, f)]);
  };
  return state.sgs.map((sg) => {
    const members = state.appliances.filter((a) => a.sg === sg.id);
    if (!members.length && !sg.uplinkPorts.length && !sg.mgmtPorts.length) return '';
    const models = [...new Set(members.map((m) => m.model))];
    const parts = [
      `SG${sg.id}`,
      members.length ? `${members.length}× ${models.join('/')} (${members.map((m) => m.name).join(', ')})` : 'sin appliances',
      `Uplinks: ${sg.uplinkPorts.length ? sg.uplinkPorts.map(nameOf).join(', ') : '—'}`,
      `Mgmt: ${sg.mgmtPorts.length ? sg.mgmtPorts.map(nameOf).join(', ') : '—'}`,
    ];
    return parts.join('   ·   ');
  }).filter(Boolean);
}

export async function rackToPng(ctx: Ctx, stage: HTMLElement): Promise<Blob> {
  // Sin selección ni cable a medio conectar, para que la foto muestre la topología limpia
  ctx.ui.set({ selected: null, pending: null, highlight: new Set(), highlightCables: new Set() });
  await nextPaint();
  if (document.fonts?.ready) await document.fonts.ready;

  // html-to-image no siempre traslada los estilos CSS de los trazos SVG (sin "fill: none" los
  // cables salen como manchas negras): se fijan como atributos en cada trazo antes de capturar.
  // El siguiente redibujado de la capa de cables los vuelve a generar limpios.
  for (const el of stage.querySelectorAll<SVGElement>('.cable-layer path, .cable-layer circle')) {
    const cs = getComputedStyle(el);
    const props = ['fill', 'stroke', 'stroke-width', 'stroke-opacity', 'opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin'];
    for (const p of props) el.setAttribute(p, cs.getPropertyValue(p));
    el.style.filter = 'none';
  }

  const width = stage.scrollWidth;
  const height = stage.scrollHeight;
  const bg = cssVar('--surface', '#ffffff');
  const rack = await toCanvas(stage, {
    width, height, pixelRatio: PIXEL_RATIO, backgroundColor: bg, cacheBust: true,
    style: { maxHeight: 'none', height: `${height}px`, width: `${width}px`, overflow: 'visible', border: '0', borderRadius: '0' },
  });

  const state = ctx.store.get();
  const project = state.project;
  const fg = cssVar('--fg', '#17202b');
  const muted = cssVar('--muted', '#5b6878');
  const line = cssVar('--line', '#d3dae2');
  const body = cssVar('--font-body', 'system-ui, sans-serif');
  const display = cssVar('--font-display', 'system-ui, sans-serif');
  const view = ctx.ui.state.view;
  const viewLabel = view === 'all' ? 'Vista: todos los Security Groups' : view === 'none' ? 'Vista: appliances sin SG' : `Vista: SG${view}`;

  const pr = PIXEL_RATIO;
  const pad = 24 * pr;
  const summary = sgSummary(state);
  const counts = { error: 0, warning: 0 };
  ctx.issues.forEach((i) => { if (i.severity !== 'info') counts[i.severity]++; });
  const headerH = 86 * pr;
  const footerH = (64 + summary.length * 20 + (project?.notes ? 24 : 0)) * pr;

  const out = document.createElement('canvas');
  out.width = rack.width;
  out.height = headerH + rack.height + footerH;
  const g = out.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, out.width, out.height);
  g.textBaseline = 'alphabetic';

  // ---- Cabecera ----
  const title = project?.name || 'Topología Maestro';
  g.fillStyle = fg;
  g.font = `700 ${26 * pr}px ${display}`;
  g.fillText(title, pad, 38 * pr);
  g.font = `400 ${13 * pr}px ${body}`;
  g.fillStyle = muted;
  const now = new Date();
  const meta = [
    project?.client ? `Cliente: ${project.client}` : '',
    project?.author ? `Autor: ${project.author}` : '',
    now.toLocaleDateString('es', { year: 'numeric', month: 'long', day: 'numeric' }),
    viewLabel,
  ].filter(Boolean).join('   ·   ');
  g.fillText(meta, pad, 62 * pr);
  g.textAlign = 'right';
  g.fillText('2× MHO-140 · Quantum Force · R82 — Maestro Port Lab', out.width - pad, 38 * pr);
  g.fillStyle = counts.error ? cssVar('--err', '#cf3a3a') : counts.warning ? cssVar('--warn', '#b7791f') : cssVar('--ok', '#2f8a4d');
  g.font = `600 ${13 * pr}px ${body}`;
  g.fillText(counts.error ? `Validación: ${counts.error} errores, ${counts.warning} avisos` : counts.warning ? `Validación: ${counts.warning} avisos` : 'Validación: todo correcto', out.width - pad, 62 * pr);
  g.textAlign = 'left';
  g.fillStyle = line;
  g.fillRect(0, headerH - 2 * pr, out.width, 1 * pr);

  // ---- Rack ----
  g.drawImage(rack, 0, headerH);

  // ---- Pie: leyenda y resumen por SG ----
  let y = headerH + rack.height + 28 * pr;
  g.fillStyle = line;
  g.fillRect(0, headerH + rack.height + 1 * pr, out.width, 1 * pr);
  const legend: [string, string][] = [
    ['Management', cssVar('--t-mgmt', '#2aa794')], ['Uplink', cssVar('--t-up', '#3d84dc')],
    ['Downlink', cssVar('--t-dl', '#e3812f')], ['Sync', cssVar('--t-sync', '#8f63db')],
    ['SG1', '#5b8c5a'], ['SG2', '#b06a9c'], ['SG3', '#4f8fa6'], ['SG4', '#c09a3a'],
  ];
  let x = pad;
  g.font = `500 ${12 * pr}px ${body}`;
  for (const [label, color] of legend) {
    g.fillStyle = color;
    g.fillRect(x, y - 10 * pr, 12 * pr, 10 * pr);
    g.fillStyle = muted;
    g.fillText(label, x + 17 * pr, y);
    x += 17 * pr + g.measureText(label).width + 18 * pr;
  }
  g.fillText('Los cables de cada appliance usan el color de su Security Group. MHO1 por el organizador izquierdo, MHO2 por el derecho.', x + 8 * pr, y);
  y += 26 * pr;
  g.fillStyle = fg;
  g.font = `400 ${13 * pr}px ${body}`;
  for (const s of summary) {
    g.fillText(s, pad, y);
    y += 20 * pr;
  }
  if (project?.notes) {
    g.fillStyle = muted;
    g.fillText(`Notas: ${project.notes.replace(/\s+/g, ' ').slice(0, 220)}`, pad, y + 4 * pr);
  }

  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen.'))), 'image/png'));
}
