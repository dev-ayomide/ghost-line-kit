// Store key builders and record types for the app. All keys start with "oja:".
import type { Lang } from './copy.ts';

export interface LangRecord {
  v: 1;
  lang: Lang;
}

export type FlowName = 'price' | 'report' | 'book' | 'reminders' | 'language';

export interface FlowRecord {
  v: 1;
  flow: FlowName;
  path: string[];
  data: Record<string, string>;
  /** Expiry, epoch ms. */
  exp: number;
}

export interface RepRecord {
  v: 1;
  today: { day: string; count: number };
  reports: { key: string; id: number }[];
}

export interface PxLastRecord {
  v: 1;
  day: string;
}

export interface SeedRecord {
  v: 1;
  day: string;
}

export const langKey = (phone: string): string => `oja:lang:${phone}`;
export const bookKey = (phone: string): string => `oja:book:${phone}`;
export const flowKey = (phone: string): string => `oja:flow:${phone}`;
export const remKey = (phone: string): string => `oja:rem:${phone}`;
export const repKey = (phone: string): string => `oja:rep:${phone}`;
export const REM_INDEX_KEY = 'oja:rem-index';
export const SEED_KEY = 'oja:seed';
export const pxKey = (market: string, commodity: string, day: string): string =>
  `oja:px:${market}:${commodity}:${day}`;
export const pxLastKey = (market: string, commodity: string): string =>
  `oja:pxlast:${market}:${commodity}`;
