export const PREMIUM_MESSAGE = {
  ua: 'днів залишилось до закінчення преміуму',
  en: 'days left until the end of the premium',
  pl: 'dni pozostało do końca premium',
  es: 'días restantes hasta el fin del premium',
};

export const BAY_PREMIUM_MENU = {
  ua: 'Оберіть потрібній вам розділ🔽',
  en: 'Choose the section you need🔽',
  pl: 'Wybierz potrzebny ci dział🔽',
  es: 'Elige la sección que necesitas🔽',
};

export const PREMIUM_SET = {
  ua: 'Тут буде функціонал для отримання преміум доступу😎',
  en: 'There will be a function for obtaining premium access😎',
  pl: 'Tu będzie funkcja do uzyskania dostępu premium😎',
  es: 'Aquí habrá una función para obtener acceso premium😎',
};

export const TRIAL_PROVIDED = {
  en: 'The premium🏆 is provided for 14 days✅',
  ua: 'Преміум🏆 надано на 14 днів✅',
  pl: 'Premium🏆 jest udostępniane na 14 dni✅',
  es: 'El premium🏆 se ha activado por 14 días✅',
};

export const TRIAL_PROVIDED_FALSE = {
  en: 'You already have a premium, try later',
  ua: 'Ви вже маєте преміум спробуйте пізніше',
  pl: 'Masz już premium, spróbuj później',
  es: 'Ya tienes un premium activo, inténtalo más tarde',
};

export const PREMIUM_MENU = {
  ua:
    'Тут можна придбати преміум та дізнатися скільки днів преміуму залишилось\n' +
    'після отримання преміуму вам відкриються додаткові функції в основному меню ',
  en:
    'Here you can purchase a premium and find out how many premium days are left\n' +
    'after receiving the premium, additional functions will open to you in the main menu',
  pl:
    'Tutaj możesz zakupić premium i dowiedzieć się, ile dni premium pozostało\n' +
    'po otrzymaniu premium dodatkowe funkcje zostaną otwarte w menu głównym',
  es:
    'Aquí puedes adquirir premium y saber cuántos días de premium te quedan\n' +
    'tras obtener el premium, se abrirán funciones adicionales en el menú principal',
};

export const getPremiumMessage = (language: string = 'en', length: number) => {
  const messages = {
    en: `you have added data for comparison: ${length}pcs.
         through the premium menu you can get information comparatively`,
    ua: `ви додали дані для порівняння: ${length}шт.
через преміум меню ви можете отримати інформацію порівняно `,
    pl: `dodałeś dane do porównania: ${length}szt.
poprzez menu premium możesz uzyskać informacje w sposób porównawczy`,
    es: `has añadido datos para comparar: ${length}pcs.
a través del menú premium puedes obtener información de forma comparativa`,
  };

  return messages[language] ?? messages.en;
};

export const NOT_COMPARE = {
  en: 'There is nothing to compare❌',
  ua: 'Нема чого порівнювати❌',
  pl: 'Nie ma czego porównywać❌',
  es: 'No hay nada que comparar❌',
};

export const GPT_MENU = {
  en: 'Welcome to the AI menu:🤖',
  ua: 'Ласкаво прошу до ШІ меню:🤖',
  pl: 'Witaj w menu sztucznej inteligencji:🤖',
  es: 'Bienvenido al menú de IA:🤖',
};

export const COMPARE_DELL = {
  en: 'More than two messages cannot be compared',
  ua: 'Понад два повідомлення  не можна порівнювати',
  pl: 'Nie można porównywać więcej niż dwóch wiadomości',
  es: 'No se pueden comparar más de dos mensajes',
};
