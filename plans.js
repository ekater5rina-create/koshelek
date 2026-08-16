/* Регулярные платежи, фонд нерегулярных трат и резервные копии. */

const Plans = {
  /* Находит в истории траты, которые повторяются почти каждый месяц. */
  detect(n = 6) {
    const months = Advice.recentMonths(n);
    if (months.length < 3) return [];
    const need = Math.max(3, Math.ceil(months.length * 0.6));
    const out = [];

    for (const [pair, byMonth] of Advice.byPair(months, true)) {
      const [cat, sub] = pair.split(' / ');
      // Переводы в накопления живут в целях и фонде, а не среди платежей.
      if (cat === 'Сбережения') continue;
      const vals = months.map((m) => byMonth[m]);
      const nz = vals.filter((v) => v > 0);
      if (nz.length < need) continue;
      const med = median(nz);
      if (med < 300) continue;
      // Слишком скачущие суммы — это не платёж, а просто частая трата.
      const spread = (Math.max(...nz) - Math.min(...nz)) / med;
      if (spread > 1) continue;
      out.push({ cat, sub, amount: Math.round(med), months: nz.length, of: months.length, spread: +spread.toFixed(2) });
    }
    return out.sort((a, b) => a.spread - b.spread || b.amount - a.amount);
  },

  /* Уже отслеживаемые платежи, которых ещё не было в этом месяце. */
  pending(key = monthKey(new Date())) {
    return (Store.state.recurring || [])
      .filter((r) => r.active !== false)
      .filter((r) => !Store.state.transactions.some(
        (t) => t.type === 'expense' && t.date.slice(0, 7) === key &&
               t.category === r.cat && (t.subcategory || '') === (r.sub || '')
      ));
  },

  /* Уже отмеченные в этом месяце — чтобы показать полную картину. */
  paid(key = monthKey(new Date())) {
    return (Store.state.recurring || []).filter((r) => r.active !== false && !this.pending(key).includes(r));
  },

  isTracked(cat, sub) {
    return (Store.state.recurring || []).some((r) => r.cat === cat && (r.sub || '') === (sub || ''));
  },

  /* Фонд нерегулярных трат: сколько в месяц нужно откладывать, чтобы машина,
     дача, ремонт и страховка не роняли бюджет в минус. */
  fund(n = 12) {
    const months = Advice.recentMonths(n);
    if (months.length < 6) return null;
    const items = [];

    for (const [pair, byMonth] of Advice.byPair(months, true)) {
      const [cat, sub] = pair.split(' / ');
      // Накопления — это не трата, которую нужно резервировать, иначе фонд
      // начнёт копить сам на себя.
      if (cat === 'Сбережения') continue;
      const vals = months.map((m) => byMonth[m]);
      const nz = vals.filter((v) => v > 0);
      if (!nz.length) continue;
      const presence = nz.length / months.length;
      const total = Math.round(vals.reduce((s, v) => s + v, 0));
      const max = Math.round(Math.max(...nz));
      const med = Math.round(median(nz));

      if (presence < 0.5) {
        // Редко, но крупно — резервируем всю сумму.
        if (max < 10000) continue;
        items.push({ cat, sub, total, max, times: nz.length, need: total, kind: 'rare', med });
      } else {
        // Бывает почти каждый месяц, но иногда взрывается: дача, ремонт.
        // Обычный уровень — это бюджет, резервировать надо только превышение.
        if (max < 30000 || max < med * 3) continue;
        const need = Math.max(0, total - med * nz.length);
        if (need < 20000) continue;
        items.push({ cat, sub, total, max, times: nz.length, need: Math.round(need), kind: 'spike', med });
      }
    }

    items.sort((a, b) => b.need - a.need);
    const total = items.reduce((s, i) => s + i.need, 0);
    return {
      months: months.length,
      from: months[0],
      to: months[months.length - 1],
      items,
      total,
      perMonth: Math.round(total / months.length),
      saved: fundSaved(),
    };
  },
};

/* Сколько уже лежит в фонде — по операциям с пометкой. */
const FUND_TAG = 'Фонд нерегулярных трат';
const fundSaved = () =>
  Store.state.transactions
    .filter((t) => t.fund)
    .reduce((s, t) => s + (t.type === 'expense' ? t.amount : -t.amount), 0);

/* ---------- Резервные копии ---------- */
const Backup = {
  daysSince() {
    const at = Store.state.settings.lastBackupAt;
    if (!at) return null;
    return Math.floor((Date.now() - at) / 86400000);
  },
  unsaved() {
    return Math.max(0, Store.state.transactions.length - (Store.state.settings.lastBackupCount || 0));
  },
  /* Копии не было две недели или с тех пор появились новые операции. */
  overdue() {
    if (Store.state.settings.backupRemind === false) return false;
    if (!Store.state.transactions.length) return false;
    const d = this.daysSince();
    if (d === null) return true;
    return d >= 14 && this.unsaved() > 0;
  },
  mark() {
    Store.state.settings.lastBackupAt = Date.now();
    Store.state.settings.lastBackupCount = Store.state.transactions.length;
    Store.save();
  },
  async save() {
    const json = JSON.stringify(Store.state, null, 2);
    const name = `koshelek-${todayISO()}.json`;
    // На айфоне «Поделиться» даёт пункт «Сохранить в Файлы» → iCloud Drive.
    try {
      const file = new File([json], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Копия Кошелька' });
        this.mark();
        return 'shared';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
    download(name, json, 'application/json');
    this.mark();
    return 'downloaded';
  },
};
