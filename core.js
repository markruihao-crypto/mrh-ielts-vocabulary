(function (root) {
  'use strict';
  const TOTAL_LISTS = 70;
  const TARGET_WORDS = 2828;

  function parseDate(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    return new Date(y, m - 1, d, 12);
  }
  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function addDays(date, n) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    next.setDate(next.getDate() + n);
    return next;
  }
  function mondayKey(date) {
    return dateKey(addDays(date, -(date.getDay() + 6) % 7));
  }
  function sundayKey(weekKey) { return dateKey(addDays(parseDate(weekKey), 6)); }
  function listMeta(index) {
    return index < 42 ? { band: 6, list: index + 1 } : { band: 7, list: index - 41 };
  }
  function listIndex(band, list) { return Number(band) === 6 ? Number(list) - 1 : 41 + Number(list); }
  function labelForList(band, list) { return `${band}分 · List ${list}`; }
  function buildSessions(startKey, dateOverrides = {}, scheduleAnchor = null) {
    const sessions = [];
    let date = parseDate(startKey);
    let anchoredDate = null;
    while (![2, 4, 6].includes(date.getDay())) date = addDays(date, 1);
    for (let index = 0; index < 28; index++) {
      if (index > 0) {
        date = addDays(date, 1);
        while (![2, 4, 6].includes(date.getDay())) date = addDays(date, 1);
      }
      const band = index < 21 ? 6 : 7;
      const firstList = band === 6 ? index * 2 + 1 : (index - 21) * 4 + 1;
      const listCount = band === 6 ? 2 : 4;
      const lists = Array.from({ length: listCount }, (_, offset) => ({ band, list: firstList + offset }));
      let regularDate = dateKey(date);
      let actualDate = dateOverrides[index] || regularDate;
      if (scheduleAnchor && index >= scheduleAnchor.index) {
        if (index === scheduleAnchor.index) {
          anchoredDate = parseDate(scheduleAnchor.date);
          while (![2, 4, 6].includes(anchoredDate.getDay())) anchoredDate = addDays(anchoredDate, 1);
        } else {
          anchoredDate = addDays(anchoredDate, 1);
          while (![2, 4, 6].includes(anchoredDate.getDay())) anchoredDate = addDays(anchoredDate, 1);
          regularDate = dateKey(anchoredDate);
        }
        actualDate = index === scheduleAnchor.index ? dateKey(anchoredDate) : dateOverrides[index] || dateKey(anchoredDate);
      }
      sessions.push({ index, date: actualDate, regularDate, week: mondayKey(parseDate(actualDate)), lists });
    }
    return sessions;
  }
  function migrateLegacyState(oldState) {
    if (oldState.scheduleVersion === 2) return oldState;
    const completedLists = { ...(oldState.completedLists || {}) };
    for (const [key, finishedAt] of Object.entries(oldState.completed || {})) {
      const oldIndex = Number(key);
      if (!Number.isInteger(oldIndex) || oldIndex < 0 || oldIndex >= 18 || !finishedAt) continue;
      for (let listIndex = oldIndex * 4; listIndex < Math.min(TOTAL_LISTS, oldIndex * 4 + 4); listIndex++) {
        const list = listMeta(listIndex);
        completedLists[`${list.band}-${list.list}`] = finishedAt;
      }
    }
    const newOverrides = {};
    const allSessions = buildSessions(oldState.startDate || '2026-11-17');
    for (const [key, date] of Object.entries(oldState.dateOverrides || {})) {
      const oldIndex = Number(key);
      if (!Number.isInteger(oldIndex) || oldIndex < 0 || oldIndex >= 18) continue;
      const firstList = listMeta(oldIndex * 4);
      const session = allSessions.find(s => s.lists.some(l => l.band === firstList.band && l.list === firstList.list));
      if (session) newOverrides[session.index] = date;
    }
    const completed = {};
    for (const session of allSessions) {
      const dates = session.lists.map(l => completedLists[`${l.band}-${l.list}`]);
      if (dates.every(Boolean)) completed[session.index] = Math.max(...dates.map(Number));
    }
    let run = oldState.run;
    if (run?.type === 'session' && Number.isInteger(run.sessionIndex) && run.sessionIndex >= 0 && run.sessionIndex < 18) {
      if (run.index === 0) run = null;
      else {
        const legacyLists = [];
        for (let i = run.sessionIndex * 4; i < Math.min(TOTAL_LISTS, run.sessionIndex * 4 + 4); i++) legacyLists.push(listMeta(i));
        run = { ...run, legacyLists };
      }
    }
    return { ...oldState, scheduleVersion: 2, migratedLegacy: true, completedLists, completed, dateOverrides: newOverrides, run };
  }
  function mergeProgress(current, imported) {
    const validIds = new Set((imported.lexicon || []).map(word => word.id));
    const stats = { ...(imported.stats || {}) };
    for (const [id, recent] of Object.entries(current.stats || {})) {
      if (!validIds.has(id)) continue;
      const previous = stats[id];
      if (!previous) { stats[id] = recent; continue; }
      const merged = { ...previous, ...recent };
      for (const field of ['seen', 'correct', 'mistakes', 'skips', 'reviewCount', 'lastSeen']) {
        merged[field] = Math.max(Number(previous[field]) || 0, Number(recent[field]) || 0);
      }
      merged.focus = Boolean(previous.focus || recent.focus);
      merged.focusReasons = [...new Set([...(Array.isArray(previous.focusReasons) ? previous.focusReasons : []), ...(Array.isArray(recent.focusReasons) ? recent.focusReasons : [])])];
      stats[id] = merged;
    }
    const completedLists = { ...(imported.completedLists || {}) };
    for (const [key, time] of Object.entries(current.completedLists || {})) {
      completedLists[key] = Math.max(Number(completedLists[key]) || 0, Number(time) || 0);
    }
    const completed = {};
    for (const session of buildSessions(imported.startDate, imported.dateOverrides, imported.scheduleAnchor)) {
      const dates = session.lists.map(list => completedLists[`${list.band}-${list.list}`]);
      if (dates.every(Boolean)) completed[session.index] = Math.max(...dates.map(Number));
    }
    const sundays = { ...(imported.sundays || {}) };
    for (const [week, time] of Object.entries(current.sundays || {})) sundays[week] = Math.max(Number(sundays[week]) || 0, Number(time) || 0);
    return { ...imported, stats, completedLists, completed, sundays, run: null };
  }
  function normalizeAnswer(value) {
    return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[’‘]/g, "'");
  }
  function slugId(band, list, english) { return `${band}-${list}-${normalizeAnswer(english)}`; }
  function splitDelimited(text, delimiter) {
    const rows = [];
    let row = [], field = '', quoted = false;
    const source = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch === '"') {
        if (quoted && source[i + 1] === '"') { field += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === delimiter && !quoted) { row.push(field); field = ''; }
      else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && source[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(x => x.trim())) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some(x => x.trim())) rows.push(row);
    return rows;
  }
  function pickField(row, names) {
    const keys = Object.keys(row);
    const key = keys.find(k => names.includes(k.trim().toLowerCase()));
    return key === undefined ? '' : row[key];
  }
  function parseBand(value) {
    const v = String(value || '').trim();
    const match = v.match(/(?:^|[^0-9])([67])\s*分?/);
    return match ? Number(match[1]) : Number(v);
  }
  function parseList(value) {
    const match = String(value || '').match(/(\d{1,2})/);
    return match ? Number(match[1]) : NaN;
  }
  function parseLexicon(text, filename) {
    let rows;
    if (/\.json$/i.test(filename || '') || /^\s*[\[{]/.test(text)) {
      const parsed = JSON.parse(text);
      rows = Array.isArray(parsed) ? parsed : parsed.words;
      if (!Array.isArray(rows)) throw new Error('JSON 需是词条数组，或包含 words 数组。');
    } else {
      const first = String(text).split(/\r?\n/, 1)[0];
      const delimiter = first.includes('\t') ? '\t' : ',';
      const cells = splitDelimited(text, delimiter);
      if (cells.length < 2) throw new Error('文件只有表头或没有词条。');
      const header = cells.shift().map(x => x.trim());
      rows = cells.map(cells => Object.fromEntries(header.map((h, i) => [h, (cells[i] || '').trim()])));
    }
    const words = [], seen = new Set(), issues = [];
    rows.forEach((row, i) => {
      const band = parseBand(pickField(row, ['band', 'level', 'score', '分数', '分值', '词汇级别']));
      const list = parseList(pickField(row, ['list', 'word list', 'wordlist', '单元', '列表', 'list编号']));
      const english = String(pickField(row, ['english', 'word', 'en', '单词', '英文', '英语']) || '').trim();
      const chinese = String(pickField(row, ['chinese', 'meaning', 'zh', '中文', '释义', '中文释义', '汉语意思']) || '').trim();
      if (![6, 7].includes(band) || !Number.isInteger(list) || list < 1 || list > (band === 6 ? 42 : 28) || !english || !chinese) {
        issues.push(i + 2); return;
      }
      const id = slugId(band, list, english);
      if (seen.has(id)) { issues.push(i + 2); return; }
      seen.add(id);
      words.push({ id, band, list, english, chinese });
    });
    if (!words.length) throw new Error('未识别到有效词条。请检查表头和 6/7 分、List 编号。');
    words.sort((a, b) => listIndex(a.band, a.list) - listIndex(b.band, b.list));
    return { words, issues, listCount: new Set(words.map(w => `${w.band}-${w.list}`)).size };
  }
  function weightedSample(items, count, weight, random = Math.random) {
    const pool = items.slice(), chosen = [];
    while (pool.length && chosen.length < count) {
      const weights = pool.map(item => Math.max(0.01, weight(item)));
      const total = weights.reduce((a, b) => a + b, 0);
      let needle = random() * total, selected = pool.length - 1;
      for (let i = 0; i < pool.length; i++) { needle -= weights[i]; if (needle <= 0) { selected = i; break; } }
      chosen.push(pool.splice(selected, 1)[0]);
    }
    return chosen;
  }
  function shuffle(items, random = Math.random) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  }
  function goalFor(stat) { return stat?.focus ? 7 : 6; }
  function reviewWeight(word, stats) {
    const s = stats[word.id] || {};
    return 1 + Math.max(0, goalFor(s) - (s.reviewCount || 0)) * .35 + (s.mistakes || 0) * 1.4 + (s.focus ? 5 : 0);
  }
  function chooseDictationReviews(priorWords, currentIds, stats, random = Math.random) {
    const eligible = priorWords.filter(w => !currentIds.has(w.id) && (stats[w.id]?.reviewCount || 0) < goalFor(stats[w.id]));
    const count = Math.min(eligible.length, 3 + Math.floor(random() * 3));
    return weightedSample(eligible, count, w => reviewWeight(w, stats), random);
  }
  function chooseSunday(words, stats, random = Math.random) {
    const eligible = words.filter(w => (stats[w.id]?.reviewCount || 0) < goalFor(stats[w.id]));
    return weightedSample(eligible, Math.min(200, eligible.length), w => reviewWeight(w, stats), random);
  }
  function chooseBooster(words, stats, count, random = Math.random) {
    const eligible = words.filter(w => (stats[w.id]?.reviewCount || 0) < goalFor(stats[w.id]));
    eligible.sort((a, b) => (stats[a.id]?.reviewCount || 0) - (stats[b.id]?.reviewCount || 0));
    if (!eligible.length) return [];
    const cutoff = eligible[Math.min(count - 1, eligible.length - 1)];
    const threshold = stats[cutoff.id]?.reviewCount || 0;
    const before = eligible.filter(w => (stats[w.id]?.reviewCount || 0) < threshold);
    const peers = eligible.filter(w => (stats[w.id]?.reviewCount || 0) === threshold);
    return shuffle(before, random).concat(weightedSample(peers, Math.max(0, count - before.length), w => reviewWeight(w, stats), random)).slice(0, count);
  }
  root.WordCore = { TOTAL_LISTS, TARGET_WORDS, parseDate, dateKey, addDays, mondayKey, sundayKey, listMeta, listIndex, labelForList, buildSessions, migrateLegacyState, mergeProgress, normalizeAnswer, parseLexicon, goalFor, weightedSample, shuffle, chooseDictationReviews, chooseSunday, chooseBooster };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.WordCore;
})(typeof window !== 'undefined' ? window : globalThis);
