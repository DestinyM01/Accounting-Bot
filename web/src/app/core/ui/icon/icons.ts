// Bundled Tabler outline icons — only the names this app actually uses.
// Each import pulls in one raw SVG string via angular.json's `"loader": { ".svg": "text" }`.
import plus from '@tabler/icons/outline/plus.svg';
import x from '@tabler/icons/outline/x.svg';
import check from '@tabler/icons/outline/check.svg';
import circleCheck from '@tabler/icons/outline/circle-check.svg';
import hourglass from '@tabler/icons/outline/hourglass.svg';
import alertCircle from '@tabler/icons/outline/alert-circle.svg';
import alertTriangle from '@tabler/icons/outline/alert-triangle.svg';
import trendingUp from '@tabler/icons/outline/trending-up.svg';
import trendingDown from '@tabler/icons/outline/trending-down.svg';
import chevronDown from '@tabler/icons/outline/chevron-down.svg';
import chevronLeft from '@tabler/icons/outline/chevron-left.svg';
import chevronRight from '@tabler/icons/outline/chevron-right.svg';
import pencil from '@tabler/icons/outline/pencil.svg';
import trash from '@tabler/icons/outline/trash.svg';
import logout from '@tabler/icons/outline/logout.svg';
import buildingBank from '@tabler/icons/outline/building-bank.svg';
import wallet from '@tabler/icons/outline/wallet.svg';
import mailCheck from '@tabler/icons/outline/mail-check.svg';
import mail from '@tabler/icons/outline/mail.svg';
import menu2 from '@tabler/icons/outline/menu-2.svg';
import refresh from '@tabler/icons/outline/refresh.svg';
import arrowsDiff from '@tabler/icons/outline/arrows-diff.svg';
import adjustmentsHorizontal from '@tabler/icons/outline/adjustments-horizontal.svg';
import handFinger from '@tabler/icons/outline/hand-finger.svg';
import settings from '@tabler/icons/outline/settings.svg';
import search from '@tabler/icons/outline/search.svg';
import clock from '@tabler/icons/outline/clock.svg';
import pigMoney from '@tabler/icons/outline/pig-money.svg';
import listCheck from '@tabler/icons/outline/list-check.svg';
import brain from '@tabler/icons/outline/brain.svg';
import user from '@tabler/icons/outline/user.svg';
import bell from '@tabler/icons/outline/bell.svg';
import userCog from '@tabler/icons/outline/user-cog.svg';
import cash from '@tabler/icons/outline/cash.svg';
import bulb from '@tabler/icons/outline/bulb.svg';
import tag from '@tabler/icons/outline/tag.svg';
import calendarRepeat from '@tabler/icons/outline/calendar-repeat.svg';
import download from '@tabler/icons/outline/download.svg';
import arrowUp from '@tabler/icons/outline/arrow-up.svg';
import arrowDown from '@tabler/icons/outline/arrow-down.svg';
import arrowRight from '@tabler/icons/outline/arrow-right.svg';
import layoutDashboard from '@tabler/icons/outline/layout-dashboard.svg';
import chartBar from '@tabler/icons/outline/chart-bar.svg';
import chartDots3 from '@tabler/icons/outline/chart-dots-3.svg';
import receipt from '@tabler/icons/outline/receipt.svg';
import repeat from '@tabler/icons/outline/repeat.svg';
import buildingStore from '@tabler/icons/outline/building-store.svg';
import car from '@tabler/icons/outline/car.svg';
import home from '@tabler/icons/outline/home.svg';
import firstAidKit from '@tabler/icons/outline/first-aid-kit.svg';
import movie from '@tabler/icons/outline/movie.svg';
import cashBanknote from '@tabler/icons/outline/cash-banknote.svg';
import toolsKitchen2 from '@tabler/icons/outline/tools-kitchen-2.svg';
import shoppingCart from '@tabler/icons/outline/shopping-cart.svg';
import chartCandle from '@tabler/icons/outline/chart-candle.svg';
import externalLink from '@tabler/icons/outline/external-link.svg';

/** Every Tabler outline icon bundled for this app, keyed by its Tabler name. */
export const ICONS: Record<string, string> = {
  plus,
  x,
  check,
  'circle-check': circleCheck,
  hourglass,
  'alert-circle': alertCircle,
  'alert-triangle': alertTriangle,
  'trending-up': trendingUp,
  'trending-down': trendingDown,
  'chevron-down': chevronDown,
  'chevron-left': chevronLeft,
  'chevron-right': chevronRight,
  pencil,
  trash,
  logout,
  'building-bank': buildingBank,
  wallet,
  'mail-check': mailCheck,
  mail,
  'menu-2': menu2,
  refresh,
  'arrows-diff': arrowsDiff,
  'adjustments-horizontal': adjustmentsHorizontal,
  'hand-finger': handFinger,
  settings,
  search,
  clock,
  'pig-money': pigMoney,
  'list-check': listCheck,
  brain,
  user,
  bell,
  'user-cog': userCog,
  cash,
  bulb,
  tag,
  'calendar-repeat': calendarRepeat,
  download,
  'arrow-up': arrowUp,
  'arrow-down': arrowDown,
  'arrow-right': arrowRight,
  'layout-dashboard': layoutDashboard,
  'chart-bar': chartBar,
  'chart-dots-3': chartDots3,
  receipt,
  repeat,
  'building-store': buildingStore,
  car,
  home,
  'first-aid-kit': firstAidKit,
  movie,
  'cash-banknote': cashBanknote,
  'tools-kitchen-2': toolsKitchen2,
  'shopping-cart': shoppingCart,
  'chart-candle': chartCandle,
  'external-link': externalLink,
};

/** Material icon names the api (and legacy code) may still send, mapped to their Tabler name. */
const MATERIAL_TO_TABLER: Record<string, string> = {
  add: 'plus',
  close: 'x',
  check: 'check',
  check_circle: 'circle-check',
  check_circle_outline: 'circle-check',
  hourglass_empty: 'hourglass',
  error: 'alert-circle',
  error_outline: 'alert-circle',
  warning: 'alert-triangle',
  warning_amber: 'alert-triangle',
  trending_up: 'trending-up',
  trending_down: 'trending-down',
  expand_more: 'chevron-down',
  chevron_left: 'chevron-left',
  chevron_right: 'chevron-right',
  edit: 'pencil',
  delete_outline: 'trash',
  logout: 'logout',
  account_balance: 'building-bank',
  account_balance_wallet: 'wallet',
  mark_email_read: 'mail-check',
  mail: 'mail',
  menu: 'menu-2',
  autorenew: 'refresh',
  refresh: 'refresh',
  compare_arrows: 'arrows-diff',
  tune: 'adjustments-horizontal',
  touch_app: 'hand-finger',
  settings: 'settings',
  search: 'search',
  schedule: 'clock',
  savings: 'pig-money',
  rule: 'list-check',
  psychology: 'brain',
  person: 'user',
  notifications_none: 'bell',
  manage_accounts: 'user-cog',
  local_atm: 'cash',
  lightbulb: 'bulb',
  lightbulb_outline: 'bulb',
  label: 'tag',
  sell: 'tag',
  event_repeat: 'calendar-repeat',
  download: 'download',
  arrow_upward: 'arrow-up',
  arrow_downward: 'arrow-down',
  dashboard: 'layout-dashboard',
  bar_chart: 'chart-bar',
  insights: 'chart-dots-3',
  receipt_long: 'receipt',
  repeat: 'repeat',
  storefront: 'building-store',
  directions_car: 'car',
  home: 'home',
  medical_services: 'first-aid-kit',
  movie: 'movie',
  payments: 'cash-banknote',
  restaurant: 'tools-kitchen-2',
  shopping_cart: 'shopping-cart',
};

/**
 * Maps a Material icon name (as the api's Tips feature returns, generated by Mistral)
 * to a bundled Tabler name. Unknown names fall back to 'bulb'.
 */
export function tablerIcon(material: string): string {
  return MATERIAL_TO_TABLER[material] ?? 'bulb';
}
