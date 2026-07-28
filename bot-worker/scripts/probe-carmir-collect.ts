import { chromium } from "playwright";
import { discoverFormsViaModals } from "../src/utils/formModalDiscovery";
import { resolveOpenModalShell } from "../src/utils/formInteractions";

const CARD = "https://carmir-dealer.ru/used/volvo/s80/ii-restailing-2009-2013/845500";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(CARD, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator("div.button--credit").first().click();
  await page.waitForTimeout(1500);
  const shell = await resolveOpenModalShell(page, 8000);

  const debug = await shell.evaluate((modalRoot) => {
    const SKIP = new Set(["hidden","submit","button","checkbox","radio","file","image","reset","password","email","number","range","date","color"]);
    const inputs = [...modalRoot.querySelectorAll("input")].filter((el) => el instanceof HTMLInputElement);
    const visible = inputs.filter((i) => {
      const s = getComputedStyle(i);
      const r = i.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && r.width > 0;
    });
    return {
      cls: (modalRoot as HTMLElement).className,
      inputTypes: visible.map((i) => ({ type: i.type, ph: i.placeholder, cls: i.className })),
      hasForm: modalRoot.querySelectorAll("form").length,
      divSubmit: !!modalRoot.querySelector("div.button.button--form"),
    };
  });
  console.log("shell debug", debug);

  // Call the actual collector via discover path
  const result = await discoverFormsViaModals(page, CARD, { maxTriggers: 1 });
  console.log("discover", JSON.stringify(result, null, 2));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
