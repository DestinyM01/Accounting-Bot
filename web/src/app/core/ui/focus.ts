/**
 * After the next render, focuses the first of these element ids that exists.
 * `alive` lets a component skip it once destroyed.
 */
export function focusFirst(ids: string[], alive: () => boolean = () => true): void {
  setTimeout(() => {
    if (!alive()) return;
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) {
        el.focus();
        return;
      }
    }
  }, 0);
}
