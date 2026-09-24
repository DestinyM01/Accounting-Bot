import { Category } from '../shared/schemas/category.enum';

/** Names custom categories may never take. */
export const BUILT_IN_NAMES: readonly string[] = Object.values(Category);

/** The colours the bot offered, in its order. */
export const PALETTE: readonly { label: string; hex: string }[] = [
  { label: 'Red', hex: '#ef4444' },
  { label: 'Orange', hex: '#fb923c' },
  { label: 'Yellow', hex: '#eab308' },
  { label: 'Green', hex: '#22c55e' },
  { label: 'Blue', hex: '#3b82f6' },
  { label: 'Purple', hex: '#a855f7' },
  { label: 'Pink', hex: '#ec4899' },
  { label: 'Cyan', hex: '#06b6d4' },
  { label: 'Dark', hex: '#374151' },
  { label: 'Light', hex: '#94a3b8' },
];

/** The emoji the bot offered, in its order. */
export const EMOJIS: readonly string[] = [
  '✈️', '💪', '🏋️', '🎓', '🐶', '🐱', '🛒', '📱', '💇', '🎁',
  '⚡', '🌿', '🎨', '🎵', '🏖️', '🍕', '☕', '🛞', '📚', '🎯',
];

/** Lowercase letters of any alphabet (educación, niños), digits and hyphens; 1–20 characters. */
export const NAME_PATTERN = /^[\p{Ll}0-9-]{1,20}$/u;

export function normalizeName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/** Why a (normalized) name can't be used, or null when it can. */
export function nameError(name: string): string | null {
  if (!NAME_PATTERN.test(name)) return 'Use 1–20 lowercase letters, digits or hyphens';
  if (BUILT_IN_NAMES.includes(name)) return `${name} is a built-in category`;
  return null;
}

export function isPaletteColor(hex: unknown): boolean {
  return PALETTE.some((p) => p.hex === hex);
}

export function isKnownEmoji(emoji: unknown): boolean {
  return typeof emoji === 'string' && EMOJIS.includes(emoji);
}
