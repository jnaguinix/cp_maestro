// Adaptación a pantallas pequeñas (p. ej. laptops de 1366×768).
//  - Modo compacto: por debajo de COMPACT_MAX px el panel lateral pasa a ser un cajón que se
//    abre por encima del rack, y la barra superior se compacta (todo en CSS + esta consulta).
//  - Escala del rack: "Ajustar" calcula la escala para que el rack quepa a lo ancho (sin pasar
//    de 100 %, así en pantallas grandes no cambia nada). También se puede fijar a mano (− / +).
//    Se usa la propiedad CSS zoom, que vuelve a maquetar en nítido (no es una imagen reducida).

export const COMPACT_MAX = 1599;
const COMPACT_MQ = `(max-width: ${COMPACT_MAX}px)`;
export const isCompact = () => window.matchMedia(COMPACT_MQ).matches;

export type ZoomPref = 'fit' | number;

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1.5;
const FIT_MIN = 0.55;
const ZOOM_KEY = 'maestro-port-sim:zoom';

/** Preferencia guardada en este navegador (es una comodidad por equipo, no parte del proyecto). */
export function loadZoomPref(): ZoomPref {
  try {
    const raw = localStorage.getItem(ZOOM_KEY);
    const n = raw === null || raw === 'fit' ? NaN : Number(raw);
    return Number.isFinite(n) && n >= ZOOM_MIN && n <= ZOOM_MAX ? n : 'fit';
  } catch {
    return 'fit';
  }
}

export function saveZoomPref(p: ZoomPref) {
  try {
    localStorage.setItem(ZOOM_KEY, String(p));
  } catch {
    /* sin almacenamiento: la preferencia dura solo esta sesión */
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Escala que cabe en el ancho del escenario. Nunca amplía: en pantallas grandes da 1. */
export function fitZoom(stage: HTMLElement, rack: HTMLElement): number {
  const cs = getComputedStyle(stage);
  const avail = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const need = parseFloat(getComputedStyle(rack).minWidth) || rack.scrollWidth;
  if (!avail || !need) return 1;
  return clamp(Math.floor((avail / need) * 100) / 100, FIT_MIN, 1);
}

/** Paso de − / + : de 10 en 10 %, partiendo de la escala que se ve ahora. */
export function stepZoom(current: number, dir: 1 | -1): number {
  const next = Math.round((current + dir * 0.1) * 10) / 10;
  return clamp(next, ZOOM_MIN, ZOOM_MAX);
}
