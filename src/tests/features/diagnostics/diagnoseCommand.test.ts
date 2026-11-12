import { describe, expect, it } from 'vitest';
import { CLI_MAX_FINDINGS, DiagnoseCommand } from '../../../features/diagnostics/cli/DiagnoseCommand';
import { cable, device, hasControlCharacters, port } from './fixtures';

function topology(hostname = 'SW1') {
  const a = device('d1', hostname, [port('1', 'GE0/0/1', { enabled: false })]);
  const b = device('d2', 'SW2', [port('2', 'GE0/0/2')]);
  return { a, b, devices: [a, b], cables: [cable('c1', ['d1', '1'], ['d2', '2'])] };
}

describe('DiagnoseCommand', () => {
  it('matches the exact command word only', () => {
    const command = new DiagnoseCommand();
    expect(command.canHandle({ normalizedCommand: 'diagnose' })).toBe(true);
    expect(command.canHandle({ normalizedCommand: '  DIAGNOSE now' })).toBe(true);
    expect(command.canHandle({ normalizedCommand: 'diagnosefoo' })).toBe(false);
    expect(command.canHandle({ normalizedCommand: 'display diagnose' })).toBe(false);
    expect(command.canHandle({ normalizedCommand: '' })).toBe(false);
  });

  it('takes no arguments', () => {
    const command = new DiagnoseCommand();
    expect(command.validate({ normalizedCommand: 'diagnose' })).toEqual({ valid: true });
    expect(command.validate({ normalizedCommand: 'diagnose now' })).toEqual({
      valid: false,
      error: 'Error: diagnose takes no arguments',
    });
  });

  it('is available for every vendor and in every view', () => {
    const command = new DiagnoseCommand();
    expect(command.vendor).toBeNull();
    expect(command.requiredView).toBeUndefined();
  });

  it('prints a summary and the findings without modifying any device', () => {
    const { devices, cables } = topology();
    const before = JSON.stringify(devices);
    const result = new DiagnoseCommand().execute({ devices, cables });

    expect(result.output[0]).toBe(
      'Topology diagnosis: 2 device(s), 1 link(s), 1 finding(s) [critical 0, warning 1, info 0]',
    );
    expect(result.output.join('\n')).toContain('SW1:GE0/0/1 has a cable attached but is shut down.');
    expect(result.device).toBeUndefined();
    expect(result.deviceUpdates).toBeUndefined();
    expect(JSON.stringify(devices)).toBe(before);
  });

  it('gives the same output for the same topology', () => {
    const { devices, cables } = topology();
    const command = new DiagnoseCommand();
    expect(command.execute({ devices, cables }).output).toEqual(command.execute({ devices, cables }).output);
  });

  it('refuses to run when the injected policy disallows it', () => {
    const { devices, cables } = topology();
    const result = new DiagnoseCommand(() => false).execute({ devices, cables });
    expect(result.output).toEqual(['Error: topology diagnosis is not available during an exam']);
  });

  it('never echoes control characters from device names', () => {
    const { devices, cables } = topology('SW\u001b[2J1\r\nfake prompt>');
    const output = new DiagnoseCommand().execute({ devices, cables }).output;
    expect(output.some(hasControlCharacters)).toBe(false);
    expect(output.join('\n')).toContain('SW[2J1fake prompt>:GE0/0/1');
  });

  it('keeps a long report inside one console page', () => {
    const cables = Array.from({ length: 40 }, (_, index) => cable(`c${index}`, ['gone', 'x'], ['gone', 'y']));
    const output = new DiagnoseCommand().execute({ devices: [], cables }).output;
    expect(output).toHaveLength(1 + CLI_MAX_FINDINGS * 3 + 1);
    expect(output.length).toBeLessThanOrEqual(49);
    expect(output[output.length - 1]).toContain('25 more finding(s)');
  });
});
