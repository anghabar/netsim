import { lazy } from 'react';
import { GraduationCap } from 'lucide-react';
import type { FeatureUiDefinition } from '../featureRegistry';

export const featureUi: FeatureUiDefinition = {
  id: 'guided-labs',
  title: 'Guided labs',
  order: 30,
  Icon: GraduationCap,
  Panel: lazy(() => import('./GuidedLabsPanel')),
};
