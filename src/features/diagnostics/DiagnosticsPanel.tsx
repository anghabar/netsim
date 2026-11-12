import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import type { FeaturePanelProps } from '../featureRegistry';
import { useNetworkStore } from '../../store/useNetworkStore';
import { countBySeverity } from './domain/formatReport';
import type { Finding, FindingSeverity } from './domain/types';
import { isExamInProgress } from './examGate';

const SEVERITY_CLASS: Record<FindingSeverity, string> = {
  critical: 'border-red-500/40 text-red-300',
  warning: 'border-amber-500/40 text-amber-300',
  info: 'border-sky-500/40 text-sky-300',
};

interface FindingItemProps {
  finding: Finding;
  onOpenDevice: (deviceId: string) => void;
}

function FindingItem({ finding, onOpenDevice }: FindingItemProps) {
  const firstDeviceId = finding.deviceIds.length > 0 ? finding.deviceIds[0] : null;
  return (
    <li className={`rounded-lg border bg-black/30 p-3 ${SEVERITY_CLASS[finding.severity]}`}>
      <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-widest">
        <span>
          {finding.severity} · {finding.layer}
        </span>
        {firstDeviceId !== null && (
          <button type="button" onClick={() => onOpenDevice(firstDeviceId)} className="underline hover:text-white">
            Open console
          </button>
        )}
      </div>
      <p className="mt-1 text-sm font-semibold text-white">{finding.title}</p>
      <p className="mt-1 text-xs text-zinc-300">{finding.detail}</p>
      <p className="mt-1 text-xs text-zinc-400">{finding.recommendation}</p>
    </li>
  );
}

export default function DiagnosticsPanel({ onClose }: FeaturePanelProps) {
  const report = useNetworkStore((state) => state.diagnosticsReport);
  const devices = useNetworkStore((state) => state.devices);
  const cables = useNetworkStore((state) => state.cables);
  const examActive = useNetworkStore((state) => isExamInProgress(state.currentLabSession));
  const runDiagnosis = useNetworkStore((state) => state.diagnosticsRun);
  const clearDiagnosis = useNetworkStore((state) => state.diagnosticsClear);
  const openConsole = useNetworkStore((state) => state.openConsole);

  // Keep the report in sync with the topology while the panel is open.
  useEffect(() => {
    runDiagnosis();
  }, [runDiagnosis, devices, cables, examActive]);

  // Nothing is kept once the panel is closed.
  useEffect(
    () => () => {
      clearDiagnosis();
    },
    [clearDiagnosis],
  );

  const openDevice = (deviceId: string): void => {
    if (!devices.some((device) => device.id === deviceId)) return;
    openConsole(deviceId);
    onClose();
  };

  const counts = report ? countBySeverity(report.findings) : null;

  return (
    <div className="flex flex-col gap-3 text-white">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-zinc-500">Checks run locally in this browser.</p>
        <button
          type="button"
          onClick={runDiagnosis}
          disabled={examActive}
          aria-label="Run the checks again"
          className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white disabled:opacity-30"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {examActive && <p className="text-sm text-zinc-400">Topology diagnosis is not available during an exam.</p>}

      {!examActive && report !== null && counts !== null && (
        <>
          <p role="status" className="text-xs text-zinc-400">
            {report.deviceCount} devices · {report.cableCount} links · {counts.critical} critical · {counts.warning}{' '}
            warning · {counts.info} info
          </p>
          {report.truncated && (
            <p className="text-xs text-amber-300">The topology exceeds the analysis limits; results are partial.</p>
          )}
          {report.skipped > 0 && (
            <p className="text-xs text-amber-300">{report.skipped} malformed or duplicate entries were ignored.</p>
          )}
          {report.findings.length === 0 ? (
            <p className="text-sm text-emerald-300">No consistency issues found.</p>
          ) : (
            <ul className="space-y-2">
              {report.findings.map((finding) => (
                <FindingItem key={finding.id} finding={finding} onOpenDevice={openDevice} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
