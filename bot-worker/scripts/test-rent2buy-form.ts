import { chromium } from 'playwright';
import { getCollectFormsInDocument } from '../src/utils/browserEvaluate';
import { scanSiteForForms } from '../src/utils/formScanner';

const rent2buyFormHtml = `
<!doctype html>
<html lang="ru">
<body>
  <main style="height:3000px;padding-top:2800px">
    <form class="w-full" action="">
      <div class="rounded-box relative overflow-hidden bg-base-100 p-6 text-center shadow-md">
        <h2 class="mb-2 text-2xl">Остались вопросы?</h2>
        <div class="mb-2 text-center text-sm">Перезвоним Вам в течение 10 минут</div>
        <div>
          <input class="input input-bordered my-1 w-full p-3" id=":R2l1mqkva:" placeholder="Ваш номер телефона*" required type="tel" name="phone_num" value="">
          <input class="input input-bordered my-1 w-full p-3" id=":R2l1mqkvaH1:" maxlength="40" placeholder="Ваше имя" type="text" name="name" value="">
        </div>
        <div class="form-control h-[84px] justify-center overflow-hidden py-1">
          <label class="label cursor-pointer justify-start px-0 py-1" for=":R2l1mqkvaH2:">
            <input class="checkbox checkbox-xs" id=":R2l1mqkvaH2:" required type="checkbox" name="compliance" checked="">
            <span class="label-text ml-2 text-left text-[10px] leading-3">Нажимая на кнопку Отправить, Вы даете <a href="/privacy-policy">согласие на обработку</a> своих данных</span>
          </label>
        </div>
        <button type="submit" class="btn btn-primary relative mt-2 w-full"><span class="font-bold">Отправить</span></button>
      </div>
    </form>
  </main>
</body>
</html>
`;

async function testInlineHtml(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'ru-RU' });

  try {
    await page.setContent(rent2buyFormHtml, { waitUntil: 'load' });
    const collector = getCollectFormsInDocument();
    const detected = await page.evaluate(collector);
    console.log('=== Inline rent2buy form detect ===');
    console.log(JSON.stringify(detected, null, 2));

    const scanned = await scanSiteForForms(page, 'https://rent2buy.test/');
    console.log('=== Inline rent2buy full scan ===');
    console.log(JSON.stringify(scanned, null, 2));
  } finally {
    await browser.close();
  }
}

async function testLiveSite(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    locale: 'ru-RU',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  try {
    const scanned = await scanSiteForForms(page, 'https://rent2buy.ru');
    console.log('=== Live rent2buy.ru scan ===');
    console.log(JSON.stringify(scanned, null, 2));
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  await testInlineHtml();
  await testLiveSite();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
