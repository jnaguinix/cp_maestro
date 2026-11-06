// Recorrido guiado para quien entra por primera vez: oscurece la página, resalta una parte
// de la interfaz y explica qué hace con una tarjeta (Atrás / Siguiente / Saltar).
// Vive fuera del render principal (se cuelga del <body>), así que los redibujados de la app
// no lo interrumpen: en cada paso vuelve a buscar el elemento por su selector.

const DONE_KEY = 'maestro-port-sim:tour-done';

interface Step {
  /** Selectores en orden de preferencia; se usa el primero visible. Sin selector = tarjeta centrada. */
  target?: string[];
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: 'Bienvenido a Maestro Port Lab',
    body: 'Aquí diseñas y validas el cableado de un Maestro con dos Orchestrators MHO-140, firewalls Quantum Force y el switch del cliente. En un minuto te muestro dónde está cada cosa.',
  },
  {
    target: ['.proj-toggle'],
    title: 'Tu proyecto',
    body: 'Pon nombre y cliente, guarda o abre el diseño (.maestro.json), exporta la foto PNG o el plan de cableado CSV, y abre un ejemplo para practicar.',
  },
  {
    target: ['.status'],
    title: 'Estado del diseño',
    body: 'Cuántos downlinks quedan libres en cada MHO y el resultado de la validación. Haz clic en él para ver qué está mal y por qué, con la fuente de cada regla.',
  },
  {
    target: ['.view-tabs'],
    title: 'Vista por Security Group',
    body: 'Mira todos los equipos o solo los de un SG. En la vista de un SG, los puertos del MHO que usan otros SG se ven atenuados.',
  },
  {
    target: ['.cable-picker'],
    title: 'Tipo de cable',
    body: 'Elige el cable antes de conectar: DAC, fibra, breakout o cobre, con su velocidad. El validador avisa si no coincide con la velocidad del puerto.',
  },
  {
    target: ['.add-equip .add-inline', '.add-equip .add-menu-btn', '.add-equip'],
    title: 'Agregar firewalls',
    body: 'Haz clic en un modelo para agregarlo al SG de la pestaña abierta, o arrástralo hasta una pestaña.',
  },
  {
    target: ['.switch.u'],
    title: 'Switch del cliente',
    body: 'Zona MGMT (1-8) hacia el servidor de gestión y zona Producción (9-24) hacia las redes del cliente. Se conectan a los puertos Management y Uplink de los MHO.',
  },
  {
    target: ['.mho.u'],
    title: 'Los Orchestrators',
    body: 'Cada color es un tipo de puerto: Management (1-4), Uplinks (5-26), Downlinks hacia los firewalls (27-47), Sync (48) y QSFP28 (49-56). Haz clic en un puerto para ver su Port ID, su nombre en Gaia y cambiarle el tipo o la velocidad.',
  },
  {
    target: ['.appliance.u .fw-slot', '.appliance.u'],
    title: 'Los firewalls',
    body: 'El slot de expansión es lo único que va al Maestro: los puertos impares (1 y 3) al MHO1 y los pares (2 y 4) al MHO2. Los puertos onboard no se usan.',
  },
  {
    target: ['.mho.u .g-dl', '.mho.u'],
    title: 'Cómo conectar',
    body: 'Haz clic en un puerto libre y luego en el otro extremo: el cable se crea con el tipo elegido. Esc cancela. Un clic en un cable o en un puerto conectado lo ilumina; otro clic lo apaga.',
  },
  {
    target: ['.mgr.l'],
    title: 'Organizadores de cables',
    body: 'Los cables del MHO1 bajan por la izquierda y los del MHO2 por la derecha. Así ves de un vistazo si cada firewall llega a los dos Orchestrators.',
  },
  {
    target: ['.side', '.side-toggle'],
    title: 'Panel lateral',
    body: 'Detalle del puerto o cable seleccionado, la Validación, los Security Groups (aquí asignas Management y Uplinks) y los Comandos de Gaia Clish generados.',
  },
  {
    target: ['.zoom-ctl'],
    title: 'Tamaño del rack',
    body: '«Ajustar» hace que el rack quepa a lo ancho de la pantalla. Con − y + lo fijas tú.',
  },
  {
    title: 'Listo para empezar',
    body: 'Un buen primer paso: en el menú del proyecto, abre «Ejemplo con errores» y corrige lo que marca la validación. Puedes repetir esta guía con el botón «? Guía».',
  },
];

function visible(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

function findTarget(step: Step): HTMLElement | null {
  for (const sel of step.target ?? []) {
    const el = [...document.querySelectorAll(sel)].find(visible);
    if (el) return el as HTMLElement;
  }
  return null;
}

let active: { close: () => void } | null = null;

export function startTour() {
  active?.close();
  let i = 0;

  const shade = document.createElement('div');
  shade.className = 'tour-shade';
  const spot = document.createElement('div');
  spot.className = 'tour-spot';
  const card = document.createElement('div');
  card.className = 'tour-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'tour-title');
  document.body.append(shade, spot, card);

  // Pasos cuyo elemento no está en pantalla (p. ej. sin firewalls en la vista) se saltan
  const usable = () => STEPS.map((s, idx) => ({ s, idx })).filter(({ s }) => !s.target || findTarget(s));

  function place() {
    const steps = usable();
    const cur = steps[Math.min(i, steps.length - 1)];
    const el = cur.s.target ? findTarget(cur.s) : null;
    const pad = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (el) {
      const r = el.getBoundingClientRect();
      Object.assign(spot.style, {
        display: 'block',
        left: `${Math.max(4, r.left - pad)}px`,
        top: `${Math.max(4, r.top - pad)}px`,
        width: `${Math.min(vw - 8, r.width + pad * 2)}px`,
        height: `${Math.min(vh - 8, r.height + pad * 2)}px`,
      });
      shade.classList.remove('dark');
    } else {
      spot.style.display = 'none';
      shade.classList.add('dark');
    }

    // Tarjeta: debajo del elemento si cabe; si no, encima; si no, centrada
    const cw = Math.min(380, vw - 24);
    card.style.width = `${cw}px`;
    const ch = card.offsetHeight || 200;
    let left: number;
    let top: number;
    if (el) {
      const r = el.getBoundingClientRect();
      left = Math.min(Math.max(12, r.left), vw - cw - 12);
      if (r.bottom + pad + 12 + ch < vh) top = r.bottom + pad + 12;
      else if (r.top - pad - 12 - ch > 0) top = r.top - pad - 12 - ch;
      else { top = Math.max(12, (vh - ch) / 2); left = Math.max(12, vw - cw - 24); }
    } else {
      left = (vw - cw) / 2;
      top = Math.max(12, (vh - ch) / 2);
    }
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function show() {
    const steps = usable();
    i = Math.max(0, Math.min(i, steps.length - 1));
    const cur = steps[i];
    const el = cur.s.target ? findTarget(cur.s) : null;
    // Llevar el elemento a la vista (también dentro del rack, que tiene su propio scroll)
    el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    const last = i === steps.length - 1;
    card.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'tour-head';
    const count = document.createElement('span');
    count.className = 'tour-count';
    count.textContent = `${i + 1} de ${steps.length}`;
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'tour-skip';
    skip.textContent = last ? 'Cerrar' : 'Saltar guía';
    skip.onclick = () => finish();
    head.append(count, skip);
    const title = document.createElement('h3');
    title.id = 'tour-title';
    title.textContent = cur.s.title;
    const body = document.createElement('p');
    body.textContent = cur.s.body;
    const dots = document.createElement('div');
    dots.className = 'tour-dots';
    dots.setAttribute('aria-hidden', 'true');
    steps.forEach((_, k) => { const d = document.createElement('i'); if (k === i) d.className = 'on'; dots.append(d); });
    const nav = document.createElement('div');
    nav.className = 'tour-nav';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn';
    back.textContent = 'Atrás';
    back.disabled = i === 0;
    back.onclick = () => { i--; show(); };
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn primary';
    next.textContent = last ? 'Empezar' : i === 0 ? 'Comenzar recorrido' : 'Siguiente';
    next.onclick = () => { if (last) finish(); else { i++; show(); } };
    nav.append(dots, back, next);
    card.append(head, title, body, nav);
    place();
    next.focus();
  }

  function finish() {
    try { localStorage.setItem(DONE_KEY, '1'); } catch { /* sin almacenamiento */ }
    close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); finish(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); const n = usable().length; if (i < n - 1) { i++; show(); } else finish(); }
    else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); i--; show(); }
  }
  const onMove = () => place();

  function close() {
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onMove);
    window.removeEventListener('scroll', onMove, true);
    shade.remove();
    spot.remove();
    card.remove();
    active = null;
  }

  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onMove);
  window.addEventListener('scroll', onMove, true);
  active = { close };
  show();
}

/** La primera vez que alguien abre la app, el recorrido arranca solo. */
export function maybeStartTour() {
  let done = false;
  try { done = localStorage.getItem(DONE_KEY) === '1'; } catch { /* sin almacenamiento */ }
  if (!done) window.setTimeout(startTour, 700);
}
