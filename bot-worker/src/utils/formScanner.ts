import pino from 'pino';
import { Page } from 'playwright';
import { config } from '../config';
import { getCollectFormsInDocument } from './browserEvaluate';
import { dismissCommonOverlays, humanWarmupScroll, relativizeSelector, scrollPageToRevealContent, closeOpenModal, openFormModal } from './formInteractions';
import { waitForLeadInputsViaMutation } from './domMutationWait';
import { buildIframeSelector, discoverFormsViaModals, discoverFormsViaQuiz } from './formModalDiscovery';
import { pageLooksLikeQuiz } from './quizAdvance';
import { navigateToUrl } from './navigate';
import {
  clampMaxFormsPerSite,
  dealerBrandPathRegex,
  enqueuePrioritized,
  isBrandListingUrl,
  isBrandModelListingUrl,
  isDealerBrandUrl,
  isLowValueUrl,
  isModelCardUrl,
  isOfferCardUrl,
  isStockListingUrl,
  MAX_LINKS_PER_PAGE,
  MAX_PAGES_MULTI_CRAWL,
  MAX_PAGES_TO_CRAWL,
  normalizePageUrl,
  prioritizeLinks,
  scoreLink,
  seedHighValueUrls,
  URL_SCORE_HTML_LEAD_HINT,
  URL_SCORE_LOW_VALUE,
} from './formScanUtils';
import { isLeadPhoneSelector, MIN_FORM_SCORE } from './formDetectionConstants';
import { discoverUrlsFromRobotsAndSitemaps, pageHtmlLooksLikeLeadForm } from './urlDiscovery';

export type DetectedFormMapping = {
  source_url: string;
  name_selector: string | null;
  first_name_selector?: string | null;
  last_name_selector?: string | null;
  email_selector?: string | null;
  select_selectors?: string[] | null;
  phone_selector: string;
  submit_selector: string;
  consent_checkbox_selector: string | null;
  consent_checkbox_selectors: string[];
  form_scope_selector: string | null;
  open_modal_selector: string | null;
  pre_form_click_selectors?: string[] | null;
  pre_form_strategy?: 'selectors' | 'quiz_auto' | null;
  quiz_container_selector?: string | null;
  iframe_selector?: string | null;
  confidence: number;
  fingerprint: string;
  captcha_type?: 'none' | 'yandex_smartcaptcha' | 'google_recaptcha_v2' | 'hcaptcha';
  captcha_yandex_mode?: 'checkbox' | 'slider' | null;
  captcha_iframe_selector?: string | null;
  captcha_checkbox_selector?: string | null;
  captcha_token_selector?: string | null;
};

export type ScanSiteOptions = {
  maxForms?: number;
  /** How many internal pages to visit (default MAX_PAGES_TO_CRAWL). */
  maxPages?: number;
  /**
   * Keep the same footer/form selectors on different URLs as separate mappings.
   * Needed so submit can randomly pick a page per site.
   */
  oneMappingPerPage?: boolean;
  /** Click CTA buttons / open modals looking for hidden lead forms. */
  discoverModals?: boolean;
};

const logger = pino({ name: 'form-scanner' });

export type ScanDiagnostics = {
  pagesVisited: number;
  pageErrors: string[];
  phonesSeen: number;
  formsScanned: number;
  formsFound: number;
  modalTriggersTried: number;
  modalEntryPoints: number;
  inlineForms: number;
  modalForms: number;
  quizForms: number;
  brandPagesExpanded: number;
};

export async function scanSiteForForms(
  page: Page,
  startUrl: string,
  options?: ScanSiteOptions,
): Promise<{ forms: DetectedFormMapping[]; diagnostics: ScanDiagnostics }> {
  const maxForms = clampMaxFormsPerSite(options?.maxForms);
  // Prefer one mapping per page URL so identical lead forms on /kia/rio/1 and /kia/rio/2 are both kept.
  const oneMappingPerPage = options?.oneMappingPerPage !== false;
  const discoverModals = options?.discoverModals !== false;
  const maxPages = Math.max(
    1,
    Math.min(
      MAX_PAGES_MULTI_CRAWL,
      options?.maxPages ?? (oneMappingPerPage ? Math.min(MAX_PAGES_MULTI_CRAWL, 24) : MAX_PAGES_TO_CRAWL),
    ),
  );
  const baseUrl = normalizePageUrl(startUrl);
  const found: DetectedFormMapping[] = [];
  const seenFingerprints = new Set<string>();
  const visited = new Set<string>();
  // Start with homepage ONLY. /credit /contacts /new are seeded later —
  // only if the homepage is not a quiz funnel (or quiz advance failed).
  const queue: string[] = [baseUrl];
  const htmlHintBoost = new Map<string, number>();
  let deferredCrawlSeeded = false;

  const pageErrors: string[] = [];
  let phonesSeen = 0;
  let formsScanned = 0;
  let modalTriggersTried = 0;
  let modalEntryPoints = 0;
  let inlineForms = 0;
  let modalForms = 0;
  let quizForms = 0;
  let brandPagesExpanded = 0;
  const brandUrlsSeen = new Set<string>();

  logger.info(
    { startUrl: baseUrl, maxForms, maxPages, oneMappingPerPage, discoverModals, queueSeeded: queue.length },
    'Starting flexible form scan (homepage first; contact/credit seeds deferred)',
  );

  const seedDealerPagesIfNeeded = async (reason: string) => {
    if (deferredCrawlSeeded) {
      return;
    }
    if (found.some((form) => form.pre_form_strategy === 'quiz_auto')) {
      deferredCrawlSeeded = true;
      logger.info({ reason, found: found.length }, 'Skip contact/credit seeds — quiz mapping already saved');
      return;
    }
    if (found.some((form) => form.confidence >= 70) && found.length >= Math.min(2, maxForms)) {
      deferredCrawlSeeded = true;
      logger.info({ reason, found: found.length }, 'Skip contact/credit seeds — strong forms already found');
      return;
    }

    deferredCrawlSeeded = true;
    for (const seeded of seedHighValueUrls(baseUrl)) {
      if (seeded !== baseUrl && !visited.has(seeded) && !queue.includes(seeded)) {
        queue.push(seeded);
      }
    }

    const sitemapUrls = await discoverUrlsFromRobotsAndSitemaps(baseUrl);
    if (sitemapUrls.length > 0) {
      logger.info({ count: sitemapUrls.length }, 'Sitemap/robots URL discovery finished');
      enqueuePrioritized(queue, sitemapUrls.slice(0, 120), baseUrl, visited);
    }

    if (queue.length > 1) {
      queue.splice(0, queue.length, queue[0], ...prioritizeLinks(queue.slice(1), baseUrl));
    }

    logger.info({ reason, queueSize: queue.length }, 'Seeded contact/credit/catalog pages after homepage pass');
  };

  // Stop as soon as TARGET_FORMS is reached — do not keep crawling past maxForms.
  let pagesScanned = 0;
  /**
   * Brand/model listings share one template.
   * Probe the first one for forms; then never form-scan sibling brand/model pages.
   */
  let brandModelFormProbed = false;
  let brandModelListingHasForm = false;

  while (queue.length > 0 && pagesScanned < maxPages) {
    if (found.length >= maxForms) {
      logger.info({ found: found.length, maxForms }, 'Target forms reached — stopping page crawl');
      break;
    }

    const currentUrl = queue.shift();

    if (!currentUrl || visited.has(currentUrl)) {
      continue;
    }

    // After the first brand/model probe — skip other brands/models (same shell).
    // Offer cards and non-listing pages stay in play.
    if (isBrandModelListingUrl(currentUrl) && brandModelFormProbed) {
      visited.add(currentUrl);
      logger.info(
        { url: currentUrl, brandModelListingHasForm },
        'Skip brand/model listing — already probed template',
      );
      continue;
    }

    // Skip low-value utility pages unless we still have almost nothing.
    if (isLowValueUrl(currentUrl) && !isModelCardUrl(currentUrl) && found.length > 0) {
      visited.add(currentUrl);
      continue;
    }

    visited.add(currentUrl);

    // Optional fast HTML precheck — boosts priority for siblings, never hard-blocks JS forms.
    // Only used as soft signal for already-queued pages when score is borderline.
    const linkScore = scoreLink(currentUrl, baseUrl) + (htmlHintBoost.get(currentUrl) ?? 0);
    if (linkScore <= URL_SCORE_LOW_VALUE + 5 && found.length >= Math.min(3, maxForms) && !isModelCardUrl(currentUrl)) {
      continue;
    }

    const onStockListing = isStockListingUrl(currentUrl);
    const onBrandModelListing = isBrandModelListingUrl(currentUrl);

    try {
      await navigateToPage(page, currentUrl);
      pagesScanned += 1;

      if (await isBlockedByAntiBot(page)) {
        pageErrors.push(`${currentUrl}: anti-bot block page detected`);
        logger.warn({ url: currentUrl }, 'Anti-bot block page — forms may be missing');
      }

      await dismissCommonOverlays(page);
      await page.waitForSelector('body', { timeout: 10000 }).catch(() => undefined);

      const isHomepage = normalizePageUrl(currentUrl) === baseUrl;

      // Prefer short settle over networkidle (analytics widgets never go idle on dealer sites).
      // Homepage may host a chat quiz — give it more time to mount bubbles/cards.
      const settleMs = isHomepage
        ? Math.max(config.BOT_SCAN_PAGE_WAIT_MS, 2500)
        : isModelCardUrl(currentUrl)
          ? Math.min(config.BOT_SCAN_PAGE_WAIT_MS, 900)
          : onStockListing
            ? Math.min(config.BOT_SCAN_PAGE_WAIT_MS, 900)
            : Math.min(config.BOT_SCAN_PAGE_WAIT_MS, 1500);
      await page.waitForTimeout(settleMs);
      await humanWarmupScroll(page);

      if (!isModelCardUrl(currentUrl) || pagesScanned <= 2) {
        await scrollPageToRevealContent(page);
      }

      if (isHomepage) {
        // Wait for any answer-like UI (chat, cards, chips, buttons) — not a specific CSS framework.
        await page.locator(
          'button, [role="button"], label, .card.cursor-pointer, [class*="cursor-pointer"], .chat-bubble, [class*="quiz" i]',
        ).first()
          .waitFor({ state: 'visible', timeout: 8000 })
          .catch(() => undefined);
      }

      await waitForDetectableForms(page);
      await page.waitForSelector(
        'input, textarea, button, form, label, [role="button"], .card.cursor-pointer, [class*="cursor-pointer"]',
        { timeout: 4000 },
      ).catch(() => undefined);

      let pageStats = await page.evaluate(() => ({
        inputs: document.querySelectorAll('input').length,
        forms: document.querySelectorAll('form').length,
        phones: document.querySelectorAll(
          'input[type="tel"], input[data-type="PHONE"], input[name*="phone" i], input[placeholder*="тел" i]',
        ).length,
        answerControls: document.querySelectorAll(
          'button, [role="button"], label, .card.cursor-pointer, [class*="cursor-pointer"]',
        ).length,
      }));

      // Tilda / heavy promo landing: scripts sometimes finish late.
      if (pageStats.inputs === 0 && pageStats.forms === 0 && pageStats.answerControls < 2) {
        await page.waitForTimeout(2000);
        await scrollPageToRevealContent(page);
        await waitForDetectableForms(page);
        pageStats = await page.evaluate(() => ({
          inputs: document.querySelectorAll('input').length,
          forms: document.querySelectorAll('form').length,
          phones: document.querySelectorAll(
            'input[type="tel"], input[data-type="PHONE"], input[name*="phone" i], input[placeholder*="тел" i]',
          ).length,
          answerControls: document.querySelectorAll(
            'button, [role="button"], label, .card.cursor-pointer, [class*="cursor-pointer"]',
          ).length,
        }));
      }

      logger.info({ url: currentUrl, score: linkScore, ...pageStats }, 'Scanning page');

      const foundBeforePage = found.length;
      const pageForms = await detectFormsOnCurrentPage(page, currentUrl);
      phonesSeen += pageForms.phonesSeen;
      formsScanned += pageForms.formsScanned;
      inlineForms += pageForms.forms.length;

      const captcha = await detectCaptchaOnPage(page);
      const formsWithCaptcha = pageForms.forms.map((form) => ({
        ...form,
        ...captcha,
      }));

      await appendValidatedForms(page, found, seenFingerprints, formsWithCaptcha, {
        oneMappingPerPage,
        maxForms,
      });

      // Chat/quiz FIRST (before modal CTA clicks that can leave the homepage).
      let looksLikeQuiz = await pageLooksLikeQuiz(page);
      const hasQuizMapping = found.some((form) => form.pre_form_strategy === 'quiz_auto');
      const stillNeedsForm = !found.some((form) => form.confidence >= 70) && found.length < maxForms;
      const shouldTryQuiz = discoverModals
        && !hasQuizMapping
        && found.length < maxForms
        && (stillNeedsForm || looksLikeQuiz || isHomepage);

      if (shouldTryQuiz && (looksLikeQuiz || isHomepage)) {
        if (!looksLikeQuiz && isHomepage) {
          // One more wait — tenet chat mounts after hero/consent.
          await page.waitForTimeout(2000);
          looksLikeQuiz = await pageLooksLikeQuiz(page);
        }

        if (looksLikeQuiz || stillNeedsForm) {
          logger.info({ url: currentUrl, looksLikeQuiz, isHomepage }, 'Trying quiz/chat advance before other pages');
          const quizResult = await discoverFormsViaQuiz(page, currentUrl);
          quizForms += quizResult.forms.length;

          const quizWithCaptcha = quizResult.forms.map((form) => ({
            ...form,
            ...captcha,
          }));

          await appendValidatedForms(page, found, seenFingerprints, quizWithCaptcha, {
            oneMappingPerPage,
            maxForms,
          });

          logger.info(
            {
              url: currentUrl,
              quizFormsFound: quizResult.forms.length,
              steps: quizResult.steps,
              reachedForm: quizResult.reachedForm,
              looksLikeQuiz,
            },
            'Quiz/chat discovery finished',
          );

          if (quizResult.forms.length > 0) {
            logger.info(
              { url: currentUrl, found: found.length },
              'Quiz form saved — stopping further page crawl',
            );
            break;
          }
        }
      }

      // Skip heavy modal probing only when we already have a high-confidence lead form.
      const hasStrongForm = found.some((form) => form.confidence >= 70);
      const skipModals = found.some((form) => form.confidence >= 90) || found.length >= maxForms;

      if (discoverModals && !skipModals) {
        const modalResult = await discoverFormsViaModals(page, currentUrl, {
          maxTriggers: found.length > 0 ? 3 : undefined,
        });
        modalTriggersTried += modalResult.triggersTried;
        modalEntryPoints += modalResult.entryPointsFound;
        modalForms += modalResult.forms.length;

        const modalWithCaptcha = modalResult.forms.map((form) => ({
          ...form,
          ...captcha,
        }));

        await appendValidatedForms(page, found, seenFingerprints, modalWithCaptcha, {
          oneMappingPerPage,
          maxForms,
        });

        logger.info(
          {
            url: currentUrl,
            triggersTried: modalResult.triggersTried,
            entryPoints: modalResult.entryPointsFound,
            modalFormsFound: modalResult.forms.length,
          },
          'Modal discovery finished',
        );
      }

      // Homepage done without a quiz mapping → now allow /credit /contacts crawl.
      if (isHomepage) {
        await seedDealerPagesIfNeeded(found.length > 0 ? 'homepage_had_forms' : 'homepage_no_quiz_form');
      }

      const foundOnThisPage = found.length > foundBeforePage;

      if (onBrandModelListing && !brandModelFormProbed) {
        brandModelFormProbed = true;
        brandModelListingHasForm = foundOnThisPage;
        logger.info(
          {
            url: currentUrl,
            brandModelListingHasForm,
            foundOnThisPage,
          },
          brandModelListingHasForm
            ? 'Brand/model listing has a form — skip sibling brand/model pages'
            : 'Brand/model listing has no form — skip sibling brand/model pages, prefer offer cards',
        );

        // Shared template: never walk peugeot/408, opel/corsa, … after the first probe.
        const withoutSiblingListings = queue.filter((url) => !isBrandModelListingUrl(url));
        queue.splice(0, queue.length, ...withoutSiblingListings);
      }

      if (found.length >= maxForms) {
        logger.info({ found: found.length, maxForms, pagesScanned }, 'Target forms reached after page scan');
        break;
      }

      if (maxPages > 1) {
        const links = await collectInternalLinks(page, baseUrl);
        const cardLinks = links.filter((link) => isOfferCardUrl(link) || isModelCardUrl(link));
        let otherLinks = links.filter((link) => !isOfferCardUrl(link) && !isModelCardUrl(link));

        // After brand/model probe — do not enqueue more brand/model filters.
        if (brandModelFormProbed) {
          otherLinks = otherLinks.filter((link) => !isBrandModelListingUrl(link));
        }

        for (const link of links) {
          if (isDealerBrandUrl(link) || isModelCardUrl(link) || isBrandListingUrl(link)) {
            brandUrlsSeen.add(normalizePageUrl(link));
          }
        }

        // Card links first (high priority), then the rest.
        if (cardLinks.length > 0) {
          enqueuePrioritized(queue, cardLinks, baseUrl, visited);
        }

        enqueuePrioritized(queue, otherLinks, baseUrl, visited);

        // Soft HTML hint for a few top unscored cards (non-blocking budget).
        if (found.length > 0 && cardLinks.length > 0) {
          const sample = cardLinks.filter((url) => !visited.has(url)).slice(0, 4);
          await Promise.all(
            sample.map(async (url) => {
              const hint = await pageHtmlLooksLikeLeadForm(url);
              if (hint === true) {
                htmlHintBoost.set(url, URL_SCORE_HTML_LEAD_HINT);
              }
            }),
          );
          // Re-order front of queue after hints.
          queue.splice(0, queue.length, ...prioritizeLinks(queue, baseUrl));
        }

        if (oneMappingPerPage && links.length === 0 && found.length > 0) {
          const hashUrls = await collectHashPageUrls(page, baseUrl, maxForms);

          for (const hashUrl of hashUrls) {
            const template = found[0];
            const pageUrl = normalizePageUrl(hashUrl);

            if (found.some((item) => normalizePageUrl(item.source_url) === pageUrl)) {
              continue;
            }

            found.push({
              ...template,
              source_url: pageUrl,
              fingerprint: `${pageUrl}|${template.fingerprint}`,
              confidence: Math.min(100, template.confidence),
            });

            if (found.length >= maxForms) {
              break;
            }
          }
        }
      }

      logger.info(
        {
          url: currentUrl,
          foundOnPage: pageForms.forms.length,
          phonesSeen: pageForms.phonesSeen,
          formsScanned: pageForms.formsScanned,
          totalFound: found.length,
          queueLeft: queue.length,
          captchaType: captcha.captcha_type,
        },
        'Page scan complete',
      );

      // After a solid form on a model card — prefer sibling cards and stop once target filled.
      if (hasStrongForm && found.length >= maxForms) {
        logger.info(
          { found: found.length, pagesScanned, queueLeft: queue.length },
          'Target forms filled — stopping crawl early',
        );
        break;
      }

      if (hasStrongForm && isModelCardUrl(currentUrl) && found.length > 0) {
        // Keep crawling only offer cards; drop stock filter tails.
        const cardOnly = queue.filter((url) => isOfferCardUrl(url) || isModelCardUrl(url));
        if (cardOnly.length > 0) {
          queue.splice(0, queue.length, ...prioritizeLinks(cardOnly, baseUrl));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pageErrors.push(`${currentUrl}: ${message}`);
      logger.warn({ url: currentUrl, err: message }, 'Failed to scan page');
      // Do not flood /credit /contacts after a hard homepage 404 — those seeds 404 too on quiz SPAs.
      if (normalizePageUrl(currentUrl) === baseUrl && !/^HTTP 4\d\d$/i.test(message.trim())) {
        await seedDealerPagesIfNeeded('homepage_scan_error');
      }
    }
  }

  // Multi-brand / multi-card: clone template onto other car pages until maxForms.
  // Do not clone quiz_auto mappings onto /credit /model pages.
  if (found.length < maxForms && !found.some((form) => form.pre_form_strategy === 'quiz_auto')) {
    brandPagesExpanded = await expandMappingsAcrossBrandPages(page, baseUrl, found, {
      brandUrls: [...brandUrlsSeen],
      maxForms,
      oneMappingPerPage,
    });
  }

  const forms = found
    .sort((left, right) => rankDetectedForm(right) - rankDetectedForm(left))
    .slice(0, maxForms);

  const diagnostics: ScanDiagnostics = {
    pagesVisited: pagesScanned,
    pageErrors,
    phonesSeen,
    formsScanned,
    formsFound: forms.length,
    modalTriggersTried,
    modalEntryPoints,
    inlineForms,
    modalForms,
    quizForms,
    brandPagesExpanded,
  };

  logger.info(diagnostics, 'Flexible form scan finished');

  return { forms, diagnostics };
}

function mappingDedupeKey(form: DetectedFormMapping, oneMappingPerPage: boolean): string {
  const base = [
    form.form_scope_selector ?? 'no-scope',
    form.phone_selector,
    form.submit_selector,
    form.open_modal_selector ?? 'inline',
    form.iframe_selector ?? 'main',
  ].join('|');

  return oneMappingPerPage ? `${normalizePageUrl(form.source_url)}|${base}` : base;
}

function rankDetectedForm(form: DetectedFormMapping): number {
  let score = form.confidence;

  if (form.name_selector && form.name_selector !== 'input[name="name"]') {
    score += 5;
  } else if (!form.name_selector) {
    // Phone-only lead forms are valid and common on dealer sites.
    score += 2;
  }

  if (form.consent_checkbox_selectors.length > 0) {
    score += 3;
  }

  if (form.open_modal_selector) {
    score += 20;
  }

  if (form.iframe_selector) {
    score += 4;
  }

  if (/data-submit=["']?(CALLBACK|BUY|CONTACTS)/i.test(form.submit_selector)) {
    score += 25;
  }

  if (/data-submit=["']?CALC/i.test(form.submit_selector)) {
    score -= 20;
  }

  if (/#vin\b|#year\b/i.test(form.phone_selector)) {
    score -= 40;
  }

  return score;
}

async function validateFormOnPage(page: Page, form: DetectedFormMapping): Promise<boolean> {
  if (form.confidence < MIN_FORM_SCORE) {
    logger.warn(
      { sourceUrl: form.source_url, confidence: form.confidence, min: MIN_FORM_SCORE },
      'Form rejected: confidence below minimum',
    );
    return false;
  }

  // Modal forms are validated at discovery time (after click); fields may be closed now.
  if (form.open_modal_selector) {
    return true;
  }

  if (form.iframe_selector) {
    const frame = page.frameLocator(form.iframe_selector).first();
    const phoneCount = await frame.locator(form.phone_selector).count().catch(() => 0);
    const submitCount = await frame.locator(form.submit_selector).count().catch(() => 0);

    if (phoneCount > 0 && submitCount > 0) {
      return true;
    }

    logger.warn(
      {
        sourceUrl: form.source_url,
        iframe: form.iframe_selector,
        phone: form.phone_selector,
        submit: form.submit_selector,
        phoneCount,
        submitCount,
      },
      'Form rejected: iframe fields not found',
    );
    return false;
  }

  const scope = form.form_scope_selector
    ? page.locator(form.form_scope_selector).filter({ visible: true }).first()
    : page.locator('body');

  // Fall back to first match when the visible filter finds nothing (opacity animations).
  const scopeFallback = form.form_scope_selector
    ? page.locator(form.form_scope_selector).first()
    : page.locator('body');
  const resolvedScope = (await scope.count().catch(() => 0)) > 0 ? scope : scopeFallback;

  if ((await resolvedScope.count().catch(() => 0)) < 1) {
    logger.warn(
      { sourceUrl: form.source_url, scope: form.form_scope_selector },
      'Form rejected: scope selector not found',
    );
    return false;
  }

  const rel = (selector: string): string => relativizeSelector(selector, form.form_scope_selector);

  let phoneField = resolvedScope.locator(rel(form.phone_selector)).filter({ visible: true });
  let submitButton = resolvedScope.locator(rel(form.submit_selector)).filter({ visible: true });

  let phoneCount = await phoneField.count().catch(() => 0);
  let submitCount = await submitButton.count().catch(() => 0);

  if (phoneCount < 1) {
    phoneField = resolvedScope.locator(rel(form.phone_selector));
    phoneCount = await phoneField.count().catch(() => 0);
  }

  if (submitCount < 1) {
    submitButton = resolvedScope.locator(rel(form.submit_selector));
    submitCount = await submitButton.count().catch(() => 0);
  }

  // Nuxt/Vue: <button class="button--form"> without type="submit" attr.
  if (submitCount < 1) {
    submitButton = resolvedScope.locator(
      [
        'button.button--form',
        'button.form__btn',
        'button[type="submit"]',
        'input[type="submit"]',
        'a.button--success',
        'a.button',
        'button:has-text("Перезвоните")',
        'button:has-text("Отправить")',
        'button:has-text("Заказать")',
        'button:has-text("Оставить")',
        'button:has-text("Получить")',
        'a:has-text("Купить в кредит")',
      ].join(', '),
    );
    submitCount = await submitButton.count().catch(() => 0);
  }

  if (phoneCount < 1) {
    phoneField = resolvedScope.locator(
      'input[type="tel"], input[placeholder*="Телефон" i], input[placeholder*="телефон" i], input[inputmode="numeric"], input[inputmode="tel"]',
    );
    phoneCount = await phoneField.count().catch(() => 0);
  }

  if (phoneCount < 1 || submitCount < 1) {
    logger.warn(
      {
        sourceUrl: form.source_url,
        scope: form.form_scope_selector,
        phone: form.phone_selector,
        submit: form.submit_selector,
        phoneCount,
        submitCount,
      },
      'Form rejected: phone/submit not found in scope',
    );
    return false;
  }

  await phoneField.first().scrollIntoViewIfNeeded().catch(() => undefined);
  await submitButton.first().scrollIntoViewIfNeeded().catch(() => undefined);

  const phoneVisible = await phoneField.first().isVisible().catch(() => false);
  const submitVisible = await submitButton.first().isVisible().catch(() => false);

  // Cookie banners / sticky headers may cover fields; presence in DOM is enough for mapping.
  if (phoneVisible && submitVisible) {
    return true;
  }

  const phoneAttached = await phoneField.first().count().catch(() => 0);
  const submitAttached = await submitButton.first().count().catch(() => 0);

  if (phoneAttached > 0 && submitAttached > 0) {
    logger.info(
      { sourceUrl: form.source_url, phoneVisible, submitVisible },
      'Form accepted by DOM presence (visibility check soft-failed)',
    );
    return true;
  }

  logger.warn(
    {
      sourceUrl: form.source_url,
      phoneVisible,
      submitVisible,
      phone: form.phone_selector,
      submit: form.submit_selector,
    },
    'Form rejected: phone/submit not usable',
  );
  return false;
}

async function appendValidatedForms(
  page: Page,
  target: DetectedFormMapping[],
  seenFingerprints: Set<string>,
  forms: DetectedFormMapping[],
  options: { oneMappingPerPage: boolean; maxForms: number },
): Promise<void> {
  const ranked = [...forms].sort((left, right) => rankDetectedForm(right) - rankDetectedForm(left));

  for (const form of ranked) {
    if (target.length >= options.maxForms) {
      return;
    }

    if (seenFingerprints.has(form.fingerprint)) {
      continue;
    }

    if (!(await validateFormOnPage(page, form))) {
      continue;
    }

    const mappingKey = mappingDedupeKey(form, options.oneMappingPerPage);
    const score = rankDetectedForm(form);
    const existingIndex = target.findIndex(
      (item) => mappingDedupeKey(item, options.oneMappingPerPage) === mappingKey,
    );

    if (existingIndex >= 0) {
      if (score <= rankDetectedForm(target[existingIndex])) {
        continue;
      }

      seenFingerprints.delete(target[existingIndex].fingerprint);
      target[existingIndex] = {
        ...form,
        confidence: Math.min(100, score),
      };
      seenFingerprints.add(form.fingerprint);
      continue;
    }

    if (options.oneMappingPerPage) {
      const pageUrl = normalizePageUrl(form.source_url);
      const pageAlreadySaved = target.some((item) => normalizePageUrl(item.source_url) === pageUrl);

      if (pageAlreadySaved) {
        continue;
      }
    }

    seenFingerprints.add(form.fingerprint);
    target.push({
      ...form,
      confidence: Math.min(100, score),
    });
  }
}

async function collectInternalLinks(page: Page, baseUrl: string): Promise<string[]> {
  const hrefs = await page.evaluate(() => {
    return [...document.querySelectorAll('a[href]')]
      .map((anchor) => (anchor as HTMLAnchorElement).href)
      .filter((href) => typeof href === 'string' && href.startsWith('http'));
  }).catch(() => [] as string[]);

  return prioritizeLinks(hrefs, baseUrl).slice(0, MAX_LINKS_PER_PAGE);
}

async function collectHashPageUrls(page: Page, baseUrl: string, limit: number): Promise<string[]> {
  if (limit <= 0) {
    return [];
  }

  const origin = new URL(baseUrl).origin;
  const hashes = await page.evaluate(() => {
    const prefer = /^#(callkeeper|callback|feedback|form|popup|modal|credit|tradein|trade-in|offer|lead)/i;

    return [...document.querySelectorAll('a[href*="#"]')]
      .map((anchor) => (anchor as HTMLAnchorElement).hash)
      .filter((hash) => hash.length > 2 && !/^#(top|close)$/i.test(hash))
      .sort((left, right) => Number(prefer.test(right)) - Number(prefer.test(left)));
  }).catch(() => [] as string[]);

  const unique = [...new Set(hashes)].slice(0, limit);

  return unique.map((hash) => `${origin}/${hash}`);
}

async function detectCaptchaOnPage(page: Page): Promise<{
  captcha_type: DetectedFormMapping['captcha_type'];
  captcha_yandex_mode: DetectedFormMapping['captcha_yandex_mode'];
  captcha_iframe_selector: string | null;
  captcha_checkbox_selector: string | null;
  captcha_token_selector: string | null;
}> {
  const detected = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const hasYandex = Boolean(
      document.querySelector(
        'iframe[src*="smartcaptcha"], iframe[src*="captcha.yandex"], iframe[src*="checkbox"], .smart-captcha, [class*="SmartCaptcha"], input[name="smart-token"]',
      ),
    ) || /smartcaptcha|captcha\.yandex|smart-token/i.test(html);

    const hasRecaptcha = Boolean(
      document.querySelector('.g-recaptcha, iframe[src*="recaptcha"], #g-recaptcha-response'),
    ) || /google\.com\/recaptcha|grecaptcha/i.test(html);

    const hasHcaptcha = Boolean(
      document.querySelector('.h-captcha, iframe[src*="hcaptcha"]'),
    ) || /hcaptcha\.com/i.test(html);

    const slider = Boolean(
      document.querySelector('#captcha-slider, [data-testid="thumb"], .AdvancedCaptcha'),
    );

    return { hasYandex, hasRecaptcha, hasHcaptcha, slider };
  }).catch(() => ({ hasYandex: false, hasRecaptcha: false, hasHcaptcha: false, slider: false }));

  if (detected.hasYandex) {
    return {
      captcha_type: 'yandex_smartcaptcha',
      captcha_yandex_mode: detected.slider ? 'slider' : 'checkbox',
      captcha_iframe_selector: 'iframe[src*="checkbox"], iframe[src*="smartcaptcha"]',
      captcha_checkbox_selector: detected.slider ? '#captcha-slider' : '[role="checkbox"]',
      captcha_token_selector: 'input[name="smart-token"]',
    };
  }

  if (detected.hasRecaptcha) {
    return {
      captcha_type: 'google_recaptcha_v2',
      captcha_yandex_mode: null,
      captcha_iframe_selector: 'iframe[src*="recaptcha"]',
      captcha_checkbox_selector: null,
      captcha_token_selector: '#g-recaptcha-response',
    };
  }

  if (detected.hasHcaptcha) {
    return {
      captcha_type: 'hcaptcha',
      captcha_yandex_mode: null,
      captcha_iframe_selector: 'iframe[src*="hcaptcha"]',
      captcha_checkbox_selector: null,
      captcha_token_selector: '[name="h-captcha-response"]',
    };
  }

  return {
    captcha_type: 'none',
    captcha_yandex_mode: null,
    captcha_iframe_selector: null,
    captcha_checkbox_selector: null,
    captcha_token_selector: null,
  };
}

async function detectFormsOnCurrentPage(
  page: Page,
  sourceUrl: string,
): Promise<{ forms: DetectedFormMapping[]; phonesSeen: number; formsScanned: number }> {
  const collector = getCollectFormsInDocument();
  let phonesSeen = 0;
  let formsScanned = 0;
  const forms: DetectedFormMapping[] = [];

  for (const frame of page.frames()) {
    try {
      const raw = await frame.evaluate(collector);
      phonesSeen += raw.phonesSeen;
      formsScanned += raw.formsScanned;
      const iframeSel = frame === page.mainFrame() ? null : buildIframeSelector(frame.url());

      for (const form of raw.forms) {
        const mapped = toDetectedForm(form, sourceUrl, null, iframeSel);

        if (mapped) {
          forms.push(mapped);
        }
      }
    } catch {
      continue;
    }
  }

  return { phonesSeen, formsScanned, forms };
}

async function waitForDetectableForms(page: Page): Promise<void> {
  const collector = getCollectFormsInDocument();
  const maxWaitMs = Math.max(Math.min(config.BOT_SCAN_PAGE_WAIT_MS * 2, 6000), 2500);
  const deadline = Date.now() + maxWaitMs;

  // Fast path: MutationObserver often sees late Tilda / SPA inputs earlier than polling.
  await waitForLeadInputsViaMutation(page, Math.min(maxWaitMs, 2500)).catch(() => false);

  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        const raw = await frame.evaluate(collector);

        if (raw.phonesSeen > 0 || raw.forms.length > 0) {
          return;
        }
      } catch {
        continue;
      }
    }

    const hasLiveLeadInputs = await page.evaluate(() => {
      const phones = document.querySelectorAll(
        'input[type="tel"], input[data-type="PHONE"], input[name*="phone" i], input[name*="tel" i], input[name*="telefon" i], input[placeholder*="тел" i], input[placeholder*="phone" i]',
      );

      return phones.length > 0 || document.querySelectorAll('form input, form button[type="submit"]').length >= 2;
    }).catch(() => false);

    if (hasLiveLeadInputs) {
      return;
    }

    await page.waitForTimeout(350);
  }
}

async function collectBrandUrlsFromPage(page: Page, baseUrl: string): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const brandSource = dealerBrandPathRegex().source;

  const hrefs = await page.evaluate(({ siteOrigin, brandRe }) => {
    const re = new RegExp(brandRe, 'i');
    const urls: string[] = [];

    for (const node of document.querySelectorAll('a[href]')) {
      const anchor = node as HTMLAnchorElement;
      const href = anchor.href;

      try {
        const parsed = new URL(href, siteOrigin);
        if (parsed.origin !== siteOrigin) {
          continue;
        }

        const text = (anchor.textContent || '').trim();
        if (re.test(parsed.pathname) || re.test(text)) {
          parsed.hash = '';
          parsed.search = '';
          urls.push(parsed.href);
        }
      } catch {
        // ignore
      }
    }

    return urls;
  }, { siteOrigin: origin, brandRe: brandSource }).catch(() => [] as string[]);

  return prioritizeLinks(hrefs, baseUrl).filter((url) => isDealerBrandUrl(url));
}

/**
 * Multi-brand dealers share the same lead form across /kia, /hyundai, /renault…
 * Once we have a good template, verify selectors on other brand pages and clone mappings.
 */
async function expandMappingsAcrossBrandPages(
  page: Page,
  baseUrl: string,
  found: DetectedFormMapping[],
  options: {
    brandUrls: string[];
    maxForms: number;
    oneMappingPerPage: boolean;
  },
): Promise<number> {
  if (found.length === 0) {
    return 0;
  }

  const template = [...found]
    .sort((left, right) => rankDetectedForm(right) - rankDetectedForm(left))[0];

  if (!template || template.confidence < 55) {
    return 0;
  }

  const fromPage = await collectBrandUrlsFromPage(page, baseUrl);
  const candidates = prioritizeLinks(
    [...options.brandUrls, ...fromPage],
    baseUrl,
  )
    // Prefer car cards over brand indexes / news that merely contain a brand slug.
    .filter((url) => isModelCardUrl(url) || isBrandListingUrl(url) || isDealerBrandUrl(url))
    .sort((left, right) => {
      const leftCard = isModelCardUrl(left) ? 1 : 0;
      const rightCard = isModelCardUrl(right) ? 1 : 0;
      return rightCard - leftCard;
    });

  let expanded = 0;

  for (const brandUrl of candidates) {
    if (found.length >= options.maxForms) {
      break;
    }

    const pageUrl = normalizePageUrl(brandUrl);

    if (found.some((item) => normalizePageUrl(item.source_url) === pageUrl)) {
      continue;
    }

    try {
      await navigateToPage(page, pageUrl);
      await dismissCommonOverlays(page);
      await page.waitForTimeout(Math.min(config.BOT_SCAN_PAGE_WAIT_MS, 800));

      const ok = await verifyMappingWorksOnPage(page, template);

      if (!ok) {
        logger.info({ brandUrl: pageUrl }, 'Brand page: template selectors not found — skip');
        continue;
      }

      const clone: DetectedFormMapping = {
        ...template,
        source_url: pageUrl,
        fingerprint: `${pageUrl}|brand|${template.fingerprint}`,
        confidence: Math.min(100, template.confidence),
      };

      const key = mappingDedupeKey(clone, true);
      if (found.some((item) => mappingDedupeKey(item, true) === key)) {
        continue;
      }

      found.push(clone);
      expanded += 1;
      logger.info(
        { brandUrl: pageUrl, phone: template.phone_selector, openModal: template.open_modal_selector },
        'Brand page: cloned form mapping',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ brandUrl: pageUrl, err: message }, 'Brand page expansion failed');
    }
  }

  return expanded;
}

async function verifyMappingWorksOnPage(page: Page, template: DetectedFormMapping): Promise<boolean> {
  try {
    if (template.open_modal_selector) {
      await openFormModal(page, template.open_modal_selector).catch(() => undefined);
      await page.waitForTimeout(600);
    }

    const scope = template.form_scope_selector
      ? page.locator(template.form_scope_selector).first()
      : page.locator('body');

    const root = template.iframe_selector
      ? page.frameLocator(template.iframe_selector)
      : scope;

    const phoneSel = relativizeSelector(template.phone_selector, template.form_scope_selector);
    const submitSel = relativizeSelector(template.submit_selector, template.form_scope_selector);

    const phone = root.locator(phoneSel).filter({ visible: true }).first();
    const submit = root.locator(submitSel).filter({ visible: true }).first();

    const phoneOk = (await phone.count()) > 0 && (await phone.isVisible().catch(() => false));
    const submitOk = (await submit.count()) > 0 && (await submit.isVisible().catch(() => false));

    if (template.open_modal_selector) {
      await closeOpenModal(page).catch(() => undefined);
    }

    return phoneOk && submitOk;
  } catch {
    await closeOpenModal(page).catch(() => undefined);

    return false;
  }
}

async function navigateToPage(page: Page, url: string): Promise<void> {
  const response = await navigateToUrl(page, url, { timeoutMs: 60000, retries: 1 });
  const status = response?.status() ?? 0;

  if (status < 400) {
    return;
  }

  // Next.js / SPA soft-404: document status can be 404 while chat/quiz still renders.
  const usable = await page.evaluate(() => {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const hasInteractive = !!document.querySelector(
      '.chat-bubble, [class*="chat-bubble"], .card.cursor-pointer, form, input[type="tel"], input, button.btn',
    );
    const head = `${document.title} ${text.slice(0, 240)}`;
    const classic404 = /404|not\s*found|страница не найдена|не существует/i.test(head)
      && text.length < 400
      && !hasInteractive;
    return {
      textLen: text.length,
      hasInteractive,
      classic404,
    };
  }).catch(() => ({ textLen: 0, hasInteractive: false, classic404: true }));

  if (usable.hasInteractive || (usable.textLen > 250 && !usable.classic404)) {
    logger.warn(
      { url, status, textLen: usable.textLen, hasInteractive: usable.hasInteractive },
      'HTTP error status but page content looks usable — continue scan',
    );
    return;
  }

  throw new Error(`HTTP ${status}`);
}

async function isBlockedByAntiBot(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => '');

  return /botfaqtor|заблокирован|suspicious\s+traffic|access\s+denied/i.test(title);
}

function toDetectedForm(
  raw: {
    formScopeSelector: string | null;
    nameSelector: string | null;
    firstNameSelector?: string | null;
    lastNameSelector?: string | null;
    emailSelector?: string | null;
    selectSelectors?: string[];
    phoneSelector: string;
    submitSelector: string;
    consentCheckboxSelectors: string[];
    fingerprint: string;
    score: number;
  },
  sourceUrl: string,
  openModalSelector: string | null,
  iframeSelector: string | null,
): DetectedFormMapping | null {
  if (raw.score < MIN_FORM_SCORE) {
    return null;
  }

  if (!isLeadPhoneSelector(raw.phoneSelector)) {
    return null;
  }

  return {
    source_url: sourceUrl,
    name_selector: raw.nameSelector,
    first_name_selector: raw.firstNameSelector ?? null,
    last_name_selector: raw.lastNameSelector ?? null,
    email_selector: raw.emailSelector ?? null,
    select_selectors: (raw.selectSelectors ?? []).length > 0 ? raw.selectSelectors ?? null : null,
    phone_selector: raw.phoneSelector,
    submit_selector: raw.submitSelector,
    consent_checkbox_selector: raw.consentCheckboxSelectors[0] ?? null,
    consent_checkbox_selectors: raw.consentCheckboxSelectors,
    form_scope_selector: raw.formScopeSelector,
    open_modal_selector: openModalSelector,
    iframe_selector: iframeSelector,
    confidence: raw.score,
    fingerprint: `${sourceUrl}|modal:${openModalSelector ?? 'inline'}|iframe:${iframeSelector ?? 'main'}|${raw.fingerprint}`,
  };
}
