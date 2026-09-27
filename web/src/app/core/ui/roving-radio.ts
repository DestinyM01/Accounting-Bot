/**
 * Arrow-key roving-tabindex behaviour for a `role="radiogroup"` of `.seg-opt`
 * buttons — the pattern shared by Settings → Appearance, the Transactions
 * type filter and needs-review/unitemized-style chips, the transaction form's
 * type toggle, and the Balance history filter.
 *
 * ArrowRight/ArrowDown move to the next option, ArrowLeft/ArrowUp to the
 * previous (both wrap around); Home/End jump to the first/last; Space/Enter
 * select the option currently focused. Selecting moves the DOM focus to the
 * newly-selected option's id too, so the roving tabindex and the actual
 * browser focus never drift apart.
 *
 * `select` and `idOf` take the option's index rather than its value so this
 * stays agnostic to whatever shape each caller's own option list has.
 */
export function rovingRadioKeydown(
  event: KeyboardEvent,
  index: number,
  count: number,
  select: (index: number) => void,
  idOf: (index: number) => string,
): void {
  const { key } = event;
  if (key === ' ' || key === 'Enter') {
    event.preventDefault();
    select(index);
    return;
  }

  let next: number;
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    next = (index + 1) % count;
  } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
    next = (index - 1 + count) % count;
  } else if (key === 'Home') {
    next = 0;
  } else if (key === 'End') {
    next = count - 1;
  } else {
    return;
  }

  event.preventDefault();
  select(next);
  setTimeout(() => document.getElementById(idOf(next))?.focus());
}
