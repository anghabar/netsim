import { lazy } from 'react';
import { GraduationCap } from 'lucide-react';
import type { FeatureUiDefinition } from '../featureRegistry';

export const featureUi: FeatureUiDefinition = {
  id: 'practice-quiz',
  title: 'Practice quiz',
  order: 51,
  Icon: GraduationCap,
  Panel: lazy(() => import('./PracticeQuizPanel')),
};
