import type { ICommand } from '../../store/slices/cli/commands/base/Command';
import { BpduGuardCommand } from '../../store/slices/cli/commands/interface/BpduGuardCommand';
import { EthTrunkMemberCommand } from '../../store/slices/cli/commands/interface/EthTrunkMemberCommand';
import { PortDefaultVlanCommand } from '../../store/slices/cli/commands/interface/PortDefaultVlanCommand';
import { PortLinkTypeCommand } from '../../store/slices/cli/commands/interface/PortLinkTypeCommand';
import { PortSecurityCommand } from '../../store/slices/cli/commands/interface/PortSecurityCommand';
import { PortTrunkAllowVlanCommand } from '../../store/slices/cli/commands/interface/PortTrunkAllowVlanCommand';
import { PortfastCommand } from '../../store/slices/cli/commands/interface/PortfastCommand';
import { StpCommand } from '../../store/slices/cli/commands/network/StpCommand';
import { AclRuleDeleteCommand } from '../../store/slices/cli/commands/system/AclCommand';
import { AclRuleAddByPortName, IpRouteStaticChecked } from './cli/LabFriendlyCommands';
import { OspfConfigCommand } from './cli/OspfConfigCommand';

/**
 * The guided labs need these settings to be typed in the consoles. Most of the
 * commands already exist in the command library but were never registered in
 * the executor, so typing them gave "Unrecognized command". The labs register
 * them here. Two are wrapped to be usable (dotted masks and port names) and the
 * OSPF command is new.
 */
export const featureCommands: readonly ICommand[] = [
  new PortLinkTypeCommand(),
  new PortDefaultVlanCommand(),
  new PortTrunkAllowVlanCommand(),
  new StpCommand(),
  new PortfastCommand(),
  new BpduGuardCommand(),
  new PortSecurityCommand(),
  new EthTrunkMemberCommand(),
  new IpRouteStaticChecked(),
  new AclRuleAddByPortName(),
  new AclRuleDeleteCommand(),
  new OspfConfigCommand(),
];
