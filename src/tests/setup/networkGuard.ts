/**
 * Offline guard for the test run.
 *
 * The simulator promises that nothing leaves the machine, so the test suites
 * must be able to prove it: every browser networking entry point is replaced
 * by a function that throws as soon as it is called or constructed.
 *
 * The replacements throw synchronously (they do not return a rejected
 * promise), so a test asserts the behaviour with:
 *
 *   expect(() => fetch('https://example.com/')).toThrow('network disabled in tests');
 */

export const NETWORK_DISABLED_MESSAGE = 'network disabled in tests';

/** Global constructors and functions replaced by the guard. */
export const BLOCKED_GLOBAL_APIS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'] as const;

/** Every API covered by the guard, as reported in the error message. */
export const BLOCKED_NETWORK_APIS = [...BLOCKED_GLOBAL_APIS, 'navigator.sendBeacon'] as const;

const SEND_BEACON_API = 'navigator.sendBeacon';

export class NetworkDisabledError extends Error {
  readonly api: string;

  constructor(api: string) {
    super(`${NETWORK_DISABLED_MESSAGE}: ${api} was used`);
    this.name = 'NetworkDisabledError';
    this.api = api;
  }
}

/**
 * Returns a regular function (not an arrow function) so that it throws the
 * same clear error whether it is called or used with `new`.
 */
function createBlocker(api: string): () => never {
  return function blockedNetworkApi(): never {
    throw new NetworkDisabledError(api);
  };
}

function defineBlocker(target: object, property: string, api: string): boolean {
  return Reflect.defineProperty(target, property, {
    value: createBlocker(api),
    configurable: true,
    enumerable: false,
    writable: true
  });
}

function installSendBeaconGuard(target: object): void {
  const current: unknown = Reflect.get(target, 'navigator');

  // Keep an existing navigator object and only shadow sendBeacon on it.
  if (typeof current === 'object' && current !== null && defineBlocker(current, 'sendBeacon', SEND_BEACON_API)) {
    return;
  }

  // No navigator, or one that cannot be extended: provide a minimal one.
  const replacement: object = {};
  const installed =
    defineBlocker(replacement, 'sendBeacon', SEND_BEACON_API) &&
    Reflect.defineProperty(target, 'navigator', {
      value: replacement,
      configurable: true,
      enumerable: true,
      writable: true
    });

  if (!installed) {
    throw new Error(`Could not install the offline guard for ${SEND_BEACON_API}`);
  }
}

/**
 * Installs the guard on `target` (the global object by default). Safe to call
 * more than once. Throws when a blocker cannot be installed, so a test run
 * never continues with a working network API.
 */
export function installNetworkGuard(target: object = globalThis): void {
  for (const api of BLOCKED_GLOBAL_APIS) {
    if (!defineBlocker(target, api, api)) {
      throw new Error(`Could not install the offline guard for ${api}`);
    }
  }
  installSendBeaconGuard(target);
}
