import { Component, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TransactionFormService } from '../../services/transaction-form.service';

@Component({
    selector: 'app-fab',
    imports: [MatIconModule],
    templateUrl: './fab.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./fab.component.scss']
})
export class FabComponent {
  constructor(private formSvc: TransactionFormService) {}
  open() { this.formSvc.openCreate(); }
}
