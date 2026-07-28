import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://carmir-dealer.ru/used/volvo/s80/ii-restailing-2009-2013/845500", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator(".button.button--credit").first().click();
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const wrap = document.querySelector(".modal__wrapper");
    if (!wrap) return { err: "no wrapper" };
    const style = getComputedStyle(wrap);
    const buttons = [...wrap.querySelectorAll("button, a, div.button, div.btn, [role=button], input[type=submit]")].map((el) => ({
      tag: el.tagName,
      cls: (el as HTMLElement).className?.toString?.().slice(0, 80),
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
      visible: !!(el as HTMLElement).offsetParent,
    }));
    const forms = wrap.querySelectorAll("form").length;
    const checks = [...wrap.querySelectorAll("input")].map((i) => ({
      type: i.type,
      ph: i.placeholder,
      name: i.name,
      visible: !!(i as HTMLElement).offsetParent && getComputedStyle(i).display !== "none",
    }));
    return {
      display: style.display,
      forms,
      buttons,
      checks,
      htmlSnippet: wrap.className,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
