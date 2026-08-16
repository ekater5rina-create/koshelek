/* Цели и советы. Все расчёты строятся на истории операций пользователя,
   никаких «средних по стране» — только его собственные месяцы. */

/* Насколько категория поддаётся урезанию: 0 — обязательный платёж, 1 — полностью на усмотрение.
   Проверяются по очереди, берётся первое совпадение по «Категория / Подкатегория». */
const FLEX_RULES = [
  // Сбережения тоже неприкосновенны: предлагать «сэкономить на накоплениях» бессмысленно.
  [/Сбережения|Коммунальные|Телефон|Интернет|Кредит|Рассрочка|РКО|Налог|Страховк|Дет\.сад|Обучение|Лекарства|Доктора|Скорая/i, 0],
  [/Табак/i, 1],
  [/Алкоголь|Фуд-корт|Кафе\/Рестораны/i, 0.9],
  [/Подписки|Игрушки\/Гаджеты|Концерты|Кинотеатр|Театр|Музыка|Фильмы/i, 0.8],
  [/Одежда|Игрушки/i, 0.7],
  [/Парикмахерская|Салон|Процедуры|БАДы/i, 0.6],
  // «Спорт» пишем с границей, иначе правило ловит «Транспорт».
  [/Подарки|Отпуск|(^|[\s\/])Спорт|Дача еда/i, 0.5],
  [/Разное|Другое|Ремонт дом|Дача/i, 0.45],
  [/Бытовые \(Магнит|Бензин|Автобус\/Такси|Ремонт(?! дом)/i, 0.3],
  [/Продукты|Питание|Обеды/i, 0.25],
];

const flexibility = (cat, sub) => {
  const key = `${cat} / ${sub || ''}`;
  for (const [re, f] of FLEX_RULES) if (re.test(key)) return f;
  return 0.15; // всё остальное слегка поджимается
};

const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const median = (arr) => percentile(arr, 0.5);
const monthDiff = (fromKey, toKey) => {
  const [fy, fm] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
};
const addMonths = (key, n) => {
  const d = parseKey(key);
  d.setMonth(d.getMonth() + n);
  return monthKey(d);
};

const Advice = {
  /* Последние N завершённых месяцев, в которых были операции. */
  recentMonths(n = 6) {
    const cur = monthKey(new Date());
    const keys = [...new Set(Store.state.transactions.map((t) => t.date.slice(0, 7)))]
      .filter((k) => k < cur)
      .sort();
    return keys.slice(-n);
  },

  /* Свободные деньги в месяц: медиана профицита. Медиана, а не среднее,
     чтобы разовая покупка машины не обнуляла картину. */
  freeCash(n = 6) {
    const months = this.recentMonths(n);
    if (!months.length) return { value: 0, months: [], list: [] };
    const list = months.map((k) => ({ month: k, profit: monthTotals(k).profit }));
    return { value: Math.round(median(list.map((x) => x.profit))), months, list };
  },

  /* Расходы по паре «категория / подкатегория» за указанные месяцы. */
  byPair(months, skipGoals = false) {
    const map = new Map();
    for (const t of Store.state.transactions) {
      if (t.type !== 'expense') continue;
      // Пополнения целей — это осознанные накопления, а не перерасход.
      if (skipGoals && t.goalId) continue;
      const k = t.date.slice(0, 7);
      if (!months.includes(k)) continue;
      const key = t.category + ' / ' + (t.subcategory || '');
      if (!map.has(key)) map.set(key, Object.fromEntries(months.map((m) => [m, 0])));
      map.get(key)[k] += t.amount;
    }
    return map;
  },

  /* Идеи экономии: сравниваем средний месяц категории с её же скромным месяцем.
     Экономия = (среднее − скромный месяц) × гибкость категории. */
  savingIdeas(need, n = 6) {
    const months = this.recentMonths(n);
    if (months.length < 2) return [];
    const ideas = [];
    for (const [key, byMonth] of this.byPair(months)) {
      const vals = months.map((m) => byMonth[m]);
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      if (avg < 300) continue;
      const [cat, sub] = key.split(' / ');
      const flex = flexibility(cat, sub);
      if (!flex) continue;
      const lean = percentile(vals, 0.25);
      const save = Math.round((avg - lean) * flex);
      if (save < 200) continue;
      ideas.push({ cat, sub, avg: Math.round(avg), lean: Math.round(lean), save, flex });
    }
    ideas.sort((a, b) => b.save - a.save);

    // Отмечаем, скольких идей хватает, чтобы закрыть нехватку.
    let acc = 0;
    for (const i of ideas) {
      i.covers = acc < need;
      acc += i.save;
    }
    return ideas;
  },

  /* Ожидаемый профицит конкретного календарного месяца по прошлым годам.
     known = false значит, что такого месяца в истории ещё не было и судить не по чему. */
  expectedProfit(key) {
    const m = key.slice(5);
    const same = [...new Set(Store.state.transactions.map((t) => t.date.slice(0, 7)))]
      .filter((k) => k.slice(5) === m && k < monthKey(new Date()))
      .map((k) => monthTotals(k).profit);
    if (!same.length) return { value: this.freeCash().value, known: false };
    return { value: Math.round(median(same)), known: true };
  },

  /* План по цели: сколько нужно в месяц ровным темпом и по «умному» графику,
     где в традиционно тяжёлые месяцы откладывается меньше. */
  plan(goal) {
    const cur = monthKey(new Date());
    const saved = goalSaved(goal);
    const need = Math.max(0, goal.target - saved);
    const monthsLeft = goal.deadline ? Math.max(0, monthDiff(cur, goal.deadline) + 1) : null;
    const free = this.freeCash();

    const flat = monthsLeft ? Math.ceil(need / monthsLeft) : null;
    const gap = flat != null ? Math.max(0, flat - free.value) : 0;

    // Неравномерный график: вес месяца — его ожидаемый профицит.
    let schedule = [];
    if (monthsLeft) {
      const months = Array.from({ length: monthsLeft }, (_, i) => addMonths(cur, i));
      const est = months.map((k) => this.expectedProfit(k));

      // Месяцу, которого ещё не было в истории, даём средний вес вместо нулевого:
      // отсутствие данных — не повод считать месяц безнадёжным.
      const knownWeights = est.filter((e) => e.known).map((e) => Math.max(0, e.value));
      const neutral = knownWeights.length ? knownWeights.reduce((s, v) => s + v, 0) / knownWeights.length : 1;
      const weights = est.map((e) => (e.known ? Math.max(0, e.value) : neutral));

      const sum = weights.reduce((s, w) => s + w, 0);
      schedule = months.map((k, i) => ({
        month: k,
        amount: sum > 0 ? Math.round((need * weights[i]) / sum) : Math.ceil(need / monthsLeft),
        expected: est[i].value,
        known: est[i].known,
      }));
      // Из-за округления сумма графика может разойтись с целью — правим последний месяц.
      const drift = need - schedule.reduce((s, x) => s + x.amount, 0);
      const last = [...schedule].reverse().find((x) => x.amount > 0);
      if (last && drift) last.amount += drift;
    }

    // Когда цель закроется при нынешнем темпе накоплений.
    const forecastMonths = free.value > 0 ? Math.ceil(need / free.value) : null;

    return {
      saved, need, monthsLeft, flat, gap, free, schedule, forecastMonths,
      forecastMonth: forecastMonths != null ? addMonths(cur, forecastMonths - 1) : null,
      onTrack: flat == null ? free.value > 0 : flat <= free.value,
      done: need <= 0,
    };
  },

  /* Что в этом месяце выбилось из привычного. */
  anomalies(key, n = 6) {
    const months = this.recentMonths(n).filter((m) => m !== key);
    if (months.length < 2) return [];
    const base = this.byPair(months, true);
    const now = this.byPair([key], true);
    const out = [];
    for (const [pair, byMonth] of now) {
      const cur = byMonth[key];
      const vals = base.has(pair) ? months.map((m) => base.get(pair)[m]) : [0];
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const diff = Math.round(cur - avg);
      if (diff > 1500 && cur > avg * 1.4) {
        const [cat, sub] = pair.split(' / ');
        out.push({ cat, sub, cur: Math.round(cur), avg: Math.round(avg), diff });
      }
    }
    return out.sort((a, b) => b.diff - a.diff).slice(0, 5);
  },

  /* Прогноз расходов до конца месяца по текущему темпу. */
  forecast(key) {
    const now = new Date();
    if (key !== monthKey(now)) return null;
    const day = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const spent = monthTotals(key).expense;
    if (day < 3) return null;
    return { spent, projected: Math.round((spent / day) * daysInMonth), day, daysInMonth };
  },
};

/* Накоплено по цели — сумма операций, привязанных к ней.
   Пополнение может быть переводом на сберегательный счёт или расходом
   в категорию «Сбережения»; снятие обратно приходит доходом и вычитается. */
const goalSaved = (goal) =>
  (goal.initial || 0) +
  Store.state.transactions
    .filter((t) => t.goalId === goal.id)
    .reduce((s, t) => s + (t.type === 'income' ? -t.amount : t.amount), 0);
