/** Minimum score for a detected form to be saved. Phone + submit = 80. */
export const MIN_FORM_SCORE = 70;

/**
 * formScore weights (browser detector mirrors these literals).
 * Keep phone/submit high enough that phone+submit clears MIN_FORM_SCORE.
 */
export const SCORE_PHONE = 50;
export const SCORE_NAME = 20;
export const SCORE_SUBMIT = 30;
export const SCORE_CHECKBOXES = 10;
/** Optional bonuses / penalties (additive on top of the base weights above). */
export const SCORE_EMAIL = 10;
export const SCORE_TEXTAREA = 5;
export const SCORE_AUTH_PENALTY = -100;

/** successScore: aggregate post-submit signals (see resultDetector). */
export const MIN_SUCCESS_SCORE = 40;
export const SUCCESS_SCORE_TEXT = 40;
export const SUCCESS_SCORE_MODAL = 25;
export const SUCCESS_SCORE_FORM_HIDDEN = 30;
export const SUCCESS_SCORE_BUTTON_DISABLED = 20;
export const SUCCESS_SCORE_BUTTON_TEXT = 15;
export const SUCCESS_SCORE_NETWORK_OK = 35;
export const SUCCESS_SCORE_URL = 30;
export const SUCCESS_SCORE_MUTATION = 20;

/** Phone field: type="tel" + placeholder like «Ваш номер телефона», +7 (___)… */
export const PHONE_PLACEHOLDER_PATTERN =
  /ваш\s+номер\s+телефона|номер\s+телефона|ваш\s+телефон|телефон\*?|phone|\+7(?:\s|\(|_)|8\s*\(\s*_|\+\s*7/i;

/** True when a CSS selector clearly targets a phone input (not name/email/vin). */
export function isLeadPhoneSelector(selector: string): boolean {
  if (!selector.trim()) {
    return false;
  }

  if (/data-type=["']?NAME|data-type=["']?FIO|placeholder\s*\*=\s*["'][^"']*имя|placeholder\s*\*=\s*["'][^"']*Имя|#name\b|name=["']name["']/i.test(selector)
    && !/data-type=["']?PHONE|type=["']?tel|phone|tel|телефон/i.test(selector)) {
    return false;
  }

  return /data-type=["']?PHONE|type=["']?tel|inputmode=["']?tel|#phone\b|name=["'][^"']*phone|name=["']tel|phone_num|телефон|placeholder.*тел|\+7/i.test(selector)
    && !/#vin\b|#year\b|#email\b|name=["'][^"']*(vin|year|email)/i.test(selector);
}

/** Name field: name="name" or placeholder «Имя», «Ф.И.О.»… */
export const NAME_FIELD_PATTERN =
  /(?:^|\s)(имя|name|ваше\s+имя|ф\.?\s*и\.?\s*о\.?|фио|fio|first.?name)(?:\s|\*|$)/i;

export const EMAIL_FIELD_PATTERN =
  /e-?mail|почта|электронн\w*\s+почт/i;

export const AUTH_FORM_PATTERN =
  /(?:^|[\s>])(войти|вход|логин|password|пароль|sign\s*in|log\s*in|авторизац|регистрац)/i;

export const CONSENT_TEXT_PATTERN =
  /согласи[ея]|согласен|обработк[аи]\s+данн|политик|персональн|privacy|consent|compliance|terms/i;

export const SUCCESS_TEXT_PATTERN =
  /спасибо(?:\s+за\s+заявк|\s+за\s+обращени)?|заявка\s+(?:успешно\s+)?отправлена|заявка\s+принята|мы\s+свяжемся|мы\s+перезвоним|перезвоним(?:\s+вам)?(?:\s+в\s+течение)?|в\s+течение\s+\d+\s*минут|ожидайте\s+звонка|менеджер\s+свяжется|успешно(?:\s+отправлено)?|отправлено|принято|thank\s+you|request\s+sent|submitted\s+successfully/i;

export const SUCCESS_URL_PATTERN =
  /\/(?:success|thanks|thank-?you|spasibo|успех)(?:\/|$|\?)|#(?:success|thanks|thank-?you)/i;

export const SUCCESS_BUTTON_TEXT_PATTERN =
  /отправл(?:яем|ено)|отправлено|отправляется|sending|sent|готово|спасибо/i;

export const ERROR_TEXT_PATTERN =
  /ошибка|не\s+удалось\s+отправить|попробуйте\s+(?:ещё|еще)\s+раз|неверный\s+(?:номер|код|ответ)|заполните\s+обязательн|captcha\s+failed|invalid\s+captcha/i;

export const ENTRY_POINT_TEXT_PATTERN =
  /заказать\s+звонок|обратн(?:ый|ого)?\s+звонок|перезвон|получить\s+(?:лучшее\s+)?предложение|персональное\s+предложение|записаться\s+на\s+тест[-\s]?драйв|тест[-\s]?драйв|рас\S{0,4}читать\s+кредит|оставить\s+заявку|обратная\s+связь|связаться|получить\s+консультацию|отправить\s+заявку|оставить\s+контакты|записаться|перезвоните|консультация|хочу\s+купить|узнать\s+(?:цену|стоимость)|получить\s+цену|написать\s+нам|бесплатн\w*\s+звонок|купить\s+в\s+кредит|получить\s+скидк|заявка\s+на\s+trade-?in|обменять\s+по\s+trade-?in|обменять\s+по\s+трейд|trade-?in|трейд-?ин|оформить\s+кредит|подать\s+заявк|успей\s+забронировать|забронировать|выгодн\w*\s+автокредит|\bавтокредит\b|первый\s+платеж\s+в\s+подарок|в\s+кредит\s+от|получить\s+предложение|оставить\s+заявк|\bкупить\b|подробнее/i;

export const HASH_WIDGET_HREF_PATTERN =
  /^#(callkeeper|callback|feedback|form|popup|prodpopup|modal|credit|tradein|trade-in|offer|lead|creditorder|backcall|myform)/i;

export const CALLBACK_ENTRY_PATTERN =
  /заказать\s+звонок|обратн(?:ый|ого)?\s+звонок|перезвон|получить\s+(?:лучшее\s+)?предложение|заявк|связаться|callback|предложение|купить\s+в\s+кредит|получить\s+скидк|trade-?in|оформить\s+кредит|забронировать|в\s+кредит\s+от|получить\s+предложение/i;

export const SERVICE_ENTRY_PATTERN = /сервис|service|записаться\s+на\s+сервис/i;

/** Sticky / side-widget CTA texts (often fixed position, short label). */
export const STICKY_WIDGET_TEXT_PATTERN =
  /заказать\s+звонок|обратн(?:ый|ого)?\s+звонок|перезвон|заявк|связаться|callback|кредит|скидк|trade-?in|консультац|предложение/i;

export const MODAL_CONTAINER_SELECTORS = [
  '.base-dialog',
  '.base-dialog-overlay',
  '[role="dialog"]',
  '.modal',
  '.modal--open',
  '.modal.modal--credit',
  '.modal.modal--callback',
  '.modal.is-active',
  // Carmir / AutoPlaza-style shells (open via display:block, no Bootstrap .show)
  '.modal__wrapper',
  '.modal__content',
  '.v-modal',
  '.t-popup',
  '.t-popup_show',
  '.popup',
  '.dialog',
  '.fancybox-content',
  '.fancybox-is-open',
] as const;
