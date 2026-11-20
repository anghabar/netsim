import { Command, type CommandContext, type CommandResult } from '../../../store/slices/cli/commands/base/Command';
import { isRecord } from '../../../utils/guards';
import { parseIpv4 } from '../../../utils/ipv4';

const PROCESS_ID = /^\d{1,5}$/;
const AREA_ID = /^\d{1,10}$/;

/**
 * Single-line OSPF configuration for guided labs (system view):
 *
 *   ospf <process-id>
 *   ospf <process-id> router-id <ip>
 *   ospf <process-id> area <area-id> network <ip> <wildcard>
 *
 * The network statements are stored as `network` entries of `ospfLsdb`, the same
 * shape other vendor profiles use, and read back by the lab checker.
 */
export class OspfConfigCommand extends Command {
  readonly name = 'ospf process';
  readonly description = 'Configure an OSPF process, its router ID and the networks of an area';
  readonly vendor = null;
  readonly requiredView = ['system-view'];

  canHandle(context: CommandContext): boolean {
    const { args } = context;
    return args[0]?.toLowerCase() === 'ospf' && PROCESS_ID.test(args[1] ?? '');
  }

  validate(context: CommandContext): { valid: boolean; error?: string } {
    const viewCheck = super.validate(context);
    if (!viewCheck.valid) return viewCheck;
    const { args } = context;
    const usage = 'Error: ospf <id> [router-id <ip> | area <area> network <ip> <wildcard>]';
    if (args.length === 2) return { valid: true };
    if (args[2].toLowerCase() === 'router-id') {
      if (args.length !== 4 || parseIpv4(args[3]) === null) return { valid: false, error: usage };
      return { valid: true };
    }
    if (args[2].toLowerCase() === 'area') {
      const ok =
        args.length === 7 &&
        AREA_ID.test(args[3]) &&
        args[4].toLowerCase() === 'network' &&
        parseIpv4(args[5]) !== null &&
        parseIpv4(args[6]) !== null;
      return ok ? { valid: true } : { valid: false, error: usage };
    }
    return { valid: false, error: usage };
  }

  execute(context: CommandContext): CommandResult {
    const { device, args } = context;
    device.ospfEnabled = true;
    if (args.length === 2) return this.createOutput([`Info: OSPF process ${args[1]} started.`], device);
    if (args[2].toLowerCase() === 'router-id') {
      device.routerId = args[3];
      return this.createOutput([`Info: Router ID is ${args[3]}.`], device);
    }
    const area = String(Number(args[3]));
    const kept = (device.ospfLsdb ?? []).filter(
      (entry) =>
        !(isRecord(entry) && entry.type === 'network' && entry.network === args[5] && entry.wildcard === args[6]),
    );
    device.ospfLsdb = [...kept, { type: 'network', network: args[5], wildcard: args[6], area, advertisedBy: device.hostname }];
    return this.createOutput([`Info: Network ${args[5]} ${args[6]} added to area ${area}.`], device);
  }
}
