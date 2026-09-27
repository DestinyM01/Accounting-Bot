import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ICONS } from './icons';

/**
 * Renders one bundled Tabler outline icon by name. The SVG markup comes only from our own
 * bundle (see icons.ts), so trusting it via bypassSecurityTrustHtml is safe: nothing here is
 * ever built from user or api input.
 *
 * The SafeHtml wrapper is cached per icon name (module-level, shared by every instance).
 * DomSanitizer.bypassSecurityTrustHtml() returns a NEW wrapper object on every call, and
 * [innerHTML] rewrites the DOM whenever the bound object's identity changes — even when the
 * markup is identical. A `get svg()` recomputed on every change-detection pass therefore
 * rewrote innerHTML every tick: it detached the actual <svg> node on every check (closing a
 * menu the instant its glyph was clicked, since the click landed on a node Angular had already
 * thrown away), and it fed Chart.js's document-level MutationObserver a mutation on every tick,
 * which re-entered Angular's zone and triggered another change-detection pass — an infinite
 * loop that froze any page with a chart. Resolving once per name, on `name` set, and reusing
 * the cached SafeHtml on every later check keeps the bound object's identity stable.
 */
const SVG_CACHE = new Map<string, SafeHtml>();

@Component({
  selector: 'app-icon',
  standalone: true,
  template: `<span class="icon" [innerHTML]="safeSvg" aria-hidden="true"></span>`,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: inherit;
        /* A plain CSS rule from an ancestor (e.g. ".fc-btn app-icon { width: 16px }")
           can still override this: it targets the width/height properties directly,
           which beats this :host rule's var() on equal-or-higher specificity. The
           [size] input only sets the variable used by the fallback below. */
        width: var(--icon-size, 18px);
        height: var(--icon-size, 18px);
      }
      .icon {
        display: inline-flex;
        width: 100%;
        height: 100%;
      }
      .icon ::ng-deep svg {
        width: 100%;
        height: 100%;
        stroke: currentColor;
        stroke-width: 1.75;
      }
    `,
  ],
  host: {
    '[style.--icon-size.px]': 'size',
  },
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class IconComponent {
  /** Icon box size in pixels, both width and height. Can be overridden by CSS on app-icon. */
  @Input() size = 18;

  /** The resolved, cached SafeHtml for the current `name` — computed once per name, not per check. */
  safeSvg: SafeHtml;

  constructor(private readonly sanitizer: DomSanitizer) {
    this.safeSvg = this.resolve('bulb');
  }

  /** A Tabler icon name from icons.ts (e.g. 'plus', 'home'). Unknown names fall back to 'bulb'. */
  @Input()
  set name(value: string) {
    this.safeSvg = this.resolve(value);
  }

  private resolve(name: string): SafeHtml {
    const key = Object.hasOwn(ICONS, name) ? name : 'bulb';
    let cached = SVG_CACHE.get(key);
    if (!cached) {
      cached = this.sanitizer.bypassSecurityTrustHtml(ICONS[key]);
      SVG_CACHE.set(key, cached);
    }
    return cached;
  }
}
