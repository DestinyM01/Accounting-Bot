import { Action, Update } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { IContext } from '../type/interface';
import { ExportService } from '../service';
import { exportMenuButtons } from '../buttons';

const EXPORT_MENU = {
  en: '📤 Export your transactions as a CSV file.\nChoose a time range:',
  ua: '📤 Експортуйте ваші транзакції у файл CSV.\nОберіть період:',
  pl: '📤 Eksportuj swoje transakcje do pliku CSV.\nWybierz zakres czasu:',
  es: '📤 Exporta tus transacciones como archivo CSV.\nElige un rango de tiempo:',
};

const EXPORT_DONE = {
  en: '✅ Here is your export file.',
  ua: '✅ Ось ваш файл експорту.',
  pl: '✅ Oto Twój plik eksportu.',
  es: '✅ Aquí está tu archivo de exportación.',
};

const EXPORT_EMPTY = {
  en: 'No transactions found to export.',
  ua: 'Транзакцій для експорту не знайдено.',
  pl: 'Brak transakcji do eksportu.',
  es: 'No se encontraron transacciones para exportar.',
};

@Update()
export class ExportHandler {
  private readonly logger: Logger = new Logger(ExportHandler.name);

  constructor(private readonly exportService: ExportService) {}

  @Action('export')
  async exportMenu(ctx: IContext) {
    const lang = ctx.session.language || 'en';
    try {
      await ctx.editMessageText(EXPORT_MENU[lang] ?? EXPORT_MENU.en, exportMenuButtons(lang));
    } catch (err) {
      this.logger.error(`exportMenu error`, err);
    }
  }

  @Action('export_csv')
  async exportCsv(ctx: IContext) {
    const lang = ctx.session.language || 'en';
    await ctx.answerCbQuery();
    try {
      const csvBuffer = await this.exportService.exportUserTransactionsCsv(ctx.from.id, ctx.session.group);
      if (csvBuffer.length === 0) {
        await ctx.reply(EXPORT_EMPTY[lang] ?? EXPORT_EMPTY.en);
        return;
      }
      const filename = `transactions_all_${ctx.from.id}_${new Date().toISOString().slice(0, 10)}.csv`;
      await ctx.replyWithDocument({ source: csvBuffer, filename }, { caption: EXPORT_DONE[lang] ?? EXPORT_DONE.en });
    } catch (err) {
      this.logger.error('Error exporting CSV', err);
    }
  }

  @Action('export_csv_thismonth')
  async exportCsvThisMonth(ctx: IContext) {
    const lang = ctx.session.language || 'en';
    await ctx.answerCbQuery();
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    await this.sendCsvForPeriod(ctx, lang, start, end, 'thismonth');
  }

  @Action('export_csv_lastmonth')
  async exportCsvLastMonth(ctx: IContext) {
    const lang = ctx.session.language || 'en';
    await ctx.answerCbQuery();
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    await this.sendCsvForPeriod(ctx, lang, start, end, 'lastmonth');
  }

  private async sendCsvForPeriod(ctx: IContext, lang: string, start: Date, end: Date, tag: string) {
    try {
      const csvBuffer = await this.exportService.exportUserTransactionsCsvByPeriod(
        ctx.from.id,
        start,
        end,
        ctx.session.group,
      );
      if (csvBuffer.length === 0) {
        await ctx.reply(EXPORT_EMPTY[lang] ?? EXPORT_EMPTY.en);
        return;
      }
      const label = start.toLocaleString('en-US', { month: 'short', year: 'numeric' });
      const filename = `transactions_${tag}_${ctx.from.id}_${label.replace(' ', '_')}.csv`;
      await ctx.replyWithDocument({ source: csvBuffer, filename }, { caption: `${EXPORT_DONE[lang] ?? EXPORT_DONE.en} (${label})` });
    } catch (err) {
      this.logger.error(`Error exporting CSV (${tag})`, err);
    }
  }
}
