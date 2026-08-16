/* Импорт файла «Планировщик семейного бюджета» (ЭксельХак), выгруженного в CSV.
   Лист устроен блоками: строка-заголовок с месяцами, под ней подкатегории,
   заканчивается блок строками «Итого …» и «% от всех расходов». */

const MONTH_HEADERS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/* Названия в таблице и в приложении местами расходятся. */
const NAME_FIX = {
  'бытовые (магнит,фикс)': 'Бытовые (Магнит, Фикс)',
  'английский,танцы, алгебра': 'Английский, танцы, алгебра',
  'алкоголь,закуски': 'Алкоголь, закуски',
  'рассрочка яндекс': 'Рассрочка Яндекс',
  'доктора/стомотологи': 'Доктора/Стоматологи',
  'sintex,gamma,бегает': 'Sintex, Gamma',
  'фуд-корт': 'Фуд-корт',
  'мама,папа': 'Мама, папа',
  'другие комисиии': 'Другие комиссии',
};

/* Строки блока «Доходы» — это сами категории доходов. */
const INCOME_MAP = {
  'зарплата': ['Зарплата', ''],
  'пилатес': ['Подработка', 'Пилатес'],
  'хобби': ['Подработка', 'Хобби'],
  'кодекс': ['Подработка', 'Кодекс'],
  'подработка': ['Подработка', ''],
  'подарки': ['Подарки', ''],
  'мама,папа': ['Мама, папа', ''],
  'муж': ['Муж', ''],
  'кэшбэк': ['Кэшбэк', ''],
  'дивиденды': ['Дивиденды', ''],
  'компенсация за сад': ['Компенсация за сад', ''],
  'трансфер с сбережений': ['Трансфер с сбережений', ''],
};

const fixName = (s) => NAME_FIX[String(s).trim().toLowerCase()] || String(s).trim();

/* «- 7 383 ₽» → -7383, «  -   ₽ » → 0 */
function plannerNum(v) {
  const s = String(v || '').replace(/[\s  ₽]/g, '');
  if (!s || s === '-') return 0;
  const neg = s.startsWith('-');
  const digits = s.replace(/[^\d.,]/g, '').replace(',', '.');
  if (!digits) return 0;
  const n = parseFloat(digits);
  return isNaN(n) ? 0 : (neg ? -n : n);
}

const isMonthHeader = (row) =>
  MONTH_HEADERS.every((m, i) => String(row[i + 1] || '').trim().toLowerCase().startsWith(m));

/* Возвращает { year, rows: [{type, category, subcategory, values[12]}], totals } */
function parsePlannerCsv(text, year) {
  const table = parseCsv(text);
  const rows = [];
  let block = null;

  for (const r of table) {
    const head = String(r[0] || '').trim();

    if (isMonthHeader(r)) {
      // «Итого» — сводный блок в шапке листа, его данные дублируют остальные.
      block = head && head.toLowerCase() !== 'итого' ? head : null;
      continue;
    }
    if (!block || !head) continue;
    if (/^итого/i.test(head) || /^%/.test(head)) continue;

    const values = Array.from({ length: 12 }, (_, i) => plannerNum(r[i + 1]));
    if (!values.some((v) => v !== 0)) continue;

    if (block.toLowerCase() === 'доходы') {
      const m = INCOME_MAP[head.toLowerCase()];
      rows.push({ type: 'income', category: m ? m[0] : fixName(head), subcategory: m ? m[1] : '', values });
    } else {
      rows.push({ type: 'expense', category: fixName(block), subcategory: fixName(head), values });
    }
  }

  return { year, rows };
}

/* Превращает разобранный лист в операции приложения. */
function plannerToTransactions(parsed, accountId) {
  const out = [];
  let seq = 0;
  for (const row of parsed.rows) {
    row.values.forEach((v, m) => {
      if (!v) return;
      out.push({
        id: uid('tx'), type: row.type, amount: v, accountId, toAccountId: null,
        category: row.category, subcategory: row.subcategory,
        date: `${parsed.year}-${String(m + 1).padStart(2, '0')}-01`,
        note: `Планировщик ${parsed.year}`, src: 'planner', srcYear: parsed.year,
        createdAt: Date.now() + seq++,
      });
    });
  }
  return out;
}

/* Сверка с итогами листа — чтобы сразу видеть, всё ли перенеслось. */
function plannerCheck(parsed) {
  const inc = Array(12).fill(0), exp = Array(12).fill(0);
  for (const row of parsed.rows) {
    row.values.forEach((v, m) => {
      if (row.type === 'income') inc[m] += v; else exp[m] += v;
    });
  }
  return { income: inc, expense: exp, incomeTotal: inc.reduce((s, v) => s + v, 0), expenseTotal: exp.reduce((s, v) => s + v, 0) };
}
