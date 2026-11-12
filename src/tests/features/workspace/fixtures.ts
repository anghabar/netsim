import type { NetworkCable, NetworkDevice } from '../../../types/NetworkTypes';
import type { TopologyData } from '../../../features/workspace/domain/workspaceModel';
import type { IdSource } from '../../../utils/runtime';
import { linkedPair } from '../../helpers/createTestStore';

export const FIXED_NOW = Date.UTC(2026, 0, 5, 10, 30);

export function sequentialIds(prefix: string): IdSource {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}

/** A switch and a router joined by one cable, plus the same data as a topology. */
export function pairTopology(): { a: NetworkDevice; b: NetworkDevice; cable: NetworkCable; topology: TopologyData } {
  const { a, b, cable } = linkedPair();
  return { a, b, cable, topology: { devices: [a, b], cables: [cable] } };
}
