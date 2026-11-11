import { lazy } from 'react';
import { Archive } from 'lucide-react';
import type { FeatureUiDefinition } from '../featureRegistry';

export const featureUi: FeatureUiDefinition = {
  id: 'workspace',
  title: 'Workspace',
  order: 20,
  Icon: Archive,
  Panel: lazy(() => import('./components/WorkspacePanel')),
};
