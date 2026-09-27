import { ChangeDetectionStrategy, Component } from '@angular/core';
import { OAuthService } from 'angular-oauth2-oidc';
import { IconComponent } from '../../core/ui/icon/icon.component';

/**
 * Shown when the api refuses a request with 403 — a valid Authentik login, but not the
 * account configured as OWNER_SUB on the server (see api/src/auth/jwt.strategy.ts). Reached
 * only through authInterceptor's 403 handling (auth.interceptor.ts), which navigates here.
 */
@Component({
  selector: 'app-not-allowed',
  imports: [IconComponent],
  templateUrl: './not-allowed.component.html',
  styleUrls: ['./not-allowed.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class NotAllowedComponent {
  copied = false;
  private copiedTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly oauthService: OAuthService) {}

  private get claims(): Record<string, unknown> {
    return (this.oauthService.getIdentityClaims() as Record<string, unknown>) ?? {};
  }

  get displayName(): string {
    return (this.claims['name'] as string) || (this.claims['email'] as string) || 'unknown account';
  }

  get sub(): string {
    return (this.claims['sub'] as string) || '';
  }

  copySub(input: HTMLInputElement): void {
    // No clipboard api (an insecure context, an older browser) or the write was refused
    // (permissions): focus the field and select its value instead, so the id is ready for a
    // manual copy (Ctrl+C, or the phone's own copy menu) rather than the click doing nothing.
    const selectForManualCopy = () => {
      input.focus();
      input.select();
    };
    if (!navigator.clipboard?.writeText) {
      selectForManualCopy();
      return;
    }
    navigator.clipboard.writeText(this.sub).then(
      () => {
        this.copied = true;
        clearTimeout(this.copiedTimer);
        this.copiedTimer = setTimeout(() => { this.copied = false; }, 2000);
      },
      selectForManualCopy,
    );
  }

  logOut(): void {
    this.oauthService.logOut();
  }
}
