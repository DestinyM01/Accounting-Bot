export function exportMenuButtons(language: string) {
  const back = language === 'en' ? '⬅️ Back' : language === 'pl' ? '⬅️ Wróć' : '⬅️ Назад';
  const download = language === 'en' ? '📥 Download CSV' : language === 'pl' ? '📥 Pobierz CSV' : '📥 Завантажити CSV';
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: download, callback_data: 'export_csv' }],
        [{ text: back, callback_data: 'backToStart' }],
      ],
    },
  };
}
