/**
 * Guided lab definition: plain data, no code. Criteria are evaluated against the
 * state of the simulated network (see network.ts), never against typed commands.
 */

export const LAB_FORMAT_VERSION = 1;

export type LabLevel = 'beginner' | 'intermediate' | 'advanced';

export interface LabDeviceSpec {
  /** Host name shown on the canvas; unique inside the lab. */
  name: string;
  /** Catalog model, for example "Huawei-S5700-28TP", "Huawei-AR617" or "PC". */
  model: string;
}

/** A cable between two endpoints written as "<device>:<port>". */
export interface LabLinkSpec {
  from: string;
  to: string;
}

/** Initial settings of one port, applied before the learner starts. */
export interface LabPortInit {
  device: string;
  port: string;
  ip?: string;
  prefix?: number;
  vlan?: number;
  /** Default gateway of the device (hosts). */
  gateway?: string;
}

export interface LabSetup {
  devices: LabDeviceSpec[];
  links: LabLinkSpec[];
  ports: LabPortInit[];
}

interface CriterionBase {
  /** Short label shown next to the pass or fail mark. */
  label: string;
}

export type Criterion =
  | (CriterionBase & { type: 'vlan-exists'; device: string; vlan: number })
  | (CriterionBase & { type: 'port-access-vlan'; device: string; port: string; vlan: number })
  | (CriterionBase & { type: 'trunk-allows'; device: string; port: string; vlan: number })
  | (CriterionBase & { type: 'l2-reachable'; a: string; b: string; expected: boolean })
  | (CriterionBase & { type: 'stp-enabled'; device: string })
  | (CriterionBase & { type: 'stp-root'; device: string })
  | (CriterionBase & { type: 'stp-blocked-ports'; count: number })
  | (CriterionBase & { type: 'ospf-enabled'; device: string })
  | (CriterionBase & { type: 'ospf-adjacency'; a: string; b: string })
  | (CriterionBase & { type: 'ospf-route'; device: string; prefix: string })
  | (CriterionBase & { type: 'static-route'; device: string; prefix: string; nextHop: string })
  | (CriterionBase & { type: 'ip-reachable'; from: string; address: string; expected: boolean })
  | (CriterionBase & { type: 'vlanif-address'; device: string; vlan: number; address: string; prefix: number })
  | (CriterionBase & { type: 'eth-trunk-mode'; device: string; trunk: string; mode: TrunkModeCheck })
  | (CriterionBase & { type: 'eth-trunk-members'; device: string; trunk: string; count: number })
  | (CriterionBase & { type: 'eth-trunk-up'; a: string; b: string; trunk: string; count: number })
  | (CriterionBase & {
      type: 'port-feature';
      device: string;
      port: string;
      feature: PortFeature;
      enabled: boolean;
      maxMacs?: number;
    });

/** `lacp` accepts either LACP mode (active or passive). */
export type TrunkModeCheck = 'static' | 'active' | 'passive' | 'lacp';
export const TRUNK_MODE_CHECKS: readonly TrunkModeCheck[] = ['static', 'active', 'passive', 'lacp'];
export type PortFeature = 'portfast' | 'bpdu-guard' | 'port-security';
export const PORT_FEATURES: readonly PortFeature[] = ['portfast', 'bpdu-guard', 'port-security'];

export type CriterionType = Criterion['type'];

export const CRITERION_TYPES: readonly CriterionType[] = [
  'vlan-exists',
  'port-access-vlan',
  'trunk-allows',
  'l2-reachable',
  'stp-enabled',
  'stp-root',
  'stp-blocked-ports',
  'ospf-enabled',
  'ospf-adjacency',
  'ospf-route',
  'static-route',
  'ip-reachable',
  'vlanif-address',
  'eth-trunk-mode',
  'eth-trunk-members',
  'eth-trunk-up',
  'port-feature',
];

export interface LabTask {
  id: string;
  title: string;
  description: string;
  /** Hints from gentle to explicit; the last one may show example commands. */
  hints: string[];
  criteria: Criterion[];
}

export interface GuidedLab {
  formatVersion: number;
  id: string;
  title: string;
  level: LabLevel;
  minutes: number;
  summary: string;
  objectives: string[];
  setup: LabSetup;
  tasks: LabTask[];
}

export interface CriterionResult {
  criterion: Criterion;
  pass: boolean;
  /** What the checker observed; meaningful when the criterion fails. */
  detail: string;
}

export interface TaskResult {
  taskId: string;
  pass: boolean;
  results: CriterionResult[];
}

export interface LabCheckResult {
  labId: string;
  pass: boolean;
  tasks: TaskResult[];
}
