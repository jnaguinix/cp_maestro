// Menú "Proyecto": datos del proyecto, guardar/abrir .maestro.json, foto PNG y plan de cableado CSV.
import { cablePlanCsv } from '../model/cablePlan';
import { FILE_EXTENSION, exportProject, fileBaseName, importProject } from '../model/projectFile';
import type { ProjectInfo } from '../model/types';
import type { Ctx } from './context';
import { h } from './dom';
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
  const hasWork = ctx.sim.cables.length > 0 || ctx.sim.appliances.length > 0;
  if (hasWork && !window.confirm(`¿Abrir "${name}"?\n\nSe reemplaza la topología actual. Si quieres conservarla, guárdala antes con "Guardar proyecto".`)) return;
  ctx.store.replaceState(result.state);
  ctx.ui.set({ selected: null, pending: null, highlight: new Set(), highlightCables: new Set(), view: 'all', importWarnings: result.warnings, projectOpen: result.warnings.length > 0 });
  ctx.ui.toast(result.warnings.length
    ? `Proyecto abierto con ${result.warnings.length} ajuste(s): revisa la lista en el menú Proyecto.`
    : `Proyecto "${name}" abierto.`);
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
      onclick: () => ctx.ui.set({ projectOpen: !open }),
    }, h('span', { class: 'proj-name' }, ctx.sim.project?.name || 'Proyecto sin nombre'), ' ▾'),
    open ? h('div', { class: 'proj-panel', id: 'proj-panel', role: 'dialog', 'aria-label': 'Proyecto' },
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
