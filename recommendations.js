/* Pure, replaceable ranking strategy: only the supplied user's saved looks are considered. */
(function (root) {
  const options = {
    occasion: { label: 'Повод', values: ['На каждый день', 'Работа', 'Прогулка', 'Свидание', 'Вечеринка', 'Спорт'] },
    mood: { label: 'Настроение', values: ['Комфорт', 'Минимализм', 'Романтичное', 'Яркое', 'Деловое'] },
    season: { label: 'Сезон', values: ['Весна', 'Лето', 'Осень', 'Зима'] },
    weather: { label: 'Погода', values: ['Жарко', 'Тепло', 'Прохладно', 'Холодно', 'Дождь', 'Снег'] }
  };
  const words = {
    'На каждый день': ['на каждый день', 'повседнев', 'casual'], 'Работа': ['работ', 'офис', 'делов'],
    'Прогулка': ['прогул'], 'Свидание': ['свидан'], 'Вечеринка': ['вечерин', 'празднич'], 'Спорт': ['спорт', 'трениров'],
    'Комфорт': ['комфорт', 'уют', 'удобн'], 'Минимализм': ['минимал'], 'Романтичное': ['романтич'], 'Яркое': ['ярк'], 'Деловое': ['делов', 'офис'],
    'Весна': ['весн', 'весен'], 'Лето': ['лето', 'летн'], 'Осень': ['осен'], 'Зима': ['зим'],
    'Жарко': ['жарк', 'жар'], 'Тепло': ['тепло', 'теплая погода'], 'Прохладно': ['прохлад'], 'Холодно': ['холод'], 'Дождь': ['дожд'], 'Снег': ['снег', 'снеж']
  };
  function rank(looks, preferences) {
    const selected = Object.entries(preferences).filter(([key, value]) => options[key]?.values.includes(value));
    if (!selected.length) return [];
    return looks.map(look => {
      const text = [look.note || '', ...(look.tags || []), ...(look.folders || [])].join(' ').toLowerCase();
      const matches = [];
      let conflict = false;
      for (const [key, value] of selected) {
        const explicit = look.attributes?.[key];
        if (explicit && explicit !== value) { conflict = true; continue; }
        if (explicit === value || (!explicit && (words[value] || [value.toLowerCase()]).some(w => text.includes(w)))) matches.push(value);
      }
      return { look, matches, total: selected.length, conflict };
    }).filter(x => !x.conflict && x.matches.length).sort((a, b) => b.matches.length - a.matches.length);
  }
  root.KveRecommendations = { options, rank };
})(globalThis);
