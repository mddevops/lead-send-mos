/**
 * Quick sanity checks for URL scoring / normalization (no test runner required).
 * Usage: npx tsx scripts/verify-url-score.ts
 */
import {
  isLowValueUrl,
  isModelCardUrl,
  isOfferCardUrl,
  isStockListingUrl,
  normalizePageUrl,
  prioritizeLinks,
  scoreLink,
} from '../src/utils/formScanUtils';

const base = 'https://dealer.example/';

const cases: Array<{
  url: string;
  expectModel?: boolean;
  expectOffer?: boolean;
  expectStockListing?: boolean;
  expectLow?: boolean;
}> = [
  { url: 'https://dealer.example/auto/kia/rio/123', expectModel: true, expectOffer: true },
  { url: 'https://dealer.example/kia/rio/456', expectModel: true, expectOffer: true },
  {
    url: 'https://carmir-dealer.ru/used/volvo/s80/ii-restailing-2009-2013/845500',
    expectModel: true,
    expectOffer: true,
    expectStockListing: false,
  },
  {
    url: 'https://carmir-dealer.ru/used/volvo/xc70',
    expectModel: false,
    expectOffer: false,
    expectStockListing: true,
  },
  {
    url: 'https://carmir-dealer.ru/used/peugeot/408',
    expectModel: false,
    expectStockListing: true,
  },
  {
    url: 'https://carmir-dealer.ru/used/opel/corsa',
    expectModel: false,
    expectStockListing: true,
  },
  {
    url: 'https://carmir-dealer.ru/used/volvo/xc70/ii-2007-2013',
    expectModel: false,
    expectStockListing: true,
  },
  {
    url: 'https://carmir-dealer.ru/used/volvo/xc70/ii-2007-2013/730333',
    expectModel: true,
    expectOffer: true,
    expectStockListing: false,
  },
  { url: 'https://dealer.example/catalog/kia', expectModel: false },
  { url: 'https://dealer.example/news/hello', expectLow: true },
  { url: 'https://dealer.example/privacy', expectLow: true },
];

let failed = 0;

for (const item of cases) {
  const model = isModelCardUrl(item.url);
  const offer = isOfferCardUrl(item.url);
  const stock = isStockListingUrl(item.url);
  const low = isLowValueUrl(item.url);

  if (item.expectModel !== undefined && model !== item.expectModel) {
    console.error('FAIL model', item.url, model);
    failed += 1;
  }
  if (item.expectOffer !== undefined && offer !== item.expectOffer) {
    console.error('FAIL offer', item.url, offer);
    failed += 1;
  }
  if (item.expectStockListing !== undefined && stock !== item.expectStockListing) {
    console.error('FAIL stockListing', item.url, stock);
    failed += 1;
  }
  if (item.expectLow !== undefined && low !== item.expectLow) {
    console.error('FAIL low', item.url, low);
    failed += 1;
  }
}

const card = 'https://carmir-dealer.ru/used/volvo/xc70/ii-2007-2013/730333';
const listing = 'https://carmir-dealer.ru/used/volvo/xc70';
const news = 'https://dealer.example/news/offer';
if (scoreLink(card, base) <= scoreLink(listing, 'https://carmir-dealer.ru/')) {
  console.error('FAIL score card <= listing', scoreLink(card, base), scoreLink(listing, 'https://carmir-dealer.ru/'));
  failed += 1;
}

const normalized = normalizePageUrl('https://dealer.example/auto/kia/rio/1?utm_source=yandex&yclid=1');
if (normalized.includes('utm_') || normalized.includes('yclid')) {
  console.error('FAIL utm not stripped', normalized);
  failed += 1;
}

const ordered = prioritizeLinks(
  [
    'https://carmir-dealer.ru/used/peugeot/408',
    'https://carmir-dealer.ru/used/volvo/xc70/ii-2007-2013/730333',
    'https://carmir-dealer.ru/credit',
  ],
  'https://carmir-dealer.ru/',
);
if (!ordered[0].includes('/730333')) {
  console.error('FAIL priority order', ordered);
  failed += 1;
}

if (failed > 0) {
  console.error(`Failed: ${failed}`);
  process.exit(1);
}

console.log('URL score checks OK');
console.log({
  card: scoreLink(card, 'https://carmir-dealer.ru/'),
  listing: scoreLink(listing, 'https://carmir-dealer.ru/'),
  credit: scoreLink('https://carmir-dealer.ru/credit', 'https://carmir-dealer.ru/'),
  news: scoreLink(news, base),
  ordered,
});
