import type { ICommand } from '../../store/slices/cli/commands/base/Command';
import { DiagnoseCommand } from './cli/DiagnoseCommand';
import { isDiagnosisBlocked } from './examGate';

export const featureCommands: readonly ICommand[] = [new DiagnoseCommand(() => !isDiagnosisBlocked())];
