/* Local repository boundary. A future authenticated cloud adapter replaces this API. */
(function (root) {
  const KEY = 'kve-v01';
  function normalize(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректный формат данных');
    if (value.schemaVersion > 2) throw new Error('Данные созданы более новой версией KVÉ');
    for (const key of ['looks', 'ideas', 'folders', 'list']) {
      if (value[key] !== undefined && !Array.isArray(value[key])) throw new Error('Некорректный раздел: ' + key);
    }
    const data = { ...value, schemaVersion: 2, looks: value.looks || [], ideas: value.ideas || [], folders: value.folders || ['Лето', 'На каждый день'], list: value.list || [], folderCovers: { ...value.folderCovers } };
    if (data.folders.some(f => typeof f !== 'string')) throw new Error('Некорректные папки');
    const ids = new Set();
    data.looks = data.looks.map(x => {
      if (!x || !Number.isSafeInteger(x.id) || ids.has('l'+x.id)) throw new Error('Некорректный образ');
      ids.add('l'+x.id);
      return { ...x, folders: x.folders || (x.folder ? [x.folder] : []), tags: x.tags || [], photos: x.photos || [], favorite: !!x.favorite, attributes: { ...x.attributes } };
    });
    data.ideas = data.ideas.map(x => {
      if (!x || !Number.isSafeInteger(x.id) || ids.has('i'+x.id)) throw new Error('Некорректная идея');
      ids.add('i'+x.id);
      return { ...x, tags: x.tags || [], photo: x.photo || '' };
    });
    for (const x of [...data.looks, ...data.ideas]) {
      for (const key of ['tags', 'folders', 'photos']) {
        if (x[key] !== undefined && (!Array.isArray(x[key]) || x[key].some(v => typeof v !== 'string'))) throw new Error('Некорректные данные карточки');
      }
    }
    if (data.list.some(x => !x || !Number.isSafeInteger(x.id) || typeof x.text !== 'string')) throw new Error('Некорректный List');
    return data;
  }
  function createLocalRepository(storage) {
    let raw = null, snapshot, error = null;
    try { raw = storage.getItem(KEY); snapshot = normalize(raw ? JSON.parse(raw) : {}); }
    catch (e) { error = e; snapshot = normalize({}); }
    const copy = () => JSON.parse(JSON.stringify(snapshot));
    return {
      load: copy,
      get error() { return error; },
      save(data) {
        if (error) throw new Error('Данные не удалось прочитать. Исходная запись сохранена; скачайте резервную копию через меню •••.');
        if (storage.getItem(KEY) !== raw) throw new Error('Данные изменились в другой вкладке. Обновите страницу перед сохранением.');
        const next = normalize(data);
        const text = JSON.stringify(next);
        storage.setItem(KEY, text); // Commit only after the browser confirms the write.
        raw = text; snapshot = next;
      },
      export() { return raw || JSON.stringify(snapshot); }
    };
  }
  root.KveStorage = { KEY, normalize, createLocalRepository };
})(globalThis);
