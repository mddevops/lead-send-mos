import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { closeBrowser, openBrowser } from '../playwright/browser';
import { buildProxyServer, ProxyConfig } from '../services/proxyManager';
import { sendSiteMappingsBulk } from '../services/laravelApi';
import { scanSiteForForms } from '../utils/formScanner';

const logger = pino({ name: 'agent-multi-page-scan' });

type SiteJob = {
  siteId: number;
  name: string;
  url: string;
};

type PrepFile = {
  proxy: ProxyConfig | null;
  sites: SiteJob[];
};

async function main(): Promise<void> {
  const prepPath = process.argv[2]
    ?? path.resolve(__dirname, '../../../storage/app/agent-scan-prep.json');

  if (!fs.existsSync(prepPath)) {
    throw new Error(`Prep file not found: ${prepPath}`);
  }

  const prep = JSON.parse(fs.readFileSync(prepPath, 'utf8')) as PrepFile;
  const proxy = buildProxyServer(prep.proxy);
  const report: Array<Record<string, unknown>> = [];

  logger.info(
    {
      sites: prep.sites.length,
      proxy: prep.proxy ? `${prep.proxy.host}:${prep.proxy.port}` : null,
    },
    'Agent multi-page scan starting',
  );

  // Skip already done first site if it has mappings; scan all by default.
  const sites = prep.sites;

  for (const site of sites) {
    logger.info({ siteId: site.siteId, url: site.url }, 'Scanning site');

    const session = await openBrowser(proxy, { headless: true, desktopFullScreen: true });
    const page = await session.context.newPage();

    try {
      const { forms, diagnostics } = await scanSiteForForms(page, site.url, {
        maxForms: 10,
        maxPages: 20,
        oneMappingPerPage: true,
      });

      await sendSiteMappingsBulk(site.siteId, {
        replace_auto: true,
        mappings: forms.map((form) => ({
          source_url: form.source_url,
          name_selector: form.name_selector,
          phone_selector: form.phone_selector,
          submit_selector: form.submit_selector,
          consent_checkbox_selector: form.consent_checkbox_selector,
          consent_checkbox_selectors: form.consent_checkbox_selectors,
          form_scope_selector: form.form_scope_selector,
          open_modal_selector: form.open_modal_selector,
          captcha_type: form.captcha_type ?? 'none',
          captcha_yandex_mode: form.captcha_yandex_mode ?? null,
          captcha_iframe_selector: form.captcha_iframe_selector ?? null,
          captcha_checkbox_selector: form.captcha_checkbox_selector ?? null,
          captcha_token_selector: form.captcha_token_selector ?? null,
          mapping_type: 'auto',
          confidence: form.confidence,
          status: form.confidence >= 70 ? 'active' : 'draft',
        })),
      });

      const row = {
        siteId: site.siteId,
        name: site.name,
        url: site.url,
        pagesVisited: diagnostics.pagesVisited,
        formsSaved: forms.length,
        captchaTypes: [...new Set(forms.map((form) => form.captcha_type ?? 'none'))],
        sourceUrls: forms.map((form) => form.source_url),
        pageErrors: diagnostics.pageErrors,
      };

      report.push(row);
      logger.info(row, 'Site scan saved');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.push({ siteId: site.siteId, name: site.name, url: site.url, error: message });
      logger.error({ siteId: site.siteId, message }, 'Site scan failed');
    } finally {
      await closeBrowser(session);
    }
  }

  const outPath = path.resolve(path.dirname(prepPath), 'agent-scan-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  logger.info({ outPath, report }, 'Agent multi-page scan finished');
}

main().catch((error) => {
  logger.error(error);
  process.exitCode = 1;
});
