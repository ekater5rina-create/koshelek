/* Кошелёк — учёт наличных и счетов. Вся логика приложения. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* Версию видно в «Ещё» — так сразу понятно, доехало ли обновление до телефона. */
const APP_VERSION = '13 · сканер камерой';

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTHS_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const DAYS = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];

const money = (n) => (n < 0 ? '−' : '') + Math.round(Math.abs(n)).toLocaleString('ru-RU') + ' ₽';
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const parseKey = (k) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1); };
const todayISO = () => new Date().toISOString().slice(0, 10);

/* ---------- Состояние экранов ---------- */
const ui = {
  screen: 'home',
  opsMonth: monthKey(new Date()),
  repMonth: monthKey(new Date()),
  repKind: 'expense',
  search: '',
  draft: null,
};

/* ---------- Помощники по данным ---------- */
const accounts = () => Store.state.accounts.filter((a) => !a.archived);
const accountById = (id) => Store.state.accounts.find((a) => a.id === id);
const catList = (type) => (type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES);
const catMeta = (type, name) =>
  catList(type).find((c) => c.name === name) || { name: name || 'Без категории', icon: '❓', color: '#9aa0a6', subs: [] };

function balanceOf(accId) {
  const acc = accountById(accId);
  if (!acc) return 0;
  let sum = acc.initial || 0;
  for (const t of Store.state.transactions) {
    if (t.type === 'expense' && t.accountId === accId) sum -= t.amount;
    else if (t.type === 'income' && t.accountId === accId) sum += t.amount;
    else if (t.type === 'transfer') {
      if (t.accountId === accId) sum -= t.amount;
      if (t.toAccountId === accId) sum += t.amount;
    }
  }
  return sum;
}
/* Общий счёт — только повседневные деньги. Сбережения считаются отдельно,
   как «Баланс расходов» и «Баланс сбережений» в таблице. */
/* Сверка кошелька: сколько денег там на самом деле против того, что насчитал учёт.
   Разница считается один раз, в момент сверки, и хранится как есть — иначе
   операции, добавленные после сверки, поднимали бы ложную тревогу. */
function discrepancy(a) {
  return a.fact ? (a.fact.diff || 0) : 0;
}
const accountsWithGap = () => accounts().filter((a) => discrepancy(a) !== 0);

const spendAccounts = () => accounts().filter((a) => !a.savings);
const savingAccounts = () => accounts().filter((a) => a.savings);
const totalBalance = () => spendAccounts().reduce((s, a) => s + balanceOf(a.id), 0);
const savingsBalance = () => savingAccounts().reduce((s, a) => s + balanceOf(a.id), 0);

const txOfMonth = (key) =>
  Store.state.transactions
    .filter((t) => t.date.slice(0, 7) === key)
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));

/* Как в таблице: перевод на сберегательный счёт — это расход месяца
   (строка «Сбережения»), а снятие обратно — доход («Трансфер с сбережений»).
   Возвращает +1 для отложенного, −1 для снятого, 0 для обычного перевода. */
const accIsSavings = (id) => !!accountById(id)?.savings;
function savingsFlow(t) {
  if (t.type !== 'transfer') return 0;
  const from = accIsSavings(t.accountId), to = accIsSavings(t.toAccountId);
  if (!from && to) return 1;
  if (from && !to) return -1;
  return 0;
}
const SAVINGS_IN = 'Сбережения';
const SAVINGS_OUT = 'Трансфер с сбережений';

function monthTotals(key) {
  let income = 0, expense = 0;
  for (const t of txOfMonth(key)) {
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
    else {
      const f = savingsFlow(t);
      if (f > 0) expense += t.amount;
      else if (f < 0) income += t.amount;
    }
  }
  return { income, expense, profit: income - expense };
}

function byCategory(key, type) {
  const map = new Map();
  const add = (name, sum) => map.set(name, (map.get(name) || 0) + sum);
  for (const t of txOfMonth(key)) {
    if (t.type === type) { add(t.category, t.amount); continue; }
    const f = savingsFlow(t);
    if (type === 'expense' && f > 0) add(SAVINGS_IN, t.amount);
    if (type === 'income' && f < 0) add(SAVINGS_OUT, t.amount);
  }
  return [...map.entries()].map(([name, sum]) => ({ name, sum })).sort((a, b) => b.sum - a.sum);
}

/* ---------- Навигация ---------- */
function go(screen) {
  ui.screen = screen;
  $$('.screen').forEach((s) => (s.hidden = s.dataset.screen !== screen));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.goto === screen));
  render();
}

/* ---------- Рендер ---------- */
function render() {
  applyTheme();
  if (ui.screen === 'home') renderHome();
  if (ui.screen === 'ops') renderOps();
  if (ui.screen === 'report') renderReport();
  if (ui.screen === 'more') renderMore();
  if (ui.screen === 'budgets') renderBudgets();
  if (ui.screen === 'goals') renderGoals();
  if (ui.screen === 'recurring') renderRecurring();
  if (ui.screen === 'fund') renderFund();
}

/* ---------- Регулярные платежи ---------- */
function renderRecurring() {
  const pending = Plans.pending();
  const tracked = (Store.state.recurring || []).filter((r) => r.active !== false);
  const key = monthKey(new Date());
  $('#recSummary').innerHTML = tracked.length
    ? `${MONTHS[new Date().getMonth()]}: отмечено ${tracked.length - pending.length} из ${tracked.length} на ${money(tracked.reduce((s, r) => s + r.amount, 0))}`
    : 'Пока ничего не отслеживается';

  let html = '';

  if (tracked.length) {
    html += `<div class="card"><div class="card-head"><span>Этот месяц</span></div>`;
    html += tracked
      .map((r) => {
        const done = !pending.includes(r);
        const m = catMeta('expense', r.cat);
        return `<div class="g-row rec-row">
          <span>${done ? '✅' : '⬜️'} ${m.icon} ${esc(r.sub || r.cat)}</span>
          ${done ? `<b class="muted-b">отмечено</b>` : `<button class="rec-add" data-recpay="${r.id}">Отметить ${money(r.amount)}</button>`}
          <span class="sub">${esc(r.cat)} · обычно ${money(r.amount)}<button class="rec-del" data-recdel="${r.id}">убрать</button></span>
        </div>`;
      })
      .join('');
    html += `</div>`;
  }

  const found = Plans.detect().filter((d) => !Plans.isTracked(d.cat, d.sub));
  html += `<div class="card"><div class="card-head"><span>Нашёл в вашей истории</span></div>`;
  html += found.length
    ? found
        .map((d) => `<div class="g-row rec-row">
          <span>${catMeta('expense', d.cat).icon} ${esc(d.sub || d.cat)}</span>
          <button class="rec-add ghost" data-rectrack='${esc(JSON.stringify({ cat: d.cat, sub: d.sub, amount: d.amount }))}'>Отслеживать</button>
          <span class="sub">${esc(d.cat)} · ${money(d.amount)} · было в ${d.months} ${plural(d.months, 'месяце', 'месяцах', 'месяцах')} из ${d.of}</span>
        </div>`)
        .join('')
    : '<div class="empty">Все повторяющиеся траты уже отслеживаются</div>';
  html += `</div>`;

  $('#recBody').innerHTML = html;
}

function trackRecurring(data) {
  Store.state.recurring = Store.state.recurring || [];
  Store.state.recurring.push({
    id: uid('rec'), cat: data.cat, sub: data.sub, amount: data.amount,
    accountId: Store.state.settings.lastAccountId || accounts()[0]?.id, active: true,
  });
  Store.save();
  render();
  toast('Буду напоминать об этом платеже');
}

/* Отметить платёж — через то же окно подтверждения. */
function payRecurring(id) {
  const r = Store.state.recurring.find((x) => x.id === id);
  if (!r) return;
  openConfirm({
    kind: 'single',
    source: `Регулярный платёж · обычно ${money(r.amount)}`,
    draft: {
      type: 'expense', amount: r.amount, category: r.cat, subcategory: r.sub,
      date: todayISO(), note: '', accountId: r.accountId || Store.state.settings.lastAccountId || accounts()[0]?.id,
      toAccountId: accounts()[1]?.id,
    },
  });
}

/* ---------- Фонд нерегулярных трат ---------- */
function renderFund() {
  const f = Plans.fund();
  if (!f) {
    $('#fundBody').innerHTML = '<div class="card"><div class="empty">Нужно хотя бы полгода истории, чтобы посчитать фонд</div></div>';
    return;
  }
  const free = Advice.freeCash().value;

  let html = `<div class="card">
    <div class="conf-amount">${money(f.perMonth)}</div>
    <div class="conf-src">откладывать в месяц, чтобы такие траты не роняли бюджет</div>
    <div class="verdict ${f.perMonth > Math.max(0, free) ? 'risk' : ''}">
      За ${f.months} ${plural(f.months, 'месяц', 'месяца', 'месяцев')} редкие крупные траты забрали <b>${money(f.total)}</b> —
      это ${money(f.perMonth)} в месяц, если растянуть их ровно.
      ${f.perMonth > Math.max(0, free)
        ? `Сейчас свободными остаётся ${money(free)}, так что фонд придётся собирать за счёт экономии — загляните в цели, там список категорий.`
        : `Свободными у вас ${money(free)} в месяц, так что фонд собирается без напряжения.`}
    </div>
    <div class="g-row"><span>Уже отложено в фонд</span><b>${money(f.saved)}</b></div>
    <div class="g-actions"><button class="g-btn" id="fundTopUp">Отложить в фонд</button></div>
  </div>`;

  html += `<div class="card"><div class="card-head"><span>Из чего он состоит</span></div>`;
  html += f.items
    .map((i) => `<div class="g-row">
      <span>${catMeta('expense', i.cat).icon} ${esc(i.sub ? i.cat + ' · ' + i.sub : i.cat)}</span><b>${money(i.need)}</b>
      <span class="sub">${i.kind === 'spike'
        ? `бывает почти каждый месяц по ${money(i.med)}, но один раз ушло ${money(i.max)} — резервирую только превышение`
        : `${i.times} ${plural(i.times, 'раз', 'раза', 'раз')} за ${f.months} мес · самый крупный ${money(i.max)}`} · ${money(Math.round(i.need / f.months))} в месяц</span>
    </div>`)
    .join('');
  html += `</div>`;
  html += `<div class="hint">Считаю по периоду с ${goalMonthName(f.from)} по ${goalMonthName(f.to)}. Сюда попадают траты, которые случались не чаще чем в половине месяцев, но били крупно, — машина, дача, ремонт, страховка.</div>`;

  $('#fundBody').innerHTML = html;
  $('#fundTopUp').onclick = () => topUpFund(f);
}

function topUpFund(f) {
  const v = prompt('Сколько отложить в фонд нерегулярных трат?', String(f.perMonth));
  if (v === null) return;
  const amount = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!amount || amount <= 0) return toast('Нужна сумма больше нуля');
  const accs = spendAccounts().map((a) => ({ label: a.name, icon: a.icon, note: money(balanceOf(a.id)), id: a.id }));
  openPicker('С какого счёта отложить', accs, (it) => {
    Store.state.transactions.push(saveToSavings(amount, it.id, FUND_TAG, { fund: true }));
    Store.save();
    render();
    toast(`Отложено ${money(amount)} в фонд`);
  });
}

/* ---------- Резервные копии ---------- */
async function doBackup() {
  const res = await Backup.save();
  if (res === 'cancelled') return;
  render();
  toast(res === 'shared' ? 'Копия готова — выберите «Сохранить в Файлы»' : 'Копия сохранена');
}

function renderBackupRow() {
  const d = Backup.daysSince();
  const unsaved = Backup.unsaved();
  const status = d === null
    ? 'копии ещё не было'
    : `последняя ${d === 0 ? 'сегодня' : d + ' ' + plural(d, 'день', 'дня', 'дней') + ' назад'}${unsaved ? `, с тех пор +${unsaved}` : ''}`;
  const el = $('#backupStatus');
  if (el) el.textContent = status;
  const rv = $('#backupRemindVal');
  if (rv) rv.textContent = Store.state.settings.backupRemind === false ? 'выключено' : 'раз в 2 недели';
}

/* ---------- Цели ---------- */
const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const goalMonthName = (key) => {
  const d = parseKey(key);
  return `${MONTHS[d.getMonth()].toLowerCase()} ${d.getFullYear()}`;
};
// Форма для «до …» и «к …»: до июня 2027, а не «до июнь 2027».
const goalMonthGen = (key) => {
  const d = parseKey(key);
  return `${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
};

function goalRow(g) {
  const p = Advice.plan(g);
  const pct = Math.min(100, Math.round((p.saved / g.target) * 100));
  const cls = p.done ? 'ok' : p.onTrack ? '' : 'risk';
  let line;
  if (p.done) line = 'Цель собрана 🎉';
  else if (p.monthsLeft) line = `Откладывать <b>${money(p.flat)}</b> в месяц · ${p.monthsLeft} мес. до ${goalMonthGen(g.deadline)}`;
  else line = p.forecastMonth ? `При нынешнем темпе — к ${goalMonthGen(p.forecastMonth)}` : 'Срок не задан';
  return `<button class="goal" data-goal="${g.id}">
    <div class="goal-top"><span>${g.icon}</span><span class="goal-name">${esc(g.name)}</span><span class="goal-pct">${pct}%</span></div>
    <div class="goal-track"><div class="goal-fill ${cls}" style="width:${pct}%"></div></div>
    <div class="goal-line">${money(p.saved)} из ${money(g.target)}</div>
    <div class="goal-line">${line}</div>
  </button>`;
}

function renderGoals() {
  const free = Advice.freeCash();
  $('#goalsFree').innerHTML = free.months.length
    ? `Свободных денег: <b>${money(free.value)}</b> в месяц (медиана за ${free.months.length} мес.)`
    : 'Пока мало истории, чтобы оценить свободные деньги';
  $('#goalsList').innerHTML = Store.state.goals.length
    ? `<div class="card">${Store.state.goals.map(goalRow).join('')}</div>`
    : '<div class="card"><div class="empty">Целей нет. Нажмите «+» вверху — например, «Обучение», 300 000 ₽, к июню 2027</div></div>';
}

function renderHomeGoals() {
  const goals = Store.state.goals;
  $('#homeGoalsCard').hidden = !goals.length;
  if (goals.length) {
    // Показываем ближайшую по сроку, а без срока — самую крупную.
    const sorted = [...goals].sort((a, b) => (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1);
    $('#homeGoals').innerHTML = sorted.slice(0, 2).map(goalRow).join('');
  }

  const tips = buildTips();
  $('#homeAdviceCard').hidden = !tips.length;
  $('#homeAdvice').innerHTML = tips
    .map((t) => t.gap
      ? `<button class="adv adv-act" data-gap="${t.gap}"><div class="adv-ic">${t.icon}</div><div>${t.text}<div class="adv-go">Внести операцию ›</div></div></button>`
      : `<div class="adv"><div class="adv-ic">${t.icon}</div><div>${t.text}</div></div>`)
    .join('');
}

/* Подсказки на главной: прогноз месяца, аномалии, статус по целям. */
function buildTips() {
  const tips = [];
  const key = monthKey(new Date());

  // Расхождение по кошельку — первым: пока оно есть, все остальные цифры неточны.
  for (const a of accountsWithGap()) {
    const d = discrepancy(a);
    tips.push({
      icon: '⚠️',
      gap: a.id,
      text: `Кошелёк «${esc(a.name)}»: по факту ${money(a.fact.amount)}, а по учёту ${money(a.fact.calc)}. ${d > 0 ? 'Внесите доход' : 'Внесите расход'} на <b>${money(Math.abs(d))}</b>.`,
    });
  }

  // Напоминание о копии — потерять всю историю дороже любого перерасхода.
  if (Backup.overdue()) {
    const d = Backup.daysSince();
    tips.push({
      icon: '💾',
      text: `${d === null ? 'Копии данных ещё не было' : `Копии не было ${d} ${plural(d, 'день', 'дня', 'дней')}`}${Backup.unsaved() ? `, с тех пор добавилось ${Backup.unsaved()} ${plural(Backup.unsaved(), 'операция', 'операции', 'операций')}` : ''}. Всё хранится только на этом телефоне — <b>сделайте копию</b> в «Ещё».`,
    });
  }

  // Регулярные платежи, которых ещё не было в этом месяце.
  const pending = Plans.pending(key);
  if (pending.length) {
    const sum = pending.reduce((s, r) => s + r.amount, 0);
    tips.push({
      icon: '🔁',
      text: `В этом месяце ещё не отмечено ${pending.length} ${plural(pending.length, 'платёж', 'платежа', 'платежей')} на <b>${money(sum)}</b>: ${pending.slice(0, 3).map((r) => esc(r.sub || r.cat)).join(', ')}${pending.length > 3 ? '…' : ''}`,
    });
  }

  const f = Advice.forecast(key);
  if (f) {
    const base = Advice.recentMonths(6).map((m) => monthTotals(m).expense);
    const avg = base.length ? Math.round(base.reduce((s, v) => s + v, 0) / base.length) : 0;
    if (avg) {
      // К прогнозу по темпу добавляем неоплаченные регулярные платежи.
      const upcoming = pending.reduce((s, r) => s + r.amount, 0);
      const projected = f.projected + upcoming;
      const diff = projected - avg;
      tips.push({
        icon: diff > 0 ? '⚠️' : '👍',
        text: `За ${f.day} дн. потрачено <b>${money(f.spent)}</b>. К концу месяца выйдет около <b>${money(projected)}</b>${upcoming ? ` (включая ${money(upcoming)} регулярных платежей)` : ''} — это ${diff > 0 ? 'на ' + money(diff) + ' больше' : 'на ' + money(-diff) + ' меньше'} обычного.`,
      });
    }
  }

  for (const a of Advice.anomalies(key).slice(0, 2)) {
    tips.push({
      icon: '📈',
      text: `<b>${esc(a.sub || a.cat)}</b>: ${money(a.cur)} против обычных ${money(a.avg)} — на ${money(a.diff)} больше.`,
    });
  }

  for (const g of Store.state.goals) {
    const p = Advice.plan(g);
    if (p.done || !p.monthsLeft) continue;
    if (!p.onTrack) {
      tips.push({
        icon: '🏁',
        text: `Цель «${esc(g.name)}»: нужно <b>${money(p.flat)}</b> в месяц, а свободно ${money(p.free.value)}. Не хватает ${money(p.gap)} — откройте цель, там список, где их взять.`,
      });
    }
  }
  return tips.slice(0, 4);
}

/* Подробная карточка цели с планом и идеями экономии. */
function openGoal(id) {
  const g = Store.state.goals.find((x) => x.id === id);
  if (!g) return;
  ui.goalId = id;
  const p = Advice.plan(g);
  const pct = Math.min(100, Math.round((p.saved / g.target) * 100));
  $('#goalTitle').textContent = `${g.icon} ${g.name}`;

  let html = `<div class="goal" style="border:0">
      <div class="goal-track"><div class="goal-fill ${p.done ? 'ok' : p.onTrack ? '' : 'risk'}" style="width:${pct}%"></div></div>
      <div class="goal-line"><b>${money(p.saved)}</b> из ${money(g.target)} · осталось ${money(p.need)}</div>
    </div>`;

  // Вердикт
  if (p.done) {
    html += `<div class="verdict">Цель собрана. Можно закрыть её или поднять планку.</div>`;
  } else if (p.monthsLeft) {
    html += p.onTrack
      ? `<div class="verdict">Успеваете. Нужно откладывать <b>${money(p.flat)}</b> в месяц, а свободными у вас остаётся около <b>${money(p.free.value)}</b>.</div>`
      : `<div class="verdict risk">Не хватает <b>${money(p.gap)}</b> в месяц. Нужно ${money(p.flat)}, а свободно ${money(p.free.value)}.
         ${p.forecastMonth ? `Нынешним темпом цель закроется только к ${goalMonthGen(p.forecastMonth)}.` : 'При нынешнем темпе цель не закроется.'}</div>`;
  } else {
    html += `<div class="verdict">Срок не задан. При нынешнем темпе (${money(p.free.value)} в месяц) цель закроется ${p.forecastMonth ? 'к ' + goalMonthGen(p.forecastMonth) : 'нескоро'}.</div>`;
  }

  // График по месяцам
  if (p.schedule.length && !p.done) {
    html += `<div class="g-sec">План по месяцам</div>`;
    html += `<div class="g-row"><span class="sub">Ровным темпом нужно ${money(p.flat)} каждый месяц. Ниже — график с поправкой на ваши обычные траты: в тяжёлые месяцы меньше, в свободные больше.</span></div>`;
    html += p.schedule
      .map((s) => {
        const note = !s.known
          ? 'такого месяца в истории ещё не было — беру средний темп'
          : s.amount > 0
            ? `в этом месяце у вас обычно остаётся ≈ ${money(s.expected)}`
            : `пропускаем: этот месяц у вас традиционно в минусе (${money(s.expected)})`;
        return `<div class="g-row"><span>${goalMonthName(s.month)}</span><b>${money(s.amount)}</b>
          <span class="sub">${note}</span></div>`;
      })
      .join('');
  }

  // Где сэкономить
  if (!p.done) {
    const need = p.monthsLeft ? p.gap || p.flat : p.flat || 0;
    const ideas = Advice.savingIdeas(need);
    html += `<div class="g-sec">Где взять деньги</div>`;
    if (!ideas.length) {
      html += `<div class="g-row"><span class="sub">Пока мало истории, чтобы сравнить месяцы. Через пару месяцев учёта здесь появятся конкретные суммы.</span></div>`;
    } else {
      const total = ideas.filter((i) => i.covers).reduce((s, i) => s + i.save, 0);
      html += `<div class="g-row"><span class="sub">Сравниваю ваш средний месяц с вашим же скромным месяцем по каждой категории.
        Отмеченные ниже дают <b>${money(total || ideas.reduce((s, i) => s + i.save, 0))}</b> в месяц.</span></div>`;
      html += ideas
        .slice(0, 8)
        .map(
          (i) => `<div class="g-row"><span>${i.covers ? '✅ ' : ''}${esc(i.sub || i.cat)}</span><b>−${money(i.save)}</b>
          <span class="sub">обычно ${money(i.avg)}, а в скромные месяцы ${money(i.lean)} — разницу реально не тратить</span></div>`
        )
        .join('');
    }
  }

  html += `<div class="g-actions">
      <button class="g-btn" id="goalTopUp">Отложить</button>
      <button class="g-btn ghost" id="goalEdit">Изменить</button>
    </div>`;

  $('#goalBody').innerHTML = html;
  $('#goalSheet').hidden = false;
  $('#goalTopUp').onclick = () => topUpGoal(g);
  $('#goalEdit').onclick = () => editGoal(g);
}

function topUpGoal(g) {
  const p = Advice.plan(g);
  const def = p.flat || Math.max(1000, Math.round(p.need / 10));
  const v = prompt(`Сколько отложить на «${g.name}»?`, String(def));
  if (v === null) return;
  const amount = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!amount || amount <= 0) return toast('Нужна сумма больше нуля');

  const accs = spendAccounts().map((a) => ({ label: a.name, icon: a.icon, note: money(balanceOf(a.id)), id: a.id }));
  openPicker('С какого счёта отложить', accs, (it) => {
    Store.state.transactions.push(saveToSavings(amount, it.id, `Цель: ${g.name}`, { goalId: g.id }));
    Store.save();
    $('#goalSheet').hidden = true;
    render();
    toast(`Отложено ${money(amount)} на «${g.name}»`);
  });
}

/* Отложить деньги: если есть сберегательный счёт — это перевод на него,
   иначе просто расход в категорию «Сбережения». */
function saveToSavings(amount, fromId, note, extra) {
  const target = savingAccounts().find((a) => a.id !== fromId);
  const base = {
    id: uid('tx'), amount, accountId: fromId, date: todayISO(), note,
    createdAt: Date.now(), ...extra,
  };
  if (target) return { ...base, type: 'transfer', toAccountId: target.id, category: '', subcategory: '' };
  return { ...base, type: 'expense', toAccountId: null, category: 'Сбережения', subcategory: 'На сберегательные счета' };
}

function editGoal(g) {
  openPicker(`${g.icon} ${g.name}`, [
    { label: 'Переименовать', icon: '✏️', act: 'name' },
    { label: 'Изменить сумму', icon: '💰', act: 'target', note: money(g.target) },
    { label: 'Изменить срок', icon: '📅', act: 'deadline', note: g.deadline ? goalMonthName(g.deadline) : 'не задан' },
    { label: 'Учесть уже накопленное', icon: '🐖', act: 'initial', note: money(g.initial || 0) },
    { label: 'Удалить цель', icon: '🗑️', act: 'delete' },
  ], (it) => {
    if (it.act === 'name') { const v = prompt('Название цели', g.name); if (v) g.name = v.trim(); }
    else if (it.act === 'target') { const v = prompt('Сумма цели, ₽', String(g.target)); const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); if (n > 0) g.target = n; }
    else if (it.act === 'deadline') {
      const v = prompt('Срок в формате ГГГГ-ММ (пусто — без срока)', g.deadline || '');
      if (v === null) return;
      g.deadline = /^\d{4}-\d{2}$/.test(v.trim()) ? v.trim() : '';
    } else if (it.act === 'initial') {
      const v = prompt('Сколько уже накоплено на эту цель, ₽', String(g.initial || 0));
      const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
      if (!isNaN(n)) g.initial = n;
    } else if (it.act === 'delete') {
      if (!confirm(`Удалить цель «${g.name}»? Отложенные операции останутся.`)) return;
      Store.state.goals = Store.state.goals.filter((x) => x.id !== g.id);
      Store.save();
      $('#goalSheet').hidden = true;
      render();
      return;
    }
    Store.save();
    openGoal(g.id);
    render();
  });
}

function addGoal() {
  const name = prompt('На что копим? Например: Обучение');
  if (!name) return;
  const t = prompt('Сколько нужно собрать, ₽', '300000');
  const target = parseFloat(String(t).replace(/\s/g, '').replace(',', '.'));
  if (!target || target <= 0) return toast('Нужна сумма больше нуля');
  const d = prompt('К какому месяцу? Формат ГГГГ-ММ, можно оставить пустым', addMonths(monthKey(new Date()), 12));
  const icons = ['🎓', '🏖️', '🚗', '🏠', '💍', '🎁'];
  Store.state.goals.push({
    id: uid('goal'), name: name.trim(), icon: icons[Store.state.goals.length % icons.length],
    target, initial: 0, deadline: d && /^\d{4}-\d{2}$/.test(d.trim()) ? d.trim() : '', createdAt: Date.now(),
  });
  Store.save();
  render();
  openGoal(Store.state.goals.at(-1).id);
}

function renderHome() {
  $('#totalBalance').textContent = money(totalBalance());
  const key = monthKey(new Date());
  const t = monthTotals(key);
  $('#homeMonthSummary').textContent =
    `${MONTHS[new Date().getMonth()]}: доходы ${money(t.income)} · расходы ${money(t.expense)}`;

  const sav = savingsBalance();
  $('#savingsLine').hidden = !savingAccounts().length;
  $('#savingsLine').innerHTML = `🐖 Сбережения <b>${money(sav)}</b> — отдельно от общего счёта`;

  $('#accountsRow').innerHTML = spendAccounts().concat(savingAccounts())
    .map(
      (a) => {
        const d = discrepancy(a);
        return `<button class="acc-card ${a.savings ? 'is-savings' : ''} ${d ? 'has-gap' : ''}" data-acc="${a.id}">
        <div class="acc-name"><span>${a.icon}</span><span>${esc(a.name)}</span>${d ? '<span>⚠️</span>' : ''}</div>
        <div class="acc-sum">${money(balanceOf(a.id))}</div>
        ${d ? `<div class="acc-tag gap">расхождение ${money(Math.abs(d))}</div>` : a.savings ? '<div class="acc-tag">сбережения</div>' : ''}
      </button>`;
      }
    )
    .join('') || '<div class="empty">Нет счетов</div>';

  $('#monthKpis').innerHTML = `
    <div class="kpi"><div class="kpi-l">Доходы</div><div class="kpi-v pos">${money(t.income)}</div></div>
    <div class="kpi"><div class="kpi-l">Расходы</div><div class="kpi-v neg">${money(t.expense)}</div></div>
    <div class="kpi"><div class="kpi-l">Профицит</div><div class="kpi-v ${t.profit < 0 ? 'neg' : 'pos'}">${money(t.profit)}</div></div>`;

  const cats = byCategory(key, 'expense').slice(0, 5);
  const max = cats[0]?.sum || 1;
  $('#monthBars').innerHTML = cats.length
    ? cats
        .map((c) => {
          const m = catMeta('expense', c.name);
          return `<div class="bar-row">
            <div class="bar-name"><span>${m.icon}</span><span>${esc(c.name)}</span></div>
            <div class="bar-val">${money(c.sum)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${(c.sum / max) * 100}%;background:${m.color}"></div></div>
          </div>`;
        })
        .join('')
    : '<div class="empty">В этом месяце ещё нет расходов</div>';

  renderHomeGoals();

  const recent = Store.state.transactions
    .slice()
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1))
    .slice(0, 6);
  $('#recentList').innerHTML = recent.length ? recent.map(txRow).join('') : '<div class="empty">Пока нет операций. Нажмите «+»</div>';
}

function txRow(t) {
  const acc = accountById(t.accountId);
  if (t.type === 'transfer') {
    const to = accountById(t.toAccountId);
    return `<button class="tx" data-tx="${t.id}">
      <div class="ic" style="background:#7a869a22">🔄</div>
      <div><div class="tx-t">Перевод</div><div class="tx-s">${esc(acc?.name || '—')} → ${esc(to?.name || '—')}${t.note ? ' 💬' : ''}</div></div>
      <div class="tx-a">${money(t.amount)}</div></button>`;
  }
  const m = catMeta(t.type, t.category);
  // Сумма со знаком: расход уменьшает счёт, доход увеличивает.
  // Отрицательная сумма расхода — это возврат, поэтому знак считаем, а не подставляем.
  const signed = t.type === 'income' ? t.amount : -t.amount;
  // Комментарий в списке не показываем — только значок 💬. Текст виден в карточке операции.
  return `<button class="tx" data-tx="${t.id}">
    <div class="ic" style="background:${m.color}22">${m.icon}</div>
    <div><div class="tx-t">${esc(t.category || 'Без категории')}</div>
      <div class="tx-s">${[t.subcategory, acc?.name].filter(Boolean).map(esc).join(' · ')}${t.note ? ' 💬' : ''}</div></div>
    <div class="tx-a ${signed > 0 ? 'pos' : ''}">${signed > 0 ? '+' : ''}${money(signed)}</div>
  </button>`;
}

function renderOps() {
  const d = parseKey(ui.opsMonth);
  $('#opsMonthName').textContent = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const t = monthTotals(ui.opsMonth);
  $('#opsSummary').textContent = `Доходы ${money(t.income)} · Расходы ${money(t.expense)} · Профицит ${money(t.profit)}`;

  const q = ui.search.trim().toLowerCase();
  let list = txOfMonth(ui.opsMonth);
  if (q) list = list.filter((t) => [t.category, t.subcategory, t.note].filter(Boolean).join(' ').toLowerCase().includes(q));

  if (!list.length) {
    $('#opsList').innerHTML = '<div class="card"><div class="empty">Операций нет</div></div><div class="pad"></div>';
    return;
  }
  const groups = new Map();
  for (const t of list) (groups.get(t.date) || groups.set(t.date, []).get(t.date)).push(t);

  $('#opsList').innerHTML =
    [...groups.entries()]
      .map(([date, items]) => {
        const dt = new Date(date + 'T00:00:00');
        const daySum = items.reduce((s, t) => s + (t.type === 'expense' ? -t.amount : t.type === 'income' ? t.amount : 0), 0);
        return `<div class="day-head"><span>${dt.getDate()} ${MONTHS[dt.getMonth()].toLowerCase()}, ${DAYS[dt.getDay()]}</span><span>${money(daySum)}</span></div>
        <div class="tx-group">${items.map(txRow).join('')}</div>`;
      })
      .join('') + '<div class="pad"></div>';
}

function renderReport() {
  const d = parseKey(ui.repMonth);
  $('#repMonthName').textContent = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  $$('#repSeg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.kind === ui.repKind));

  const cats = byCategory(ui.repMonth, ui.repKind);
  const total = cats.reduce((s, c) => s + c.sum, 0);
  $('#donutSum').textContent = money(total);
  $('#donutCap').textContent = ui.repKind === 'expense' ? 'расходы за месяц' : 'доходы за месяц';

  // Кольцо строим только по положительным суммам: отрицательная категория —
  // это возврат (например, снятие со сберегательного счёта), сегмента у неё нет.
  const ringTotal = cats.reduce((s, c) => s + Math.max(0, c.sum), 0);

  const R = 78, C = 2 * Math.PI * R;
  let offset = 0;
  const segs = cats.filter((c) => c.sum > 0).map((c) => {
    const m = catMeta(ui.repKind, c.name);
    const len = ringTotal ? (c.sum / ringTotal) * C : 0;
    const el = `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${m.color}" stroke-width="22"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)"></circle>`;
    offset += len;
    return el;
  });
  $('#donut').innerHTML =
    `<circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--card-2)" stroke-width="22"></circle>` + segs.join('');

  const budgets = Store.state.budgets[ui.repMonth] || {};
  $('#repList').innerHTML = cats.length
    ? cats
        .map((c) => {
          const m = catMeta(ui.repKind, c.name);
          const pct = ringTotal ? (Math.max(0, c.sum) / ringTotal) * 100 : 0;
          const lim = ui.repKind === 'expense' ? budgets[c.name] : 0;
          const over = lim && c.sum > lim;
          const sub = c.sum < 0 ? 'возврат на счёт' : `${pct.toFixed(1)}%${lim ? ` · лимит ${money(lim)}${over ? ' — превышен' : ''}` : ''}`;
          return `<button class="cat-row" data-cat="${esc(c.name)}">
            <div class="ic" style="background:${m.color}22">${m.icon}</div>
            <div style="min-width:0">
              <div class="tx-t">${esc(c.name)}</div>
              <div class="cat-sub">${sub}</div>
              <div class="mini-track"><div class="mini-fill" style="width:${Math.min(100, lim ? (c.sum / lim) * 100 : pct)}%;background:${over ? 'var(--red)' : m.color}"></div></div>
            </div>
            <div class="tx-a">${money(c.sum)}</div>
          </button>`;
        })
        .join('')
    : '<div class="empty">Нет данных за месяц</div>';

  // Год по месяцам
  const year = d.getFullYear();
  const rows = MONTHS_SHORT.map((_, i) => monthTotals(`${year}-${String(i + 1).padStart(2, '0')}`));
  const peak = Math.max(1, ...rows.map((r) => Math.max(r.income, r.expense)));
  $('#yearChart').innerHTML = rows
    .map(
      (r, i) => `<div class="yc" title="${MONTHS[i]}: +${money(r.income)} / −${money(r.expense)}">
      <div class="yc-bars">
        <div class="yc-bar" style="height:${(r.income / peak) * 100}%;background:var(--green)"></div>
        <div class="yc-bar" style="height:${(r.expense / peak) * 100}%;background:var(--red)"></div>
      </div><div class="yc-l">${MONTHS_SHORT[i]}</div></div>`
    )
    .join('');
}

function renderMore() {
  $('#accountsList').innerHTML = Store.state.accounts
    .map(
      (a) => `<button class="row" data-editacc="${a.id}">
      <span class="row-ic">${a.icon}</span>
      <span>${esc(a.name)}${a.archived ? ' (в архиве)' : ''}${a.savings ? '<span class="row-sub">сбережения — вне общего счёта</span>' : ''}</span>
      <span class="row-val">${money(balanceOf(a.id))}</span></button>`
    )
    .join('');
  $$('#themeSeg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.theme === Store.state.settings.theme));
  // В опубликованной версии встроенной истории нет — незачем показывать кнопку.
  $('#loadHistory').hidden = !Object.keys(typeof HISTORY === 'object' ? HISTORY : {}).length;
  renderBackupRow();
  $('#appVersion').textContent = `версия ${APP_VERSION}`;

  const pending = Plans.pending();
  $('#recBadge').textContent = pending.length ? `${pending.length} не отмечено` : '';
  const f = Plans.fund();
  $('#fundBadge').textContent = f ? `${money(f.perMonth)}/мес` : '';
}

function renderBudgets() {
  const key = ui.repMonth;
  const d = parseKey(key);
  $('#budMonthName').textContent = `${MONTHS[d.getMonth()].toLowerCase()} ${d.getFullYear()}`;
  const budgets = Store.state.budgets[key] || {};
  const fact = Object.fromEntries(byCategory(key, 'expense').map((c) => [c.name, c.sum]));
  $('#budgetList').innerHTML = EXPENSE_CATEGORIES.map(
    (c) => `<div class="bud-row">
      <span class="row-ic">${c.icon}</span>
      <span><div class="bud-name">${esc(c.name)}</div><div class="bud-fact">потрачено ${money(fact[c.name] || 0)}</div></span>
      <input type="number" inputmode="numeric" placeholder="—" value="${budgets[c.name] || ''}" data-bud="${esc(c.name)}">
    </div>`
  ).join('');
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function applyTheme() {
  const t = Store.state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 2200);
}

/* ---------- Ввод операции ---------- */
function openEntry(existing) {
  ui.draft = existing
    ? { ...existing, raw: String(existing.amount) }
    : {
        id: null,
        type: 'expense',
        raw: '0',
        accountId: Store.state.settings.lastAccountId || accounts()[0]?.id,
        toAccountId: accounts()[1]?.id,
        category: '',
        subcategory: '',
        date: todayISO(),
        note: '',
      };
  $('#noteInput').value = ui.draft.note || '';
  $('#entrySheet').hidden = false;
  renderEntry();
}

function renderEntry() {
  const d = ui.draft;
  $$('#typeSeg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === d.type));
  $('#amountDisplay').textContent = (d.raw || '0').replace('.', ',');

  const acc = accountById(d.accountId);
  if (d.type === 'transfer') {
    const to = accountById(d.toAccountId);
    $('#pickAccount').textContent = `${acc?.icon || ''} ${acc?.name || '—'} → ${to?.icon || ''} ${to?.name || '—'}`;
    $('#pickCategory').hidden = true;
  } else {
    $('#pickAccount').textContent = `${acc?.icon || ''} ${acc?.name || 'Счёт'}`;
    $('#pickCategory').hidden = false;
    $('#pickCategory').textContent = d.category
      ? `${catMeta(d.type, d.category).icon} ${d.category}${d.subcategory ? ' · ' + d.subcategory : ''}`
      : 'Категория';
  }
  $('#pickDate').textContent = d.date === todayISO() ? 'Сегодня' : formatDate(d.date);
}

const formatDate = (iso) => {
  const dt = new Date(iso + 'T00:00:00');
  return `${dt.getDate()} ${MONTHS_SHORT[dt.getMonth()].toLowerCase()} ${dt.getFullYear()}`;
};

function keypad(k) {
  const d = ui.draft;
  let raw = d.raw || '0';
  if (k === 'del') raw = raw.length > 1 ? raw.slice(0, -1) : '0';
  else if (k === '.') { if (!raw.includes('.')) raw += '.'; }
  else {
    if (raw === '0') raw = k;
    else if (raw.includes('.') && raw.split('.')[1].length >= 2) return;
    else raw += k;
  }
  d.raw = raw;
  renderEntry();
}

function saveEntry() {
  const d = ui.draft;
  const amount = Math.round(parseFloat(d.raw || '0') * 100) / 100;
  if (!amount || amount <= 0) return toast('Введите сумму');
  if (!d.accountId) return toast('Выберите счёт');
  if (d.type === 'transfer') {
    if (!d.toAccountId || d.toAccountId === d.accountId) return toast('Выберите разные счета');
  } else if (!d.category) return toast('Выберите категорию');

  const tx = {
    id: d.id || uid('tx'),
    type: d.type,
    amount,
    accountId: d.accountId,
    toAccountId: d.type === 'transfer' ? d.toAccountId : null,
    category: d.type === 'transfer' ? '' : d.category,
    subcategory: d.type === 'transfer' ? '' : d.subcategory || '',
    date: d.date,
    note: $('#noteInput').value.trim(),
    createdAt: d.createdAt || Date.now(),
  };
  const i = Store.state.transactions.findIndex((t) => t.id === tx.id);
  if (i >= 0) Store.state.transactions[i] = tx;
  else Store.state.transactions.push(tx);
  Store.state.settings.lastAccountId = tx.accountId;
  Store.save();
  $('#entrySheet').hidden = true;
  toast(i >= 0 ? 'Операция обновлена' : 'Операция добавлена');
  render();
}

/* ---------- Подтверждение разбора ----------
   Ничего распознанного не сохраняется молча: приложение сначала показывает,
   как оно поняло операцию, и ждёт «Да, всё верно». */
function openConfirm(state) {
  ui.confirm = state;
  $('#confirmTitle').textContent = state.title || 'Правильно понял?';
  renderConfirm();
  $('#confirmSheet').hidden = false;
}

function renderConfirm() {
  const c = ui.confirm;
  if (!c) return;
  let html = '';

  if (c.kind === 'single') {
    const d = c.draft;
    const acc = accountById(d.accountId);
    const typeName = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' }[d.type];
    html += `<div class="conf-amount">${d.type === 'income' ? '+' : '−'}${money(d.amount)}</div>`;
    if (c.source) html += `<div class="conf-src">${esc(c.source)}</div>`;
    html += `<button class="g-row conf-row" data-fix="type"><span>Тип</span><b>${typeName}</b></button>`;
    if (d.type !== 'transfer')
      html += `<button class="g-row conf-row" data-fix="category"><span>Категория</span><b>${esc(d.category || 'не выбрана')}${d.subcategory ? ' · ' + esc(d.subcategory) : ''}</b></button>`;
    html += `<button class="g-row conf-row" data-fix="account"><span>Счёт</span><b>${esc(acc ? acc.icon + ' ' + acc.name : 'не выбран')}</b></button>`;
    html += `<button class="g-row conf-row" data-fix="date"><span>Дата</span><b>${d.date === todayISO() ? 'сегодня' : formatDate(d.date)}</b></button>`;
    html += `<button class="g-row conf-row" data-fix="note"><span>Комментарий</span><b class="wrap">${esc(d.note || 'добавить')}</b>
      <span class="sub">В списке операций не показывается, но находится поиском.</span></button>`;
  }

  if (c.kind === 'receipt') {
    const r = c.receipt;
    html += `<div class="conf-amount">−${money(r.total)}</div>`;
    html += `<div class="conf-src">${esc([r.shop, r.date === todayISO() ? 'сегодня' : formatDate(r.date), c.source].filter(Boolean).join(' · '))}</div>`;

    if (r.items.length) {
      html += `<div class="seg wide" id="splitSeg">
        <button class="seg-btn ${c.split ? 'active' : ''}" data-split="1">Разнести по категориям</button>
        <button class="seg-btn ${c.split ? '' : 'active'}" data-split="0">Одной операцией</button>
      </div>`;
    }

    if (c.split && r.items.length) {
      const groups = groupReceipt(r.items);
      const sum = groups.reduce((s, g) => s + g.sum, 0);
      html += `<div class="g-sec">Получится ${groups.length} ${plural(groups.length, 'операция', 'операции', 'операций')}</div>`;
      html += groups
        .map((g) => `<div class="g-row"><span>${catMeta('expense', g.cat).icon} ${esc(g.sub || g.cat)}</span><b>${money(g.sum)}</b>
          <span class="sub">${esc(g.cat)} · ${g.count} ${plural(g.count, 'позиция', 'позиции', 'позиций')}</span></div>`)
        .join('');
      const diff = Math.round((r.total - sum) * 100) / 100;
      if (Math.abs(diff) > 0.5)
        html += `<div class="g-row"><span class="sub">⚠️ Сумма позиций ${money(sum)}, а в итоге чека ${money(r.total)}.
          Разницу ${money(Math.abs(diff))} ${diff > 0 ? 'допишу' : 'вычту из'} самой крупной категории — обычно это скидка или неразобранная строка.</span></div>`;
    } else {
      const cat = c.singleCat || (r.items.length ? groupReceipt(r.items)[0] : { cat: 'Жизнедеятельность', sub: 'Продукты' });
      html += `<button class="g-row conf-row" data-fix="rcat"><span>Категория</span><b>${esc(cat.sub || cat.cat)}</b><span class="sub">${esc(cat.cat)}</span></button>`;
    }

    html += `<button class="g-row conf-row" data-fix="raccount"><span>Счёт</span><b>${esc(accountById(c.accountId)?.name || 'не выбран')}</b></button>`;
    html += `<button class="g-row conf-row" data-fix="rdate"><span>Дата</span><b>${r.date === todayISO() ? 'сегодня' : formatDate(r.date)}</b></button>`;
    html += `<button class="g-row conf-row" data-fix="rnote"><span>Комментарий</span><b class="wrap">${esc(c.note || 'добавить')}</b>
      <span class="sub">Ляжет на все операции этого чека. В списке не виден, но находится поиском.</span></button>`;

    if (r.items.length) {
      html += `<div class="g-sec">Позиции чека</div>`;
      html += r.items
        .map((i, idx) => `<button class="g-row conf-row" data-item="${idx}"><span>${esc(i.name)}</span><b>${money(i.sum)}</b>
          <span class="sub">${esc(i.cat)} · ${esc(i.sub || '')} — нажмите, чтобы поменять</span></button>`)
        .join('');
    }
  }

  $('#confirmBody').innerHTML = html;
}

const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};

function confirmSave() {
  const c = ui.confirm;
  if (!c) return;

  if (c.kind === 'single') {
    const d = c.draft;
    Store.state.transactions.push({
      id: uid('tx'), type: d.type, amount: d.amount, accountId: d.accountId,
      toAccountId: d.type === 'transfer' ? d.toAccountId : null,
      category: d.type === 'transfer' ? '' : d.category, subcategory: d.type === 'transfer' ? '' : d.subcategory,
      date: d.date, note: d.note, createdAt: Date.now(),
    });
    Store.state.settings.lastAccountId = d.accountId;
    // Недостающая операция внесена — расхождение закрыто.
    if (c.reconFor) {
      const acc = accountById(c.reconFor);
      if (acc && acc.fact) acc.fact.diff = 0;
    }
    Store.save();
    toast(c.reconFor ? 'Записал, кошелёк сошёлся' : 'Записал');
  }

  if (c.kind === 'receipt') {
    const r = c.receipt;
    const note = [c.note, r.shop, 'чек'].filter(Boolean).join(', ');
    if (c.split && r.items.length) {
      const groups = groupReceipt(r.items);
      const diff = Math.round((r.total - groups.reduce((s, g) => s + g.sum, 0)) * 100) / 100;
      if (Math.abs(diff) > 0.5 && groups.length) groups[0].sum = Math.round((groups[0].sum + diff) * 100) / 100;
      groups.forEach((g, i) => {
        if (g.sum <= 0) return;
        Store.state.transactions.push({
          id: uid('tx'), type: 'expense', amount: g.sum, accountId: c.accountId, toAccountId: null,
          category: g.cat, subcategory: g.sub, date: r.date, note, createdAt: Date.now() + i,
        });
      });
      toast(`Записал ${groups.length} ${plural(groups.length, 'операцию', 'операции', 'операций')}`);
    } else {
      const cat = c.singleCat || (r.items.length ? groupReceipt(r.items)[0] : { cat: 'Жизнедеятельность', sub: 'Продукты' });
      Store.state.transactions.push({
        id: uid('tx'), type: 'expense', amount: r.total, accountId: c.accountId, toAccountId: null,
        category: cat.cat, subcategory: cat.sub, date: r.date, note, createdAt: Date.now(),
      });
      toast('Записал чек');
    }
    Store.state.settings.lastAccountId = c.accountId;
    Store.save();
  }

  $('#confirmSheet').hidden = true;
  ui.confirm = null;
  render();
}

/* Правки прямо из окна подтверждения. */
function confirmFix(what) {
  const c = ui.confirm;
  const d = c.draft;

  if (what === 'type') {
    openPicker('Тип операции', [
      { label: 'Расход', icon: '➖', t: 'expense' },
      { label: 'Доход', icon: '➕', t: 'income' },
    ], (it) => { d.type = it.t; d.category = ''; d.subcategory = ''; renderConfirm(); });
  } else if (what === 'category') {
    const list = catList(d.type).map((x) => ({ label: x.name, icon: x.icon, color: x.color, selected: x.name === d.category, cat: x }));
    openPicker('Категория', list, (it) => {
      d.category = it.cat.name; d.subcategory = '';
      if (it.cat.subs.length) {
        const subs = [{ label: 'Без подкатегории', icon: it.cat.icon, sub: '' }].concat(it.cat.subs.map((s) => ({ label: s, icon: it.cat.icon, sub: s })));
        setTimeout(() => openPicker(it.cat.name, subs, (s) => { d.subcategory = s.sub; renderConfirm(); }), 60);
      }
      renderConfirm();
    });
  } else if (what === 'account' || what === 'raccount') {
    const list = accounts().map((a) => ({ label: a.name, icon: a.icon, note: money(balanceOf(a.id)), id: a.id }));
    openPicker('Счёт', list, (it) => {
      if (what === 'account') d.accountId = it.id; else c.accountId = it.id;
      renderConfirm();
    });
  } else if (what === 'date' || what === 'rdate') {
    const target = what === 'date' ? d : c.receipt;
    const items = [];
    for (let i = 0; i < 10; i++) {
      const dt = new Date();
      dt.setDate(dt.getDate() - i);
      const iso = localISO(dt);
      items.push({ label: i === 0 ? 'Сегодня' : i === 1 ? 'Вчера' : formatDate(iso), icon: '📅', selected: iso === target.date, iso });
    }
    openPicker('Дата', items, (it) => { target.date = it.iso; renderConfirm(); });
  } else if (what === 'note') {
    const v = prompt('Комментарий к операции', d.note || '');
    if (v !== null) { d.note = v.trim(); renderConfirm(); }
  } else if (what === 'rnote') {
    const v = prompt('Комментарий к чеку', c.note || '');
    if (v !== null) { c.note = v.trim(); renderConfirm(); }
  } else if (what === 'rcat') {
    const list = EXPENSE_CATEGORIES.map((x) => ({ label: x.name, icon: x.icon, color: x.color, cat: x }));
    openPicker('Категория чека', list, (it) => {
      c.singleCat = { cat: it.cat.name, sub: '' };
      if (it.cat.subs.length) {
        const subs = it.cat.subs.map((s) => ({ label: s, icon: it.cat.icon, sub: s }));
        setTimeout(() => openPicker(it.cat.name, subs, (s) => { c.singleCat.sub = s.sub; renderConfirm(); }), 60);
      }
      renderConfirm();
    });
  }
}

/* Смена категории у одной позиции чека. */
function fixReceiptItem(idx) {
  const c = ui.confirm;
  const item = c.receipt.items[idx];
  const list = EXPENSE_CATEGORIES.map((x) => ({ label: x.name, icon: x.icon, color: x.color, selected: x.name === item.cat, cat: x }));
  openPicker(item.name, list, (it) => {
    item.cat = it.cat.name;
    item.sub = '';
    if (it.cat.subs.length) {
      const subs = [{ label: 'Без подкатегории', icon: it.cat.icon, sub: '' }].concat(it.cat.subs.map((s) => ({ label: s, icon: it.cat.icon, sub: s })));
      setTimeout(() => openPicker(it.cat.name, subs, (s) => { item.sub = s.sub; renderConfirm(); }), 60);
    }
    renderConfirm();
  });
}

/* ---------- Быстрый ввод: текст и голос ---------- */
function quickAdd(text, inputEl) {
  const parsed = parsePhrase(text, accounts());
  if (!parsed) {
    toast('Не нашёл сумму. Например: «кофе 250»');
    return false;
  }
  if (inputEl) { inputEl.value = ''; inputEl.blur(); }
  $('#entrySheet').hidden = true;

  openConfirm({
    kind: 'single',
    source: `Из фразы: «${text}»`,
    draft: {
      type: parsed.type,
      amount: parsed.amount,
      category: parsed.category,
      subcategory: parsed.subcategory,
      date: parsed.date,
      note: parsed.note,
      accountId: parsed.accountId || Store.state.settings.lastAccountId || accounts()[0]?.id,
      toAccountId: accounts()[1]?.id,
    },
  });
  return true;
}

/* ---------- Чеки ---------- */
function openReceiptMenu() {
  openPicker('Чек', [
    { label: 'Навести камеру на QR', icon: '🎯', note: 'самый надёжный способ', act: 'live' },
    { label: 'Выбрать фото из галереи', icon: '🖼️', note: 'если чек уже сфотографирован', act: 'gallery' },
    { label: 'Сфотографировать чек', icon: '📷', note: 'снимок, потом разбор', act: 'camera' },
    { label: 'Ввести код из QR', icon: '⌨️', note: 'если камера не помогла', act: 'code' },
    { label: 'Вставить текст чека', icon: '📋', note: 'разнесу по категориям построчно', act: 'text' },
  ], (it) => {
    if (it.act === 'live') startLiveScan();
    else if (it.act === 'camera') $('#receiptCamera').click();
    else if (it.act === 'gallery') $('#receiptGallery').click();
    else if (it.act === 'code') pasteQrCode();
    else pasteReceiptText();
  });
}

/* Сканирование живой камерой. */
function startLiveScan() {
  const video = $('#scanVideo');
  $('#scanOverlay').hidden = false;
  LiveScan.start(
    video,
    (raw) => {
      $('#scanOverlay').hidden = true;
      handleQrPayload(raw);
    },
    (why) => {
      $('#scanOverlay').hidden = true;
      alert(why + '\n\nМожно ввести код из QR вручную или вставить текст чека.');
    }
  );
}

/* Ручной ввод содержимого QR: айфон умеет читать его штатной «Камерой»,
   оттуда строку можно скопировать. */
function pasteQrCode() {
  const v = prompt('Вставьте строку из QR-кода чека.\nОна выглядит так:\nt=20260814T1932&s=1876.43&fn=…&i=…&fp=…');
  if (!v) return;
  handleQrPayload(v.trim());
}

function handleQrPayload(raw) {
  const parsed = parseReceiptQR(raw);
  if (!parsed) {
    return alert(`Это не похоже на код кассового чека.\n\nПрочитано:\n${String(raw).slice(0, 160)}`);
  }
  openConfirm({
    kind: 'receipt',
    receipt: { shop: '', date: parsed.date, total: parsed.sum, items: [], grocery: false },
    split: false,
    source: `QR-код чека${parsed.time ? ', ' + parsed.time : ''}`,
    accountId: Store.state.settings.lastAccountId || accounts()[0]?.id,
    title: 'Правильно понял?',
  });
}

function pasteReceiptText() {
  const text = prompt('Вставьте текст чека.\nНа айфоне: откройте фото чека → выделите текст пальцем → «Скопировать», затем вставьте сюда.');
  if (!text) return;
  const r = parseReceiptText(text);
  if (!r) return toast('Не разобрал чек. Нужны строки с названиями и ценами.');
  openConfirm({
    kind: 'receipt', receipt: r, split: r.items.length > 0, source: 'текст чека',
    accountId: Store.state.settings.lastAccountId || accounts()[0]?.id,
    title: 'Правильно разнёс?',
  });
}

async function handleReceiptImage(file) {
  if (!file) return;
  toast('Читаю чек…');
  let res;
  try {
    res = await scanReceiptImage(file);
  } catch (e) {
    return toast('Не смог открыть фото: ' + e.message);
  }

  if (res.ok) return handleQrPayload(res.raw);

  const why = {
    'foreign-qr': 'На фото есть QR, но это не кассовый чек.',
    unreadable: 'Не удалось открыть это фото.',
    blank: 'Снимок слишком большой — телефон не смог его обработать. Попробуйте снять QR крупным планом.',
    'no-qr': 'QR-код на фото не нашёлся. Снимите его крупнее, ровно и без бликов.',
  }[res.reason] || 'Не получилось прочитать QR.';

  openPicker(why, [
    { label: 'Ввести сумму вручную', icon: '✏️', note: 'быстрее всего', act: 'manual' },
    { label: 'Вставить текст чека', icon: '📋', note: 'разнесу по категориям', act: 'text' },
    { label: 'Показать, что не получилось', icon: '🔎', note: 'подробности для разбора', act: 'why' },
  ], (it) => {
    if (it.act === 'text') pasteReceiptText();
    else if (it.act === 'why') alert(res.report || why);
    else openEntry(null);
  });
}

function wireQuick(inputId, micId, goId) {
  const input = $('#' + inputId);
  const submit = () => { if (input.value.trim()) quickAdd(input.value, input); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  if (goId) $('#' + goId).onclick = submit;
  $('#' + micId).onclick = () => {
    if (Voice.active) return Voice.stop(input);
    Voice.start(input, (text) => quickAdd(text, input));
  };
}
wireQuick('quickHome', 'micHome', 'quickHomeGo');
wireQuick('quickSheet', 'micSheet', null);

/* ---------- Импорт: тип файла определяется по содержимому ----------
   Так неважно, какую кнопку нажали и что подставил файловый выбор на телефоне. */
function importAnyFile(file) {
  const r = new FileReader();
  r.onerror = () => alert(`Не удалось прочитать файл «${file.name}». Попробуйте сначала сохранить его в «Файлы» на телефоне, а потом выбрать оттуда.`);
  r.onload = () => {
    const text = String(r.result || '').replace(/^﻿/, '').trim();
    const info = `Файл: ${file.name}\nРазмер: ${Math.round(file.size / 1024)} КБ`;

    if (!text) return alert(`Файл пустой.\n\n${info}`);

    // Резервная копия или список операций
    if (text[0] === '{' || text[0] === '[') {
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return alert(`Файл начинается как JSON, но разобрать его не вышло.\n\n${info}\nОшибка: ${e.message}\nНачало файла: ${text.slice(0, 80)}`);
      }
      const state = Array.isArray(data) ? { transactions: data } : (data.state && data.state.transactions ? data.state : data);
      if (!Array.isArray(state.transactions)) {
        return alert(`В файле нет списка операций — похоже, это не копия Кошелька.\n\n${info}\nПоля в файле: ${Object.keys(data).slice(0, 10).join(', ') || 'нет'}`);
      }
      if (!confirm(`Заменить текущие данные содержимым копии?\n\nВ файле ${state.transactions.length} операций.`)) return;
      Store.replaceAll(state);
      render();
      return toast(`Восстановлено ${state.transactions.length} операций`);
    }

    // Таблица: планировщик или простой список операций
    let rows;
    try {
      rows = parseCsv(text);
    } catch (e) {
      return alert(`Не смог разобрать таблицу.\n\n${info}\nОшибка: ${e.message}`);
    }
    if (rows.some((row) => isMonthHeader(row))) return importPlannerText(file.name, text);
    if (rows.length < 2) return alert(`В файле нет строк с данными.\n\n${info}\nНачало файла: ${text.slice(0, 80)}`);
    importCsv(text);
  };
  r.readAsText(file, 'utf-8');
}

/* ---------- Импорт файла «Планировщик бюджета» ---------- */
function importPlannerText(fileName, text) {
  {
    let parsed;
    const guess = (fileName.match(/20\d{2}/) || [])[0] || String(new Date().getFullYear());
    const year = prompt(`За какой год этот файл?\nФайл: ${fileName}`, guess);
    if (!year || !/^20\d{2}$/.test(year.trim())) return toast('Нужен год в формате 2026');

    try {
      parsed = parsePlannerCsv(text, year.trim());
    } catch (e) {
      return toast('Не смог разобрать файл: ' + e.message);
    }
    if (!parsed.rows.length) return toast('В файле не нашлось блоков с месяцами');

    let accId = Store.state.accounts.find((a) => a.name === 'Бюджет (таблица)')?.id;
    if (!accId) {
      accId = uid('acc');
      // «Стартовый баланс расходов» из шапки листа планировщика.
      Store.state.accounts.unshift({ id: accId, name: 'Бюджет (таблица)', icon: '📊', color: '#8a8fd6', initial: 42000, archived: false });
    }

    // Убираем то, что уже загружалось за этот год, чтобы не плодить дубли.
    const before = Store.state.transactions.length;
    Store.state.transactions = Store.state.transactions.filter(
      (t) => !(t.date.slice(0, 4) === parsed.year && (t.src === 'planner' || /Перенос из таблицы|Строки «Отпуск»/.test(t.note || '')))
    );
    const removed = before - Store.state.transactions.length;

    const txs = plannerToTransactions(parsed, accId);
    Store.state.transactions.push(...txs);
    Store.save();

    const check = plannerCheck(parsed);
    ui.opsMonth = ui.repMonth = `${parsed.year}-01`;
    render();

    const cats = new Set(parsed.rows.map((x) => x.category)).size;
    toast(`Перенесено ${txs.length} операций за ${parsed.year}`);
    setTimeout(() => alert(
      `Файл разобран.\n\n` +
      `Год: ${parsed.year}\n` +
      `Строк со статьями: ${parsed.rows.length}\n` +
      `Категорий: ${cats}\n` +
      `Создано операций: ${txs.length}${removed ? `\nЗаменено ранее загруженных: ${removed}` : ''}\n\n` +
      `Доходы за год: ${money(check.incomeTotal)}\n` +
      `Расходы за год: ${money(check.expenseTotal)}\n\n` +
      `Сверьте эти суммы со строками «Итого» в таблице.`
    ), 300);
  }
}

/* ---------- Перенос истории из таблицы ---------- */
function loadHistoryFromSheet() {
  const already = Store.state.transactions.some((t) => t.note && t.note.includes('таблиц'));
  if (already && !confirm('История уже загружалась. Загрузить ещё раз (появятся дубли)?')) return;

  let accId = Store.state.accounts.find((a) => a.name === 'Бюджет (таблица)')?.id;
  if (!accId) {
    accId = uid('acc');
    // Первым в списке, иначе счёт со всей историей прячется за пустыми.
    // «Стартовый баланс расходов» из шапки листа планировщика.
    Store.state.accounts.unshift({ id: accId, name: 'Бюджет (таблица)', icon: '📊', color: '#8a8fd6', initial: 42000, archived: false });
  }
  const { transactions, report } = buildHistory(accId);
  Store.state.transactions.push(...transactions);
  Store.save();
  ui.opsMonth = ui.repMonth = '2026-08';
  render();

  const bad = report.filter((r) => Math.abs(r.incomeDiff) > 1);
  console.log('Перенос: операций', transactions.length, 'месяцев с расхождением по доходам:', bad);
  toast(`Перенесено ${transactions.length} операций за 2026`);
}

/* ---------- Универсальный выбор ---------- */
function openPicker(title, items, onPick) {
  $('#pickerTitle').textContent = title;
  $('#pickerBody').innerHTML = items
    .map(
      (it, i) => `<button class="pick ${it.selected ? 'sel' : ''}" data-i="${i}">
      <div class="ic" style="background:${it.color || '#9aa0a6'}22">${it.icon || '•'}</div>
      <div><div>${esc(it.label)}</div>${it.note ? `<div class="pick-note">${esc(it.note)}</div>` : ''}</div>
      <div>${it.selected ? '✓' : ''}</div></button>`
    )
    .join('');
  $('#pickerSheet').hidden = false;
  $('#pickerBody').onclick = (e) => {
    const b = e.target.closest('.pick');
    if (!b) return;
    $('#pickerSheet').hidden = true;
    onPick(items[+b.dataset.i]);
  };
}

function pickCategory() {
  const d = ui.draft;
  const list = catList(d.type).map((c) => ({ label: c.name, icon: c.icon, color: c.color, selected: c.name === d.category, cat: c }));
  openPicker('Категория', list, (it) => {
    d.category = it.cat.name;
    d.subcategory = '';
    if (it.cat.subs.length) {
      const subs = [{ label: 'Без подкатегории', icon: it.cat.icon, color: it.cat.color, sub: '' }].concat(
        it.cat.subs.map((s) => ({ label: s, icon: it.cat.icon, color: it.cat.color, sub: s }))
      );
      setTimeout(() => openPicker(it.cat.name, subs, (s) => { d.subcategory = s.sub; renderEntry(); }), 60);
    }
    renderEntry();
  });
}

function pickAccount() {
  const d = ui.draft;
  const mk = (sel) => accounts().map((a) => ({ label: a.name, icon: a.icon, color: a.color, note: money(balanceOf(a.id)), selected: a.id === sel, id: a.id }));
  if (d.type !== 'transfer') {
    openPicker('Счёт', mk(d.accountId), (it) => { d.accountId = it.id; renderEntry(); });
    return;
  }
  openPicker('Откуда', mk(d.accountId), (it) => {
    d.accountId = it.id;
    setTimeout(() => openPicker('Куда', mk(d.toAccountId).filter((x) => x.id !== d.accountId), (t) => { d.toAccountId = t.id; renderEntry(); }), 60);
    renderEntry();
  });
}

function pickDate() {
  const d = ui.draft;
  const items = [];
  for (let i = 0; i < 14; i++) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    const iso = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    items.push({ label: i === 0 ? 'Сегодня' : i === 1 ? 'Вчера' : formatDate(iso), icon: '📅', selected: iso === d.date, iso });
  }
  items.push({ label: 'Другая дата…', icon: '🗓️', iso: 'custom' });
  openPicker('Дата', items, (it) => {
    if (it.iso === 'custom') {
      const v = prompt('Дата в формате ГГГГ-ММ-ДД', d.date);
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) d.date = v;
    } else d.date = it.iso;
    renderEntry();
  });
}

/* ---------- Счета ---------- */
function editAccount(id) {
  const a = accountById(id);
  const items = [
    { label: 'Переименовать', icon: '✏️', act: 'rename' },
    { label: 'Сверить остаток', icon: '🧮', act: 'reconcile', note: `по учёту сейчас ${money(balanceOf(a.id))}` },
    { label: 'Изменить начальный остаток', icon: '💰', act: 'initial', note: money(a.initial || 0) },
    { label: a.savings ? 'Сделать обычным счётом' : 'Сделать сберегательным', icon: '🐖', act: 'savings',
      note: a.savings ? 'сейчас не входит в общий счёт' : 'сейчас входит в общий счёт' },
    { label: a.archived ? 'Вернуть из архива' : 'В архив', icon: '📥', act: 'archive' },
    { label: 'Удалить счёт', icon: '🗑️', act: 'delete' },
  ];
  openPicker(`${a.icon} ${a.name}`, items, (it) => {
    if (it.act === 'rename') {
      const v = prompt('Название счёта', a.name);
      if (v) a.name = v.trim();
    } else if (it.act === 'initial') {
      const v = prompt('Начальный остаток, ₽', String(a.initial || 0));
      if (v !== null && !isNaN(parseFloat(v))) a.initial = parseFloat(v.replace(',', '.'));
    } else if (it.act === 'reconcile') {
      reconcileAccount(a);
      return;
    } else if (it.act === 'savings') {
      a.savings = !a.savings;
      toast(a.savings ? `«${a.name}» больше не входит в общий счёт` : `«${a.name}» снова в общем счёте`);
    } else if (it.act === 'archive') {
      a.archived = !a.archived;
    } else if (it.act === 'delete') {
      const used = Store.state.transactions.some((t) => t.accountId === id || t.toAccountId === id);
      if (used) return alert('По этому счёту есть операции. Сначала удалите их или отправьте счёт в архив.');
      if (!confirm(`Удалить счёт «${a.name}»?`)) return;
      Store.state.accounts = Store.state.accounts.filter((x) => x.id !== id);
    }
    Store.save();
    render();
  });
}

/* Сверка: спрашиваем, сколько денег в кошельке на самом деле. */
function reconcileAccount(a) {
  const calc = balanceOf(a.id);
  const v = prompt(`Сколько сейчас в кошельке «${a.name}» на самом деле?\n\nПо учёту получается ${money(calc)}.`, String(Math.round(calc)));
  if (v === null) return;
  const fact = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  if (isNaN(fact)) return toast('Нужна сумма');

  a.fact = { amount: fact, calc: Math.round(calc), diff: Math.round(fact - calc), date: todayISO() };
  Store.save();
  render();

  if (!a.fact.diff) return toast('Всё сходится');
  fixDiscrepancy(a);
}

/* Предлагаем внести недостающую операцию — доход или расход, смотря чего не хватает. */
function fixDiscrepancy(a) {
  const diff = discrepancy(a);
  if (!diff) return toast(`По кошельку «${a.name}» всё сходится`);
  const income = diff > 0;
  openConfirm({
    kind: 'single',
    reconFor: a.id,
    title: income ? 'Не хватает дохода' : 'Не хватает расхода',
    source: `В кошельке «${a.name}» ${income ? 'больше' : 'меньше'} денег, чем показывает учёт, на ${money(Math.abs(diff))}. ${income ? 'Видимо, не внесён доход' : 'Видимо, не внесён расход'} — проверьте категорию и сохраните.`,
    draft: {
      type: income ? 'income' : 'expense',
      amount: Math.abs(diff),
      category: income ? 'Другое' : 'Разное',
      subcategory: income ? '' : 'Другое',
      date: a.fact.date,
      note: `Сверка кошелька «${a.name}»`,
      accountId: a.id,
      toAccountId: accounts().find((x) => x.id !== a.id)?.id,
    },
  });
}

function addAccount() {
  const name = prompt('Название счёта, например «Наличные» или «Карта Сбер»');
  if (!name) return;
  const icons = ['💵', '💳', '🐖', '🏦', '📦', '💶'];
  Store.state.accounts.push({
    id: uid('acc'), name: name.trim(), icon: icons[Store.state.accounts.length % icons.length],
    color: '#4a9df2', initial: 0, archived: false,
  });
  Store.save();
  render();
}

/* ---------- Импорт / экспорт ---------- */
const CSV_HEAD = ['Дата', 'Тип', 'Сумма', 'Категория', 'Подкатегория', 'Счёт', 'Счёт получателя', 'Заметка'];
const TYPE_RU = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' };
const TYPE_EN = { 'расход': 'expense', 'доход': 'income', 'перевод': 'transfer' };

function toCsv() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = Store.state.transactions
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((t) => [t.date, TYPE_RU[t.type], t.amount, t.category, t.subcategory, accountById(t.accountId)?.name || '', accountById(t.toAccountId)?.name || '', t.note].map(q).join(';'));
  return '﻿' + [CSV_HEAD.map(q).join(';'), ...rows].join('\r\n');
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ';' || ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function importCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return toast('В файле нет данных');
  const body = /дата/i.test(rows[0][0]) ? rows.slice(1) : rows;
  let added = 0, skipped = 0;

  const findAccount = (name) => {
    const n = (name || '').trim();
    if (!n) return accounts()[0]?.id;
    let a = Store.state.accounts.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (!a) { a = { id: uid('acc'), name: n, icon: '📦', color: '#9aa0a6', initial: 0, archived: false }; Store.state.accounts.push(a); }
    return a.id;
  };

  for (const r of body) {
    const [date, type, amount, cat, sub, acc, accTo, note] = r.map((c) => (c || '').trim());
    const iso = normalizeDate(date);
    const num = parseFloat(String(amount).replace(/[^\d.,-]/g, '').replace(/\s/g, '').replace(',', '.'));
    const kind = TYPE_EN[(type || '').toLowerCase()] || (num < 0 ? 'expense' : 'expense');
    if (!iso || !num || isNaN(num)) { skipped++; continue; }
    Store.state.transactions.push({
      id: uid('tx'), type: kind, amount: Math.abs(num),
      accountId: findAccount(acc), toAccountId: kind === 'transfer' ? findAccount(accTo) : null,
      category: cat || (kind === 'income' ? 'Другое' : 'Разное'), subcategory: sub || '',
      date: iso, note: note || '', createdAt: Date.now() + added,
    });
    added++;
  }
  Store.save();
  render();
  toast(`Добавлено ${added}${skipped ? `, пропущено ${skipped}` : ''}`);
}

function normalizeDate(v) {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Тип файла определяется по содержимому в importAnyFile, поэтому все три
   пункта меню открывают один и тот же выбор файла. */
function askFile() {
  $('#filePicker').value = '';
  $('#filePicker').click();
}

/* ---------- События ---------- */
document.addEventListener('click', (e) => {
  const goto = e.target.closest('[data-goto]');
  if (goto) return go(goto.dataset.goto);

  const tx = e.target.closest('[data-tx]');
  if (tx) {
    const t = Store.state.transactions.find((x) => x.id === tx.dataset.tx);
    if (t) openTxDetail(t);
    return;
  }
  const goal = e.target.closest('[data-goal]');
  if (goal) return openGoal(goal.dataset.goal);

  const gap = e.target.closest('[data-gap]');
  if (gap) {
    const a = accountById(gap.dataset.gap);
    if (a) fixDiscrepancy(a);
    return;
  }

  const recPay = e.target.closest('[data-recpay]');
  if (recPay) return payRecurring(recPay.dataset.recpay);

  const recTrack = e.target.closest('[data-rectrack]');
  if (recTrack) return trackRecurring(JSON.parse(recTrack.dataset.rectrack));

  const recDel = e.target.closest('[data-recdel]');
  if (recDel) {
    Store.state.recurring = Store.state.recurring.filter((r) => r.id !== recDel.dataset.recdel);
    Store.save();
    render();
    return toast('Убрал из регулярных');
  }

  const acc = e.target.closest('[data-acc]');
  if (acc) return editAccount(acc.dataset.acc);

  const ea = e.target.closest('[data-editacc]');
  if (ea) return editAccount(ea.dataset.editacc);
});

/* Карточка операции — единственное место, где виден комментарий. */
function openTxDetail(t) {
  ui.txId = t.id;
  const acc = accountById(t.accountId);
  const m = catMeta(t.type, t.category);
  const signed = t.type === 'income' ? t.amount : -t.amount;

  let html = `<div class="conf-amount ${signed > 0 ? 'pos' : ''}">${signed > 0 ? '+' : ''}${money(signed)}</div>`;
  if (t.type === 'transfer') {
    html += `<div class="conf-src">Перевод · ${esc(acc?.name || '—')} → ${esc(accountById(t.toAccountId)?.name || '—')}</div>`;
  } else {
    html += `<div class="conf-src">${m.icon} ${esc(t.category)}${t.subcategory ? ' · ' + esc(t.subcategory) : ''}</div>`;
    html += `<div class="g-row"><span>Счёт</span><b>${esc(acc ? acc.icon + ' ' + acc.name : '—')}</b></div>`;
  }
  html += `<div class="g-row"><span>Дата</span><b>${formatDate(t.date)}</b></div>`;

  html += `<div class="g-sec">Комментарий</div>`;
  html += `<button class="g-row conf-row" id="txNote"><span class="note-text">${t.note ? esc(t.note) : 'Пусто — нажмите, чтобы добавить'}</span>
    <span class="row-go">✏️</span>
    <span class="sub">Виден только здесь. В списках его нет, но поиск по нему работает.</span></button>`;

  html += `<div class="g-actions">
      <button class="g-btn ghost" id="txDelete">Удалить</button>
      <button class="g-btn ghost" id="txRepeat">Повторить</button>
      <button class="g-btn" id="txEdit">Изменить</button>
    </div>`;

  $('#txBody').innerHTML = html;
  $('#txSheet').hidden = false;

  $('#txNote').onclick = () => {
    const v = prompt('Комментарий к операции', t.note || '');
    if (v === null) return;
    t.note = v.trim();
    Store.save();
    openTxDetail(t);
    render();
  };
  $('#txEdit').onclick = () => { $('#txSheet').hidden = true; openEntry(t); };
  $('#txRepeat').onclick = () => {
    Store.state.transactions.push({ ...t, id: uid('tx'), date: todayISO(), createdAt: Date.now() });
    Store.save(); $('#txSheet').hidden = true; render(); toast('Операция скопирована на сегодня');
  };
  $('#txDelete').onclick = () => {
    if (!confirm('Удалить операцию?')) return;
    Store.state.transactions = Store.state.transactions.filter((x) => x.id !== t.id);
    Store.save(); $('#txSheet').hidden = true; render(); toast('Удалено');
  };
}

$('#fab').onclick = () => openEntry(null);
$('#entryClose').onclick = () => ($('#entrySheet').hidden = true);
$('#entrySave').onclick = saveEntry;
$('#pickerClose').onclick = () => ($('#pickerSheet').hidden = true);
$('#pickAccount').onclick = pickAccount;
$('#pickCategory').onclick = pickCategory;
$('#pickDate').onclick = pickDate;
$('#keypad').onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) keypad(b.dataset.k); };
$('#typeSeg').onclick = (e) => {
  const b = e.target.closest('[data-type]');
  if (!b) return;
  ui.draft.type = b.dataset.type;
  ui.draft.category = '';
  ui.draft.subcategory = '';
  renderEntry();
};
$$('.sheet').forEach((s) => s.addEventListener('click', (e) => { if (e.target === s) s.hidden = true; }));

const shiftMonth = (key, delta) => {
  const d = parseKey(key);
  d.setMonth(d.getMonth() + delta);
  return monthKey(d);
};
$('#opsPrev').onclick = () => { ui.opsMonth = shiftMonth(ui.opsMonth, -1); renderOps(); };
$('#opsNext').onclick = () => { ui.opsMonth = shiftMonth(ui.opsMonth, 1); renderOps(); };
$('#repPrev').onclick = () => { ui.repMonth = shiftMonth(ui.repMonth, -1); renderReport(); };
$('#repNext').onclick = () => { ui.repMonth = shiftMonth(ui.repMonth, 1); renderReport(); };
$('#opsSearch').oninput = (e) => { ui.search = e.target.value; renderOps(); };
$('#repSeg').onclick = (e) => { const b = e.target.closest('[data-kind]'); if (b) { ui.repKind = b.dataset.kind; renderReport(); } };

$('#addAccount').onclick = addAccount;
$('#loadHistory').onclick = loadHistoryFromSheet;
$('#addGoal').onclick = addGoal;
$('#camHome').onclick = openReceiptMenu;
$('#scanClose').onclick = () => { LiveScan.stop($('#scanVideo')); $('#scanOverlay').hidden = true; };
$('#checkUpdate').onclick = async () => {
  toast('Проверяю…');
  try {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.update();
    for (const k of await caches.keys()) await caches.delete(k);
  } catch (e) {}
  setTimeout(() => location.reload(), 600);
};
$('#receiptCamera').onchange = (e) => { handleReceiptImage(e.target.files[0]); e.target.value = ''; };
$('#receiptGallery').onchange = (e) => { handleReceiptImage(e.target.files[0]); e.target.value = ''; };
$('#txClose').onclick = () => ($('#txSheet').hidden = true);
$('#confirmYes').onclick = confirmSave;
$('#confirmCancel').onclick = () => { $('#confirmSheet').hidden = true; ui.confirm = null; };
$('#confirmNo').onclick = () => {
  const c = ui.confirm;
  $('#confirmSheet').hidden = true;
  if (c && c.kind === 'single') {
    // Открываем обычный ввод с уже подставленными полями.
    openEntry(null);
    Object.assign(ui.draft, c.draft, { raw: String(c.draft.amount) });
    $('#noteInput').value = c.draft.note || '';
    renderEntry();
  } else if (c) {
    toast('Нажмите на любую строку, чтобы её поправить');
    $('#confirmSheet').hidden = false;
    return;
  }
  ui.confirm = null;
};
$('#confirmBody').addEventListener('click', (e) => {
  const item = e.target.closest('[data-item]');
  if (item) return fixReceiptItem(+item.dataset.item);
  const split = e.target.closest('[data-split]');
  if (split) { ui.confirm.split = split.dataset.split === '1'; return renderConfirm(); }
  const fix = e.target.closest('[data-fix]');
  if (fix) return confirmFix(fix.dataset.fix);
});
$('#goalClose').onclick = () => ($('#goalSheet').hidden = true);
$('#goalMenu').onclick = () => {
  const g = Store.state.goals.find((x) => x.id === ui.goalId);
  if (g) editGoal(g);
};
$('#exportCsv').onclick = () => { download(`koshelek-${todayISO()}.csv`, toCsv(), 'text/csv;charset=utf-8'); toast('Файл выгружен'); };
$('#makeBackup').onclick = doBackup;
$('#backupRemind').onclick = () => {
  Store.state.settings.backupRemind = Store.state.settings.backupRemind === false;
  Store.save();
  render();
  toast(Store.state.settings.backupRemind ? 'Буду напоминать раз в две недели' : 'Напоминания выключены');
};
$('#importCsv').onclick = () => askFile('csv');
$('#importJson').onclick = () => askFile('json');
$('#importPlanner').onclick = () => askFile('planner');
$('#wipe').onclick = () => {
  if (!confirm('Стереть все счета и операции? Это необратимо.')) return;
  Store.reset(); render(); toast('Данные очищены');
};
$('#filePicker').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  importAnyFile(f);
};
$('#themeSeg').onclick = (e) => {
  const b = e.target.closest('[data-theme]');
  if (!b) return;
  Store.state.settings.theme = b.dataset.theme;
  Store.save();
  render();
};
$('#budgetList').addEventListener('change', (e) => {
  const inp = e.target.closest('[data-bud]');
  if (!inp) return;
  const key = ui.repMonth;
  Store.state.budgets[key] = Store.state.budgets[key] || {};
  const v = parseFloat(inp.value);
  if (!v || isNaN(v)) delete Store.state.budgets[key][inp.dataset.bud];
  else Store.state.budgets[key][inp.dataset.bud] = v;
  Store.save();
});

/* ---------- Старт ---------- */
Store.load();
applyTheme();
go('home');

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // Когда обновлённая версия берёт управление, перезагружаем страницу один раз,
  // иначе приложение продолжит работать на старом коде до следующего запуска.
  let reloadedOnce = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadedOnce) return;
    reloadedOnce = true;
    location.reload();
  });
}
