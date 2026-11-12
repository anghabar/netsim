// Topology diagnosis: pure rule engine and text rendering.
export { analyzeTopology, diagnoseTopology, sameReport, MAX_FINDINGS } from './domain/analyzeTopology';
export { countBySeverity, formatReportLines } from './domain/formatReport';
export { DIAGNOSTICS_LIMITS, toTopologyView } from './domain/topologyView';
export type { ViewLimits } from './domain/topologyView';
export type {
  DiagnosticsReport,
  Finding,
  FindingCode,
  FindingLayer,
  FindingSeverity,
  TopologyView,
} from './domain/types';
