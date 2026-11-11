/** Guards and bounded readers for values that enter the app from storage, files or pasted text. */

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Plain objects only: arrays, null and class instances are rejected. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const own = (rec: Record<string, unknown>, field: string): unknown =>
  Object.prototype.hasOwnProperty.call(rec, field) ? rec[field] : undefined;

export function readString(
  rec: Record<string, unknown>,
  field: string,
  options: { maxLength: number; minLength?: number; pattern?: RegExp },
): string | undefined {
  const value = own(rec, field);
  if (typeof value !== 'string') return undefined;
  if (value.length > options.maxLength || value.length < (options.minLength ?? 0)) return undefined;
  if (options.pattern && !options.pattern.test(value)) return undefined;
  return value;
}

export function readNumber(
  rec: Record<string, unknown>,
  field: string,
  options: { min: number; max: number; integer?: boolean },
): number | undefined {
  const value = own(rec, field);
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value < options.min || value > options.max) return undefined;
  if (options.integer === true && !Number.isInteger(value)) return undefined;
  return value;
}

export function readBoolean(rec: Record<string, unknown>, field: string): boolean | undefined {
  const value = own(rec, field);
  return typeof value === 'boolean' ? value : undefined;
}

export function readEnum<T extends string>(
  rec: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T | undefined {
  const value = own(rec, field);
  return allowed.find((candidate) => candidate === value);
}

export function readArray(
  rec: Record<string, unknown>,
  field: string,
  options: { maxItems: number },
): unknown[] | undefined {
  const value = own(rec, field);
  if (!Array.isArray(value) || value.length > options.maxItems) return undefined;
  const items: readonly unknown[] = value;
  return items.slice();
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [name: string]: JsonValue };

export interface PlainJsonLimits {
  /** Maximum number of nested containers (objects or arrays). */
  maxDepth: number;
  /** Maximum number of values visited, containers included. */
  maxNodes: number;
  maxStringLength: number;
}

export type PlainJsonError = 'too-deep' | 'too-large' | 'string-too-long' | 'unsupported-value';

const UNSAFE_NAMES: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Bounded deep copy made only of JSON-safe data. Prototype-related names are
 * dropped, every object is a fresh literal, and anything that is not plain
 * data (functions, class instances, non-finite numbers) is rejected.
 */
export function toPlainJson(value: unknown, limits: PlainJsonLimits): Result<JsonValue, PlainJsonError> {
  let nodes = 0;
  const copy = (input: unknown, depth: number): Result<JsonValue, PlainJsonError> => {
    nodes += 1;
    if (nodes > limits.maxNodes) return err('too-large');
    if (input === null || typeof input === 'boolean') return ok(input);
    if (typeof input === 'number') return Number.isFinite(input) ? ok(input) : err('unsupported-value');
    if (typeof input === 'string') {
      return input.length <= limits.maxStringLength ? ok(input) : err('string-too-long');
    }
    if (typeof input !== 'object') return err('unsupported-value');
    if (depth >= limits.maxDepth) return err('too-deep');

    if (Array.isArray(input)) {
      const items: readonly unknown[] = input;
      if (items.length > limits.maxNodes - nodes) return err('too-large');
      const out: JsonValue[] = [];
      for (const item of items) {
        // Same convention as JSON.stringify: holes and undefined become null.
        const copied = copy(item === undefined ? null : item, depth + 1);
        if (!copied.ok) return copied;
        out.push(copied.value);
      }
      return ok(out);
    }

    if (!isRecord(input)) return err('unsupported-value');
    const out: { [name: string]: JsonValue } = {};
    for (const name of Object.keys(input)) {
      if (UNSAFE_NAMES.has(name)) continue;
      if (name.length > limits.maxStringLength) return err('string-too-long');
      const item = input[name];
      if (item === undefined) continue;
      const copied = copy(item, depth + 1);
      if (!copied.ok) return copied;
      out[name] = copied.value;
    }
    return ok(out);
  };
  return copy(value, 0);
}

/** UTF-8 size of a string without allocating an encoded copy. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

export type JsonTextError = 'too-large' | 'invalid-json';

/** Size check first, then JSON.parse; never throws. The result is still untrusted. */
export function parseJsonText(text: string, limits: { maxBytes: number }): Result<unknown, JsonTextError> {
  if (text.length > limits.maxBytes || utf8ByteLength(text) > limits.maxBytes) return err('too-large');
  try {
    const parsed: unknown = JSON.parse(text);
    return ok(parsed);
  } catch {
    return err('invalid-json');
  }
}
