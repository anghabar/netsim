import ReactDOM from 'react-dom/client';
import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import 'reactflow/dist/style.css';

import type { NetworkCable, NetworkDevice } from './types/NetworkTypes';
import { useAuthStore } from './store/useAuthStore';
import { useNetworkStore } from './store/useNetworkStore';
import { attachTopologyAutosave, type AutosaveError } from './store/topologyAutosave';
import { useUiStore } from './store/useUiStore';
import { notifyAutosaveError } from './store/autosaveNotice';
import { initWasm, wasmSetTopology } from './wasm/wasmBridge';

// Lazy load route components for code splitting
const App = lazy(() => import('./App.tsx'));

const PageLoader = () => (
  <div className="flex items-center justify-center h-screen w-screen bg-[#0b0c0d]">
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-zinc-400 text-sm">Loading...</span>
    </div>
  </div>
);

const pushTopology = (devices: NetworkDevice[], cables: NetworkCable[]): void => {
  try {
    wasmSetTopology(devices, cables);
  } catch {
    // A topology the engine cannot read must not break the store update that triggered the sync.
  }
};

const RootHandlers = () => {
  const { initListener } = useAuthStore();

  useEffect(() => {
    initListener();

    // Start-up side effects live here, not in the store module.
    const notify = (error: AutosaveError): void => notifyAutosaveError(error, useUiStore.getState().addToast);
    useNetworkStore.getState().initialize(notify);
    const detachAutosave = attachTopologyAutosave(useNetworkStore, { onError: notify });

    let cancelled = false;
    let detachEngineSync: (() => void) | null = null;
    initWasm()
      .then(() => {
        if (cancelled) return;
        const initial = useNetworkStore.getState();
        pushTopology(initial.devices, initial.cables);
        detachEngineSync = useNetworkStore.subscribe((state, previous) => {
          if (state.devices !== previous.devices || state.cables !== previous.cables) {
            pushTopology(state.devices, state.cables);
          }
        });
      })
      .catch(() => {
        // initWasm reports its own failure; the TypeScript CLI layer keeps working without the engine.
      });

    return () => {
      cancelled = true;
      detachAutosave();
      if (detachEngineSync) detachEngineSync();
    };
  }, [initListener]);

  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/*" element={<App />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<RootHandlers />);
}
