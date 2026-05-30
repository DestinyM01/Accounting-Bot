function t(language: string, en: string, es: string, ua: string, pl: string) {
  if (language === 'es') return es;
  if (language === 'ua') return ua;
  if (language === 'pl') return pl;
  return en;
}

export function exportMenuButtons(language: string) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: t(language, '📥 All time', '📥 Todo el tiempo', '📥 Весь час', '📥 Cały czas'), callback_data: 'export_csv' }],
        [{ text: t(language, '📅 This month', '📅 Este mes', '📅 Цей місяць', '📅 Ten miesiąc'), callback_data: 'export_csv_thismonth' }],
        [{ text: t(language, '📅 Last month', '📅 Mes pasado', '📅 Минулий місяць', '📅 Ostatni miesiąc'), callback_data: 'export_csv_lastmonth' }],
        [{ text: t(language, '⬅️ Back', '⬅️ Volver', '⬅️ Назад', '⬅️ Wróć'), callback_data: 'backToStart' }],
      ],
    },
  };
}
