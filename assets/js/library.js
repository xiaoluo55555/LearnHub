/* LearnHub — vocabulary library loader (phase 4-4)
   Externalizes the 19k word list, caches it, and notifies the app when it is ready. */
(function () {
  var DATA_URL = 'assets/data/library-words.json';
  var CACHE_KEY = 'learnhub.library.words.v1';
  var SLOW_MS = 5000;
  var GLOBAL_KEY = 'LIBRARY_WORDS';

  var words = (window[GLOBAL_KEY] = Array.isArray(window[GLOBAL_KEY]) ? window[GLOBAL_KEY] : []);
  var state = { status: 'idle', slow: false, error: '', count: 0, fromCache: false, ms: 0 };
  var listeners = [];
  var inflight = null;
  var slowTimer = null;

  function snapshot() {
    return { status: state.status, slow: state.slow, error: state.error, count: words.length, fromCache: state.fromCache, ms: state.ms };
  }
  function emit() {
    var detail = snapshot();
    listeners.slice().forEach(function (fn) {
      try { fn(detail); } catch (error) { console.error('[library] listener failed', error); }
    });
    try { window.dispatchEvent(new CustomEvent('library:status', { detail: detail })); } catch (error) {}
  }
  function normalize(list) {
    return (Array.isArray(list) ? list : []).map(function (raw) {
      var item = raw || {};
      var tags = Array.isArray(item.tags) ? item.tags : [];
      tags = tags.map(function (tag) { return String(tag || '').trim(); }).filter(function (tag) { return !!tag; });
      var level = String(item.level || '').trim();
      if (level && tags.indexOf(level) < 0) tags.push(level);
      return {
        id: String(item.id || level + '-' + item.word),
        word: String(item.word || ''),
        phonetic: String(item.phonetic || ''),
        pos: String(item.pos || 'word'),
        meaning: String(item.meaning || ''),
        level: level,
        tags: tags,
        example: String(item.example || ''),
        exampleZh: String(item.exampleZh || '')
      };
    }).filter(function (item) { return !!item.word; });
  }
  function readCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length ? parsed : null;
    } catch (error) { return null; }
  }
  function writeCache(list) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(list)); return true; }
    catch (error) { console.warn('[library] session cache skipped (quota)', error && error.name); return false; }
  }
  function clearCache() { try { sessionStorage.removeItem(CACHE_KEY); } catch (error) {} }
  function fetchWords() {
    return fetch(DATA_URL, { cache: 'force-cache' }).then(function (response) {
      if (!response || !response.ok) throw new Error('HTTP ' + (response ? response.status : '0'));
      return response.json();
    });
  }
  function apply(list, fromCache, startedAt) {
    words.splice.apply(words, [0, words.length].concat(list));
    state.status = 'ready';
    state.slow = false;
    state.error = '';
    state.fromCache = !!fromCache;
    state.ms = Math.round(Date.now() - startedAt);
    clearTimeout(slowTimer);
    emit();
    return words;
  }
  function load(force) {
    if (state.status === 'loading') return inflight;
    if (state.status === 'ready' && !force) return Promise.resolve(words);
    var startedAt = Date.now();
    state.status = 'loading';
    state.slow = false;
    state.error = '';
    emit();
    clearTimeout(slowTimer);
    slowTimer = setTimeout(function () {
      if (state.status !== 'loading') return;
      state.slow = true;
      emit();
    }, SLOW_MS);
    if (force) clearCache();
    var cached = force ? null : readCache();
    inflight = (cached ? Promise.resolve({ list: cached, cached: true }) : fetchWords().then(function (raw) {
      return { list: raw, cached: false };
    })).then(function (pack) {
      var list = normalize(pack.list);
      if (!list.length) throw new Error('empty payload');
      if (!pack.cached) writeCache(list);
      return apply(list, pack.cached, startedAt);
    }).catch(function (error) {
      state.status = 'error';
      state.slow = false;
      state.error = String((error && error.message) || error || 'load failed');
      clearTimeout(slowTimer);
      console.error('[library] ' + DATA_URL + ' load failed: ' + state.error + (location.protocol === 'file:' ? ' (file:// cannot fetch JSON — serve over http)' : ''));
      emit();
      throw error;
    });
    return inflight;
  }

  window.LibraryData = {
    url: DATA_URL,
    getWords: function () { return words; },
    status: function () { return snapshot(); },
    ready: function () { return state.status === 'ready' ? Promise.resolve(words) : (state.status === 'error' ? Promise.reject(new Error(state.error)) : (inflight || load(false))); },
    onStatus: function (fn) { if (typeof fn === 'function') { listeners.push(fn); fn(snapshot()); } return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    reload: function () { state.status = 'idle'; inflight = null; clearCache(); return load(true); }
  };

  load(false).catch(function () { /* status is surfaced through onStatus; avoid an unhandled rejection */ });
})();
