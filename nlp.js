/* Разбор фразы вида «кофе 250», «такси 300 вчера картой», «зарплата 160 тысяч».
   Используется и для текстового поля, и для распознанной речи. */

const KEYWORDS = [
  // [регулярное выражение, тип, категория, подкатегория]
  [/зарплат|зп\b|аванс|получк|оклад/, 'income', 'Зарплата', ''],
  [/пилатес|тренировк(а|у)? провел/, 'income', 'Подработка', 'Пилатес'],
  [/подработ|халтур|хобби/, 'income', 'Подработка', 'Хобби'],
  [/кэшб|кешб/, 'income', 'Кэшбэк', ''],
  [/дивиденд/, 'income', 'Дивиденды', ''],
  [/компенсац/, 'income', 'Компенсация за сад', ''],
  [/от мужа|муж (дал|перевёл|перевел|скинул)/, 'income', 'Муж', ''],
  [/от мамы|от папы|от родител/, 'income', 'Мама, папа', ''],

  [/продукт|магазин|пятёроч|пятероч|перекрёст|перекрест|ашан|лент(а|у)\b|дикси|окей|супермаркет|молок|хлеб|овощ|мясо/, 'expense', 'Жизнедеятельность', 'Продукты'],
  [/кафе|ресторан|кофе|кофей|завтрак|ужин(?! дома)|пиццер|суши|бар\b|столов/, 'expense', 'Жизнедеятельность', 'Кафе/Рестораны'],
  [/фикс прайс|фикспрайс|магнит|хозтовар|порошок|моющ|бытов(ая|ые) хими/, 'expense', 'Жизнедеятельность', 'Бытовые (Магнит, Фикс)'],
  [/одежд|обувь|кроссовк|куртк|джинс|футболк|платье/, 'expense', 'Жизнедеятельность', 'Одежда'],
  [/парикмахер|салон|маникюр|педикюр|стрижк|бров|ногт/, 'expense', 'Жизнедеятельность', 'Парикмахерская/Салоны'],
  [/химчист/, 'expense', 'Жизнедеятельность', 'Химчистка'],

  [/коммунал|квартплат|жкх|электричеств|за свет|за газ|за воду/, 'expense', 'Бытовые расходы', 'Коммунальные платежи'],
  [/интернет|вайфай|wifi|роутер/, 'expense', 'Бытовые расходы', 'Интернет'],
  [/телефон|связь|мтс|билайн|мегафон|теле2|тele2/, 'expense', 'Бытовые расходы', 'Телефон'],
  [/ремонт дом|обои|шпаклёв|шпаклев|плитк|ламинат|строймат/, 'expense', 'Бытовые расходы', 'Ремонт дом'],
  [/дач(а|у|е|и)|огород|теплиц|рассад|саженц/, 'expense', 'Бытовые расходы', 'Дача'],

  [/бензин|заправк|азс|топлив|дизел|солярк/, 'expense', 'Транспорт', 'Бензин'],
  [/такси|метро|автобус|троллейбус|маршрутк|трамвай|проезд/, 'expense', 'Транспорт', 'Автобус/Такси/Метро'],
  [/шиномонтаж|автосервис|то маш|масло в машин|мойк(а|у) машин/, 'expense', 'Транспорт', 'Обслуживание автомобиля'],
  [/ремонт машин|ремонт авто|запчаст/, 'expense', 'Транспорт', 'Ремонт'],

  [/аптек|лекарств|таблетк|сироп|мазь|антибиотик/, 'expense', 'Здоровье', 'Лекарства'],
  [/врач|доктор|стоматолог|клиник|анализ|узи|терапевт|приём у|прием у/, 'expense', 'Здоровье', 'Доктора/Стоматологи'],
  [/бад\b|витамин/, 'expense', 'Здоровье', 'БАДы'],
  [/массаж|процедур|косметолог/, 'expense', 'Здоровье', 'Процедуры'],

  [/детсад|дет\.?сад|садик|за сад/, 'expense', 'Дети', 'Дет.сад'],
  [/игрушк|лего|кукл|конструктор/, 'expense', 'Дети', 'Игрушки'],
  [/тетрад|учебник|канцеляр|портфель|рюкзак в школ|школьн/, 'expense', 'Дети', 'Принадлежности для учебы'],
  [/английск|танц|алгебр|репетитор|кружок|секци/, 'expense', 'Дети', 'Английский, танцы, алгебра'],
  [/школьн(ые)? обед|обеды в школ/, 'expense', 'Дети', 'Обеды'],

  [/обучени|курс(ы|а)?\b|вебинар|учёб|учеб|интенсив|марафон/, 'expense', 'Образование', 'Обучение'],
  [/книг|книжн/, 'expense', 'Образование', 'Книги'],

  [/подар|цвет(ы|ов)\b|букет/, 'expense', 'Подарки/Благотворительность', 'Подарки'],
  [/благотвор|пожертв/, 'expense', 'Подарки/Благотворительность', 'Благотворительные взносы'],

  [/ипотек|кредит|рассрочк|долг отда|по карте сбер/, 'expense', 'Налоги/Кредиты', 'Кредитная карта Сбер'],
  [/осаго|каско|страховк/, 'expense', 'Страховка', 'Автомобиль'],
  [/налог/, 'expense', 'Страховка', 'Налог'],

  [/табак|сигарет|стик|вейп|жидкост/, 'expense', 'Развлечения', 'Табак'],
  [/алкогол|вино|пиво|виск|коньяк|шампанск|закуск/, 'expense', 'Развлечения', 'Алкоголь, закуски'],
  [/кино|киноте/, 'expense', 'Развлечения', 'Кинотеатр'],
  [/театр|спектакл/, 'expense', 'Развлечения', 'Театр'],
  [/концерт/, 'expense', 'Развлечения', 'Концерты'],
  [/фуд.?корт|фастфуд|макдо|вкусно и точка|kfc|кфс|бургер|шаверм|шаурм|донер/, 'expense', 'Развлечения', 'Фуд-корт'],
  [/спортзал|фитнес|бассейн|тренировк|абонемент/, 'expense', 'Развлечения', 'Спорт'],
  [/гаджет|наушник|телефон куп|планшет/, 'expense', 'Развлечения', 'Игрушки/Гаджеты'],

  [/подписк|нетфликс|netflix|иви\b|okko|окко|кинопоиск|яндекс плюс|spotify|тильд/, 'expense', 'Подписки', 'Сервисы музыки/Фильмов'],

  [/корм|ветеринар|зоомаг|кошк|собак|котик/, 'expense', 'Животные', 'Еда'],

  [/отпуск|отел(ь|я)|авиабилет|билет(ы)? на самол|путёвк|путевк|турагент/, 'expense', 'Отпуск', 'Билеты'],
  [/комисси|обслуживание карты/, 'expense', 'Разное', 'Банковские комиссии'],
  [/сбереж|накопл|копилк|отложил|на подушк/, 'expense', 'Сбережения', 'На сберегательные счета'],
];

const MONTH_WORDS = ['январ', 'феврал', 'март', 'апрел', 'мая|май', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];

/* Ищет в фразе название статьи — категории или подкатегории — как они заданы в справочнике.
   Побеждает самое длинное совпадение: «дети дет.сад» точнее, чем просто «дети». */
function explicitCategory(s) {
  let best = null;
  const consider = (type, category, subcategory, len) => {
    if (!best || len > best.len) best = { type, category, subcategory, len };
  };

  for (const [list, type] of [[EXPENSE_CATEGORIES, 'expense'], [INCOME_CATEGORIES, 'income']]) {
    for (const c of list) {
      if (!s.includes(c.name.toLowerCase())) continue;
      let sub = '';
      for (const sb of c.subs) {
        const sn = sb.toLowerCase();
        if (s.includes(sn) && sn.length > sub.length) sub = sb;
      }
      consider(type, c.name, sub, c.name.length + sub.length);
    }
  }

  // Подкатегории, которые встречаются лишь в одной категории, можно называть без неё:
  // «коммунальные платежи 8500». Неоднозначные («Одежда», «Другое») пропускаем.
  if (!best) {
    const seen = new Map();
    for (const [list, type] of [[EXPENSE_CATEGORIES, 'expense'], [INCOME_CATEGORIES, 'income']]) {
      for (const c of list) for (const sb of c.subs) {
        const k = sb.toLowerCase();
        if (!seen.has(k)) seen.set(k, []);
        seen.get(k).push({ type, cat: c.name, sub: sb });
      }
    }
    for (const [k, owners] of seen) {
      if (owners.length !== 1 || k.length < 5 || !s.includes(k)) continue;
      consider(owners[0].type, owners[0].cat, owners[0].sub, k.length);
    }
  }
  return best;
}

/* Возвращает { amount, type, category, subcategory, date, note, accountId } либо null. */
function parsePhrase(text, accountsList) {
  const src = String(text || '').trim();
  if (!src) return null;
  const s = src.toLowerCase();

  // ---- сумма ----
  const m = s.match(/(\d+(?:[\s ]\d{3})*(?:[.,]\d+)?)\s*(тыс(?:яч[аи]?)?|т\.?\s?р|k|к(?![а-я])|₽|руб\w*|р(?![а-я]))?/);
  if (!m) return null;
  let amount = parseFloat(m[1].replace(/[\s ]/g, '').replace(',', '.'));
  const mult = (m[2] || '').replace(/[.\s]/g, '');
  if (/^(тыс|k|к|тр)/.test(mult)) amount *= 1000;
  if (!amount || amount <= 0) return null;

  // ---- тип ----
  let type = 'expense';
  if (/(^|\s)(доход|получил|получила|заработал|заработала|пришл[ао]|вернули|прислал)/.test(s)) type = 'income';
  if (/перевод|перевёл|перевела|перевел|переложил|снял[аи]? с|положил[а]? на/.test(s)) type = 'transfer';

  // ---- категория ----
  // Сначала смотрим, не назвал ли человек статью прямо: «расход транспорт 700»,
  // «доход подработка пилатес 6000». Явно названная статья важнее словаря.
  let category = '', subcategory = '';
  const explicit = type === 'transfer' ? null : explicitCategory(s);
  if (explicit) {
    type = explicit.type;
    category = explicit.category;
    subcategory = explicit.subcategory;
  } else {
    for (const [re, t, cat, sub] of KEYWORDS) {
      if (re.test(s)) {
        if (type !== 'transfer') { type = t; category = cat; subcategory = sub; }
        break;
      }
    }
  }
  if (type === 'income' && !category) category = 'Другое';
  if (type === 'expense' && !category) { category = 'Разное'; subcategory = 'Другое'; }

  // ---- дата ----
  const now = new Date();
  const shift = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return localISO(d); };
  let date = localISO(now);
  if (/позавчера/.test(s)) date = shift(2);
  else if (/вчера/.test(s)) date = shift(1);
  else {
    const dm = s.match(/(\d{1,2})[.\-\/](\d{1,2})(?:[.\-\/](\d{2,4}))?/);
    const wordDate = s.match(/(\d{1,2})\s+([а-яё]{3,})/);
    if (dm) {
      const y = dm[3] ? (dm[3].length === 2 ? '20' + dm[3] : dm[3]) : now.getFullYear();
      date = `${y}-${String(dm[2]).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}`;
    } else if (wordDate) {
      const mi = MONTH_WORDS.findIndex((w) => new RegExp('^(' + w + ')').test(wordDate[2]));
      if (mi >= 0) date = `${now.getFullYear()}-${String(mi + 1).padStart(2, '0')}-${String(wordDate[1]).padStart(2, '0')}`;
    }
  }

  // ---- счёт ----
  let accountId = null;
  for (const a of accountsList) {
    const n = a.name.toLowerCase();
    if (s.includes(n) || (/налич|наликом|кэшем/.test(s) && /налич/.test(n)) || (/карт|сбер|тинькоф|альф/.test(s) && /карт|сбер/.test(n))) {
      accountId = a.id;
      break;
    }
  }

  // ---- заметка ----
  // \b в JS не работает с кириллицей, поэтому служебные слова вырезаем по пробелам.
  const STOP = /(^|\s)(вчера|позавчера|сегодня|наличными|наличкой|налом|картой|рублей|рубля|рублях|руб\.?|доход|расход|трата|потратил|потратила|получил|получила|заработал|заработала)(?=\s|$|[.,!])/gi;
  const note = src
    .replace(m[0], ' ')
    .replace(/(^|\s)\d{1,2}[.\-\/]\d{1,2}([.\-\/]\d{2,4})?(?=\s|$)/g, ' ')
    .replace(STOP, ' ')
    .replace(STOP, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { amount, type, category, subcategory, date, note: note.slice(0, 60), accountId };
}

const localISO = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/* ---------- Голосовой ввод ----------
   На айфоне у распознавания речи Safari есть особенность: в приложении,
   запущенном с домашнего экрана, оно «стартует» и молчит навсегда — ни результата,
   ни ошибки. Поэтому там сразу отправляем к диктовке с клавиатуры, а везде ещё
   держим сторожевой таймер, чтобы кнопка не горела вечно. */
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_STANDALONE = window.navigator.standalone === true ||
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

const Voice = {
  rec: null,
  active: false,
  timer: null,
  placeholder: '',

  supported() {
    if (IS_IOS && IS_STANDALONE) return false;
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  },

  /* Диктовка с клавиатуры: ставим курсор в поле, дальше человек жмёт 🎤 на клавиатуре. */
  useKeyboard(input, why) {
    this.reset(input);
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
    toast(why || 'Нажмите 🎤 на клавиатуре и продиктуйте');
  },

  start(input, onDone) {
    if (this.active) return this.stop(input);

    if (!this.supported()) {
      return this.useKeyboard(input, IS_IOS
        ? 'На айфоне диктуйте кнопкой 🎤 на клавиатуре'
        : 'Здесь нет распознавания речи — наберите текстом');
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'ru-RU';
    rec.interimResults = true;
    rec.continuous = false;

    let heard = false;
    rec.onresult = (e) => {
      heard = true;
      this.arm(input);
      let text = '';
      for (const r of e.results) text += r[0].transcript;
      input.value = text;
      if (e.results[e.results.length - 1].isFinal) {
        this.reset(input);
        onDone(text);
      }
    };
    rec.onerror = (e) => {
      this.reset(input);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.useKeyboard(input, 'Нет доступа к микрофону — продиктуйте с клавиатуры');
      } else if (e.error !== 'aborted') {
        toast('Не расслышал, попробуйте ещё раз');
      }
    };
    rec.onend = () => {
      const wasActive = this.active;
      this.reset(input);
      if (wasActive && !heard) this.useKeyboard(input, 'Ничего не расслышал — продиктуйте с клавиатуры');
    };

    this.rec = rec;
    this.active = true;
    this.placeholder = input.placeholder;
    document.body.classList.add('listening');
    input.value = '';
    input.placeholder = 'Говорите…';

    try {
      rec.start();
    } catch (err) {
      // Например, распознавание уже запущено — состояние обязательно снимаем.
      this.reset(input);
      return this.useKeyboard(input, 'Голосовой ввод не запустился — продиктуйте с клавиатуры');
    }
    this.arm(input);
  },

  /* Сторожевой таймер: если за 8 секунд ничего не пришло — выключаем сами. */
  arm(input) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.active) return;
      this.stop(input);
      this.useKeyboard(input, 'Микрофон не отвечает — продиктуйте с клавиатуры');
    }, 8000);
  },

  stop(input) {
    try { this.rec && this.rec.abort ? this.rec.abort() : this.rec && this.rec.stop(); } catch (e) {}
    this.reset(input);
  },

  reset(input) {
    clearTimeout(this.timer);
    this.timer = null;
    this.active = false;
    document.body.classList.remove('listening');
    if (input && this.placeholder) input.placeholder = this.placeholder;
  },
};
