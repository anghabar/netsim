// Feature modules exports
// Use this file to import all features from a single location

// Sidebar features
export { SidebarCard, SidebarItem, CatalogItem } from './sidebar/components';

// Labs features
export { LabsPanelEnhanced, useLabsState } from './labs';

// Feature contract (panels and CLI commands contributed by feature folders)
export { listFeatureUi, registerFeatureCommands } from './featureRegistry';
export type { FeaturePanelProps, FeatureUiDefinition } from './featureRegistry';
