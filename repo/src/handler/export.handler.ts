import { Action, Update } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { IContext } from '../type/interface';
import { ExportService } from '../service';
import { exportMenuButtons } from '../battons';

const EXPORT_MENU = {
  en: '📤 Export your transactions as a CSV file.',
  ua: '📤 Експортуйте ваші транзакції у файл CSV.',
  pl: '📤 Eksportuj swoje transakcje do pliku CSV.',
};

const EXPORT_DONE = {
  en: '✅ Here is your export file.',
  ua: '✅ Ось ваш файл експорту.',
  pl: '✅ Oto Twój plik eksportu.',
};

const EXPORT_EMPTY = {
  en: 'No transactions found to export.',
  ua: 'Транзакцій для експорту не знайдено.',
  pl: 'Brak transakcji do eksportu.',
};

@Update()
export class ExportHandler {
  private readonly logger: Logger = new Logger(ExportHandler.name);

  constructor(private readonly exportService: ExportService) {}

  @Action('export')
  async exportMenu(ctx: IContext) {
    const lang = ctx.session.language || 'en';
    await ctx.editMessageText(EXPORT_MENU[lang], exportMenuButtons(lang));
  }

  @Action('export_csv')
  async exportCsv(ctx: IContext) {
    const lang = ctx.session.language || 'en';
    await ctx.answerCbQuery();
    try {
      const csvBuffer = await this.exportService.exportUserTransactionsCsv(ctx.from.id, ctx.session.group);
      if (csvBuffer.length === 0) {
        await ctx.reply(EXPORT_EMPTY[lang]);
        return;
      }
      const filename = `transactions_${ctx.from.id}_${new Date().toISOString().slice(0, 10)}.csv`;
      await ctx.replyWithDocument({ source: csvBuffer, filename }, { caption: EXPORT_DONE[lang] });
    } catch (err) {
      this.logger.error('Error exporting CSV', err);
    }
  }
}
