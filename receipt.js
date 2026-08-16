/* Чеки: чтение QR-кода с фотографии и разбор текста чека.
   Всё считается на телефоне — фотография никуда не отправляется. */

/* ---------- 1. QR-код с фото ---------- */
/* Российский чек кодирует строку вида
   t=20260816T1830&s=1234.50&fn=9960...&i=12345&fp=1234567890&n=1
   где t — дата и время, s — итоговая сумма. */
function parseReceiptQR(text) {
  if (!text || !/[?&]?s=/.test(text)) return null;
  const p = Object.fromEntries(
    text.replace(/^.*?\?/, '').split('&').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i), kv.slice(i + 1)];
    })
  );
  const sum = parseFloat(String(p.s || '').replace(',', '.'));
  if (!sum || isNaN(sum)) return null;

  let date = todayISO();
  const t = String(p.t || '');
  const m = t.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (m) date = `${m[1]}-${m[2]}-${m[3]}`;

  return { sum, date, time: m ? `${m[4]}:${m[5]}` : '', fn: p.fn || '', fd: p.i || '', fp: p.fp || '' };
}

/* Читаем QR с картинки. Пробуем несколько масштабов: фото с телефона
   обычно слишком крупное, а мелкий QR теряется при сильном уменьшении. */
async function scanReceiptImage(file) {
  const img = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('не удалось открыть картинку'));
      im.src = r.result;
    };
    r.onerror = () => reject(new Error('не удалось прочитать файл'));
    r.readAsDataURL(file);
  });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  for (const maxSide of [1600, 1000, 2400, 700]) {
    const k = Math.min(1, maxSide / Math.max(img.width, img.height));
    canvas.width = Math.round(img.width * k);
    canvas.height = Math.round(img.height * k);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const res = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
    if (res && res.data) {
      const parsed = parseReceiptQR(res.data);
      if (parsed) return { ok: true, ...parsed, raw: res.data };
      return { ok: false, reason: 'foreign-qr', raw: res.data };
    }
  }
  return { ok: false, reason: 'no-qr' };
}

/* ---------- 2. Разбор текста чека ---------- */

/* Магазины, где по умолчанию всё считается продуктами. */
const GROCERY = /пятёроч|пятероч|магнит|лент[аы]|перекрёст|перекрест|ашан|дикси|окей|о'кей|верный|вкусвилл|спар|метро|глобус|billa|карусель/i;

/* Дополнения к словарю из nlp.js — то, что встречается именно в чеках. */
const ITEM_RULES = [
  // Бакалея: в чеке «кофе молотый» — это продукты, а не поход в кофейню.
  [/кофе\s*(молот|зернов|раствор|в зёрн|в зерн|\d)|чай\s|сахар|крупа|макарон|мука|масло\s*(подсолн|оливк|слив)|соль\b|специи|консерв/i, 'Жизнедеятельность', 'Продукты'],
  [/батарейк|лампочк|удлинител|скотч|клей|перчатк хоз/i, 'Бытовые расходы', 'Другое'],
  [/порошок|салфет|туалетн|шампун|мыло|зубн|паста|прокладк|подгузн|пелен|губк|пакет|фольг|моющ|чистящ|освежит|стиральн|кондиционер для бель/i, 'Жизнедеятельность', 'Бытовые (Магнит, Фикс)'],
  [/сигарет|табак|стик|iqos|жидкост для|под\b/i, 'Развлечения', 'Табак'],
  [/пиво|вино|водк|виск|коньяк|шампанск|ликёр|ликер|сидр|ром\b|джин\b/i, 'Развлечения', 'Алкоголь, закуски'],
  [/корм|наполнител|whiskas|felix|pedigree|китекет/i, 'Животные', 'Еда'],
  [/лекарств|таблет|бинт|пластыр|витамин|сироп|спрей от|капли/i, 'Здоровье', 'Лекарства'],
  [/игрушк|конструктор|кукл|машинк|лего/i, 'Дети', 'Игрушки'],
  [/тетрад|ручк|карандаш|альбом|пенал|дневник/i, 'Дети', 'Принадлежности для учебы'],
  [/носк|футболк|джинс|куртк|платье|обувь|кроссовк|колготк|трусы|бельё/i, 'Жизнедеятельность', 'Одежда'],
];

function categorizeItem(name, grocery) {
  const s = String(name).toLowerCase();
  for (const [re, cat, sub] of ITEM_RULES) if (re.test(s)) return { cat, sub };
  // Словарь голосового ввода: он уже знает «кофе», «хлеб», «бензин» и прочее.
  for (const [re, type, cat, sub] of KEYWORDS) {
    if (type === 'expense' && re.test(s)) return { cat, sub };
  }
  return grocery ? { cat: 'Жизнедеятельность', sub: 'Продукты' } : { cat: 'Разное', sub: 'Другое' };
}

const num = (s) => parseFloat(String(s).replace(/[\s ]/g, '').replace(',', '.'));

/* Разбирает текст, скопированный с чека (в том числе через «Живой текст» на айфоне). */
function parseReceiptText(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const shopLine = lines.slice(0, 6).find((l) => GROCERY.test(l)) || '';
  const shop = (shopLine || lines.find((l) => /^[А-ЯЁA-Z][^0-9]{2,30}$/.test(l)) || '').trim().slice(0, 30);
  const grocery = GROCERY.test(raw);

  // Дата
  let date = todayISO();
  const dm = raw.match(/(\d{2})[.\-\/](\d{2})[.\-\/](\d{2,4})/);
  if (dm) {
    const y = dm[3].length === 2 ? '20' + dm[3] : dm[3];
    date = `${y}-${dm[2]}-${dm[1]}`;
  }

  // Итог
  let total = 0;
  for (const l of lines) {
    // Между словом «ИТОГ» и суммой в чеке бывает длинный отступ из пробелов и точек.
    const t = l.match(/(итог|итого|к оплате|сумма к оплате|всего)[^\d]{0,40}(\d[\d\s ]*[.,]?\d*)/i);
    if (t) {
      const v = num(t[2]);
      if (v > total) total = v;
    }
  }

  // Позиции: строка с названием и ценой в конце, либо «2 x 89.90 = 179.80».
  const items = [];
  const SKIP = /итог|к оплате|сдач|нал(ичн)?ым|безнал|карт|ндс|скидк|бонус|кассир|смена|чек|фн\b|фд\b|фп\b|инн|адрес|телефон|www|спасибо/i;
  for (const l of lines) {
    if (SKIP.test(l)) continue;
    const mult = l.match(/^(.{2,60}?)\s+(\d+(?:[.,]\d+)?)\s*[x*х]\s*(\d[\d\s ]*[.,]?\d*)/i);
    if (mult) {
      const price = num(mult[2]) * num(mult[3]);
      if (price > 0) items.push({ name: mult[1].trim(), sum: Math.round(price * 100) / 100 });
      continue;
    }
    const plain = l.match(/^(.*[А-Яа-яЁёA-Za-z].{1,60}?)\s+(\d[\d\s ]*[.,]\d{2})\s*(?:₽|руб)?$/);
    if (plain) {
      const v = num(plain[2]);
      const name = plain[1].replace(/\s*\d+(?:[.,]\d+)?\s*(шт|кг|г|л|мл)\.?$/i, '').trim();
      if (v > 0 && name.length > 1) items.push({ name, sum: v });
    }
  }

  if (!items.length && !total) return null;
  if (!total) total = Math.round(items.reduce((s, i) => s + i.sum, 0) * 100) / 100;

  for (const i of items) {
    const c = categorizeItem(i.name, grocery);
    i.cat = c.cat;
    i.sub = c.sub;
  }
  return { shop: shop || '', date, total, items, grocery };
}

/* Группировка позиций по категориям для разноса операций. */
function groupReceipt(items) {
  const map = new Map();
  for (const i of items) {
    const key = i.cat + ' / ' + i.sub;
    if (!map.has(key)) map.set(key, { cat: i.cat, sub: i.sub, sum: 0, count: 0 });
    const g = map.get(key);
    g.sum = Math.round((g.sum + i.sum) * 100) / 100;
    g.count++;
  }
  return [...map.values()].sort((a, b) => b.sum - a.sum);
}
