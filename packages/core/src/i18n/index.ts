import en from './en.ts';
import es from './es.ts';
import type { TLLocale } from './types.ts';

export type { TLLocale } from './types.ts';
export { getMessage } from './types.ts';
export { en, es };

const LOCALES: Record<string, TLLocale> = { en, es };

export function getLocale(id: string): TLLocale {
  return LOCALES[id] ?? en;
}
