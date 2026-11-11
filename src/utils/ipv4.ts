/** Strict IPv4 helpers on unsigned 32-bit numbers; arithmetic avoids signed shift pitfalls. */

const OCTET = /^(0|[1-9]\d{0,2})$/;

/** A mask given as a prefix length (0..32) or in dotted notation. */
export type MaskInput = number | string;

export function parseIpv4(text: string): number | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!OCTET.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function formatIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

const isPrefixLength = (value: number): boolean => Number.isInteger(value) && value >= 0 && value <= 32;

const maskValue = (prefix: number): number => (prefix === 0 ? 0 : 2 ** 32 - 2 ** (32 - prefix));

export function maskToPrefix(mask: string): number | null {
  const value = parseIpv4(mask);
  if (value === null) return null;
  for (let prefix = 0; prefix <= 32; prefix += 1) {
    if (maskValue(prefix) === value) return prefix;
  }
  return null;
}

export function isValidMask(text: string): boolean {
  return maskToPrefix(text) !== null;
}

export function prefixToMask(prefix: number): string | null {
  return isPrefixLength(prefix) ? formatIpv4(maskValue(prefix)) : null;
}

function toPrefix(mask: MaskInput): number | null {
  if (typeof mask === 'number') return isPrefixLength(mask) ? mask : null;
  return maskToPrefix(mask);
}

export function networkOf(ip: string, mask: MaskInput): string | null {
  const address = parseIpv4(ip);
  const prefix = toPrefix(mask);
  if (address === null || prefix === null) return null;
  const block = 2 ** (32 - prefix);
  return formatIpv4(Math.floor(address / block) * block);
}

export function sameSubnet(a: string, b: string, mask: MaskInput): boolean {
  const network = networkOf(a, mask);
  return network !== null && network === networkOf(b, mask);
}
