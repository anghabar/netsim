import { useEffect, useRef, useState } from 'react';
import { Download, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import type { FeaturePanelProps } from '../../featureRegistry';
import { useNetworkStore } from '../../../store/useNetworkStore';
import type { TopologyFileExport } from '../domain/topologyFile';
import { describeWorkspaceError, WORKSPACE_LIMITS, type WorkspaceError } from '../domain/workspaceModel';
import type { TopologyFileSource, WorkspaceExportSource } from '../feature.slice';

type Status = { tone: 'ok' | 'error'; text: string } | null;
type Pending = { kind: 'restore' | 'delete'; id: string } | null;

const BUTTON =
  'inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-zinc-200 hover:bg-white/10 disabled:opacity-40';
const INPUT =
  'min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white placeholder:text-zinc-600';
const REVOKE_DELAY_MS = 10000;

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;
const formatDate = (timestamp: number): string => new Date(timestamp).toLocaleString();

function exportMessage(file: TopologyFileExport): string {
  if (file.sensitiveCount === 0) return `Exported ${file.fileName}.`;
  const values = plural(file.sensitiveCount, 'secret value');
  return file.sensitiveIncluded
    ? `Exported ${file.fileName}. Warning: it contains ${values} in clear text.`
    : `Exported ${file.fileName}. ${values} left out of the file.`;
}

function startDownload(fileName: string, text: string): string {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.click();
  return url;
}

export default function WorkspacePanel(_props: FeaturePanelProps) {
  const snapshots = useNetworkStore((state) => state.workspaceSnapshots);
  const skipped = useNetworkStore((state) => state.workspaceSkippedEntries);
  const hasDevices = useNetworkStore((state) => state.devices.length > 0);
  const load = useNetworkStore((state) => state.workspaceLoad);
  const saveSnapshot = useNetworkStore((state) => state.workspaceSaveSnapshot);
  const restoreSnapshot = useNetworkStore((state) => state.workspaceRestoreSnapshot);
  const deleteSnapshot = useNetworkStore((state) => state.workspaceDeleteSnapshot);
  const importFile = useNetworkStore((state) => state.workspaceImportFile);
  const exportFile = useNetworkStore((state) => state.workspaceExportFile);

  const [name, setName] = useState('');
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [status, setStatus] = useState<Status>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const downloads = useRef(new Map<ReturnType<typeof setTimeout>, string>());

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    const active = downloads.current;
    return () => {
      mounted.current = false;
      active.forEach((url, timer) => {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      });
      active.clear();
    };
  }, []);

  const fail = (error: WorkspaceError): void => setStatus({ tone: 'error', text: describeWorkspaceError(error) });
  const done = (text: string): void => setStatus({ tone: 'ok', text });

  const handleSave = (): void => {
    const result = saveSnapshot(name);
    if (!result.ok) return fail(result.error);
    setName('');
    done(`Saved "${result.value.name}" in this browser.`);
  };

  const handleExport = (source: WorkspaceExportSource): void => {
    const result = exportFile(source, { includeSensitive });
    if (!result.ok) return fail(result.error);
    const url = startDownload(result.value.fileName, result.value.text);
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      downloads.current.delete(timer);
    }, REVOKE_DELAY_MS);
    downloads.current.set(timer, url);
    done(exportMessage(result.value));
  };

  const handleImport = (file: TopologyFileSource): void => {
    void importFile(file).then((result) => {
      if (!mounted.current) return;
      if (!result.ok) return fail(result.error);
      const notes: string[] = [];
      if (result.value.ignoredFields > 0) notes.push(`${plural(result.value.ignoredFields, 'unknown field')} ignored.`);
      if (result.value.unknownModels > 0) notes.push(`${plural(result.value.unknownModels, 'device')} use an unknown model.`);
      done([`Imported "${result.value.snapshot.name}" as a snapshot. Use Restore to apply it.`, ...notes].join(' '));
    });
  };

  const requestRestore = (id: string): void => {
    if (hasDevices) return setPending({ kind: 'restore', id });
    const result = restoreSnapshot(id);
    if (!result.ok) return fail(result.error);
    done('Snapshot restored.');
  };

  const confirmPending = (): void => {
    if (pending === null) return;
    const result =
      pending.kind === 'restore' ? restoreSnapshot(pending.id, { replaceCurrent: true }) : deleteSnapshot(pending.id);
    setPending(null);
    if (!result.ok) return fail(result.error);
    done(pending.kind === 'restore' ? 'Snapshot restored.' : 'Snapshot deleted.');
  };

  return (
    <div className="flex flex-col gap-4 text-white">
      <p className="text-[11px] text-zinc-400">
        Snapshots are stored only in this browser ({snapshots.length}/{WORKSPACE_LIMITS.maxSnapshots}). Topology files
        can be shared; they do not include console output.
      </p>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          handleSave();
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={WORKSPACE_LIMITS.maxNameLength}
          placeholder="Snapshot name (optional)"
          aria-label="Snapshot name"
          className={INPUT}
        />
        <button type="submit" disabled={!hasDevices} className={BUTTON}>
          <Save size={12} /> Save
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON} onClick={() => fileInput.current?.click()}>
          <Upload size={12} /> Import file
        </button>
        <button
          type="button"
          disabled={!hasDevices}
          className={BUTTON}
          onClick={() => handleExport({ kind: 'current', name: name || 'Topology' })}
        >
          <Download size={12} /> Export current
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          aria-label="Topology file"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) handleImport(file);
          }}
        />
      </div>

      <label className="flex items-start gap-2 text-[11px] text-zinc-400">
        <input
          type="checkbox"
          checked={includeSensitive}
          onChange={(event) => setIncludeSensitive(event.target.checked)}
          className="mt-0.5"
        />
        <span>
          Include secrets in exported files.{' '}
          {includeSensitive ? (
            <strong className="text-amber-300">
              Configured passwords (for example BGP neighbour passwords) will be written in clear text.
            </strong>
          ) : (
            'By default they are left out.'
          )}
        </span>
      </label>

      <p
        role="status"
        aria-live="polite"
        className={status?.tone === 'error' ? 'min-h-[1rem] text-xs text-rose-300' : 'min-h-[1rem] text-xs text-emerald-300'}
      >
        {status?.text}
      </p>
      {skipped > 0 ? (
        <p className="text-[11px] text-amber-300">
          {plural(skipped, 'stored entry')} failed validation and {skipped === 1 ? 'was' : 'were'} ignored.
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {snapshots.length === 0 ? <li className="text-xs text-zinc-500">No snapshots yet.</li> : null}
        {snapshots.map((snapshot) => (
          <li key={snapshot.id} className="flex flex-col gap-1 rounded-xl border border-white/10 bg-black/30 p-3">
            <span className="break-words text-xs font-semibold">{snapshot.name}</span>
            <span className="text-[10px] text-zinc-500">
              {formatDate(snapshot.createdAt)} · {plural(snapshot.topology.devices.length, 'device')} ·{' '}
              {plural(snapshot.topology.cables.length, 'cable')}
            </span>
            {pending !== null && pending.id === snapshot.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-amber-300">
                  {pending.kind === 'restore' ? 'Replace the current topology?' : 'Delete this snapshot?'}
                </span>
                <button type="button" className={BUTTON} onClick={confirmPending}>
                  Confirm
                </button>
                <button type="button" className={BUTTON} onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BUTTON} onClick={() => requestRestore(snapshot.id)}>
                  <RotateCcw size={12} /> Restore
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  aria-label={`Export ${snapshot.name}`}
                  onClick={() => handleExport({ kind: 'snapshot', id: snapshot.id })}
                >
                  <Download size={12} /> Export
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  aria-label={`Delete ${snapshot.name}`}
                  onClick={() => setPending({ kind: 'delete', id: snapshot.id })}
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
