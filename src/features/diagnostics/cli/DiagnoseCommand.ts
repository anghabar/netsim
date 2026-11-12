import { Command } from '../../../store/slices/cli/commands/base/Command';
import type { CommandContext, CommandResult } from '../../../store/slices/cli/commands/base/Command';
import { diagnoseTopology } from '../domain/analyzeTopology';
import { formatReportLines } from '../domain/formatReport';

/** The console pages command output; this keeps a whole report inside one page. */
export const CLI_MAX_FINDINGS = 15;

type CommandText = Pick<CommandContext, 'normalizedCommand'>;
type DiagnoseInput = Pick<CommandContext, 'devices' | 'cables'>;

const tokensOf = (context: CommandText): string[] =>
  context.normalizedCommand.trim().toLowerCase().split(/\s+/).filter(Boolean);

/**
 * diagnose - consistency checks for the whole topology.
 * Read-only: it never modifies a device and works entirely in the browser.
 */
export class DiagnoseCommand extends Command {
  readonly name = 'diagnose';
  readonly description = 'Run consistency checks on the whole topology';
  private readonly isAllowed: () => boolean;

  constructor(isAllowed: () => boolean = () => true) {
    super();
    this.isAllowed = isAllowed;
  }

  /** Matches the exact first word only, so longer words are not captured. */
  canHandle(context: CommandText): boolean {
    return tokensOf(context)[0] === this.name;
  }

  validate(context: CommandText): { valid: boolean; error?: string } {
    if (tokensOf(context).length > 1) {
      return { valid: false, error: 'Error: diagnose takes no arguments' };
    }
    return { valid: true };
  }

  execute(context: DiagnoseInput): CommandResult {
    if (!this.isAllowed()) {
      return this.createError('topology diagnosis is not available during an exam');
    }
    const report = diagnoseTopology(context.devices, context.cables);
    return this.createOutput(formatReportLines(report, { maxFindings: CLI_MAX_FINDINGS }));
  }
}
