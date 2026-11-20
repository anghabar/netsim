import type { CommandContext, CommandResult } from '../../../store/slices/cli/commands/base/Command';
import { AclRuleAddCommand } from '../../../store/slices/cli/commands/system/AclCommand';
import { IpRouteStaticCommand } from '../../../store/slices/cli/commands/system/IpRouteStaticCommand';
import { parseIpv4, maskToPrefix } from '../../../utils/ipv4';
import { canonicalPortName } from '../domain/network';

/**
 * `ip route-static <network> <mask> <next-hop>`: the library command only
 * understands a prefix length. This accepts a dotted mask as well and checks
 * the addresses before the route is stored.
 */
export class IpRouteStaticChecked extends IpRouteStaticCommand {
  private static prefixOf(text: string): number | null {
    if (text.includes('.')) return maskToPrefix(text);
    const n = Number(text);
    return Number.isInteger(n) && n >= 0 && n <= 32 ? n : null;
  }

  validate(context: CommandContext): { valid: boolean; error?: string } {
    const base = super.validate(context);
    if (!base.valid) return base;
    const [, , dest, mask, hop] = context.args;
    if (parseIpv4(dest) === null || parseIpv4(hop) === null || IpRouteStaticChecked.prefixOf(mask) === null) {
      return { valid: false, error: 'Error: ip route-static <network> <mask or prefix length> <next-hop>' };
    }
    return { valid: true };
  }

  execute(context: CommandContext): CommandResult {
    const prefix = IpRouteStaticChecked.prefixOf(context.args[3]);
    const args = [...context.args];
    args[3] = String(prefix ?? 24);
    return super.execute({ ...context, args });
  }
}

/**
 * `acl rule add <name> <permit|deny> <interface> <in|out> [src=<cidr>] [dst=<cidr>]`:
 * the library command stores the internal port id, which a learner cannot see.
 * This one takes the port name as shown in the console (for example GE0/0/1).
 */
export class AclRuleAddByPortName extends AclRuleAddCommand {
  validate(context: CommandContext): { valid: boolean; error?: string } {
    if (context.device.cliState.view !== 'system-view') {
      return { valid: false, error: 'Error: Command requires system-view view' };
    }
    const base = super.validate(context);
    if (!base.valid) return base;
    const wanted = canonicalPortName(context.args[5]);
    if (!context.device.ports.some((p) => canonicalPortName(p.name) === wanted)) {
      return { valid: false, error: 'Error: Interface not found.' };
    }
    return { valid: true };
  }

  execute(context: CommandContext): CommandResult {
    const wanted = canonicalPortName(context.args[5]);
    const port = context.device.ports.find((p) => canonicalPortName(p.name) === wanted);
    if (!port) return this.createError('Interface not found.');
    const args = [...context.args];
    args[5] = port.id;
    const result = super.execute({ ...context, args });
    return { ...result, output: result.output.map((line) => line.split(port.id).join(port.name)) };
  }
}
