import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { TransactionsService, TransactionPage } from './transactions.service';

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  findAll(
    @Query('limit')     limit?: string,
    @Query('offset')    offset?: string,
    @Query('type')      type?: 'income' | 'expense',
    @Query('category')  category?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate')   endDate?: string,
  ): Promise<TransactionPage> {
    return this.transactionsService.findAll({
      limit:     limit  ? parseInt(limit, 10)  : undefined,
      offset:    offset ? parseInt(offset, 10) : undefined,
      type,
      category,
      startDate,
      endDate,
    });
  }

  @Get('export')
  async exportCsv(
    @Query('type')      type: string,
    @Query('category')  category: string,
    @Query('startDate') startDate: string,
    @Query('endDate')   endDate: string,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.transactionsService.exportCsv({
      type:      (type      || undefined) as 'income' | 'expense' | undefined,
      category:  category  || undefined,
      startDate: startDate || undefined,
      endDate:   endDate   || undefined,
    });
    const filename = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
