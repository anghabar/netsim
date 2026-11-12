import { describe, expect, it } from 'vitest';
import { lab1 } from '../../../data/labs/lab1_campus_basic';
import { lab2 } from '../../../data/labs/lab2_stp';
import { runStepValidations } from '../../../features/labs/domain/labSession';
import type { NetworkCable, NetworkDevice } from '../../../types/NetworkTypes';
import { buildLabTopology } from '../../../utils/labTopologyBuilder';
import { parseTopology } from '../../../utils/topology/topologyGuards';
import { makeLab } from './fixtures';

const deps = () => {
  let counter = 0;
  return {
    ids: () => {
      counter += 1;
      return `built-${counter}`;
    },
    random: () => 0.5,
  };
};

const endpointNames = (devices: NetworkDevice[], cables: NetworkCable[]): string[][] => {
  const name = (deviceId: string, portId: string): string => {
    const device = devices.find((item) => item.id === deviceId);
    const port = device?.ports.find((item) => item.id === portId);
    return `${device?.hostname ?? '?'}:${port?.name ?? '?'}`;
  };
  return cables.map((cable) => [
    name(cable.sourceDeviceId, cable.sourcePortId),
    name(cable.targetDeviceId, cable.targetPortId),
  ]);
};

describe('buildLabTopology', () => {
  it('resolves ports by exact name so no port carries two cables', () => {
    const { devices, cables } = buildLabTopology(lab2, deps());
    expect(endpointNames(devices, cables)).toEqual([
      ['Switch1:GE0/0/23', 'Switch2:GE0/0/23'],
      ['Switch2:GE0/0/24', 'Switch3:GE0/0/24'],
      ['Switch3:GE0/0/1', 'Switch1:GE0/0/1'],
    ]);
    expect(parseTopology({ devices, cables }).ok).toBe(true);
  });

  it('is deterministic with injected ids', () => {
    expect(buildLabTopology(lab2, deps())).toEqual(buildLabTopology(lab2, deps()));
  });

  it('accepts long port names, falls back to a free port and skips unknown devices', () => {
    const lab = makeLab(undefined, {
      topology: {
        devices: [
          { type: 'Switch', count: 1 },
          { type: 'Router', count: 1 },
        ],
        connections: [
          { from: 'Switch:GigabitEthernet 0/0/3', to: 'Router:GE0/0/0', type: 'copper' },
          { from: 'Switch:GE0/0/3', to: 'Router:missing-port', type: 'copper' },
          { from: 'Ghost:GE0/0/1', to: 'Router:GE0/0/2', type: 'copper' },
          { from: 'Switch', to: 'Router', type: 'copper' },
        ],
      },
    });
    const { devices, cables } = buildLabTopology(lab, deps());
    expect(endpointNames(devices, cables)).toEqual([
      ['Switch:GE0/0/3', 'Router:GE0/0/0'],
      ['Switch:GE0/0/1', 'Router:GE0/0/1'],
      ['Switch:GE0/0/2', 'Router:GE0/0/2'],
    ]);
    expect(parseTopology({ devices, cables }).ok).toBe(true);
  });
});

describe('basic campus lab validations', () => {
  it('fail on the initial topology and pass once the switch is configured', () => {
    const { devices, cables } = buildLabTopology(lab1, deps());
    const context = { devices, cables, commands: [], topology: { devices, cables } };
    const [vlanStep, portStep] = lab1.steps;
    expect(runStepValidations(vlanStep, context).every((result) => result.passed)).toBe(false);

    const campusSwitch = devices.find((device) => device.hostname === 'Switch');
    if (!campusSwitch) throw new Error('the lab switch was not built');
    campusSwitch.vlans.push(10, 20);
    expect(runStepValidations(vlanStep, context).every((result) => result.passed)).toBe(true);

    campusSwitch.ports[0].config.vlan = 10;
    campusSwitch.ports[1].config.vlan = 20;
    expect(runStepValidations(portStep, context).every((result) => result.passed)).toBe(true);
  });
});
