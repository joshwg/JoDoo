// Device-local text appearance for task/shopping item text (not the rest of
// the UI). Backed by the same settings key/value table as other device-local
// prefs (e.g. server config); never synced between devices.
import { useEffect, useState } from 'react';
import { getSetting, setSetting } from './db';

/** 'System' means no fontFamily override (platform default). */
export const FONT_FAMILY_OPTIONS = [
  'System',
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Courier New',
] as const;
export type FontFamilyOption = (typeof FONT_FAMILY_OPTIONS)[number];

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 36;

const FONT_FAMILY_SETTING = 'text_font_family';
const FONT_SIZE_SETTING = 'text_font_size';

const DEFAULT_FONT_FAMILY: FontFamilyOption = 'System';
const DEFAULT_FONT_SIZE = 16;

function clampFontSize(size: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function getFontFamily(): FontFamilyOption {
  const v = getSetting(FONT_FAMILY_SETTING);
  return (FONT_FAMILY_OPTIONS as readonly string[]).includes(v ?? '')
    ? (v as FontFamilyOption)
    : DEFAULT_FONT_FAMILY;
}

export function getFontSize(): number {
  const v = Number(getSetting(FONT_SIZE_SETTING));
  return Number.isFinite(v) && v > 0 ? clampFontSize(v) : DEFAULT_FONT_SIZE;
}

export function setFontFamily(family: FontFamilyOption): void {
  setSetting(FONT_FAMILY_SETTING, family);
  listeners.forEach((fn) => fn());
}

export function setFontSize(size: number): void {
  setSetting(FONT_SIZE_SETTING, String(clampFontSize(size)));
  listeners.forEach((fn) => fn());
}

/** RN's `fontFamily` style value: undefined lets the platform default apply. */
export function fontFamilyStyle(family: FontFamilyOption): string | undefined {
  return family === 'System' ? undefined : family;
}

/** Live-updating text settings for components that render task/shopping item
 *  text; re-renders whenever the settings change (e.g. from FontSettingsModal). */
export function useTextSettings(): { fontFamily: string | undefined; fontSize: number } {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return { fontFamily: fontFamilyStyle(getFontFamily()), fontSize: getFontSize() };
}
