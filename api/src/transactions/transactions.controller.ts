import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { TransactionsService, TransactionPage, CreateTransactionBody, UpdateTransactionBody } from './transactions.service';

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  findAll(
    @Query('limit')       limit?: string,
    @Query('offset')      offset?: string,
    @Query('type')        type?: 'income' | 'expense',
    @Query('category')    category?: string,
    @Query('startDate')   startDate?: string,
    @Query('endDate')     endDate?: string,
    @Query('needsReview') needsReview?: string,
    @Query('transferKind') transferKind?: string,
  ): Promise<TransactionPage> {
    return this.transactionsService.findAll({
      limit:       limit  ? parseInt(limit, 10)  : undefined,
      offset:      offset ? parseInt(offset, 10) : undefined,
      type,
      category,
      startDate,
      endDate,
      needsReview: needsReview === 'true',
      transferKind,
    });
  }

  @Post()
  create(@Body() body: CreateTransactionBody) {
    return this.transactionsService.create(body);
  }

  @Put(':id')
  @HttpCode(204)
  async update(@Param('id') id: string, @Body() body: UpdateTransactionBody) {
    await this.transactionsService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.transactionsService.softDelete(id);
  }

  @Patch(':id/category')
  @HttpCode(204)
  async setCategory(@Param('id') id: string, @Body() body: { category: string }) {
    await this.transactionsService.setCategory(id, body.category);
  }

  @Patch(':id/transfer-kind')
  @HttpCode(204)
  async resolveTransfer(@Param('id') id: string, @Body() body: { kind: 'internal' | 'external' }) {
    await this.transactionsService.resolveTransfer(id, body.kind);
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
