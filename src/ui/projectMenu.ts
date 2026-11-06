// Menú "Proyecto": datos del proyecto, guardar/abrir .maestro.json, foto PNG y plan de cableado CSV.
import { cablePlanCsv } from '../model/cablePlan';
import { SCENARIOS, type ScenarioId } from '../model/scenarios';
import { FILE_EXTENSION, exportProject, fileBaseName, importProject } from '../model/projectFile';
import type { ProjectInfo } from '../model/types';
import type { Ctx } from './context';
import { h, svg } from './dom';
import { rackToPng } from './exportImage';

function download(name: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function openFile(ctx: Ctx, file: File) {
  let text: string;
  try {
    text = await file.text();
  } catch {
    ctx.ui.toast('No se pudo leer el archivo.');
    return;
  }
  let result;
  try {
    result = importProject(text);
  } catch (e) {
    ctx.ui.toast((e as Error).message);
    return;
  }
  const name = result.state.project?.name || file.name;
  const { state, warnings } = result;
  askReplace(ctx, `el proyecto «${name}»`, () => {
    ctx.store.replaceState(state);
    ctx.ui.set({ selected: null, pending: null, highlight: new Set(), highlightCables: new Set(), view: 'all', importWarnings: warnings, projectOpen: warnings.length > 0, confirmOpen: null });
    ctx.ui.toast(warnings.length
      ? `Proyecto abierto con ${warnings.length} ajuste(s): revisa la lista en el menú Proyecto.`
      : `Proyecto «${name}» abierto.`);
  });
}

/** Si hay trabajo en el rack, pide confirmación dentro del menú antes de reemplazarlo.
 *  (No se usa window.confirm: algunos navegadores integrados bloquean esos diálogos y
 *  responden "Cancelar" sin mostrarlos.) */
function askReplace(ctx: Ctx, what: string, run: () => void) {
  const hasWork = ctx.sim.cables.length > 0 || ctx.sim.appliances.length > 0;
  if (!hasWork) { run(); return; }
  ctx.ui.set({ projectOpen: true, confirmOpen: { what, run } });
}

/** Carga un escenario de ejemplo (pide confirmación si hay trabajo en el rack). */
function openExample(ctx: Ctx, id: ScenarioId) {
  const s = SCENARIOS.find((x) => x.id === id)!;
  askReplace(ctx, `el ejemplo «${s.label}»`, () => {
    ctx.store.loadScenario(id);
    ctx.ui.set({
      selected: null, pending: null, highlight: new Set(), highlightCables: new Set(), view: 'all',
      tab: id === 'broken' ? 'issues' : 'inspector', drawer: id === 'broken', projectOpen: false, confirmOpen: null,
    });
    ctx.ui.toast(`Ejemplo «${s.label}» abierto.`);
  });
}

/** Icono de carpeta (sin depender de una fuente de iconos) */
function folderIcon() {
  const s = svg('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  s.appendChild(svg('path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }));
  return s;
}

function field(ctx: Ctx, key: keyof ProjectInfo, label: string, placeholder: string, multiline = false) {
  const value = ctx.sim.project?.[key] ?? '';
  const id = `proj-${key}`;
  // Se guarda mientras escribes; main.ts conserva el foco y el cursor al redibujar
  const oninput = (e: Event) => ctx.store.setProject({ [key]: (e.target as HTMLInputElement).value });
  return h('label', { class: 'proj-field', for: id },
    h('span', {}, label),
    multiline
      ? h('textarea', { id, rows: 3, placeholder, oninput, maxlength: 4000 }, value)
      : h('input', { id, type: 'text', value, placeholder, oninput, maxlength: 120 }));
}

export function renderProjectMenu(ctx: Ctx) {
  const open = ctx.ui.state.projectOpen;
  const fileInput = h('input', {
    type: 'file', accept: `${FILE_EXTENSION},.json,application/json`, class: 'visually-hidden', tabindex: -1, 'aria-hidden': 'true',
    onchange: (e: Event) => {
      const input = e.target as HTMLInputElement;
      const f = input.files?.[0];
      input.value = '';
      if (f) void openFile(ctx, f);
    },
  }) as HTMLInputElement;

  const base = () => fileBaseName(ctx.store.get());
  const warnings = ctx.ui.state.importWarnings;

  return h('div', { class: `project-menu ${open ? 'open' : ''}` },
    h('button', {
      type: 'button', class: 'proj-toggle', 'aria-expanded': String(open), 'aria-controls': 'proj-panel',
      title: 'Proyecto: datos, guardar, abrir, ejemplos y exportar',
      onclick: () => ctx.ui.set({ projectOpen: !open, cableOpen: false, addOpen: false, confirmOpen: null }),
    }, folderIcon(), h('span', { class: 'proj-name' }, ctx.sim.project?.name || 'Proyecto sin nombre'), ' ▾'),
    open ? h('div', { class: 'proj-panel', id: 'proj-panel', role: 'dialog', 'aria-label': 'Proyecto' },
      ctx.ui.state.confirmOpen
        ? h('div', { class: 'proj-confirm', role: 'alertdialog', 'aria-label': 'Confirmar' },
          h('p', {}, h('strong', {}, `¿Abrir ${ctx.ui.state.confirmOpen.what}?`), ' Se reemplaza la topología actual (cables y equipos). Si quieres conservarla, guárdala antes con «Guardar proyecto».'),
          h('div', { class: 'proj-confirm-actions' },
            h('button', { type: 'button', class: 'btn primary', onclick: () => ctx.ui.state.confirmOpen?.run() }, 'Abrir y reemplazar'),
            h('button', { type: 'button', class: 'btn', onclick: () => ctx.ui.set({ confirmOpen: null }) }, 'Cancelar')))
        : null,
      h('div', { class: 'proj-fields' },
        field(ctx, 'name', 'Proyecto', 'p. ej. Core DC principal'),
        field(ctx, 'client', 'Cliente', 'p. ej. ACME S.A.'),
        field(ctx, 'author', 'Autor', 'Quién diseña'),
        field(ctx, 'notes', 'Notas', 'Ubicación del rack, versión, supuestos…', true),
      ),
      h('div', { class: 'proj-actions' },
        h('span', { class: 'tool-label' }, 'Archivo del proyecto'),
        h('button', {
          type: 'button', class: 'btn',
          onclick: () => {
            download(`${base()}${FILE_EXTENSION}`, new Blob([exportProject(ctx.store.get())], { type: 'application/json' }));
            ctx.ui.toast('Proyecto guardado en tu carpeta de descargas.');
          },
        }, 'Guardar proyecto (.maestro.json)'),
        h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, 'Abrir proyecto…'),
        fileInput,
        h('span', { class: 'tool-label' }, 'Para el cliente y el instalador'),
        h('button', {
          type: 'button', class: 'btn',
          onclick: async (e: Event) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.disabled = true;
            btn.textContent = 'Generando foto…';
            try {
              const stage = document.getElementById('stage')!;
              const png = await rackToPng(ctx, stage);
              const v = ctx.ui.state.view;
              download(`${base()}${v === 'all' ? '' : v === 'none' ? '-sin-sg' : `-sg${v}`}.png`, png);
              ctx.ui.toast('Foto de la topología descargada.');
            } catch (err) {
              console.error(err);
              ctx.ui.toast('No se pudo generar la foto. Revisa la consola del navegador.');
            }
          },
        }, 'Exportar foto (PNG) de la vista actual'),
        h('button', {
          type: 'button', class: 'btn',
          onclick: () => {
            download(`${base()}-plan-cableado.csv`, new Blob([cablePlanCsv(ctx.store.get())], { type: 'text/csv;charset=utf-8' }));
            ctx.ui.toast('Plan de cableado descargado (CSV para Excel).');
          },
        }, 'Exportar plan de cableado (CSV)'),
        h('span', { class: 'tool-label' }, 'Abrir un ejemplo'),
        SCENARIOS.map((s) => h('button', { type: 'button', class: 'btn', title: s.hint, onclick: () => openExample(ctx, s.id) }, s.label)),
      ),
      warnings.length
        ? h('details', { class: 'explain proj-warnings', open: true },
          h('summary', {}, `Ajustes al abrir el último proyecto (${warnings.length})`),
          h('ul', {}, warnings.map((w) => h('li', {}, w))),
          h('button', { type: 'button', class: 'linkish', onclick: () => ctx.ui.set({ importWarnings: [] }) }, 'Ocultar'))
        : null,
    ) : null,
  );
}
