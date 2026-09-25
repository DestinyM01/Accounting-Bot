import { Component } from '@angular/core';
import { MailSectionComponent } from './mail-section/mail-section.component';
import { ReportsSectionComponent } from './reports-section/reports-section.component';
import { AccountsSectionComponent } from './accounts-section/accounts-section.component';

/** Bank mail, email reports and the user's own accounts. Each section loads and saves on its own. */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [MailSectionComponent, ReportsSectionComponent, AccountsSectionComponent],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
})
export class SettingsComponent {}
