import { Component, ChangeDetectionStrategy } from '@angular/core';
import { TransactionFormService } from '../../services/transaction-form.service';
import { IconComponent } from '../icon/icon.component';

@Component({
    selector: 'app-fab',
    imports: [IconComponent],
    templateUrl: './fab.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./fab.component.scss']
})
export class FabComponent {
  constructor(private formSvc: TransactionFormService) {}
  open() { this.formSvc.openCreate(); }
}
