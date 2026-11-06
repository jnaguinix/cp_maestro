// Catálogo del Maestro Hyperscale Orchestrator MHO-140.
// Fuentes:
//   GSG p.46-47  (Port Mapping MHO-140: tipos por defecto)
//   GSG p.231-233 (nombres de interfaz en Gaia)
//   GSG p.124    (breakout: solo 49/51/53/55; deshabilita 50/52/54/56)
//   AG  p.85     (modos qsfp-mode admitidos por puerto)
//   GSG online "MHO-140 Front Panel": solo los puertos 1-4 admiten type management
import type { MhoPortConfig, MhoPortDef, OrchId, PortMode, PortType, Speed } from '../model/types';

const SFP_MODES: PortMode[] = ['1G', '10G', '25G'];
const QSFP_TOP_MODES: PortMode[] = ['4x10G', '4x25G', '25G', '40G', '100G'];
const QSFP_BOTTOM_MODES: PortMode[] = ['25G', '40G', '100G'];

/** Nombre Gaia del puerto físico sin breakout (GSG p.231-233) */
const QSFP_GAIA: Record<number, string> = {
  49: '49', 50: '51', 51: '53', 52: '55', 53: '57', 54: '59', 55: '61',
};

function build(): MhoPortDef[] {
  const defs: MhoPortDef[] = [];
  for (let p = 1; p <= 56; p++) {
    if (p <= 4) {
      defs.push({
        front: p, defaultType: 'management', allowedTypes: ['management'],
        allowedModes: ['1G', '10G'], defaultMode: '10G',
        gaiaSuffix: `Mgmt${p}`, formFactor: 'SFP',
      });
    } else if (p <= 26) {
      defs.push({
        front: p, defaultType: 'uplink', allowedTypes: ['uplink', 'downlink'],
        allowedModes: SFP_MODES, defaultMode: '10G',
        gaiaSuffix: String(p).padStart(2, '0'), formFactor: 'SFP',
      });
    } else if (p <= 47) {
      defs.push({
        front: p, defaultType: 'downlink', allowedTypes: ['downlink', 'uplink'],
        allowedModes: SFP_MODES, defaultMode: '10G',
        gaiaSuffix: String(p).padStart(2, '0'), formFactor: 'SFP',
      });
    } else if (p === 48) {
      defs.push({
        front: p, defaultType: 'ssm_sync', allowedTypes: ['ssm_sync'],
        allowedModes: ['10G'], defaultMode: '10G',
        gaiaSuffix: 'SYNC-INT', formFactor: 'SFP',
      });
    } else if (p === 56) {
      defs.push({
        front: p, defaultType: 'site_sync', allowedTypes: ['site_sync'],
        allowedModes: QSFP_BOTTOM_MODES, defaultMode: '100G',
        disabledBy: 55, gaiaSuffix: 'SYNC-EXT', formFactor: 'QSFP28',
      });
    } else {
      const top = p % 2 === 1; // 49, 51, 53, 55 = fila de arriba
      defs.push({
        front: p, defaultType: 'uplink', allowedTypes: ['uplink', 'downlink'],
        allowedModes: top ? QSFP_TOP_MODES : QSFP_BOTTOM_MODES,
        defaultMode: '100G',
        pairsWith: top ? p + 1 : undefined,
        disabledBy: top ? undefined : p - 1,
        gaiaSuffix: QSFP_GAIA[p], formFactor: 'QSFP28',
      });
    }
  }
  return defs;
}

export const MHO140_PORTS: MhoPortDef[] = build();

export function portDef(front: number): MhoPortDef {
  const d = MHO140_PORTS[front - 1];
  if (!d) throw new Error(`Puerto inexistente: ${front}`);
  return d;
}

export const portKey = (o: OrchId, front: number) => `${o}/${front}`;
export const portIdStr = (o: OrchId, front: number, sub = 1) => `${o}/${front}/${sub}`;
export const mhoEndpoint = (o: OrchId, front: number, sub = 1) => `mho:${portIdStr(o, front, sub)}`;

export function defaultPortConfig(front: number): MhoPortConfig {
  const d = portDef(front);
  return { type: d.defaultType, mode: d.defaultMode };
}

export const isSplitMode = (m: PortMode) => m === '4x10G' || m === '4x25G';

export function modeSpeed(m: PortMode): Speed {
  switch (m) {
    case '1G': return 1;
    case '10G': case '4x10G': return 10;
    case '25G': case '4x25G': return 25;
    case '40G': return 40;
    case '100G': return 100;
  }
}

/** Nombre de la interfaz en Gaia (Orchestrator / Security Group).
 *  Con breakout en el puerto 49 aparecen eth1-49..eth1-52 (GSG p.124).
 *  Para 51/53/55 se aplica el mismo patrón [INF]. */
export function gaiaName(o: OrchId, front: number, sub: number, cfg: MhoPortConfig): string {
  const d = portDef(front);
  if (front === 48) return 'SYNC-INT';
  if (front === 56) return 'SYNC-EXT';
  if (front <= 4) return `eth${o}-Mgmt${front}`;
  if (d.formFactor === 'QSFP28') {
    const base = Number(d.gaiaSuffix);
    if (isSplitMode(cfg.mode)) return `eth${o}-${String(base + sub - 1).padStart(2, '0')}`;
    return `eth${o}-${d.gaiaSuffix}`;
  }
  // Puertos SFP 5-47: en la tabla del GSG los downlinks se llaman dlNN.
  if (cfg.type === 'downlink') return `dl${front}`;
  return `eth${o}-${d.gaiaSuffix}`;
}

export const TYPE_LABEL: Record<PortType, string> = {
  management: 'Management',
  uplink: 'Uplink',
  downlink: 'Downlink',
  ssm_sync: 'Sync interno',
  site_sync: 'Sync Dual Site',
};

/** Nota explicativa del tipo de puerto (lo que se muestra en el inspector) */
export const TYPE_HELP: Record<PortType, string> = {
  management:
    'Conecta el Security Group con el Management Server (SMS/MDS). Lo usa el SMO Master para política, logs, SSH y Gaia Portal del SG. Puede compartirse entre varios SGs (Shared Management), con IP y MAC distintas en cada uno. No es para tráfico de producción. (CB p.54, p.173; GSG p.128)',
  uplink:
    'Conecta el Orchestrator con las redes del cliente. La interfaz se ve en el Gaia del Security Group y en SmartConsole; bonds, VLANs e IPs se configuran en el SG, no en el Orchestrator. (CB p.54; GSG p.222)',
  downlink:
    'Conecta el Orchestrator con un appliance (SGM). No tiene configuración de red: el Orchestrator detecta los downlinks de cada appliance y los agrega solo. Por aquí viajan el tráfico de producción y las VLANs de control 3700/3800/3900 + SG#. (GSG p.131, p.222; CB p.50)',
  ssm_sync:
    'Sync interno entre los dos Orchestrators del mismo site. Solo sincroniza la configuración de los Security Groups; no lleva producción ni estado de conexiones. Cable directo 48↔48. No se puede cambiar su tipo. (GSG p.46, p.126; CB p.55)',
  site_sync:
    'Sync externo hacia el Orchestrator del otro site (Dual Site). En un único site no se usa. (GSG p.46, p.165)',
};
