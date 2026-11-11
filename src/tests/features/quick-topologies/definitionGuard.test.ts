import { describe, expect, it } from 'vitest';
import {
  QUICK_TOPOLOGY_LIMITS,
  validateQuickTopology,
} from '../../../features/quick-topologies/domain/definitionGuard';
import type {
  QuickTopologyAddress,
  QuickTopologyDefinition,
  QuickTopologyNode,
} from '../../../features/quick-topologies/domain/types';

const sw = (ref: string): QuickTopologyNode => ({
  ref,
  model: 'Huawei-S5700-28TP',
  hostname: ref,
  position: { x: 100, y: 100 },
});

const pc = (ref: string, address?: QuickTopologyAddress): QuickTopologyNode => ({
  ref,
  model: 'PC',
  hostname: ref,
  position: { x: 200, y: 200 },
  ...(address === undefined ? {} : { address }),
});

const base: QuickTopologyDefinition = {
  id: 'tiny',
  title: 'Tiny',
  summary: 'Two devices and one cable.',
  nodes: [sw('SW1'), pc('PC1', { ip: '192.0.2.10', prefix: 24, gateway: '192.0.2.1' })],
  links: [{ from: 'SW1', to: 'PC1' }],
};

const withPatch = (patch: Partial<QuickTopologyDefinition>): QuickTopologyDefinition => ({ ...base, ...patch });

const expectError = (definition: QuickTopologyDefinition, code: string, path: string): void => {
  expect(validateQuickTopology(definition)).toEqual({ ok: false, error: { code, path } });
};

describe('validateQuickTopology', () => {
  it('accepts a well-formed definition', () => {
    expect(validateQuickTopology(base)).toEqual({ ok: true, value: undefined });
    expect(validateQuickTopology(withPatch({ links: [{ from: 'SW1', to: 'PC1', media: 'copper' }] })).ok).toBe(true);
  });

  it('rejects unsafe ids and texts', () => {
    expectError(withPatch({ id: 'Bad Id' }), 'invalid-id', 'id');
    expectError(withPatch({ id: '__proto__' }), 'invalid-id', 'id');
    expectError(withPatch({ title: '   ' }), 'invalid-text', 'title');
    expectError(withPatch({ title: 'a\u0007b' }), 'invalid-text', 'title');
    expectError(
      withPatch({ summary: 's'.repeat(QUICK_TOPOLOGY_LIMITS.maxSummaryLength + 1) }),
      'invalid-text',
      'summary',
    );
  });

  it('enforces size limits', () => {
    expectError(withPatch({ nodes: [], links: [] }), 'invalid-size', 'nodes');
    const tooMany = Array.from({ length: QUICK_TOPOLOGY_LIMITS.maxNodes + 1 }, (_, index) => sw(`N${index}`));
    expectError(withPatch({ nodes: tooMany, links: [] }), 'invalid-size', 'nodes');
    const manyLinks = Array.from({ length: QUICK_TOPOLOGY_LIMITS.maxLinks + 1 }, () => ({ from: 'SW1', to: 'PC1' }));
    expectError(withPatch({ links: manyLinks }), 'invalid-size', 'links');
  });

  it('rejects malformed, duplicated or unknown nodes', () => {
    expectError(withPatch({ nodes: [{ ...sw('SW1'), ref: 'bad ref' }], links: [] }), 'invalid-node', 'nodes[0].ref');
    expectError(
      withPatch({ nodes: [{ ...sw('SW1'), hostname: '<b>core</b>' }], links: [] }),
      'invalid-node',
      'nodes[0].hostname',
    );
    expectError(withPatch({ nodes: [sw('SW1'), sw('SW1')], links: [] }), 'duplicate-node', 'nodes[1]');
    expectError(
      withPatch({ nodes: [sw('SW1'), { ...sw('SW2'), hostname: 'sw1' }], links: [] }),
      'duplicate-node',
      'nodes[1]',
    );
    expectError(
      withPatch({ nodes: [{ ...sw('SW1'), model: 'NS-Switch-L3-48' }], links: [] }),
      'unknown-model',
      'nodes[0].model',
    );
  });

  it('rejects positions outside the canvas bounds', () => {
    for (const position of [
      { x: -1, y: 0 },
      { x: Number.NaN, y: 0 },
      { x: 0, y: QUICK_TOPOLOGY_LIMITS.maxCoordinate + 1 },
    ]) {
      expectError(withPatch({ nodes: [{ ...sw('SW1'), position }], links: [] }), 'invalid-position', 'nodes[0].position');
    }
  });

  it('rejects invalid host addressing', () => {
    const bad: QuickTopologyAddress[] = [
      { ip: '192.0.2.256', prefix: 24 },
      { ip: '192.0.2.01', prefix: 24 },
      { ip: '192.0.2.10', prefix: 33 },
      { ip: '192.0.2.10', prefix: 31 },
      { ip: '192.0.2.10', prefix: 24.5 },
      { ip: '192.0.2.0', prefix: 24 },
      { ip: '192.0.2.255', prefix: 24 },
      { ip: '192.0.2.10', prefix: 24, gateway: '198.51.100.1' },
      { ip: '192.0.2.10', prefix: 24, gateway: '192.0.2.10' },
      { ip: '192.0.2.10', prefix: 24, gateway: 'gateway' },
    ];
    for (const address of bad) {
      expectError(withPatch({ nodes: [sw('SW1'), pc('PC1', address)] }), 'invalid-address', 'nodes[1].address');
    }
  });

  it('rejects the same address on two nodes', () => {
    const address: QuickTopologyAddress = { ip: '192.0.2.10', prefix: 24 };
    expectError(
      withPatch({ nodes: [sw('SW1'), pc('PC1', address), pc('PC2', address)] }),
      'duplicate-address',
      'nodes[2].address',
    );
  });

  it('rejects links to unknown nodes and self links', () => {
    expectError(withPatch({ links: [{ from: 'SW1', to: 'nope' }] }), 'invalid-link', 'links[0]');
    expectError(withPatch({ links: [{ from: '__proto__', to: 'PC1' }] }), 'invalid-link', 'links[0]');
    expectError(withPatch({ links: [{ from: 'SW1', to: 'SW1' }] }), 'invalid-link', 'links[0]');
  });

  it('accepts only models from the supplied set', () => {
    expect(validateQuickTopology(base, new Set(['PC'])).ok).toBe(false);
    expect(validateQuickTopology(base, new Set(['PC', 'Huawei-S5700-28TP'])).ok).toBe(true);
  });
});
