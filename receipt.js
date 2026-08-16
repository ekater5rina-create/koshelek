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

/* Один кадр: рисуем источник (видео, картинку, холст) и ищем в нём QR.
   Вынесено отдельно, чтобы проверять разбор без камеры. */
const _frameCanvas = document.createElement('canvas');
const _frameCtx = _frameCanvas.getContext('2d', { willReadFrequently: true });

function scanFrame(source, sw, sh, maxSide = 900) {
  return scanRect(source, 0, 0, sw, sh, maxSide);
}

/* Кусок кадра в исходном разрешении: центральный вырез даёт QR вдвое крупнее,
   чем то же изображение, ужатое целиком. */
function scanRect(source, sx, sy, sw, sh, maxSide = 900, fast = false) {
  if (!sw || !sh) return null;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  _frameCanvas.width = w;
  _frameCanvas.height = h;
  try {
    _frameCtx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
  } catch (e) {
    return null;
  }
  const data = _frameCtx.getImageData(0, 0, w, h);
  // В живом потоке важна скорость: код на чеке всегда тёмный на светлом,
  // поэтому не проверяем инверсию и не тянем контраст — это делает «Снимок».
  let res = jsQR(data.data, w, h, { inversionAttempts: fast ? 'dontInvert' : 'attemptBoth' });
  if (!res && !fast) {
    const b = boost(data);
    if (b) res = jsQR(b.data, w, h, { inversionAttempts: 'attemptBoth' });
  }
  return res && res.data ? res.data : null;
}

/* Открываем картинку. createImageBitmap надёжнее старого Image: он сам
   разворачивает снимок по EXIF, понимает HEIC на айфоне и не гоняет
   многомегабайтный data-URL через память. */
async function loadPicture(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return { img: await createImageBitmap(file), via: 'bitmap' };
    } catch (e) { /* ниже попробуем по-старому */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('формат не поддерживается'));
      im.src = url;
    });
    return { img, via: 'image' };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

/* Растягиваем контраст: на термобумаге «чёрное» бывает светло-серым. */
function boost(data) {
  const d = data.data;
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 16) {
    const v = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range < 10 || range > 200) return null;
  const k = 255 / range;
  const out = new ImageData(data.width, data.height);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10 - min) * k));
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  return out;
}

/* Читаем QR с фотографии. Фото с телефона огромное, а QR на нём мелкий,
   поэтому идём несколькими масштабами, а потом по кускам кадра. */
async function scanReceiptImage(file) {
  const t0 = Date.now();
  const log = [];
  let img, via;
  try {
    ({ img, via } = await loadPicture(file));
  } catch (e) {
    return { ok: false, reason: 'unreadable', report: `Не удалось открыть файл: ${e.message}` };
  }

  const W = img.width, H = img.height;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let attempts = 0, blank = 0;

  const tryPiece = (sx, sy, sw, sh, outW, label) => {
    const outH = Math.max(1, Math.round((sh / sw) * outW));
    canvas.width = outW;
    canvas.height = outH;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    const data = ctx.getImageData(0, 0, outW, outH);
    attempts++;

    // На айфоне слишком большой холст иногда возвращается пустым — это видно сразу.
    let allWhite = true;
    for (let i = 0; i < data.data.length; i += 4000) {
      if (data.data[i] < 245) { allWhite = false; break; }
    }
    if (allWhite) { blank++; log.push(`${label}: пусто`); return null; }

    let res = jsQR(data.data, outW, outH, { inversionAttempts: 'attemptBoth' });
    if (!res) {
      const b = boost(data);
      if (b) res = jsQR(b.data, outW, outH, { inversionAttempts: 'attemptBoth' });
    }
    if (res && res.data) { log.push(`${label}: найден`); return res.data; }
    return null;
  };

  const pieces = [];
  // Весь кадр в нескольких размерах.
  for (const side of [1400, 2000, 900, 2800]) pieces.push([0, 0, W, H, Math.min(side, Math.max(W, H)), `кадр ${side}`]);
  // Центр — туда обычно и целятся.
  pieces.push([W * 0.15, H * 0.15, W * 0.7, H * 0.7, 1400, 'центр']);
  // Четверти с нахлёстом: мелкий QR разбирается в своём куске крупнее.
  for (const [ix, iy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    pieces.push([ix * W * 0.42, iy * H * 0.42, W * 0.58, H * 0.58, 1200, `четверть ${ix}${iy}`]);
  }

  for (const [sx, sy, sw, sh, side, label] of pieces) {
    let raw = null;
    try {
      raw = tryPiece(Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh), Math.round(side), label);
    } catch (e) {
      log.push(`${label}: ошибка ${e.message}`);
      continue;
    }
    if (!raw) continue;
    const parsed = parseReceiptQR(raw);
    if (parsed) return { ok: true, ...parsed, raw };
    return { ok: false, reason: 'foreign-qr', raw, report: `Найден QR, но это не кассовый чек:\n${String(raw).slice(0, 120)}` };
  }

  return {
    ok: false,
    reason: blank === attempts ? 'blank' : 'no-qr',
    report: `Фото: ${W}×${H}, ${Math.round(file.size / 1024)} КБ, тип ${file.type || 'неизвестен'}\n` +
            `Способ открытия: ${via}\nПопыток: ${attempts}${blank ? `, пустых кадров: ${blank}` : ''}\n` +
            `Время: ${Date.now() - t0} мс\n${log.join('; ') || 'QR не найден ни в одном фрагменте'}`,
  };
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

/* ---------- Живая камера ----------
   Надёжнее фотографии: кадры идут потоком, и QR ловится, как только попал в объектив. */
const LiveScan = {
  stream: null,
  raf: null,
  timer: null,
  running: false,

  frames: 0,
  found: 0,
  status: '',

  async start(video, onFound, onFail, onStatus) {
    this.frames = 0;
    this.onStatus = onStatus || (() => {});
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return onFail('Камера в этом браузере недоступна');
    }
    try {
      // Просим максимум разрешения: мелкий QR читается только на детальном кадре.
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch (e) {
      const why = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
        ? 'Нет доступа к камере. Разрешите его в настройках Safari для этого сайта.'
        : `Камера не открылась: ${e && e.name ? e.name : e}`;
      return onFail(why);
    }

    video.srcObject = this.stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    try { await video.play(); } catch (e) { /* некоторые браузеры играют и без этого */ }

    this.running = true;
    // Если за минуту ничего не нашлось — закрываем сами, чтобы камера не жгла батарею.
    this.timer = setTimeout(() => { if (this.running) { this.stop(video); onFail('Не нашёл QR-код за минуту'); } }, 60000);

    const started = Date.now();
    const tick = () => {
      if (!this.running) return;
      const vw = video.videoWidth, vh = video.videoHeight;
      if (vw && vh) {
        this.gotFrames = true;
        this.frames++;
        // Чередуем: центральный вырез в исходном разрешении и весь кадр целиком.
        let raw;
        const t0 = Date.now();
        if (this.frames % 2) {
          const side = Math.round(Math.min(vw, vh) * 0.7);
          raw = scanRect(video, Math.round((vw - side) / 2), Math.round((vh - side) / 2), side, side, 640, true);
        } else {
          raw = scanRect(video, 0, 0, vw, vh, 640, true);
        }
        this.ms = Date.now() - t0;
        if (this.frames % 8 === 0) this.onStatus(`Ищу код · кадров ${this.frames} · ${vw}×${vh} · ${this.ms} мс/кадр`);
        if (raw) {
          this.stop(video);
          return onFound(raw);
        }
      } else {
        this.onStatus(Date.now() - started > 3000
          ? 'Камера включилась, но кадры не приходят. Нажмите «Вставить код».'
          : 'Камера запускается…');
      }
      // Обычный таймер, а не requestAnimationFrame: тот замирает в фоне
      // и в режиме энергосбережения, и сканирование молча останавливается.
      this.raf = setTimeout(tick, 30);
    };
    tick();
  },

  /* Разбор текущего кадра «в полную силу» — по кнопке, если поток не справляется. */
  async shot(video) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return { ok: false, report: 'Камера ещё не отдала кадр' };
    const c = document.createElement('canvas');
    c.width = vw; c.height = vh;
    c.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
    return scanReceiptImage(new File([blob], 'frame.jpg', { type: 'image/jpeg' }));
  },

  stop(video) {
    this.running = false;
    clearTimeout(this.timer);
    clearTimeout(this.raf);
    this.raf = null;
    if (this.stream) {
      for (const t of this.stream.getTracks()) { try { t.stop(); } catch (e) {} }
      this.stream = null;
    }
    if (video) { try { video.pause(); } catch (e) {} video.srcObject = null; }
  },
};

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
