import { useState } from 'react';
import { Wrench } from 'lucide-react';
import { listFeatureUi } from '../../features/featureRegistry';
import { useNetworkStore } from '../../store/useNetworkStore';

/** One "Tools" button for the control hub; lists every registered feature panel. */
export function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const openToolPanel = useNetworkStore((state) => state.openToolPanel);
  const features = listFeatureUi();

  if (features.length === 0) return null;

  return (
    <div className="relative flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/5">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all duration-300 flex items-center gap-2 text-zinc-500 hover:text-white hover:bg-white/5"
      >
        <Wrench size={13} strokeWidth={2.5} />
        <span className="hidden lg:inline">Tools</span>
      </button>
      {open && (
        <ul
          role="menu"
          className="absolute top-full left-0 mt-2 min-w-[12rem] rounded-xl border border-white/10 bg-black/90 p-1 shadow-2xl"
        >
          {features.map(({ id, title, Icon }) => (
            <li key={id} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  openToolPanel(id);
                }}
                className="w-full px-3 py-2 rounded-lg text-left text-xs text-zinc-300 hover:text-white hover:bg-white/10 flex items-center gap-2"
              >
                {Icon ? <Icon size={13} /> : null}
                {title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
