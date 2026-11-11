import { describe, expect, it } from 'vitest';
import {
  isRecord,
  parseJsonText,
  readArray,
  readBoolean,
  readEnum,
  readNumber,
  readString,
  toPlainJson,
  utf8ByteLength,
} from '../../utils/guards';
import {
  formatIpv4,
  isValidMask,
  maskToPrefix,
  networkOf,
  parseIpv4,
  prefixToMask,
  sameSubnet,
} from '../../utils/ipv4';

const LIMITS = { maxDepth: 4, maxNodes: 50, maxStringLength: 16 };

const nest = (levels: number): unknown => {
  let value: unknown = 1;
  for (let i = 0; i < levels; i += 1) value = { child: value };
  return value;
};

describe('isRecord', () => {
  it('accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(new Date(0))).toBe(false);
    expect(isRecord(new Map())).toBe(false);
    expect(isRecord('text')).toBe(false);
  });
});

describe('toPlainJson', () => {
  it('drops prototype-related names and never pollutes Object.prototype', () => {
    const parsed: unknown = JSON.parse(
      '{"a":1,"__proto__":{"polluted":true},"nested":{"constructor":{"x":1},"prototype":2,"b":"ok"}}',
    );
    const result = toPlainJson(parsed, LIMITS);
    expect(result).toEqual({ ok: true, value: { a: 1, nested: { b: 'ok' } } });
    if (result.ok && isRecord(result.value)) {
      expect(Object.keys(result.value)).toEqual(['a', 'nested']);
    }
    expect(Reflect.get({}, 'polluted')).toBeUndefined();
  });

  it('enforces depth, node and string limits', () => {
    expect(toPlainJson(nest(4), LIMITS).ok).toBe(true);
    expect(toPlainJson(nest(5), LIMITS)).toEqual({ ok: false, error: 'too-deep' });
    expect(toPlainJson(new Array(60).fill(1), LIMITS)).toEqual({ ok: false, error: 'too-large' });
    expect(toPlainJson({ text: 'x'.repeat(17) }, LIMITS)).toEqual({ ok: false, error: 'string-too-long' });
  });

  it('rejects values that are not plain data', () => {
    expect(toPlainJson({ when: new Date(0) }, LIMITS)).toEqual({ ok: false, error: 'unsupported-value' });
    expect(toPlainJson({ run: () => 1 }, LIMITS)).toEqual({ ok: false, error: 'unsupported-value' });
    expect(toPlainJson(Number.NaN, LIMITS)).toEqual({ ok: false, error: 'unsupported-value' });
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(toPlainJson(loop, LIMITS).ok).toBe(false);
  });

  it('returns a copy, not the input', () => {
    const input = { list: [1, 2], inner: { flag: true } };
    const result = toPlainJson(input, LIMITS);
    expect(result).toEqual({ ok: true, value: input });
    if (result.ok) expect(result.value).not.toBe(input);
  });
});

describe('parseJsonText', () => {
  it('reports corrupt JSON instead of throwing', () => {
    expect(parseJsonText('{"a":', { maxBytes: 100 })).toEqual({ ok: false, error: 'invalid-json' });
  });

  it('checks the size in bytes before parsing', () => {
    expect(parseJsonText('"aaaaaaaaaa"', { maxBytes: 5 })).toEqual({ ok: false, error: 'too-large' });
    expect(utf8ByteLength('"ééé"')).toBe(8);
    expect(parseJsonText('"ééé"', { maxBytes: 7 })).toEqual({ ok: false, error: 'too-large' });
    expect(parseJsonText('{"a":[1,2]}', { maxBytes: 100 })).toEqual({ ok: true, value: { a: [1, 2] } });
  });
});

describe('bounded readers', () => {
  const rec: Record<string, unknown> = { name: 'core', count: 3, ratio: 0.5, kind: 'b', on: true, items: [1, 2, 3] };

  it('reads values inside the limits', () => {
    expect(readString(rec, 'name', { maxLength: 8, pattern: /^[a-z]+$/ })).toBe('core');
    expect(readNumber(rec, 'count', { min: 0, max: 10, integer: true })).toBe(3);
    expect(readBoolean(rec, 'on')).toBe(true);
    expect(readEnum(rec, 'kind', ['a', 'b'])).toBe('b');
    expect(readArray(rec, 'items', { maxItems: 3 })).toEqual([1, 2, 3]);
  });

  it('returns undefined for anything else', () => {
    expect(readString(rec, 'name', { maxLength: 3 })).toBeUndefined();
    expect(readString(rec, 'name', { maxLength: 8, minLength: 5 })).toBeUndefined();
    expect(readString(rec, 'toString', { maxLength: 99 })).toBeUndefined();
    expect(readNumber(rec, 'count', { min: 0, max: 2 })).toBeUndefined();
    expect(readNumber(rec, 'ratio', { min: 0, max: 1, integer: true })).toBeUndefined();
    expect(readBoolean(rec, 'name')).toBeUndefined();
    expect(readEnum(rec, 'kind', ['a', 'c'])).toBeUndefined();
    expect(readArray(rec, 'items', { maxItems: 2 })).toBeUndefined();
  });
});

describe('ipv4', () => {
  it('parses strict dotted decimal only', () => {
    expect(parseIpv4('192.0.2.1')).toBe(3221225985);
    expect(parseIpv4('192.0.2.01')).toBeNull();
    expect(parseIpv4('256.0.0.1')).toBeNull();
    expect(parseIpv4('192.0.2')).toBeNull();
    expect(formatIpv4(parseIpv4('203.0.113.255') ?? 0)).toBe('203.0.113.255');
  });

  it('converts masks and prefixes', () => {
    expect(maskToPrefix('255.255.255.0')).toBe(24);
    expect(maskToPrefix('0.0.0.0')).toBe(0);
    expect(isValidMask('255.0.255.0')).toBe(false);
    expect(prefixToMask(26)).toBe('255.255.255.192');
    expect(prefixToMask(33)).toBeNull();
  });

  it('computes networks for prefixes and dotted masks', () => {
    expect(networkOf('198.51.100.77', 26)).toBe('198.51.100.64');
    expect(networkOf('198.51.100.77', '255.255.255.0')).toBe('198.51.100.0');
    expect(networkOf('192.0.2.1', 0)).toBe('0.0.0.0');
    expect(networkOf('192.0.2.1', 32)).toBe('192.0.2.1');
    expect(networkOf('not-an-ip', 24)).toBeNull();
    expect(sameSubnet('192.0.2.10', '192.0.2.200', 24)).toBe(true);
    expect(sameSubnet('192.0.2.10', '192.0.2.200', 25)).toBe(false);
    expect(sameSubnet('192.0.2.10', 'bad', 24)).toBe(false);
  });
});
