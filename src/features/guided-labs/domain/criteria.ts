import type { NetworkCable, NetworkDevice } from '../../../types/NetworkTypes';
import { buildNetworkView, type NetworkView } from './network';
import type { Criterion, CriterionResult, GuidedLab, LabCheckResult, TaskResult } from './types';

const pass = (criterion: Criterion): CriterionResult => ({ criterion, pass: true, detail: '' });
const miss = (criterion: Criterion, detail: string): CriterionResult => ({ criterion, pass: false, detail });

/** Evaluates one criterion against the derived network state. */
export function evaluateCriterion(criterion: Criterion, view: NetworkView): CriterionResult {
  const named = (name: string): NetworkDevice | undefined => view.deviceByName(name);
  switch (criterion.type) {
    case 'vlan-exists': {
      const d = named(criterion.device);
      if (!d) return miss(criterion, `${criterion.device} was not found.`);
      return criterion.vlan === 1 || d.vlans.includes(criterion.vlan)
        ? pass(criterion)
        : miss(criterion, `${d.hostname} has no VLAN ${criterion.vlan}.`);
    }
    case 'port-access-vlan': {
      const d = named(criterion.device);
      const p = d ? view.portByName(d, criterion.port) : undefined;
      if (!d || !p) return miss(criterion, `${criterion.device}:${criterion.port} was not found.`);
      if (p.config.mode !== 'access') return miss(criterion, `${p.name} on ${d.hostname} is not an access port.`);
      const actual = p.config.vlan ?? 1;
      return actual === criterion.vlan
        ? pass(criterion)
        : miss(criterion, `${p.name} on ${d.hostname} is in VLAN ${actual}.`);
    }
    case 'trunk-allows': {
      const d = named(criterion.device);
      const p = d ? view.portByName(d, criterion.port) : undefined;
      if (!d || !p) return miss(criterion, `${criterion.device}:${criterion.port} was not found.`);
      if (p.config.mode !== 'trunk' && p.config.mode !== 'hybrid') {
        return miss(criterion, `${p.name} on ${d.hostname} is not a trunk port.`);
      }
      const allowed = p.config.allowedVlans ?? [];
      return allowed.includes(criterion.vlan) || (p.config.vlan ?? 1) === criterion.vlan
        ? pass(criterion)
        : miss(criterion, `${p.name} on ${d.hostname} does not carry VLAN ${criterion.vlan}.`);
    }
    case 'l2-reachable': {
      const a = named(criterion.a);
      const b = named(criterion.b);
      if (!a || !b) return miss(criterion, 'A device of this check was not found.');
      const reachable = view.l2Reachable(a, b);
      return reachable === criterion.expected
        ? pass(criterion)
        : miss(
            criterion,
            reachable
              ? `${a.hostname} and ${b.hostname} can reach each other, but should not.`
              : `${a.hostname} cannot reach ${b.hostname} at layer 2.`,
          );
    }
    case 'stp-enabled': {
      const d = named(criterion.device);
      if (!d) return miss(criterion, `${criterion.device} was not found.`);
      return d.stpEnabled === true ? pass(criterion) : miss(criterion, `Spanning tree is off on ${d.hostname}.`);
    }
    case 'stp-root': {
      const d = named(criterion.device);
      if (!d) return miss(criterion, `${criterion.device} was not found.`);
      if (view.stpRoots.length === 0) return miss(criterion, 'No switch has spanning tree enabled yet.');
      return view.stpRoots.length === 1 && view.stpRoots[0] === d.hostname
        ? pass(criterion)
        : miss(criterion, `The root bridge is ${view.stpRoots.join(', ')}.`);
    }
    case 'stp-blocked-ports':
      return view.blockedPorts.length === criterion.count
        ? pass(criterion)
        : miss(
            criterion,
            `${view.blockedPorts.length} port(s) are blocked by spanning tree; expected ${criterion.count}.`,
          );
    case 'ospf-enabled': {
      const d = named(criterion.device);
      if (!d) return miss(criterion, `${criterion.device} was not found.`);
      return d.ospfEnabled === true ? pass(criterion) : miss(criterion, `OSPF is not enabled on ${d.hostname}.`);
    }
    case 'ospf-adjacency': {
      const a = named(criterion.a);
      const b = named(criterion.b);
      if (!a || !b) return miss(criterion, 'A device of this check was not found.');
      return view.ospfAdjacent(a, b)
        ? pass(criterion)
        : miss(criterion, `${a.hostname} and ${b.hostname} are not OSPF neighbours.`);
    }
    case 'ospf-route': {
      const d = named(criterion.device);
      if (!d) return miss(criterion, `${criterion.device} was not found.`);
      return view.ospfLearned(d).has(criterion.prefix)
        ? pass(criterion)
        : miss(criterion, `${d.hostname} has not learned ${criterion.prefix} through OSPF.`);
    }
  }
}

/** Checks every task of a lab against the current topology. */
export function evaluateLab(
  lab: GuidedLab,
  devices: readonly NetworkDevice[],
  cables: readonly NetworkCable[],
): LabCheckResult {
  const view = buildNetworkView(devices, cables);
  const tasks: TaskResult[] = lab.tasks.map((task) => {
    const results = task.criteria.map((criterion) => evaluateCriterion(criterion, view));
    return { taskId: task.id, pass: results.every((r) => r.pass), results };
  });
  return { labId: lab.id, pass: tasks.every((t) => t.pass), tasks };
}
