import { lazy } from 'react';
import { Activity } from 'lucide-react';
import type { FeatureUiDefinition } from '../featureRegistry';

export const featureUi: FeatureUiDefinition = {
  id: 'diagnostics',
  title: 'Topology diagnosis',
  order: 40,
  Icon: Activity,
  Panel: lazy(() => import('./DiagnosticsPanel')),
};
