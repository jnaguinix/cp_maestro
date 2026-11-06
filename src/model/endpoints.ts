// Utilidades para interpretar los identificadores de extremo de cable.
import type { EndpointId, OrchId } from './types';

export type ParsedEndpoint =
  | { kind: 'mho'; orch: OrchId; front: number; sub: number }
  | { kind: 'app'; appId: string; portId: string }
  | { kind: 'sw'; swId: string; n: number };

export function parseEndpoint(id: EndpointId): ParsedEndpoint {
  const [kind, ...rest] = id.split(':');
  if (kind === 'mho') {
    const [o, f, s] = rest[0].split('/').map(Number);
    return { kind: 'mho', orch: o as OrchId, front: f, sub: s };
  }
  if (kind === 'app') return { kind: 'app', appId: rest[0], portId: rest[1] };
  if (kind === 'sw') return { kind: 'sw', swId: rest[0], n: Number(rest[1]) };
  throw new Error(`Extremo no válido: ${id}`);
}

export const appEndpoint = (appId: string, portId: string) => `app:${appId}:${portId}`;
export const swEndpoint = (swId: string, n: number) => `sw:${swId}:${n}`;
