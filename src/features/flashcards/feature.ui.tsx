import { lazy } from 'react';
import { Layers } from 'lucide-react';
import type { FeatureUiDefinition } from '../featureRegistry';

export const featureUi: FeatureUiDefinition = {
  id: 'flashcards',
  title: 'Flashcards',
  order: 50,
  Icon: Layers,
  Panel: lazy(() => import('./FlashcardsPanel')),
};
