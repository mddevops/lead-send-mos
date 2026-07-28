/**
 * Node-side helpers for testing detection heuristics.
 * Browser detection lives in formDetector.browser.ts
 */

export function matchesPhoneFieldHint(value: string): boolean {
  const normalized = value.toLowerCase();

  return /(?:^|[_-])(phone|tel|telephone|mobile|contact|callback|gsm|номер|тел)(?:$|[_-])/.test(normalized)
    || normalized.includes('phone')
    || normalized.includes('tel');
}

export function matchesNameFieldHint(value: string): boolean {
  const normalized = value.toLowerCase();

  return /(?:^|[_-])(name|fio|fname|firstname|fullname|client|username|user|имя)(?:$|[_-])/.test(normalized)
    || normalized.includes('name')
    || /имя|фио/.test(normalized);
}

export function matchesSubmitText(value: string): boolean {
  return /отправ|заказ|позвон|перезвон|submit|send|заявк|получить|оставить|узнать|запис|консульт|связ|отправить|перезвоните|call|оформ|звонок|написать|свяж|заказать/i.test(
    value.toLowerCase(),
  );
}
