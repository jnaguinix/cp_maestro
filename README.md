# Maestro Port Lab

Simulador de puertos y cableado para Check Point Maestro: 2× MHO-140 en un mismo site, 8 appliances Quantum Force (9100, 9200, 9400 y 9800, dos de cada uno) y dos switches externos (management y producción). Modo R82.

Conectas y desconectas cables, cambias el tipo y la velocidad de los puertos, asignas appliances y puertos Management a los Security Groups, y el validador explica qué está mal y en qué documento se apoya cada regla.

## Uso

```bash
npm install
npm run dev            # servidor de desarrollo (http://localhost:5173)
npm test               # tests de las reglas (Vitest)
npm run build          # build estándar en dist/
npm run build:artifact # un único HTML autocontenido en dist-artifact/
```

## Estructura

```
src/
  data/        Catálogos de hardware con sus fuentes
    mho140.ts      Puertos del MHO-140: tipos, modos, nombres Gaia, breakout
    appliances.ts  Appliances Quantum Force, cables y switches
  model/       Dominio y estado
    types.ts       Tipos de todo el modelo
    endpoints.ts   Formato de los extremos de cable (mho:/app:/sw:)
    scenarios.ts   Escenarios precargados (correcto, con errores, vacío)
    store.ts       Estado + acciones + persistencia local
  rules/
    validate.ts    Motor de reglas (función pura, testeado)
  ui/          Interfaz sin framework
    rack.ts        Rack 1U: switches, MHO1, MHO2 y appliances apilados
    faceplate.ts   Panel frontal del Orchestrator
    devices.ts     Appliances y switches como unidades de 1U
    catalog.ts     Pestañas por Security Group y catálogo de appliances
    cables.ts      Cables por canales y organizadores laterales (MHO1 izq., MHO2 der.)
    inspector.ts   Detalle de puerto o cable
    panels.ts      Validación, Security Groups y comandos generados
    toolbar.ts     Barra superior
  styles/      tokens.css · layout.css · components.css
tests/         validate.test.ts
scripts/       to-artifact.mjs (post-proceso del build de un solo archivo)
```

## Reglas del validador

| Regla | Qué comprueba | Fuente |
|---|---|---|
| SPEED-MISMATCH | Velocidad del cable = `qsfp-mode` del puerto (sin auto-negociación) | CB p.67; AG p.85 |
| PORT-DISABLED / PORT-SUB | Breakout en 49/51/53/55 deshabilita 50/52/54/56 | GSG p.124 |
| BREAKOUT-NEEDED / UNUSED | Cable breakout solo en puertos en 4x10G / 4x25G | GSG p.48, p.124 |
| SYNC-MISSING / SYNC-MISUSE / MHO-MHO | Puerto 48 ↔ 48 entre MHOs y solo eso | GSG p.46, p.126 |
| APP-NOT-DOWNLINK | Un appliance solo va a puertos tipo Downlink | GSG p.28, p.46 |
| APP-PORT-SLOW | Solo puertos de 10G o más; MGMT/SYNC RJ45 del appliance no se usan | GSG p.28; CB p.50, p.54 |
| APP-ONBOARD | SFP+ onboard como downlink no documentado [INF] | Datasheet; GSG 2026 |
| DL-MAX | Máximo 2 downlinks por MHO por appliance | GSG p.131 |
| DL-SYM-APP / DL-SYM-SG | Mismo número de downlinks hacia cada MHO y en todo el SG | GSG p.131 |
| DL-SAME-PORT | Mismo número de puerto en ambos MHOs (buena práctica) | GSG p.126; CB p.67 |
| DL-PORT-PARITY | Puertos impares de la tarjeta al MHO1 y pares al MHO2 (aviso) | GSG p.132-133 [INF en serie 9000] |
| SG-MIXED | Un SG solo con appliances del mismo modelo | AG p.74 |
| SG-NO-MGMT / SG-MGMT-ONE-MHO / SG-MGMT-NOCABLE | Management asignado, en ambos MHOs y cableado | CB p.30, p.54; GSG p.126, p.128 |
| MGMT-SHARED | Shared Management (info) | GSG p.128 |
| SG-NO-UPLINK | Cada SG con miembros tiene al menos un Uplink asignado | GSG p.126; AG |
| SG-UPLINK-ONE-MHO / SG-UPLINK-NOCABLE / SG-UPLINK-TYPE | Uplinks en ambos MHOs, cableados al switch del cliente y de tipo Uplink | GSG p.126, p.46 [INF en parte] |
| UPLINK-SHARED | Un Uplink asignado a varios SGs (aviso) | [INF] |
| SW-ON-DOWNLINK / PROD-ON-MGMT | Switches en puertos equivocados | GSG p.126; CB p.173 |

## Supuestos marcados como [INF]

- Disposición física de los puertos 1-48 (impares arriba, pares abajo).
- Modo por defecto 100G en los QSFP28 del MHO-140.
- Nombres de los sub-puertos de breakout en 51/53/55 (documentado solo para el 49).
- Qué puerto de la tarjeta de la serie 9000 va a cada MHO (se aplica el patrón de las tarjetas de 4 puertos del GSG).
