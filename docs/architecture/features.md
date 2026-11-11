# Feature contract

A feature lives in `src/features/<id>/` and plugs into the application through
well-known files. No shared file is edited to add a feature.

| File | Export | Purpose |
|---|---|---|
| `feature.slice.ts` | `featureSlice: FeatureSliceDefinition` | State and actions added to the store |
| `feature.ui.tsx` | `featureUi: FeatureUiDefinition` | A lazy panel listed in the Tools menu |
| `feature.commands.ts` | `featureCommands: readonly ICommand[]` | CLI commands |

All three are discovered with `import.meta.glob`. `feature.ui.tsx` and
`feature.commands.ts` must not import the store at module load; panels are
always `lazy`, and commands receive devices and cables through `CommandContext`.

## Rules

- **State**: prefix every field with the feature name (`notesItems`, `notesAdd`).
  A field that already exists in a core slice or in another feature throws when
  the store is created.
- **Runtime values**: never call `Date.now()`, `Math.random()` or `crypto` in
  domain code. Inside store actions read `get().runtime` (`clock`, `ids`,
  `random`, `storage`). Do not read it while the slice is being created.
- **Storage**: define slots in your folder with
  `defineStorageSlot('netsim.<feature>.<thing>.v1', { maxBytes })`. Slot
  constants are named after what they hold (`NOTES_SLOT`). `write` returns a
  `Result`; quota and disabled storage are errors, never exceptions.
- **Untrusted input** (storage, files, pasted text) enters as `unknown`: use
  `parseJsonText` for the size check and parsing, then `isRecord` and the
  bounded readers from `src/utils/guards.ts`, and rebuild objects field by
  field. Never spread or merge parsed objects into state.
- **Topologies**: validate with `parseTopology` and swap the whole topology only
  through `replaceTopology(next)`. It returns `'lab-in-progress'` or
  `'invalid-topology'` instead of throwing, closes consoles of removed devices
  and rebuilds link state.
- **Panels**: the host draws the frame, title and close button; the panel
  renders its content and may call `onClose`.
- **Commands**: a name or alias already registered throws. Core commands match
  by prefix, so pick names that do not start with an existing command name.
- **Tests** go in `src/tests/features/<id>/` and use `createTestStore()`.

## Example

```ts
// src/features/notes/feature.slice.ts
import type { FeatureSliceDefinition } from '@/store/featureState';
import { isRecord, parseJsonText, readArray } from '@/utils/guards';
import { defineStorageSlot } from '@/utils/storage/storageSlot';

const NOTES_SLOT = defineStorageSlot('netsim.notes.items.v1', { maxBytes: 20000 });
const MAX_NOTES = 50;

export interface NotesSlice {
  notesItems: string[];
  notesLoad: () => void;
  notesAdd: (text: string) => boolean;
}

declare module '@/store/featureState' {
  interface FeatureState extends NotesSlice {}
}

function readNotes(text: string | null): string[] {
  if (text === null) return [];
  const json = parseJsonText(text, { maxBytes: NOTES_SLOT.maxBytes });
  if (!json.ok || !isRecord(json.value)) return [];
  const items = readArray(json.value, 'items', { maxItems: MAX_NOTES }) ?? [];
  return items.filter((item): item is string => typeof item === 'string' && item.length <= 200);
}

export const featureSlice: FeatureSliceDefinition = {
  id: 'notes',
  create: (set, get): NotesSlice => ({
    notesItems: [],
    notesLoad: () => set({ notesItems: readNotes(get().runtime.storage.read(NOTES_SLOT)) }),
    notesAdd: (text) => {
      const items = [...get().notesItems, text.slice(0, 200)].slice(-MAX_NOTES);
      const saved = get().runtime.storage.write(NOTES_SLOT, JSON.stringify({ items }));
      if (saved.ok) set({ notesItems: items });
      return saved.ok;
    },
  }),
};
```

```tsx
// src/features/notes/feature.ui.tsx
import { lazy } from 'react';
import { StickyNote } from 'lucide-react';
import type { FeatureUiDefinition } from '@/features/featureRegistry';

export const featureUi: FeatureUiDefinition = {
  id: 'notes',
  title: 'Notes',
  order: 50,
  Icon: StickyNote,
  Panel: lazy(() => import('./NotesPanel')),
};
```

`NotesPanel.tsx` default-exports a component that takes `{ onClose }`.
