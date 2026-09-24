import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TransactionFormService } from '../../services/transaction-form.service';

@Component({
  selector: 'app-fab',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './fab.component.html',
  styleUrls: ['./fab.component.scss'],
})
export class FabComponent {
  constructor(private formSvc: TransactionFormService) {}
  open() { this.formSvc.openCreate(); }
}
