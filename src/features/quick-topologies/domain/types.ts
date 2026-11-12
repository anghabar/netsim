import type { CableType, SwitchModel } from '../../../types/NetworkTypes';

/** IPv4 settings applied to the first port of a node (hosts have exactly one port). */
export interface QuickTopologyAddress {
  readonly ip: string;
  /** Prefix length, for example 24. */
  readonly prefix: number;
  readonly gateway?: string;
}

export interface QuickTopologyNode {
  /** Local reference used by links. It is never used as a device id. */
  readonly ref: string;
  readonly model: SwitchModel;
  readonly hostname: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly address?: QuickTopologyAddress;
}

export interface QuickTopologyLink {
  readonly from: string;
  readonly to: string;
  /** Defaults to copper. Copper uses RJ45 ports, fiber uses SFP ports. */
  readonly media?: CableType;
}

/** A small starter topology, described as data. Ports are assigned in link order. */
export interface QuickTopologyDefinition {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly nodes: readonly QuickTopologyNode[];
  readonly links: readonly QuickTopologyLink[];
}
