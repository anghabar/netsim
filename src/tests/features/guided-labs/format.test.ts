import { describe, expect, it } from 'vitest';
import {
  LAB_LISTINGS,
  describeLoadError,
  labUrl,
  loadGuidedLab,
  type LabFetcher,
} from '../../../features/guided-labs/domain/catalog';
import { MAX_LAB_BYTES, parseCriterion, parseGuidedLab } from '../../../features/guided-labs/domain/guards';
import {
  EMPTY_PROGRESS,
  GUIDED_LABS_SLOT,
  loadProgress,
  parseProgress,
  recordCheck,
  saveProgress,
} from '../../../features/guided-labs/domain/progress';
import { createMemoryStorage } from '../../../utils/storage/keyValueStorage';
import { LAB_FILE_IDS, readLab, readLabText } from './fixtures';

const clone = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value));

describe('lab files', () => {
  it.each(LAB_FILE_IDS)('%s parses and matches its listing', (id) => {
    const lab = readLab(id);
    const listing = LAB_LISTINGS.find((item) => item.id === id);
    expect(listing).toBeDefined();
    expect(lab.title).toBe(listing?.title);
    expect(lab.level).toBe(listing?.level);
    expect(lab.minutes).toBe(listing?.minutes);
    expect(lab.summary).toBe(listing?.summary);
    expect(readLabText(id).length).toBeLessThan(MAX_LAB_BYTES);
  });

  it('lists exactly the lab files', () => {
    expect(LAB_LISTINGS.map((item) => item.id).sort()).toEqual([...LAB_FILE_IDS].sort());
  });

  it.each(LAB_FILE_IDS)('%s has no vendor marks or certification names in its text', (id) => {
    const lab = readLab(id);
    const text = [
      lab.title,
      lab.summary,
      ...lab.objectives,
      ...lab.tasks.flatMap((t) => [t.title, t.description, ...t.hints]),
    ].join(' ');
    expect(text).not.toMatch(/ccna|ccnp|cisco|huawei|hcia|hcip/i);
  });

  it.each(LAB_FILE_IDS)('%s only uses documentation addresses', (id) => {
    const addresses = readLabText(id).match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
    // Documentation ranges, router IDs such as 1.1.1.1 and wildcard masks such as 0.0.0.3.
    const allowed = /^(192\.0\.2|198\.51\.100|203\.0\.113)\.|^[1-9]\.[1-9]\.[1-9]\.[1-9]$|^0\.0\.0\.\d+$/;
    for (const address of addresses) expect(address).toMatch(allowed);
  });
});

describe('parseGuidedLab', () => {
  const base = (): Record<string, unknown> => clone(readLab('vlans-and-trunks'));

  it('rejects anything that is not a plain object or has another format version', () => {
    expect(parseGuidedLab(null).ok).toBe(false);
    expect(parseGuidedLab([]).ok).toBe(false);
    expect(parseGuidedLab({ ...base(), formatVersion: 2 }).ok).toBe(false);
  });

  it('rejects a criterion that names an unknown device', () => {
    const lab = base();
    const tasks = lab.tasks as Array<{ criteria: Array<Record<string, unknown>> }>;
    tasks[0].criteria[0].device = 'SW9';
    expect(parseGuidedLab(lab).ok).toBe(false);
  });

  it('rejects an unknown criterion type, duplicate device names and a link to nowhere', () => {
    const typeLab = base();
    (typeLab.tasks as Array<{ criteria: Array<Record<string, unknown>> }>)[0].criteria[0].type = 'run-script';
    expect(parseGuidedLab(typeLab).ok).toBe(false);

    const dupLab = base();
    const setup = dupLab.setup as { devices: Array<{ name: string }> };
    setup.devices[1].name = setup.devices[0].name;
    expect(parseGuidedLab(dupLab).ok).toBe(false);

    const linkLab = base();
    (linkLab.setup as { links: Array<{ to: string }> }).links[0].to = 'SW1:XX';
    expect(parseGuidedLab(linkLab).ok).toBe(true);
    (linkLab.setup as { links: Array<{ to: string }> }).links[0].to = 'SW9:GE0/0/1';
    expect(parseGuidedLab(linkLab).ok).toBe(false);
  });

  it('rejects out-of-range VLANs, invalid addresses and oversized lists', () => {
    expect(parseCriterion({ type: 'vlan-exists', device: 'A', vlan: 5000, label: 'x' })).toBeNull();
    const lab = base();
    (lab.setup as { ports: unknown[] }).ports = [{ device: 'PC1', port: 'eth0', ip: '999.1.1.1', prefix: 24 }];
    expect(parseGuidedLab(lab).ok).toBe(false);
    const many = base();
    many.objectives = Array.from({ length: 20 }, (_, i) => `o${i}`);
    expect(parseGuidedLab(many).ok).toBe(false);
  });

  it('rebuilds the lab field by field and drops unknown keys', () => {
    const lab = { ...base(), extra: 'ignored' };
    const parsed = parseGuidedLab(lab);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(Object.keys(parsed.value)).not.toContain('extra');
  });
});

describe('loadGuidedLab', () => {
  const okFetcher = (text: string, calls: string[] = []): LabFetcher => async (url) => {
    calls.push(url);
    return { ok: true, text: async () => text };
  };

  it('does one plain same-origin GET of labs/<id>.json without a query string', async () => {
    const calls: string[] = [];
    const inits: unknown[] = [];
    const fetcher: LabFetcher = async (url, init) => {
      calls.push(url);
      inits.push(init);
      return { ok: true, text: async () => readLabText('vlans-and-trunks') };
    };
    const loaded = await loadGuidedLab('vlans-and-trunks', fetcher, '/');
    expect(loaded.ok).toBe(true);
    expect(calls).toEqual(['/labs/vlans-and-trunks.json']);
    expect(calls[0]).not.toContain('?');
    expect(inits).toEqual([{ credentials: 'same-origin' }]);
  });

  it('keeps a sub-path base', () => {
    expect(labUrl('a', '/netsim/')).toBe('/netsim/labs/a.json');
    expect(labUrl('a', '/netsim')).toBe('/netsim/labs/a.json');
  });

  it('never fetches an id that is not listed', async () => {
    const calls: string[] = [];
    const loaded = await loadGuidedLab('../secret', okFetcher('{}', calls), '/');
    expect(loaded).toEqual({ ok: false, error: 'unknown-lab' });
    expect((await loadGuidedLab('not-listed', okFetcher('{}', calls), '/')).ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('maps failures to errors', async () => {
    const refused: LabFetcher = async () => ({ ok: false, text: async () => '' });
    const thrown: LabFetcher = async () => {
      throw new Error('offline');
    };
    expect(await loadGuidedLab('vlans-and-trunks', refused, '/')).toEqual({ ok: false, error: 'fetch-failed' });
    expect(await loadGuidedLab('vlans-and-trunks', thrown, '/')).toEqual({ ok: false, error: 'fetch-failed' });
    expect(await loadGuidedLab('vlans-and-trunks', okFetcher('{nope'), '/')).toEqual({ ok: false, error: 'invalid-json' });
    expect(await loadGuidedLab('vlans-and-trunks', okFetcher('x'.repeat(MAX_LAB_BYTES + 1)), '/')).toEqual({
      ok: false,
      error: 'too-large',
    });
    expect(await loadGuidedLab('vlans-and-trunks', okFetcher('{}'), '/')).toEqual({ ok: false, error: 'invalid-lab' });
  });

  it('refuses a file whose id is another lab', async () => {
    const loaded = await loadGuidedLab('vlans-and-trunks', okFetcher(readLabText('spanning-tree-root')), '/');
    expect(loaded).toEqual({ ok: false, error: 'invalid-lab' });
    expect(describeLoadError('invalid-lab')).toContain('not valid');
  });
});

describe('progress', () => {
  const passing = { labId: 'vlans-and-trunks', pass: false, tasks: [{ taskId: 'create-vlans', pass: true, results: [] }, { taskId: 'configure-trunk', pass: false, results: [] }] };

  it('records the tasks that passed and never goes backwards', () => {
    const first = recordCheck(EMPTY_PROGRESS, passing);
    expect(first['vlans-and-trunks']).toEqual({ doneTasks: ['create-vlans'], completed: false });
    const done = recordCheck(first, { labId: 'vlans-and-trunks', pass: true, tasks: [{ taskId: 'configure-trunk', pass: true, results: [] }] });
    expect(done['vlans-and-trunks'].completed).toBe(true);
    const regress = recordCheck(done, passing);
    expect(regress['vlans-and-trunks'].completed).toBe(true);
    expect(regress['vlans-and-trunks'].doneTasks.sort()).toEqual(['configure-trunk', 'create-vlans']);
  });

  it('round-trips through storage', () => {
    const storage = createMemoryStorage();
    const progress = recordCheck(EMPTY_PROGRESS, passing);
    expect(saveProgress(storage, progress).ok).toBe(true);
    expect(loadProgress(storage)).toEqual(progress);
  });

  it('survives corrupt, oversized and hostile stored data', () => {
    expect(parseProgress(null)).toEqual({});
    expect(parseProgress('{broken')).toEqual({});
    expect(parseProgress('x'.repeat(GUIDED_LABS_SLOT.maxBytes + 1))).toEqual({});
    expect(parseProgress(JSON.stringify({ version: 9, labs: {} }))).toEqual({});
    const hostile = JSON.stringify({ version: 1, labs: { '__proto__': { doneTasks: ['a'] }, 'ok-lab': { doneTasks: ['x', 7, 'Bad Id'], completed: 'yes' } } });
    const parsed = parseProgress(hostile);
    expect(Object.keys(parsed)).toEqual(['ok-lab']);
    expect(parsed['ok-lab']).toEqual({ doneTasks: ['x'], completed: false });
  });

  it('reports a full or disabled store instead of throwing', () => {
    const full = createMemoryStorage({ quotaBytes: 5 });
    expect(saveProgress(full, recordCheck(EMPTY_PROGRESS, passing)).ok).toBe(false);
  });
});
