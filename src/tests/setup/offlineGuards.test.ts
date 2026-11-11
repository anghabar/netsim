import { describe, expect, it } from 'vitest';
import * as wasmBridge from '../../wasm/wasmBridge';
import {
  BLOCKED_GLOBAL_APIS,
  BLOCKED_NETWORK_APIS,
  NETWORK_DISABLED_MESSAGE,
  installNetworkGuard
} from './networkGuard';
import { createWasmBridgeStub } from './wasmBridgeStub';

function readFunction(target: object, property: string): (...args: never[]) => unknown {
  const candidate: unknown = Reflect.get(target, property);
  if (typeof candidate !== 'function') {
    throw new Error(`${property} is not installed`);
  }
  return () => Reflect.apply(candidate, undefined, []);
}

function readConstructor(target: object, property: string): () => unknown {
  const candidate: unknown = Reflect.get(target, property);
  if (typeof candidate !== 'function') {
    throw new Error(`${property} is not installed`);
  }
  return () => Reflect.construct(candidate, []);
}

describe('network APIs in the test environment', () => {
  it('blocks fetch synchronously', () => {
    expect(() => fetch('https://example.com/')).toThrow(NETWORK_DISABLED_MESSAGE);
  });

  it('names the blocked API in the error', () => {
    expect(() => fetch('https://example.com/')).toThrow('fetch');
  });

  it('blocks XMLHttpRequest', () => {
    expect(() => new XMLHttpRequest()).toThrow(NETWORK_DISABLED_MESSAGE);
  });

  it('blocks WebSocket', () => {
    expect(() => new WebSocket('wss://example.com/socket')).toThrow(NETWORK_DISABLED_MESSAGE);
  });

  it('blocks EventSource', () => {
    expect(() => new EventSource('https://example.com/events')).toThrow(NETWORK_DISABLED_MESSAGE);
  });

  it('blocks navigator.sendBeacon', () => {
    expect(() => navigator.sendBeacon('https://example.com/collect', 'ping')).toThrow('navigator.sendBeacon');
  });
});

describe('installNetworkGuard', () => {
  it('lists every API it covers', () => {
    expect([...BLOCKED_NETWORK_APIS]).toEqual([
      'fetch',
      'XMLHttpRequest',
      'WebSocket',
      'EventSource',
      'navigator.sendBeacon'
    ]);
  });

  it('installs blockers that throw when called and when constructed', () => {
    const target: object = {};
    installNetworkGuard(target);

    for (const api of BLOCKED_GLOBAL_APIS) {
      expect(readFunction(target, api)).toThrow(NETWORK_DISABLED_MESSAGE);
      expect(readConstructor(target, api)).toThrow(NETWORK_DISABLED_MESSAGE);
    }

    const installedNavigator: unknown = Reflect.get(target, 'navigator');
    expect(typeof installedNavigator).toBe('object');
    expect(installedNavigator).not.toBeNull();
    if (typeof installedNavigator === 'object' && installedNavigator !== null) {
      expect(readFunction(installedNavigator, 'sendBeacon')).toThrow('navigator.sendBeacon');
    }
  });

  it('keeps an existing navigator object and only shadows sendBeacon', () => {
    const existingNavigator = { userAgent: 'example-agent' };
    const target = { navigator: existingNavigator };

    installNetworkGuard(target);

    expect(target.navigator).toBe(existingNavigator);
    expect(existingNavigator.userAgent).toBe('example-agent');
    expect(readFunction(existingNavigator, 'sendBeacon')).toThrow(NETWORK_DISABLED_MESSAGE);
  });

  it('replaces a navigator object that cannot be extended', () => {
    const frozenNavigator = Object.freeze({ userAgent: 'example-agent' });
    const target: object = { navigator: frozenNavigator };

    installNetworkGuard(target);

    const installedNavigator: unknown = Reflect.get(target, 'navigator');
    expect(installedNavigator).not.toBe(frozenNavigator);
    if (typeof installedNavigator === 'object' && installedNavigator !== null) {
      expect(readFunction(installedNavigator, 'sendBeacon')).toThrow(NETWORK_DISABLED_MESSAGE);
    } else {
      throw new Error('navigator was not replaced');
    }
  });

  it('can be installed twice and refuses a target it cannot guard', () => {
    const target: object = {};
    installNetworkGuard(target);
    expect(() => installNetworkGuard(target)).not.toThrow();

    expect(() => installNetworkGuard(Object.freeze({}))).toThrow('Could not install the offline guard');
  });
});

describe('WebAssembly bridge stub', () => {
  it('replaces the bridge with inert functions', async () => {
    await expect(wasmBridge.initWasm()).resolves.toBeUndefined();
    expect(wasmBridge.wasmSetTopology([], [])).toBeUndefined();
    expect(wasmBridge.wasmGetDevices()).toEqual([]);
    expect(wasmBridge.wasmExecuteCommand('device-1', 'display version')).toEqual({
      success: false,
      output: ''
    });
    expect(wasmBridge.wasmPing('192.0.2.1')).toBe('');
  });

  it('exposes exactly the export names of the bridge', () => {
    expect(Object.keys(createWasmBridgeStub()).sort()).toEqual([
      'initWasm',
      'wasmExecuteCommand',
      'wasmGetDevices',
      'wasmPing',
      'wasmSetTopology'
    ]);
  });
});
