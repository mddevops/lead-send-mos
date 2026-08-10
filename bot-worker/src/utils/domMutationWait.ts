/**
 * Shared DOM wait helpers (MutationObserver via page.evaluate).
 * Additive — does not replace existing timeouts/polling.
 */
import { Frame, Page } from 'playwright';

export type DomMutationSummary = {
  addedNodes: number;
  characterData: number;
  childList: number;
  sawModalHint: boolean;
  sawSuccessHint: boolean;
  sampleText: string;
};

/**
 * Observe DOM mutations for a short window after submit / CTA click.
 * Returns a compact summary for successScore — never throws.
 */
export async function observeDomMutations(
  page: Page,
  options?: { timeoutMs?: number; successTextPatternSource?: string },
): Promise<DomMutationSummary> {
  const timeoutMs = options?.timeoutMs ?? 3500;
  const successSource = options?.successTextPatternSource
    ?? String(/спасибо|заявка\s+(?:успешно\s+)?отправлена|мы\s+свяжемся|успешно|отправлено|принято/i);

  try {
    return await page.evaluate(
      async ({ waitMs, successSrc }) => {
        const summary = {
          addedNodes: 0,
          characterData: 0,
          childList: 0,
          sawModalHint: false,
          sawSuccessHint: false,
          sampleText: '',
        };

        let successRe: RegExp | null = null;
        try {
          // successSrc is a RegExp.toString() like /foo/i
          const match = /^\/(.+)\/([a-z]*)$/i.exec(successSrc);
          successRe = match ? new RegExp(match[1], match[2]) : new RegExp(successSrc, 'i');
        } catch {
          successRe = /спасибо|успешно|отправлено|принято|свяжемся/i;
        }

        const samples: string[] = [];

          const deadline = Date.now() + waitMs;
          await new Promise<void>((resolve) => {
            const finish = () => {
              observer.disconnect();
              summary.sampleText = samples.slice(0, 3).join(' | ').slice(0, 400);
              resolve();
            };

            const observer = new MutationObserver((mutations) => {
              for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                  summary.childList += 1;
                  summary.addedNodes += mutation.addedNodes.length;

                  for (const node of mutation.addedNodes) {
                    if (!(node instanceof HTMLElement)) {
                      continue;
                    }

                    const cls = typeof node.className === 'string' ? node.className : '';
                    if (/modal|popup|dialog|toast|alert|success|уведомл/i.test(cls) || node.getAttribute('role') === 'dialog') {
                      summary.sawModalHint = true;
                    }

                    const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
                    if (text && text.length < 240) {
                      samples.push(text);
                      if (successRe && successRe.test(text)) {
                        summary.sawSuccessHint = true;
                      }
                    }
                  }
                }

                if (mutation.type === 'characterData') {
                  summary.characterData += 1;
                  const text = (mutation.target.textContent || '').replace(/\s+/g, ' ').trim();
                  if (text && successRe && successRe.test(text)) {
                    summary.sawSuccessHint = true;
                    samples.push(text.slice(0, 120));
                  }
                }
              }

              // Stop early once success is visible — don't burn the full wait window.
              if (summary.sawSuccessHint) {
                finish();
              }
            });

            observer.observe(document.documentElement, {
              childList: true,
              subtree: true,
              characterData: true,
            });

            window.setTimeout(finish, Math.max(0, deadline - Date.now()));
          });

        return summary;
      },
      { waitMs: timeoutMs, successSrc: successSource },
    );
  } catch {
    return {
      addedNodes: 0,
      characterData: 0,
      childList: 0,
      sawModalHint: false,
      sawSuccessHint: false,
      sampleText: '',
    };
  }
}

/** Wait until lead-like inputs appear (MutationObserver + timeout). */
export async function waitForLeadInputsViaMutation(
  target: Page | Frame,
  timeoutMs = 8000,
): Promise<boolean> {
  try {
    return await target.evaluate(async (waitMs) => {
      const hasLead = () => {
        const phones = document.querySelectorAll(
          'input[type="tel"], input[inputmode="tel"], input[name*="phone" i], input[name*="tel" i], input[placeholder*="тел" i], input[placeholder*="phone" i]',
        );
        if (phones.length > 0) {
          return true;
        }

        return document.querySelectorAll('form input, form button[type="submit"]').length >= 2;
      };

      if (hasLead()) {
        return true;
      }

      return new Promise<boolean>((resolve) => {
        const observer = new MutationObserver(() => {
          if (hasLead()) {
            observer.disconnect();
            resolve(true);
          }
        });

        observer.observe(document.documentElement, { childList: true, subtree: true });
        window.setTimeout(() => {
          observer.disconnect();
          resolve(hasLead());
        }, waitMs);
      });
    }, timeoutMs);
  } catch {
    return false;
  }
}
