/** Injectable sources of time, identifiers and randomness. Domain code receives these instead of calling globals. */
export type Clock = () => number;
export type IdSource = () => string;
export type RandomSource = () => number;

export const systemClock: Clock = () => Date.now();

export const mathRandomSource: RandomSource = () => Math.random();

export const cryptoIdSource: IdSource = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};
