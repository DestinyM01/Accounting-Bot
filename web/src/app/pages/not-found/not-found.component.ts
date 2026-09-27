import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../core/ui/icon/icon.component';

/** Shown for any URL that matches no route (the `**` route, last in app.routes.ts). */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink, IconComponent],
  templateUrl: './not-found.component.html',
  styleUrls: ['./not-found.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class NotFoundComponent {}
