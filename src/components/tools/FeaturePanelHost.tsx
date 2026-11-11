import { Suspense } from 'react';
import { X } from 'lucide-react';
import { listFeatureUi } from '../../features/featureRegistry';
import { useNetworkStore } from '../../store/useNetworkStore';

/** Renders the feature panel selected in the Tools menu inside a shared frame. */
export function FeaturePanelHost() {
  const activeToolPanel = useNetworkStore((state) => state.activeToolPanel);
  const closeToolPanel = useNetworkStore((state) => state.closeToolPanel);
  const feature = listFeatureUi().find((entry) => entry.id === activeToolPanel);

  if (!feature) return null;
  const Panel = feature.Panel;

  return (
    <aside
      role="dialog"
      aria-label={feature.title}
      className="fixed top-0 right-0 z-[5000] h-screen w-full max-w-md flex flex-col bg-[#0b0c0d]/95 border-l border-white/10 shadow-2xl backdrop-blur-xl"
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h2 className="text-sm font-bold text-white">{feature.title}</h2>
        <button
          type="button"
          onClick={closeToolPanel}
          aria-label={`Close ${feature.title}`}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10"
        >
          <X size={14} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <Suspense fallback={<p role="status" className="text-xs text-zinc-500">Loading…</p>}>
          <Panel onClose={closeToolPanel} />
        </Suspense>
      </div>
    </aside>
  );
}
