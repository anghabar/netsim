import type { ICommand } from '../../store/slices/cli/commands/base/Command';
import { PortDefaultVlanCommand } from '../../store/slices/cli/commands/interface/PortDefaultVlanCommand';
import { PortLinkTypeCommand } from '../../store/slices/cli/commands/interface/PortLinkTypeCommand';
import { PortTrunkAllowVlanCommand } from '../../store/slices/cli/commands/interface/PortTrunkAllowVlanCommand';
import { StpCommand } from '../../store/slices/cli/commands/network/StpCommand';
import { OspfConfigCommand } from './cli/OspfConfigCommand';

/**
 * The guided labs need VLAN port settings, spanning tree settings and OSPF
 * settings to be typed in the consoles. The port and STP commands already exist
 * in the command library but were not registered in the executor, so the labs
 * register them here; the OSPF command is new.
 */
export const featureCommands: readonly ICommand[] = [
  new PortLinkTypeCommand(),
  new PortDefaultVlanCommand(),
  new PortTrunkAllowVlanCommand(),
  new StpCommand(),
  new OspfConfigCommand(),
];
