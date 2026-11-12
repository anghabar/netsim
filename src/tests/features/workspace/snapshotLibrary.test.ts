import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../wasm/wasmBridge', () => ({
  initWasm: async () => undefined,
  wasmSetTopology: () => undefined,
  wasmGetDevices: () => [],
  wasmExecuteCommand: () => null,
  wasmPing: () => '',
}));

import {
  createSnapshot,
  loadLibrary,
  parseLibrary,
  removeSnapshot,
  saveLibrary,
  serializeLibrary,
  WORKSPACE_SNAPSHOTS_SLOT,
} from '../../../features/workspace/domain/snapshotLibrary';
import {
  cleanName,
  WORKSPACE_LIMITS,
  type WorkspaceSnapshot,
} from '../../../features/workspace/domain/workspaceModel';
import { err } from '../../../utils/guards';
import { createMemoryStorage, type KeyValueStorage } from '../../../utils/storage/keyValueStorage';
import { FIXED_NOW, pairTopology, sequentialIds } from './fixtures';

const deps = () => ({ clock: () => FIXED_NOW, ids: sequentialIds('snap') });

function mustCreate(name: string, existing: readonly WorkspaceSnapshot[] = []): WorkspaceSnapshot {
  const created = createSnapshot(name, pairTopology().topology, existing, deps());
  if (!created.ok) throw new Error(`fixture failed: ${created.error}`);
  return created.value;
}

describe('createSnapshot', () => {
  it('stamps id and time from the injected sources and stores an independent copy', () => {
    const { a, topology } = pairTopology();
    const created = createSnapshot('  Baseline  ', topology, [], deps());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({ id: 'snap-1', name: 'Baseline', createdAt: FIXED_NOW });
    expect(created.value.topology.cables).toHaveLength(1);
    expect(created.value.topology.devices[0]).not.toBe(a);
    const hostname = a.hostname;
    a.hostname = 'changed-later';
    a.ports[0].config.vlan = 99;
    expect(created.value.topology.devices[0].hostname).toBe(hostname);
    expect(created.value.topology.devices[0].ports[0].config.vlan).toBe(1);
  });

  it('keeps only the most recent console lines', () => {
    const { a, topology } = pairTopology();
    a.consoleLogs = Array.from({ length: 100 }, (_, index) => `line ${index}`);
    const created = createSnapshot('logs', topology, [], deps());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const logs = created.value.topology.devices[0].consoleLogs;
    expect(logs).toHaveLength(WORKSPACE_LIMITS.snapshotConsoleLines);
    expect(logs[logs.length - 1]).toBe('line 99');
  });

  it('falls back to a dated name and keeps names unique', () => {
    expect(mustCreate(' \n ').name).toBe('Snapshot 2026-01-05 10:30');
    const first = mustCreate('Baseline');
    expect(mustCreate('baseline', [first]).name).toBe('baseline (2)');
  });

  it('never reuses the id of an existing snapshot', () => {
    const first = mustCreate('One');
    expect(mustCreate('Two', [first]).id).toBe('snap-2');
  });

  it('refuses empty, invalid and surplus snapshots', () => {
    const { a, cable } = pairTopology();
    expect(createSnapshot('x', { devices: [], cables: [] }, [], deps())).toEqual({ ok: false, error: 'empty-topology' });
    expect(createSnapshot('x', { devices: [a], cables: [cable] }, [], deps())).toEqual({
      ok: false,
      error: 'invalid-topology',
    });
    expect(createSnapshot('x', null, [], deps())).toEqual({ ok: false, error: 'invalid-topology' });
    const one = mustCreate('one');
    const full = Array.from({ length: WORKSPACE_LIMITS.maxSnapshots }, (_, index) => ({
      ...one,
      id: `s-${index}`,
      name: `n-${index}`,
    }));
    expect(createSnapshot('x', pairTopology().topology, full, deps())).toEqual({ ok: false, error: 'limit-reached' });
  });
});

describe('cleanName', () => {
  it('collapses whitespace, strips control and override characters and bounds the length', () => {
    expect(cleanName('  before \n\t the\u0007 change  ')).toBe('before the change');
    expect(cleanName('a\u202eb')).toBe('ab');
    expect(cleanName('x'.repeat(500))).toHaveLength(WORKSPACE_LIMITS.maxNameLength);
    expect(cleanName(' \u0000 ')).toBe('');
  });
});

describe('removeSnapshot', () => {
  it('removes by id and reports unknown ids', () => {
    const snapshot = mustCreate('One');
    expect(removeSnapshot([snapshot], 'missing')).toEqual({ ok: false, error: 'not-found' });
    expect(removeSnapshot([snapshot], snapshot.id)).toEqual({ ok: true, value: [] });
  });
});

describe('snapshot storage', () => {
  it('round-trips through storage', () => {
    const storage = createMemoryStorage();
    const list = [mustCreate('One')];
    expect(saveLibrary(storage, list)).toEqual({ ok: true, value: undefined });
    expect(loadLibrary(storage)).toEqual({ snapshots: list, skipped: 0 });
  });

  it('returns an empty list when nothing is stored', () => {
    expect(loadLibrary(createMemoryStorage())).toEqual({ snapshots: [], skipped: 0 });
  });

  it('reports corrupt or foreign documents without throwing', () => {
    const snapshot = mustCreate('One');
    expect(parseLibrary('{broken')).toEqual({ snapshots: [], skipped: 1 });
    expect(parseLibrary('[]')).toEqual({ snapshots: [], skipped: 1 });
    expect(parseLibrary(JSON.stringify({ version: 99, snapshots: [snapshot] }))).toEqual({ snapshots: [], skipped: 1 });
    expect(parseLibrary(JSON.stringify({ version: 1, snapshots: 'x' }))).toEqual({ snapshots: [], skipped: 1 });
  });

  it('keeps valid entries and skips invalid or duplicated ones', () => {
    const good = mustCreate('One');
    const broken = { ...good, id: 'other', topology: { devices: [{ id: 'x' }], cables: [] } };
    const text = JSON.stringify({ version: 1, snapshots: [good, { id: 'no-fields' }, good, null, broken] });
    const report = parseLibrary(text);
    expect(report.snapshots).toEqual([good]);
    expect(report.skipped).toBe(4);
  });

  it('never copies prototype-related names from stored text', () => {
    const text = serializeLibrary([mustCreate('One')]).replace('"name"', '"__proto__":{"polluted":true},"name"');
    const report = parseLibrary(text);
    expect(report.snapshots).toHaveLength(1);
    expect(Object.keys(report.snapshots[0])).toEqual(['id', 'name', 'createdAt', 'topology']);
    expect(Reflect.get({}, 'polluted')).toBeUndefined();
  });

  it('maps storage failures to result errors', () => {
    const list = [mustCreate('One')];
    expect(saveLibrary(createMemoryStorage({ quotaBytes: 10 }), list)).toEqual({ ok: false, error: 'storage-failed' });
    const tooSmall: KeyValueStorage = {
      read: () => null,
      write: () => err('too-large'),
      remove: () => undefined,
    };
    expect(saveLibrary(tooSmall, list)).toEqual({ ok: false, error: 'too-large' });
    const storage = createMemoryStorage();
    storage.write(WORKSPACE_SNAPSHOTS_SLOT, '{broken');
    expect(loadLibrary(storage)).toEqual({ snapshots: [], skipped: 1 });
  });
});
