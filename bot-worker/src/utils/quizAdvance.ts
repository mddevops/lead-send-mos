import { Locator, Page } from 'playwright';
import pino from 'pino';

const logger = pino({ name: 'quiz-advance' });

export type PreFormStrategy = 'selectors' | 'quiz_auto' | null | undefined;

export type PreFormMapping = {
  open_modal_selector?: string | null;
  pre_form_click_selectors?: string[] | null;
  pre_form_strategy?: PreFormStrategy;
  quiz_container_selector?: string | null;
};

const PHONE_IN_FORM =
  'input[type="tel"], input[name="tel"], input[name*="phone" i], input[data-type="PHONE"], input.phone-input, input[placeholder*="+7"], input[inputmode="tel"]';

const QUIZ_QUESTION_PATTERN =
  /какую?\s+|какие?\s+|какой\s+|выберите|укажите|отметьте|ответьте|интересует|рассматриваете|планируете|приобретать|комплектац|способ\s+оплат|подарок|шаг\s*\d|вопрос\s*\d/i;

const QUIZ_ENTRY_PATTERN =
  /подобрать\s+авто|пройти\s+опрос|начать\s+подбор|получить\s+предложен|узнать\s+персональн|пройти\s+квиз|начать\s+квиз|рассчитать/i;

const OPTION_SKIP_TEXT =
  /подробнее|политика|cookie|согласен|закрыть|close|назад|prev|показать\s+автомобил|позвонить|условия\s+кредит|пользовательск|конфиденциал|понятно|меню|войти|регистр/i;

const OPTION_SKIP_HREF =
  /cookie|privacy|policy|politic|personal|соглас|политик|\/about|tel:|mailto:|javascript:/i;

/** Soft hints only — never required to detect a quiz. */
const QUIZ_HINT_SELECTOR = [
  '[class*="quiz" i]',
  '[id*="quiz" i]',
  '[class*="marquiz" i]',
  '[id*="marquiz" i]',
  '[class*="funnel" i]',
  '[class*="wizard" i]',
  '[class*="chat-bubble" i]',
  '.chat-bubble',
  '.chat.chat-start',
  '[data-quiz]',
  '[data-marquiz]',
  'marquiz',
].join(', ');


export async function pageHasLeadPhone(page: Page, root?: Locator | null): Promise<boolean> {
  const scope = root ?? page.locator('body');
  const phone = scope.locator(PHONE_IN_FORM).filter({ visible: true }).first();
  return (await phone.count()) > 0 && (await phone.isVisible().catch(() => false));
}

/** Bot already asked for a phone number (input may still be animating in). */
export async function pageAsksForPhone(page: Page): Promise<boolean> {
  const prompt = page.getByText(/оставьте\s+(ваш\s+)?номер|ваш\s+номер\s+телефона|номер\s+телефона,?\s*пожалуйста/i).first();
  return (await prompt.count()) > 0 && (await prompt.isVisible().catch(() => false));
}

export async function waitForLeadPhone(page: Page, timeoutMs = 15000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await pageHasLeadPhone(page)) {
      return true;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

export async function findQuizContainers(page: Page): Promise<Locator[]> {
  // Prefer a visible region that holds several answer-like controls.
  const hint = page.locator(QUIZ_HINT_SELECTOR).filter({ visible: true }).first();
  if ((await hint.count()) > 0) {
    return [hint];
  }

  const question = page.locator('div, p, span, h1, h2, h3, h4, li').filter({ hasText: QUIZ_QUESTION_PATTERN }).first();
  if ((await question.count()) > 0 && (await question.isVisible().catch(() => false))) {
    return [page.locator('main, #__next, [id="root"], body').first()];
  }

  return [page.locator('body').first()];
}

/**
 * Generic quiz/funnel heuristic — NOT tied to a specific CSS framework.
 * Signals: no lead phone yet + several short answer controls + question-like text.
 * Soft class hints (quiz/marquiz/chat) only add score, never required.
 */
export async function pageLooksLikeQuiz(page: Page): Promise<boolean> {
  if (await pageHasLeadPhone(page)) {
    return false;
  }

  let signal: { score: number; bestCluster: number; answers: number; softHint: boolean } = {
    score: 0,
    bestCluster: 0,
    answers: 0,
    softHint: false,
  };

  try {
    signal = (await page.evaluate(`(() => {
    const SKIP = /cookie|политик|конфиденц|согласи|закрыть|close|menu|войти|вход|регистр|корзин|поиск|whatsapp|telegram|позвон|назад|отмен|понятно|подробнее/i;
    const CONT = /продолжить|далее|дальше|next|continue/i;
    const QUESTION = /\\?|какую?\\s+|какие?\\s+|какой\\s+|выберите|укажите|отметьте|ответьте|интересует|рассматриваете|планируете|шаг\\s*\\d|вопрос\\s*\\d/i;

    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      const st = window.getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) !== 0;
    };

    const textOf = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();

    let score = 0;
    const softHint = document.querySelector(
      '[class*="quiz" i], [id*="quiz" i], [class*="marquiz" i], [class*="wizard" i], [class*="funnel" i], [class*="chat-bubble" i], .chat-bubble, [data-quiz], marquiz'
    );
    if (softHint && isVisible(softHint)) score += 2;

    const bodyText = textOf(document.body).slice(0, 2500);
    if (QUESTION.test(bodyText)) score += 2;

    const answerLike = [];
    const nodes = document.querySelectorAll(
      'button, [role="button"], label, a, div[class*="cursor-pointer"], [class*="card"][class*="cursor"], input[type="checkbox"], input[type="radio"]'
    );
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const label = textOf(el).slice(0, 60);
      if (!label || label.length > 48 || SKIP.test(label)) continue;
      if (CONT.test(label)) {
        score += 1;
        continue;
      }
      if (el.tagName === 'A' && label.length > 28) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 700 && r.height > 200) continue;
      answerLike.push({ label, top: r.top });
    }

    answerLike.sort((a, b) => a.top - b.top);
    let bestCluster = 0;
    for (let i = 0; i < answerLike.length; i += 1) {
      let size = 1;
      for (let j = i + 1; j < answerLike.length; j += 1) {
        if (Math.abs(answerLike[j].top - answerLike[i].top) > 280) break;
        size += 1;
      }
      if (size > bestCluster) bestCluster = size;
    }

    if (bestCluster >= 2) score += 3;
    if (bestCluster >= 3) score += 2;
    if (answerLike.length >= 2 && !document.querySelector('input[type="tel"], input[name*="phone" i]')) {
      score += 1;
    }

    return { score, bestCluster, answers: answerLike.length, softHint: !!softHint };
  })()`)) as typeof signal;
  } catch {
    // keep default zero score
  }

  logger.info(signal, 'Quiz heuristic score');
  return signal.score >= 4;
}

async function buildStableClickSelector(page: Page, el: Locator): Promise<string | null> {
  return el.evaluate((node) => {
    const cssEscape = (value: string) => {
      if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(value);
      return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
    };

    if (!(node instanceof HTMLElement)) return null;

    if (node.id && /^[a-zA-Z][\w-]*$/.test(node.id) && document.querySelectorAll(`#${cssEscape(node.id)}`).length === 1) {
      return `#${cssEscape(node.id)}`;
    }

    const tag = node.tagName.toLowerCase();
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (text && text.length >= 2 && text.length <= 48 && !/[<>]/.test(text)) {
      const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const byText = `${tag}:has-text("${escaped}")`;
      try {
        // :has-text is Playwright-only; still useful when saved for worker clicks.
        return byText;
      } catch {
        // ignore
      }
    }

    const cls = Array.from(node.classList).filter((c) => c && !/hover|active|focus|open|show|selected|checked/i.test(c));
    if (cls.length) {
      const candidate = `${tag}.${cls.slice(0, 2).map(cssEscape).join('.')}`;
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    }

    return null;
  }).catch(() => null);
}

/**
 * Click first safe option inside quiz root. Returns selector used (if any).
 */
export async function clickFirstQuizOption(
  page: Page,
  root: Locator,
): Promise<{ clicked: boolean; selector: string | null }> {
  // Prefer explicit answer cards (tenet chat: .card.cursor-pointer).
  const candidates = root.locator(
    [
      '.card.cursor-pointer:not([class*="border-primary"])',
      '[class*="card"][class*="cursor-pointer"]',
      'button:not([type="submit"])',
      '[role="button"]',
      '[role="option"]',
      '[role="radio"]',
      'label',
      'div[class*="option" i]',
      'div[class*="answer" i]',
      'div[class*="choice" i]',
      'div[class*="variant" i]',
      'li[class*="option" i]',
      'a[class*="btn" i]',
      'a[class*="button" i]',
    ].join(', '),
  );

  const count = Math.min(await candidates.count(), 40);

  for (let index = 0; index < count; index += 1) {
    const item = candidates.nth(index);
    if (!(await item.isVisible().catch(() => false))) {
      continue;
    }

    const meta = await item.evaluate((el) => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const href = (el.closest('a') || (el.tagName === 'A' ? el : null))?.getAttribute('href') || '';
      const type = (el.getAttribute('type') || '').toLowerCase();
      const tag = el.tagName.toLowerCase();
      const cls = typeof el.className === 'string' ? el.className : '';
      const inPhoneForm = Boolean(
        el.closest('form')?.querySelector(
          'input[type="tel"], input[name="tel"], input[name*="phone" i], input[data-type="PHONE"]',
        ),
      );
      const alreadySelected = /border-primary|ring-|selected|is-active|is-selected|checked/i.test(cls)
        || el.getAttribute('aria-pressed') === 'true'
        || el.getAttribute('aria-checked') === 'true';

      return { text, href, type, tag, cls, inPhoneForm, alreadySelected };
    }).catch(() => null);

    if (!meta) {
      continue;
    }

    if (meta.alreadySelected) {
      continue;
    }

    if (meta.inPhoneForm) {
      continue;
    }
    if (meta.type === 'submit') {
      continue;
    }
    if (meta.href && OPTION_SKIP_HREF.test(meta.href)) {
      continue;
    }
    if (meta.href && (/^https?:\/\//i.test(meta.href) || meta.href.startsWith('/')) && !meta.href.startsWith('#')) {
      continue;
    }

    const text = meta.text;
    if (!text || text.length < 1 || text.length > 120) {
      continue;
    }
    if (OPTION_SKIP_TEXT.test(text)) {
      continue;
    }

    // Skip huge page sections accidentally matched as "buttons".
    if (text.length > 80 && !/tenet|t4|t7|t8|кредит|наличн|рассроч|подарок|комплект/i.test(text)) {
      continue;
    }

    const selector = await buildStableClickSelector(page, item);
    await item.scrollIntoViewIfNeeded().catch(() => undefined);

    // Prefer real pointer click — force:true often misses React/Next handlers (tenet chat cards).
    let clickedOk = false;
    const box = await item.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) {
      await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 40));
      clickedOk = true;
    }
    if (!clickedOk) {
      await item.click({ timeout: 5000 }).catch(async () => {
        await item.click({ timeout: 5000, force: true }).catch(() => undefined);
      });
    }

    logger.info({ text: text.slice(0, 60), selector, cls: meta.cls.slice(0, 60) }, 'Quiz option clicked');
    return { clicked: true, selector };
  }

  // Explicit "continue" after multi-choice (Базовая/Средняя + ПРОДОЛЖИТЬ).
  const continueBtn = root.getByRole('button', { name: /продолжить|далее|далее\s*→|следующ/i }).filter({ visible: true }).first();
  if ((await continueBtn.count()) > 0) {
    const box = await continueBtn.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await continueBtn.click({ timeout: 5000 }).catch(() => undefined);
    }
    logger.info('Quiz continue button clicked');
    return { clicked: true, selector: null };
  }

  return { clicked: false, selector: null };
}

export async function tryOpenQuizEntry(page: Page): Promise<string | null> {
  const entries = page.locator('button, a, [role="button"], div.button, div.btn').filter({
    hasText: QUIZ_ENTRY_PATTERN,
  });
  const count = Math.min(await entries.count(), 12);

  for (let index = 0; index < count; index += 1) {
    const entry = entries.nth(index);
    if (!(await entry.isVisible().catch(() => false))) {
      continue;
    }

    const href = await entry.evaluate((el) => {
      const a = el.closest('a') || (el.tagName === 'A' ? el : null);
      return a?.getAttribute('href') || '';
    }).catch(() => '');

    if (href && OPTION_SKIP_HREF.test(href)) {
      continue;
    }
    if (href && (/^https?:\/\//i.test(href) || (href.startsWith('/') && !href.startsWith('/#')))) {
      continue;
    }

    const selector = await buildStableClickSelector(page, entry);
    await entry.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    logger.info({ selector }, 'Quiz entry CTA clicked');
    return selector;
  }

  return null;
}

export type QuizAdvanceResult = {
  reachedForm: boolean;
  steps: number;
  clickSelectors: string[];
  quizContainerSelector: string | null;
  openModalSelector: string | null;
};

async function mouseClickPoint(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y);
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

type LastBlockHit = {
  kind: 'choice' | 'continue';
  /** How to click via Playwright */
  mode: 'card' | 'checkbox-label' | 'chip' | 'button' | 'point';
  /** nth match within last block root */
  index: number;
  label: string;
  x: number;
  y: number;
};

type LastBlockState = {
  hasPhone: boolean;
  bubbleCount: number;
  lastText: string;
  /** True when a card was already picked in this block — do not click sibling cards. */
  choiceAlreadyMade: boolean;
  choices: LastBlockHit[];
  continues: LastBlockHit[];
};

/**
 * Inspect the active quiz step only (newest answer cluster).
 * Works with chat bubbles when present, otherwise clusters answer controls by position.
 * Never returns hits from older/upper steps.
 */
async function inspectLastBlock(page: Page): Promise<LastBlockState> {
  const empty: LastBlockState = {
    hasPhone: false,
    bubbleCount: 0,
    lastText: '',
    choiceAlreadyMade: false,
    choices: [],
    continues: [],
  };

  try {
    return (await page.evaluate(`(() => {
    const SKIP = /cookie|политик|конфиденц|согласи|закрыть|close|menu|войти|вход|регистр|корзин|поиск|whatsapp|telegram|позвон|назад|отмен|понятно|подробнее/i;
    const CONT = /продолжить|далее|дальше|next|continue|отправить(?!\\s+заяв)/i;
    const phone = !!document.querySelector(
      'input[type="tel"], input[name="tel"], input[name="phone"], input[name*="phone" i], input[data-type="PHONE"], input[autocomplete="tel"]'
    );

    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) return false;
      const st = window.getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) !== 0;
    };

    const textOf = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();

    const isSelectedVisual = (el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true') return true;
      if (el.checked === true) return true;
      return /border-info|border-primary|border-success|alert-info|bg-info|bg-primary|btn-primary|ring-|selected|is-selected|is-active|checked/i.test(cls);
    };

    const isChip = (el) => {
      if (!el || el.tagName !== 'DIV') return false;
      const cls = typeof el.className === 'string' ? el.className : '';
      if (el.classList.contains('card')) return false;
      if (el.closest('label')) return false;
      const cursor = window.getComputedStyle(el).cursor === 'pointer' || /cursor-pointer/.test(cls);
      if (!cursor) return false;
      return /rounded-full|rounded-pill|chip|pill|bg-base-300|px-4|tag/i.test(cls) || (el.children.length <= 2 && textOf(el).length <= 40);
    };

    const empty = {
      hasPhone: phone,
      bubbleCount: 0,
      lastText: '',
      choiceAlreadyMade: false,
      choices: [],
      continues: [],
    };

    const collectHits = (scopeNodes) => {
      const choices = [];
      const continues = [];
      const seen = new Set();
      let choiceAlreadyMade = false;
      let cardIndex = 0;
      let labelIndex = 0;
      let chipIndex = 0;
      let buttonIndex = 0;

      const candidates = [];
      for (const node of scopeNodes) {
        if (!node || !node.querySelectorAll) continue;
        candidates.push(...node.querySelectorAll(
          'button, [role="button"], label, a, .card.cursor-pointer, [class*="cursor-pointer"], div.cursor-pointer, input[type="checkbox"], input[type="radio"]'
        ));
        if (node.matches && node.matches('button, [role="button"], .card.cursor-pointer, div.cursor-pointer')) {
          candidates.push(node);
        }
      }

      for (const el of candidates) {
        if (!isVisible(el)) continue;
        if ((el.classList && el.classList.contains('card') && isSelectedVisual(el)) || (isChip(el) && isSelectedVisual(el))) {
          choiceAlreadyMade = true;
        }
        if (el.matches && el.matches('input[type="checkbox"], input[type="radio"]') && el.checked) {
          choiceAlreadyMade = true;
        }
      }

      for (const el of candidates) {
        if (seen.has(el) || !isVisible(el)) continue;
        // Prefer outermost clickable (card/label), skip nested spans later via seen of parents... 
        seen.add(el);
        let label = textOf(el).slice(0, 80);
        if (!label || SKIP.test(label)) continue;

        // If this is a raw checkbox/radio, use its label text.
        if (el.matches && el.matches('input[type="checkbox"], input[type="radio"]')) {
          const lab = el.closest('label') || (el.id ? document.querySelector('label[for="' + el.id + '"]') : null);
          label = lab ? textOf(lab).slice(0, 80) : label;
          if (!label || SKIP.test(label) || el.checked) {
            if (el.checked) choiceAlreadyMade = true;
            continue;
          }
        }

        const r = el.getBoundingClientRect();
        if (r.width > 720) continue;
        const base = {
          kind: 'choice',
          mode: 'point',
          index: 0,
          label,
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
        };

        if ((el.matches('button, [role="button"]') || el.tagName === 'A') && CONT.test(label)) {
          base.kind = 'continue';
          base.mode = 'button';
          base.index = buttonIndex++;
          continues.push(base);
          continue;
        }

        if (el.classList && el.classList.contains('card') && (el.classList.contains('cursor-pointer') || window.getComputedStyle(el).cursor === 'pointer')) {
          const idx = cardIndex++;
          if (choiceAlreadyMade || isSelectedVisual(el)) continue;
          base.mode = 'card';
          base.index = idx;
          choices.push(base);
          continue;
        }

        if (isChip(el)) {
          const idx = chipIndex++;
          if (choiceAlreadyMade || isSelectedVisual(el) || label.length > 48) continue;
          base.mode = 'chip';
          base.index = idx;
          choices.push(base);
          continue;
        }

        if (el.matches('label')) {
          const input = el.querySelector('input[type="checkbox"], input[type="radio"]')
            || (el.htmlFor ? document.getElementById(el.htmlFor) : null);
          if (input && input.checked) {
            choiceAlreadyMade = true;
            continue;
          }
          if (CONT.test(label) || label.length > 48) continue;
          base.mode = 'checkbox-label';
          base.index = labelIndex++;
          choices.push(base);
          continue;
        }

        if (el.matches('button, [role="button"]')) {
          if (label.length > 48) continue;
          base.mode = 'button';
          base.index = buttonIndex++;
          choices.push(base);
        }
      }

      // Dedupe by label+mode (nested card/text-left etc.)
      const dedupe = (arr) => {
        const out = [];
        const seenL = new Set();
        for (const h of arr) {
          const key = h.kind + '|' + h.mode + '|' + h.label;
          if (seenL.has(key)) continue;
          seenL.add(key);
          out.push(h);
        }
        return out;
      };

      return {
        choices: dedupe(choices),
        continues: dedupe(continues),
        choiceAlreadyMade,
      };
    };

    // --- Path A: chat bubbles (tenet / daisyUI) when present ---
    const bubbles = Array.from(document.querySelectorAll('.chat-bubble, [class*="chat-bubble"]')).filter(isVisible);
    empty.bubbleCount = bubbles.length;

    if (bubbles.length > 0) {
      const scopeFor = (bubble) => {
        const root = bubble.closest('.chat') || bubble;
        const parent = root.parentElement;
        const nodes = [root];
        if (!parent) return nodes;
        let after = false;
        for (const child of Array.from(parent.children)) {
          if (child === root || child.contains(bubble)) {
            after = true;
            continue;
          }
          if (!after) continue;
          if (child.classList.contains('chat') || child.querySelector('.chat-bubble, [class*="chat-bubble"]')) break;
          nodes.push(child);
        }
        return nodes;
      };

      for (let i = bubbles.length - 1; i >= 0; i -= 1) {
        const bubble = bubbles[i];
        const { choices, continues, choiceAlreadyMade } = collectHits(scopeFor(bubble));
        if (choices.length === 0 && continues.length === 0 && !choiceAlreadyMade) continue;
        return {
          hasPhone: phone,
          bubbleCount: bubbles.length,
          lastText: textOf(bubble).slice(0, 120),
          choiceAlreadyMade,
          choices,
          continues,
        };
      }
    }

    // --- Path B: generic — bottom-most cluster of answer controls ---
    const allCandidates = Array.from(document.querySelectorAll(
      'button, [role="button"], label, .card.cursor-pointer, div.cursor-pointer, [class*="cursor-pointer"]'
    )).filter((el) => {
      if (!isVisible(el)) return false;
      const label = textOf(el).slice(0, 60);
      if (!label || label.length > 48 || SKIP.test(label)) return false;
      const r = el.getBoundingClientRect();
      return r.width < 700 && r.height < 420;
    });

    if (allCandidates.length === 0) {
      return empty;
    }

    // Group by approximate vertical band (active step = lowest band with 2+ items or continue).
    const items = allCandidates.map((el) => {
      const r = el.getBoundingClientRect();
      return { el, top: r.top, label: textOf(el).slice(0, 60) };
    }).sort((a, b) => a.top - b.top);

    const bands = [];
    for (const item of items) {
      const band = bands.find((b) => Math.abs(b.top - item.top) < 220);
      if (band) {
        band.els.push(item.el);
        band.top = Math.max(band.top, item.top);
      } else {
        bands.push({ top: item.top, els: [item.el] });
      }
    }

    for (let i = bands.length - 1; i >= 0; i -= 1) {
      const band = bands[i];
      // Unique parents to form a scope
      const parents = [];
      for (const el of band.els) {
        const p = el.closest('form, section, article, [class*="quiz" i], [class*="step" i], .chat, .chat-bubble, div') || el.parentElement || el;
        if (!parents.includes(p)) parents.push(p);
      }
      const { choices, continues, choiceAlreadyMade } = collectHits(parents.length ? parents : band.els);
      if (choices.length === 0 && continues.length === 0 && !choiceAlreadyMade) continue;
      if (choices.length + continues.length === 0) continue;

      return {
        hasPhone: phone,
        bubbleCount: bands.length,
        lastText: (choices[0] || continues[0] || { label: '' }).label.slice(0, 120),
        choiceAlreadyMade,
        choices,
        continues,
      };
    }

    return empty;
  })()`)) as LastBlockState;
  } catch {
    return empty;
  }
}

async function quizStepSignal(page: Page): Promise<number> {
  const block = await inspectLastBlock(page);
  // Prefer bubble count when chat UI exists; otherwise number of active choices as step signal.
  return Math.max(block.bubbleCount, block.choices.length + block.continues.length);
}

async function quizBlockFingerprint(page: Page): Promise<string> {
  const state = await inspectLastBlock(page);
  return [
    state.hasPhone ? 'PHONE' : '',
    String(state.bubbleCount),
    state.lastText,
    state.choiceAlreadyMade ? '1' : '0',
    state.choices.map((c) => c.label).join(';'),
    state.continues.map((c) => c.label).join(';'),
  ].join('|');
}

/** Wait until step signal / last block text changes, or phone form. */
async function waitForNewBubbleOrForm(
  page: Page,
  beforeCount: number,
  beforeLastText: string,
  timeoutMs = 10000,
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await pageHasLeadPhone(page)) return true;
    const count = await quizStepSignal(page);
    if (count !== beforeCount) {
      await page.waitForTimeout(400);
      return true;
    }
    const block = await inspectLastBlock(page);
    if (block.lastText && block.lastText !== beforeLastText) {
      await page.waitForTimeout(300);
      return true;
    }
    // Also treat growing chat bubble count as progress when present.
    const bubbles = await page.locator('.chat-bubble, [class*="chat-bubble"]').count().catch(() => 0);
    if (bubbles > beforeCount) {
      await page.waitForTimeout(350);
      return true;
    }
    await page.waitForTimeout(200);
  }
  return false;
}

async function clickLastBlockHit(page: Page, hit: LastBlockHit): Promise<boolean> {
  // Prefer trusted Playwright clicks by visible text; fall back to stored coordinates.
  // Not locked to .chat — works for wizard/marquiz/generic layouts too.
  const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  try {
    if (hit.kind === 'continue' || (hit.mode === 'button' && /продолжить|далее|дальше|next|continue/i.test(hit.label))) {
      const cont = page.locator('button, [role="button"]').filter({ hasText: /продолжить|далее|дальше|next|continue/i }).last();
      if (await cont.count()) {
        await cont.scrollIntoViewIfNeeded({ timeout: 5000 });
        await cont.click({ delay: 30 });
        return true;
      }
    }

    if (hit.mode === 'card') {
      const card = page.locator('.card.cursor-pointer, [class*="card"][class*="cursor"]').filter({ hasText: hit.label.slice(0, 24) }).last();
      if (await card.count()) {
        await card.scrollIntoViewIfNeeded({ timeout: 5000 });
        await card.click({ delay: 40 });
        return true;
      }
    }

    if (hit.mode === 'checkbox-label') {
      const label = page.locator('label').filter({ hasText: new RegExp(`^\\s*${escapeRe(hit.label)}\\s*$`, 'i') }).last();
      if (await label.count()) {
        await label.scrollIntoViewIfNeeded({ timeout: 5000 });
        await label.click({ delay: 30 });
        return true;
      }
    }

    if (hit.mode === 'chip') {
      const chip = page.locator('div.cursor-pointer, [class*="cursor-pointer"], [role="button"]')
        .filter({ hasText: hit.label })
        .last();
      if (await chip.count()) {
        await chip.scrollIntoViewIfNeeded({ timeout: 5000 });
        await chip.click({ delay: 40 });
        return true;
      }
    }

    if (hit.mode === 'button') {
      const btn = page.getByRole('button', { name: new RegExp(escapeRe(hit.label), 'i') }).last();
      if (await btn.count()) {
        await btn.scrollIntoViewIfNeeded({ timeout: 5000 });
        await btn.click({ delay: 30 });
        return true;
      }
    }
  } catch (err) {
    logger.warn({ err, label: hit.label, mode: hit.mode }, 'Locator click failed, falling back to mouse');
  }

  await mouseClickPoint(page, hit.x, hit.y);
  return true;
}

/**
 * Auto-advance quiz/chat — only the last block:
 * 1) click a choice (card / checkbox / chip) in the last block
 * 2) wait for a new block
 * 3) if no new block and still not a form → click the button in that same last block
 * Never touch upper blocks (that restarts the quiz).
 */
export async function advanceQuizUntilForm(
  page: Page,
  options?: {
    containerSelector?: string | null;
    maxSteps?: number;
    timeoutMs?: number;
    openEntry?: boolean;
    /** Pause after each click so the bot can answer (ms). */
    paceMs?: number;
    /** Pick a random unanswered option instead of the first. */
    randomChoice?: boolean;
  },
): Promise<QuizAdvanceResult> {
  const maxSteps = options?.maxSteps ?? 20;
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const paceMs = options?.paceMs ?? 1200;
  const randomChoice = options?.randomChoice !== false;
  const started = Date.now();
  const clickSelectors: string[] = [];
  let openModalSelector: string | null = null;
  let quizContainerSelector = options?.containerSelector?.trim() || null;

  if (await pageHasLeadPhone(page)) {
    return {
      reachedForm: true,
      steps: 0,
      clickSelectors,
      quizContainerSelector,
      openModalSelector,
    };
  }

  // Cookie / consent often blocks the chat.
  const consent = page.getByRole('button', { name: /понятно|согласен|принять/i }).first();
  if (await consent.isVisible().catch(() => false)) {
    await consent.click().catch(() => undefined);
  }

  await page.locator(
    'button, [role="button"], label, .card.cursor-pointer, [class*="cursor-pointer"], .chat-bubble, [class*="quiz" i]',
  ).first()
    .waitFor({ state: 'visible', timeout: 8000 })
    .catch(() => undefined);
  await page.locator('.card.cursor-pointer, label.cursor-pointer, button, div.cursor-pointer.rounded-full, [role="button"]').first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .catch(() => undefined);
  await page.waitForTimeout(Math.max(600, Math.floor(paceMs / 2)));

  if (options?.openEntry !== false) {
    openModalSelector = await tryOpenQuizEntry(page);
    await page.waitForTimeout(paceMs);
  }

  if (!quizContainerSelector) {
    const containers = await findQuizContainers(page);
    if (containers.length > 0) {
      quizContainerSelector = await containers[0].evaluate((el) => {
        const cssEscape = (value: string) => {
          if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(value);
          return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
        };
        if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) return `#${cssEscape(el.id)}`;
        const tag = el.tagName.toLowerCase();
        const cls = Array.from(el.classList).filter(Boolean).slice(0, 2);
        if (cls.length) {
          const candidate = `${tag}.${cls.map(cssEscape).join('.')}`;
          if (document.querySelectorAll(candidate).length <= 3) return candidate;
        }
        return null;
      }).catch(() => null);
    }
  }

  let steps = 0;
  let idleRounds = 0;

  while (steps < maxSteps && Date.now() - started < timeoutMs) {
    const block = await inspectLastBlock(page);

    if (block.hasPhone || await pageHasLeadPhone(page)) {
      logger.info({ steps, elapsedMs: Date.now() - started }, 'Quiz reached lead phone form');
      return {
        reachedForm: true,
        steps,
        clickSelectors,
        quizContainerSelector,
        openModalSelector,
      };
    }

    logger.info(
      {
        step: steps,
        bubbleCount: block.bubbleCount,
        lastText: block.lastText.slice(0, 80),
        choiceAlreadyMade: block.choiceAlreadyMade,
        choices: block.choices.map((c) => c.label).slice(0, 6),
        continues: block.continues.map((c) => c.label),
      },
      'Quiz last block',
    );

    const beforeText = block.lastText;

    // Already answered this block (card selected / checkbox checked) → only Continue.
    // Do not click sibling checkboxes/cards — that toggles state and stalls the quiz.
    if (block.choiceAlreadyMade && block.continues.length > 0) {
      const countBefore = await quizStepSignal(page);
      await page.waitForTimeout(paceMs);
      await clickLastBlockHit(page, block.continues[0]);
      steps += 1;
      idleRounds = 0;
      logger.info({ step: steps, label: block.continues[0].label }, 'Quiz last-block continue (choice already made)');
      const moved = await waitForNewBubbleOrForm(page, countBefore, beforeText, 14000);
      if (!moved) {
        idleRounds += 1;
        if (idleRounds >= 3) break;
      }
      await page.waitForTimeout(paceMs);
      continue;
    }

    // 1) Choice in the last block only (random among unanswered).
    if (block.choices.length > 0) {
      const hit = randomChoice ? pickRandom(block.choices) : block.choices[0];
      const countBeforeChoice = await quizStepSignal(page);
      await clickLastBlockHit(page, hit);
      steps += 1;
      idleRounds = 0;
      logger.info({ step: steps, label: hit.label, mode: hit.mode, random: randomChoice }, 'Quiz last-block choice');

      // Wait patiently for the operator/bot to reply with the next block.
      await page.waitForTimeout(paceMs);
      const advanced = await waitForNewBubbleOrForm(page, countBeforeChoice, beforeText, 12000);

      if (await pageHasLeadPhone(page)) {
        break;
      }

      if (advanced) {
        await page.waitForTimeout(paceMs);
        continue;
      }

      // Extra patience before Continue — UI may still unlock the button.
      await page.waitForTimeout(paceMs);

      // 2) No new block and not a form → button in THIS last block.
      const afterChoice = await inspectLastBlock(page);
      if (afterChoice.continues.length > 0) {
        const countBeforeCont = await quizStepSignal(page);
        await clickLastBlockHit(page, afterChoice.continues[0]);
        steps += 1;
        logger.info({ step: steps, label: afterChoice.continues[0].label }, 'Quiz last-block continue (stuck)');
        await waitForNewBubbleOrForm(page, countBeforeCont, afterChoice.lastText, 14000);
        await page.waitForTimeout(paceMs);
        continue;
      }

      // Choice made (card/chip) but next bubble slow — wait a bit more.
      if (afterChoice.choiceAlreadyMade || hit.mode === 'chip' || hit.mode === 'card') {
        await waitForNewBubbleOrForm(page, countBeforeChoice, beforeText, 8000);
        await page.waitForTimeout(paceMs);
        continue;
      }

      await page.waitForTimeout(paceMs);
      continue;
    }

    // Only continue left.
    if (block.continues.length > 0) {
      const countBeforeCont = await quizStepSignal(page);
      await page.waitForTimeout(paceMs);
      await clickLastBlockHit(page, block.continues[0]);
      steps += 1;
      idleRounds = 0;
      logger.info({ step: steps, label: block.continues[0].label }, 'Quiz last-block continue');
      const moved = await waitForNewBubbleOrForm(page, countBeforeCont, beforeText, 14000);
      if (!moved) {
        idleRounds += 1;
        if (idleRounds >= 3) break;
      }
      await page.waitForTimeout(paceMs);
      continue;
    }

    idleRounds += 1;
    logger.info({ steps, idleRounds, lastText: block.lastText.slice(0, 60) }, 'Quiz last block idle');

    // After the last quiz answer the bot asks for a phone — input mounts with a delay.
    if (await pageAsksForPhone(page)) {
      logger.info({ steps }, 'Waiting for lead phone input after quiz');
      if (await waitForLeadPhone(page, 15000)) {
        return {
          reachedForm: true,
          steps,
          clickSelectors,
          quizContainerSelector,
          openModalSelector,
        };
      }
    }

    // Answered block without Continue (e.g. gift chips) — wait briefly for the next bubble.
    if (block.choiceAlreadyMade && block.choices.length === 0 && block.continues.length === 0) {
      await waitForNewBubbleOrForm(page, block.bubbleCount, block.lastText, 8000);
      if (await pageHasLeadPhone(page)) {
        return {
          reachedForm: true,
          steps,
          clickSelectors,
          quizContainerSelector,
          openModalSelector,
        };
      }
      if (await pageAsksForPhone(page) && await waitForLeadPhone(page, 12000)) {
        return {
          reachedForm: true,
          steps,
          clickSelectors,
          quizContainerSelector,
          openModalSelector,
        };
      }
    }

    if (idleRounds >= 6) {
      break;
    }
    await page.waitForTimeout(paceMs);
  }

  const reachedForm = await pageHasLeadPhone(page);
  logger.info(
    { reachedForm, steps, elapsedMs: Date.now() - started, quizContainerSelector },
    'Quiz advance finished',
  );

  return {
    reachedForm,
    steps,
    clickSelectors,
    quizContainerSelector,
    openModalSelector,
  };
}

/**
 * Run mapped pre-form clicks in order (extension / manual path).
 */
export async function runSelectorPreFormClicks(
  page: Page,
  selectors: string[],
): Promise<number> {
  let clicked = 0;

  for (const raw of selectors) {
    const selector = raw?.trim();
    if (!selector) {
      continue;
    }

    if (await pageHasLeadPhone(page)) {
      break;
    }

    const target = page.locator(selector).filter({ visible: true }).first();
    if ((await target.count()) === 0) {
      logger.warn({ selector }, 'Pre-form click selector miss');
      continue;
    }

    await target.scrollIntoViewIfNeeded().catch(() => undefined);
    const box = await target.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await target.click({ timeout: 8000 }).catch(async () => {
        await target.click({ timeout: 5000, force: true }).catch(() => undefined);
      });
    }
    clicked += 1;
    logger.info({ selector, clicked }, 'Pre-form step clicked');
    await page.waitForTimeout(1200);
  }

  return clicked;
}

/**
 * Unified pre-form runner used by submit_lead.
 */
export async function runPreFormSteps(page: Page, mapping: PreFormMapping): Promise<void> {
  const selectors = Array.isArray(mapping.pre_form_click_selectors)
    ? mapping.pre_form_click_selectors.filter((s): s is string => Boolean(s && String(s).trim()))
    : [];

  const strategy = mapping.pre_form_strategy
    ?? (selectors.length > 0 ? 'selectors' : null);

  if (strategy === 'selectors' && selectors.length > 0) {
    await runSelectorPreFormClicks(page, selectors);
    return;
  }

  if (strategy === 'quiz_auto') {
    await advanceQuizUntilForm(page, {
      containerSelector: mapping.quiz_container_selector,
      openEntry: !mapping.open_modal_selector,
      maxSteps: 20,
      timeoutMs: 120_000,
      paceMs: 1400,
      randomChoice: true,
    });
  }
}
