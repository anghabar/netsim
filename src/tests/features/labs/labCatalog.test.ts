import { describe, expect, it } from 'vitest';
import { MAX_LAB_DEVICES, isLabDefinition, sanitizeCatalog } from '../../../features/labs/domain/labCatalog';
import { SMALL_TOPOLOGY, makeLab, makeStep } from './fixtures';

describe('isLabDefinition', () => {
  it('accepts a well-formed lab and labels it does not know', () => {
    expect(isLabDefinition(makeLab())).toBe(true);
    expect(isLabDefinition(makeLab(undefined, { topology: SMALL_TOPOLOGY }))).toBe(true);
    expect(isLabDefinition({ ...makeLab(), difficulty: 'expert' })).toBe(true);
  });

  it.each([
    ['a primitive', 'lab'],
    ['null', null],
    ['an array', [makeLab()]],
    ['a lab without steps', { ...makeLab(), steps: [] }],
    ['a lab without id', { ...makeLab(), id: '' }],
    ['an oversized title', { ...makeLab(), title: 't'.repeat(301) }],
    ['duplicate step ids', makeLab([makeStep('s1', 10), makeStep('s1', 10)])],
    ['a non-numeric time', { ...makeLab(), estimatedTime: '30' }],
    ['a non-finite time', { ...makeLab(), estimatedTime: Number.POSITIVE_INFINITY }],
    ['a missing topology', { ...makeLab(), topology: undefined }],
    ['negative points', makeLab([makeStep('s1', -5)])],
    ['non-finite points', makeLab([makeStep('s1', Number.NaN)])],
    [
      'a validation without check function',
      { ...makeLab(), steps: [{ ...makeStep('s1', 10), validation: [{ type: 'config', errorMessage: 'x' }] }] },
    ],
    [
      'an unbounded device count',
      { ...makeLab(), topology: { devices: [{ type: 'PC', count: MAX_LAB_DEVICES + 1 }], connections: [] } },
    ],
    [
      'a fractional device count',
      { ...makeLab(), topology: { devices: [{ type: 'PC', count: 1.5 }], connections: [] } },
    ],
    [
      'a connection without endpoints',
      { ...makeLab(), topology: { devices: [], connections: [{ from: 7, to: 'PC1:eth0', type: 'copper' }] } },
    ],
  ])('rejects %s', (_label, value) => {
    expect(isLabDefinition(value)).toBe(false);
  });
});

describe('sanitizeCatalog', () => {
  it('drops invalid entries and repeated ids', () => {
    const first = makeLab();
    const duplicate = makeLab(undefined, { title: 'Duplicate' });
    const other = makeLab(undefined, { id: 'lab-b' });
    expect(sanitizeCatalog([first, { id: 'broken' }, duplicate, other, 7])).toEqual([first, other]);
  });
});
