/* Справочники и хранилище. Категории взяты из «Планировщика семейного бюджета». */

const EXPENSE_CATEGORIES = [
  { name: 'Жизнедеятельность', icon: '🛒', color: '#f2704a', subs: ['Продукты', 'Бытовые (Магнит, Фикс)', 'Одежда', 'Кафе/Рестораны', 'Дача еда', 'Химчистка', 'Парикмахерская/Салоны', 'Другое'] },
  { name: 'Бытовые расходы', icon: '🏠', color: '#4a9df2', subs: ['Коммунальные платежи', 'Интернет', 'Телефон', 'Дача', 'Техническое обслуживание', 'Ремонт дом', 'Другое'] },
  { name: 'Дети', icon: '🧒', color: '#f2c14a', subs: ['Медицинское обслуживание', 'Одежда', 'Принадлежности для учебы', 'Обеды', 'Дет.сад', 'Игрушки', 'Питание', 'Английский, танцы, алгебра'] },
  { name: 'Транспорт', icon: '🚗', color: '#5ac8a8', subs: ['Обслуживание автомобиля', 'Бензин', 'Автобус/Такси/Метро', 'Ремонт', 'Лицензии', 'Другое'] },
  { name: 'Здоровье', icon: '💊', color: '#e05a7a', subs: ['Доктора/Стоматологи', 'Лекарства', 'Скорая помощь', 'Процедуры', 'БАДы', 'Другое'] },
  { name: 'Страховка', icon: '🛡️', color: '#8a8fd6', subs: ['Автомобиль', 'Налог', 'Дом/Имущество', 'Другое'] },
  { name: 'Образование', icon: '🎓', color: '#3fb0d8', subs: ['Обучение', 'Книги', 'Подкасты/Аудиокниги', 'Другое'] },
  { name: 'Подарки/Благотворительность', icon: '🎁', color: '#d95ac8', subs: ['Подарки', 'Благотворительные взносы', 'Религиозные взносы', 'Другое'] },
  { name: 'Налоги/Кредиты', icon: '🏦', color: '#7a869a', subs: ['Кредит/Ипотека', 'Кредитная карта Сбер', 'Кредитные карты', 'Рассрочка Яндекс', 'РКО', 'Машина', 'Другое'] },
  { name: 'Развлечения', icon: '🎬', color: '#f28b4a', subs: ['Музыка', 'Фильмы', 'Алкоголь, закуски', 'Кинотеатр', 'Театр', 'Концерты', 'Книги', 'Табак', 'Фуд-корт', 'Спорт', 'Игрушки/Гаджеты', 'Другое'] },
  { name: 'Дача', icon: '🌱', color: '#6fbf5a', subs: ['Работа', 'Дом/Имущество', 'Здоровье', 'Жизнь', 'Другое'] },
  { name: 'Животные', icon: '🐾', color: '#b98f5a', subs: ['Еда', 'Медицина', 'Игрушки', 'Другое'] },
  { name: 'Подписки', icon: '📱', color: '#5a7ad9', subs: ['Sintex, Gamma', 'Тильда', 'Сервисы музыки/Фильмов', 'Членские взносы', 'Газеты, журналы', 'Другое'] },
  { name: 'Отпуск', icon: '✈️', color: '#41c0e0', subs: ['Билеты', 'Жилье', 'Еда', 'Авто', 'Развлечения', 'Другое'] },
  { name: 'Сбережения', icon: '🐖', color: '#4fb06a', subs: ['На сберегательные счета', 'На непредвиденные расходы', 'На пенсию', 'Для инвестиций', 'На учебу детям', 'Кэшбэк', 'Другое'] },
  { name: 'Разное', icon: '📦', color: '#9aa0a6', subs: ['Банковские комиссии', 'Другие комиссии', 'Другое'] },
];

const INCOME_CATEGORIES = [
  { name: 'Зарплата', icon: '💼', color: '#4fb06a', subs: [] },
  { name: 'Подработка', icon: '🧘', color: '#5ac8a8', subs: ['Пилатес', 'Хобби', 'Кодекс', 'Другое'] },
  { name: 'Муж', icon: '👨', color: '#4a9df2', subs: [] },
  { name: 'Мама, папа', icon: '👵', color: '#f2c14a', subs: [] },
  { name: 'Подарки', icon: '🎁', color: '#d95ac8', subs: [] },
  { name: 'Кэшбэк', icon: '💳', color: '#f28b4a', subs: [] },
  { name: 'Компенсация за сад', icon: '🏫', color: '#3fb0d8', subs: [] },
  { name: 'Дивиденды', icon: '📈', color: '#8a8fd6', subs: [] },
  { name: 'Трансфер с сбережений', icon: '🔁', color: '#5ac8a8', subs: [] },
  { name: 'Другое', icon: '➕', color: '#9aa0a6', subs: [] },
];

const DEFAULT_ACCOUNTS = [
  { id: 'acc_cash', name: 'Наличные', icon: '💵', color: '#4fb06a', initial: 0, archived: false },
  { id: 'acc_card', name: 'Карта', icon: '💳', color: '#4a9df2', initial: 0, archived: false },
  { id: 'acc_savings', name: 'Сбережения', icon: '🐖', color: '#f2c14a', initial: 0, archived: false },
];

const STORE_KEY = 'koshelek.v1';

const emptyState = () => ({
  version: 1,
  accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a })),
  transactions: [],
  goals: [],            // { id, name, icon, target, initial, deadline: "2027-06" }
  recurring: [],        // { id, cat, sub, amount, accountId, active }
  budgets: {},          // { "2026-08": { "Жизнедеятельность": 40000 } }
  settings: { theme: 'auto', currency: '₽', lastAccountId: 'acc_cash', backupRemind: true, lastBackupAt: 0, lastBackupCount: 0 },
});

const Store = {
  state: emptyState(),

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.state = { ...emptyState(), ...parsed };
        this.state.settings = { ...emptyState().settings, ...(parsed.settings || {}) };
      }
    } catch (e) {
      console.warn('Не удалось прочитать сохранённые данные, начинаем с чистого листа', e);
      this.state = emptyState();
    }
    return this.state;
  },

  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.state));
    } catch (e) {
      alert('Не удалось сохранить данные: ' + e.message);
    }
    document.dispatchEvent(new CustomEvent('store:changed'));
  },

  replaceAll(next) {
    this.state = { ...emptyState(), ...next };
    this.save();
  },

  reset() {
    this.state = emptyState();
    this.save();
  },
};

const uid = (p = 'id') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
