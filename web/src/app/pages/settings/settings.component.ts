import { Component, ChangeDetectionStrategy } from '@angular/core';
import { MailSectionComponent } from './mail-section/mail-section.component';
import { ReportsSectionComponent } from './reports-section/reports-section.component';
import { AccountsSectionComponent } from './accounts-section/accounts-section.component';

/** Bank mail, email reports and the user's own accounts. Each section loads and saves on its own. */
@Component({
    selector: 'app-settings',
    imports: [MailSectionComponent, ReportsSectionComponent, AccountsSectionComponent],
    templateUrl: './settings.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./settings.component.scss']
})
export class SettingsComponent {}
