/**
 * Shared "is this change good or bad, and which way did it move" logic for any
 * tile that shows a signed change against a baseline (vs last month, vs another
 * period). Used by Dashboard, Compare and Statistics.
 */

/** `upIsGood` is whether a positive delta counts as good (more income) or bad (more expense). */
export function changeTone(delta: number, upIsGood: boolean): 'pos' | 'neg' | 'neutral' {
  if (delta === 0) return 'neutral';
  const up = upIsGood ? 'pos' : 'neg';
  const down = upIsGood ? 'neg' : 'pos';
  return delta > 0 ? up : down;
}

/** The arrow reflects only the sign of the change itself, never which tone it renders in. */
export function changeArrow(delta: number): string {
  return delta > 0 ? '↑ ' : delta < 0 ? '↓ ' : '';
}
