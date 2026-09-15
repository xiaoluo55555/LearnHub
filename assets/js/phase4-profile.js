/* Phase 4-2: profile page - identity, stats, vocabulary chart, activity heatmap. */
(function () {
  "use strict";

  var CHART_DAYS = 30;
  var HEAT_WEEKS = 12;
  var MAX_AVATAR_BYTES = 2 * 1024 * 1024;
  var ROW_LIMIT = 5000;

  var lastUser = null;
  var avatarStamp = 0;

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function dateKey(date) {
    return String(date.getFullYear()) + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function todayKey() {
    return dateKey(new Date());
  }

  function shiftKey(key, delta) {
    var parts = String(key).split("-");
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    date.setDate(date.getDate() + delta);
    return dateKey(date);
  }

  function monthDay(key) {
    var parts = String(key).split("-");
    return Number(parts[1]) + "\u6708" + Number(parts[2]) + "\u65E5";
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function text(id, value) {
    var node = byId(id);
    if (node) node.textContent = value;
  }

  function isVisible() {
    var view = byId("view-profile");
    return Boolean(view && view.classList.contains("active"));
  }

  async function getClient() {
    try {
      if (window.LearnHubPhase2 && typeof window.LearnHubPhase2.getCloudClient === "function") {
        return await window.LearnHubPhase2.getCloudClient();
      }
    } catch (error) {
      console.error("profile getCloudClient failed", error);
    }
    return null;
  }

  async function getUser(client) {
    try {
      var result = await client.auth.getUser();
      return (result && result.data && result.data.user) || null;
    } catch (error) {
      return null;
    }
  }

  function accountName(user) {
    if (!user) return "";
    var meta = user.user_metadata || {};
    var raw = meta.full_name || meta.name || meta.display_name || meta.nickname;
    if (raw && String(raw).trim()) return String(raw).trim();
    return String(user.email || user.id || "").split("@")[0];
  }

  function initialsOf(name) {
    var value = String(name || "").trim();
    if (!value) return "U";
    var parts = value.split(/[\s._\-]+/).filter(Boolean);
    if (parts.length > 1) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    return value.slice(0, 2).toUpperCase();
  }

  function softColor(seed) {
    var hash = 0;
    var value = String(seed || "learnhub");
    for (var i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) % 360;
    return "hsl(" + hash + ",42%,58%)";
  }

  function fallbackVocabulary() {
    var total = (window.LearnHubPhase1 && Number(window.LearnHubPhase1.TOTAL_WORDS)) || 0;
    return total ? Math.round(total * 0.5) : 0;
  }

  function localStartIso(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).toISOString();
  }

  function levelColor(count) {
    if (!count) return "#ebedf0";
    if (count <= 5) return "#9be9a8";
    if (count <= 15) return "#40c463";
    if (count <= 30) return "#30a14e";
    return "#216e39";
  }

  function avatarPublicUrl(client, row) {
    var raw = row && row.avatar_url ? String(row.avatar_url) : "";
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    try {
      var pub = client.storage.from("avatars").getPublicUrl(raw);
      return (pub && pub.data && pub.data.publicUrl) || "";
    } catch (error) {
      return "";
    }
  }

  async function loadProfileRow(client, userId) {
    var result = await client.from("user_profile").select("vocabulary_size,avatar_url").eq("user_id", userId).maybeSingle();
    if (result && result.error) return null;
    return (result && result.data) || null;
  }

  async function ensureProfileRow(client, userId) {
    var row = await loadProfileRow(client, userId);
    if (row) return row;
    var inserted = await client
      .from("user_profile")
      .insert({ user_id: userId, vocabulary_size: 0 })
      .select("vocabulary_size,avatar_url")
      .maybeSingle();
    if (inserted && inserted.data) return inserted.data;
    return { vocabulary_size: 0, avatar_url: "" };
  }

  /* Daily snapshot: on conflict (user_id, recorded_date) do update set vocabulary = excluded.vocabulary. */
  async function ensureTodaySnapshot(client, userId, vocabulary) {
    var key = todayKey();
    var value = Math.max(0, Math.round(Number(vocabulary) || 0));
    console.log("[vocab] snapshot upsert recorded_date=" + key + ", vocabulary=" + value);
    await client
      .from("user_vocabulary_history")
      .upsert([{ user_id: userId, vocabulary: value, recorded_date: key }], {
        onConflict: "user_id,recorded_date",
        ignoreDuplicates: false
      });
  }

  async function loadHistory(client, userId) {
    var start = shiftKey(todayKey(), -(CHART_DAYS - 1));
    var result = await client
      .from("user_vocabulary_history")
      .select("vocabulary,recorded_date")
      .eq("user_id", userId)
      .gte("recorded_date", start)
      .order("recorded_date", { ascending: true })
      .limit(CHART_DAYS + 10);
    if (result && result.error) return [];
    return ((result && result.data) || []).map(function (row) {
      return { date: String(row.recorded_date).slice(0, 10), value: Number(row.vocabulary) || 0 };
    });
  }

  async function countRows(client, table, userId) {
    var result = await client.from(table).select("user_id", { count: "exact", head: true }).eq("user_id", userId);
    return result && !result.error ? Number(result.count || 0) : 0;
  }

  async function loadStreak(client, userId) {
    var result = await client
      .from("user_checkin")
      .select("checkin_date")
      .eq("user_id", userId)
      .order("checkin_date", { ascending: false })
      .limit(400);
    var keys = (((result && result.data) || [])).map(function (row) {
      return String(row.checkin_date).slice(0, 10);
    });
    if (window.LearnHubPhase4 && typeof window.LearnHubPhase4.computeStats === "function") {
      return window.LearnHubPhase4.computeStats(keys).current;
    }
    var set = {};
    keys.forEach(function (key) {
      set[key] = true;
    });
    var cursor = todayKey();
    if (!set[cursor]) cursor = shiftKey(cursor, -1);
    var streak = 0;
    while (set[cursor]) {
      streak += 1;
      cursor = shiftKey(cursor, -1);
    }
    return streak;
  }

  async function loadActivity(client, userId) {
    var today = new Date();
    var lastSunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    var firstSunday = new Date(lastSunday.getFullYear(), lastSunday.getMonth(), lastSunday.getDate() - 7 * (HEAT_WEEKS - 1));
    var since = localStartIso(firstSunday);
    var map = {};
    function absorb(rows, column) {
      (rows || []).forEach(function (row) {
        var iso = row && row[column];
        if (!iso) return;
        var key = dateKey(new Date(iso));
        map[key] = (map[key] || 0) + 1;
      });
    }
    var wordStates = await client
      .from("user_word_state")
      .select("updated_at")
      .eq("user_id", userId)
      .gte("updated_at", since)
      .limit(ROW_LIMIT);
    if (!wordStates.error) absorb(wordStates.data, "updated_at");
    var answers = await client
      .from("answer_records")
      .select("created_at")
      .eq("user_id", userId)
      .gte("created_at", since)
      .limit(ROW_LIMIT);
    if (!answers.error) absorb(answers.data, "created_at");
    return { map: map, firstSunday: firstSunday, today: today };
  }

  function showGuest() {
    var guest = byId("profileGuest");
    var card = byId("profileCard");
    if (guest) guest.hidden = false;
    if (card) card.hidden = true;
  }

  function showBody() {
    var guest = byId("profileGuest");
    var card = byId("profileCard");
    if (guest) guest.hidden = true;
    if (card) card.hidden = false;
  }

  function bust(url) {
    if (!url || !avatarStamp) return url;
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + "t=" + avatarStamp;
  }

  function paintIdentity(user, url) {
    var name = accountName(user);
    var host = byId("profileAvatar");
    if (host) {
      if (url) {
        host.innerHTML = '<img src="' + escapeHtml(bust(url)) + '" alt="">';
      } else if (user) {
        host.innerHTML =
          '<span class="avatar-initials" style="background:' + softColor(name || "u") + '">' +
          escapeHtml(initialsOf(name)) +
          "</span>";
      } else {
        host.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8.6" r="3.6"/><path d="M4.8 20c.9-3.7 3.8-5.7 7.2-5.7s6.3 2 7.2 5.7"/></svg>';
      }
    }
    text("profileName", name || "\u2014");
    text("profileEmail", user ? user.email || user.id : "");
  }

  function renderStats(words, answers, streak) {
    text("profileStatWords", String(words));
    text("profileStatAnswers", String(answers));
    text("profileStatStreak", String(streak));
  }

  function buildSeries(points) {
    var map = {};
    points.forEach(function (point) {
      map[point.date] = point.value;
    });
    var start = shiftKey(todayKey(), -(CHART_DAYS - 1));
    var carry = null;
    for (var i = 0; i < CHART_DAYS; i += 1) {
      if (map.hasOwnProperty(shiftKey(start, i))) {
        carry = map[shiftKey(start, i)];
        break;
      }
    }
    var series = [];
    for (var day = 0; day < CHART_DAYS; day += 1) {
      var key = shiftKey(start, day);
      if (map.hasOwnProperty(key)) carry = map[key];
      series.push({ key: key, value: carry === null ? 0 : carry, hit: map.hasOwnProperty(key) });
    }
    return series;
  }

  function renderChart(points, vocabulary) {
    var host = byId("profileChart");
    if (!host) return;
    var info = (vocabulary && typeof vocabulary === "object") ? vocabulary : vocabInfo(Number(vocabulary) || 0, 0);
    text("profileVocabValue", vocabFormat(info.display));
    text("profileVocabRange", "\u7EA6 " + vocabFormat(info.low) + " ~ " + vocabFormat(info.high));
    var series = buildSeries(points);
    if (!series.length) {
      host.innerHTML = '<div class="profile-chart-empty">\u6682\u65E0\u6570\u636E</div>';
      return;
    }
    var W = 760;
    var H = 210;
    var PL = 52;
    var PR = 14;
    var PT = 16;
    var PB = 30;
    var innerW = W - PL - PR;
    var innerH = H - PT - PB;
    var values = series.map(function (point) {
      return point.value;
    });
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    if (max - min < 1) {
      var pad = Math.max(20, Math.round(max * 0.05) || 20);
      min = Math.max(0, min - pad);
      max = max + pad;
    }
    var span = max - min || 1;
    function xAt(index) {
      return PL + (series.length <= 1 ? innerW / 2 : (innerW * index) / (series.length - 1));
    }
    function yAt(value) {
      return PT + innerH - ((value - min) / span) * innerH;
    }
    var svg = [];
    svg.push('<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="vocabulary trend">');
    [min, (min + max) / 2, max].forEach(function (tick) {
      var y = yAt(tick);
      svg.push('<line x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + y.toFixed(1) + '" stroke="#F0F0F2" stroke-width="1"/>');
      svg.push('<text x="' + (PL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#A1A1A6">' + String(Math.round(tick)) + "</text>");
    });
    var coords = series.map(function (point, index) {
      return xAt(index).toFixed(1) + "," + yAt(point.value).toFixed(1);
    });
    svg.push('<polyline points="' + coords.join(" ") + '" fill="none" stroke="#0071E3" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
    series.forEach(function (point, index) {
      if (!point.hit) return;
      svg.push('<circle cx="' + xAt(index).toFixed(1) + '" cy="' + yAt(point.value).toFixed(1) + '" r="3.2" fill="#0071E3" stroke="#FFFFFF" stroke-width="1.5"/>');
    });
    svg.push('<text x="' + PL + '" y="' + (H - 8) + '" font-size="11" fill="#A1A1A6">' + monthDay(series[0].key) + "</text>");
    svg.push('<text x="' + (W - PR) + '" y="' + (H - 8) + '" text-anchor="end" font-size="11" fill="#A1A1A6">' + monthDay(series[series.length - 1].key) + "</text>");
    svg.push("</svg>");
    host.innerHTML = svg.join("");
  }

  function renderHeatmap(activity) {
    var host = byId("profileHeatmap");
    if (!host) return;
    var map = (activity && activity.map) || {};
    var firstSunday = (activity && activity.firstSunday) || new Date();
    var today = (activity && activity.today) || new Date();
    var cells = [];
    var total = 0;
    for (var week = 0; week < HEAT_WEEKS; week += 1) {
      for (var day = 0; day < 7; day += 1) {
        var current = new Date(firstSunday.getFullYear(), firstSunday.getMonth(), firstSunday.getDate() + week * 7 + day);
        if (current > today) {
          cells.push('<span class="profile-heatmap-cell blank"></span>');
          continue;
        }
        var key = dateKey(current);
        var count = map[key] || 0;
        total += count;
        cells.push(
          '<span class="profile-heatmap-cell" style="background:' + levelColor(count) + '" title="' +
            monthDay(key) + " \u00B7 " + String(count) + " \u6B21\u5B66\u4E60" + '"></span>'
        );
      }
    }
    host.innerHTML = cells.join("");
    text("profileHeatmapMeta", "\u6700\u8FD1 12 \u5468\u5171 " + String(total) + " \u6B21\u5B66\u4E60");
  }

  function openNameModal() {
    var modal = byId("profileNameModal");
    var input = byId("profileNameInput");
    if (input) input.value = accountName(lastUser);
    if (modal) modal.hidden = false;
    if (input) {
      input.focus();
      input.select();
    }
  }

  function closeNameModal() {
    var modal = byId("profileNameModal");
    if (modal) modal.hidden = true;
  }

  async function saveName() {
    var input = byId("profileNameInput");
    var value = (input && input.value ? input.value : "").trim();
    if (!value) {
      toast("\u8BF7\u8F93\u5165\u7528\u6237\u540D");
      return;
    }
    var client = await getClient();
    var user = client ? await getUser(client) : null;
    if (!client || !user) return;
    var result = await client.auth.updateUser({ data: { full_name: value } });
    if (result && result.error) {
      toast("\u4FDD\u5B58\u5931\u8D25");
      return;
    }
    closeNameModal();
    toast("\u4FDD\u5B58\u6210\u529F");
    if (window.LearnHubAccountMenu && window.LearnHubAccountMenu.refresh) window.LearnHubAccountMenu.refresh();
    render();
  }

  async function uploadAvatar(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png)$/i.test(file.type)) {
      toast("\u4EC5\u652F\u6301 JPG / PNG \u56FE\u7247");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast("\u56FE\u7247\u4E0D\u80FD\u8D85\u8FC7 2MB");
      return;
    }
    var client = await getClient();
    var user = client ? await getUser(client) : null;
    if (!client || !user) {
      console.warn("[avatar] skipped: no signed-in user");
      return;
    }
    console.log("[avatar] user " + user.id + " upload " + file.type + " " + file.size + "B");
    var path = user.id + "/avatar.jpg";
    var uploaded = await client.storage.from("avatars").upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg",
      cacheControl: "3600"
    });
    console.log("[avatar] upload result", uploaded && uploaded.error ? uploaded.error : "ok");
    if (uploaded && uploaded.error) {
      toast("\u5934\u50CF\u4E0A\u4F20\u5931\u8D25");
      return;
    }
    var publicUrl = client.storage.from("avatars").getPublicUrl(path);
    var url = (publicUrl && publicUrl.data && publicUrl.data.publicUrl) || path;
    var saved = await client.from("user_profile").upsert({ user_id: user.id, avatar_url: url }, { onConflict: "user_id" });
    if (saved && saved.error) {
      toast("\u5934\u50CF\u4E0A\u4F20\u5931\u8D25");
      return;
    }
    avatarStamp = Date.now();
    toast("\u5934\u50CF\u5DF2\u66F4\u65B0");
    if (window.LearnHubAccountMenu && window.LearnHubAccountMenu.clearAvatarCache) window.LearnHubAccountMenu.clearAvatarCache();
    if (window.LearnHubAccountMenu && window.LearnHubAccountMenu.refresh) window.LearnHubAccountMenu.refresh();
    render();
  }

  async function render() {
    try {
      var client = await getClient();
      var user = client ? await getUser(client) : null;
      if (!client || !user) {
        lastUser = null;
        showGuest();
        return;
      }
      lastUser = user;
      showBody();
      var row = await ensureProfileRow(client, user.id);
      var stored = Number(row && row.vocabulary_size) || 0;
      var vocabulary = stored > 0 ? stored : fallbackVocabulary();
      var results = await Promise.all([
        loadHistory(client, user.id),
        countRows(client, "user_word_state", user.id),
        countRows(client, "answer_records", user.id),
        loadStreak(client, user.id),
        loadActivity(client, user.id),
        vocabLearned(client, user.id)
      ]);
      var vocabNow = vocabInfo(vocabulary, results[5]);
      vocabCache.info = vocabNow;
      vocabCache.at = Date.now();
      await ensureTodaySnapshot(client, user.id, vocabNow.display);
      vocabCache.snapshot = vocabNow.display;
      paintIdentity(user, avatarPublicUrl(client, row));
      renderStats(results[1], results[2], results[3]);
      renderChart(results[0], vocabNow);
      renderHeatmap(results[4]);
      vocabApply(vocabNow, null);
    } catch (error) {
      console.error("profile render failed", error);
    }
  }

  function bind() {
    var avatarButton = byId("profileAvatarButton");
    if (avatarButton) {
      avatarButton.addEventListener("click", function () {
        var picker = byId("profileAvatarFile");
        if (picker) picker.click();
      });
    }
    var picker = byId("profileAvatarFile");
    if (picker) {
      picker.addEventListener("change", function (event) {
        var files = event.target.files;
        var file = files && files[0];
        if (file) uploadAvatar(file);
        event.target.value = "";
      });
    }
    var nameButton = byId("profileNameButton");
    if (nameButton) nameButton.addEventListener("click", openNameModal);
    var save = byId("saveProfileName");
    if (save) save.addEventListener("click", saveName);
    var cancel = byId("cancelProfileName");
    if (cancel) cancel.addEventListener("click", closeNameModal);
    var close = byId("closeProfileName");
    if (close) close.addEventListener("click", closeNameModal);
    var modal = byId("profileNameModal");
    if (modal) {
      modal.addEventListener("click", function (event) {
        if (event.target === modal) closeNameModal();
      });
    }
    var input = byId("profileNameInput");
    if (input) {
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          saveName();
        }
        if (event.key === "Escape") closeNameModal();
      });
    }
    var login = byId("profileLoginButton");
    if (login) {
      login.addEventListener("click", function () {
        var authModal = byId("authModal");
        if (authModal) authModal.hidden = false;
      });
    }
  }

  function route() {
    if (location.hash !== "#/profile") return;
    if (typeof window.go === "function") window.go("profile");
    else render();
  }

  function ready() {
    bind();
    route();
    getClient().then(function (client) {
      if (!client || !client.auth || typeof client.auth.onAuthStateChange !== "function") return;
      client.auth.onAuthStateChange(function () {
        if (isVisible()) render();
      });
    });
  }

  window.addEventListener("hashchange", route);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();

  /* ---- Plan C vocabulary estimate: base + verified learning, one small daily drift ---- */
  var VOCAB_LEARN_WEIGHT = 0.9;
  var VOCAB_LEARNED_BAR = 20;
  var VOCAB_JITTER = 30;
  var VOCAB_BAND = 0.015;
  var VOCAB_CACHE_MS = 15000;

  var vocabCache = { info: null, at: 0, snapshot: null };
  var vocabTimer = null;

  function vocabDrift(now) {
    return Math.sin(Math.floor((now || Date.now()) / 86400000)) * VOCAB_JITTER;
  }

  function vocabInfo(base, learned, now) {
    var b = Number(base) || 0;
    var l = Math.max(0, Number(learned) || 0);
    var raw = b + l * VOCAB_LEARN_WEIGHT;
    var display = Math.max(0, Math.round(raw + vocabDrift(now)));
    return {
      base: b,
      learned: l,
      raw: raw,
      display: display,
      low: Math.round(display * (1 - VOCAB_BAND)),
      high: Math.round(display * (1 + VOCAB_BAND))
    };
  }

  function vocabFormat(value) {
    return Number(value || 0).toLocaleString("en-US");
  }

  async function vocabBase(client, userId) {
    var row = await loadProfileRow(client, userId);
    var stored = Number(row && row.vocabulary_size) || 0;
    if (stored > 0) return stored;
    return 0;
  }

  async function vocabLearned(client, userId) {
    var result = await client
      .from("user_word_state")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("state", "review")
      .gte("mastery", VOCAB_LEARNED_BAR);
    return result && !result.error ? Number(result.count || 0) : 0;
  }

  async function vocabResolve() {
    var client = await getClient();
    var user = client ? await getUser(client) : null;
    return { client: client, user: user };
  }

  function vocabApply(info, apply) {
    if (typeof apply === "function") { apply(info); return; }
    if (window.LearnHubHeroVocab && typeof window.LearnHubHeroVocab.render === "function") window.LearnHubHeroVocab.render(info);
  }

  window.LearnHubVocab = {
    format: vocabFormat,
    info: vocabInfo,
    get: function () { return vocabCache.info; },
    invalidate: function () { vocabCache.at = 0; },
    compute: async function (options) {
      var opts = options || {};
      var pair = await vocabResolve();
      if (pair.client && pair.user) {
        var parts = await Promise.all([vocabBase(pair.client, pair.user.id), vocabLearned(pair.client, pair.user.id)]);
        return vocabInfo(parts[0], parts[1]);
      }
      return vocabInfo(0, opts.localLearned);
    },
    refresh: async function (options) {
      var opts = options || {};
      var now = Date.now();
      var cached = vocabCache.info && now - vocabCache.at < VOCAB_CACHE_MS && !opts.force;
      var info = cached ? vocabCache.info : null;
      var pair = null;
      if (!info) {
        pair = await vocabResolve();
        if (pair.client && pair.user) {
          var parts = await Promise.all([vocabBase(pair.client, pair.user.id), vocabLearned(pair.client, pair.user.id)]);
          info = vocabInfo(parts[0], parts[1]);
        } else {
          info = vocabInfo(0, opts.localLearned);
        }
        vocabCache.info = info;
        vocabCache.at = now;
        console.log("[vocab] recompute base=" + info.base + ", learned=" + info.learned + ", display=" + info.display + ", band=" + info.low + "~" + info.high + (pair && pair.user ? "" : " (local)"));
      }
      if (opts.persist !== false && info && info.display !== vocabCache.snapshot) {
        if (!pair) pair = await vocabResolve();
        if (pair.client && pair.user) {
          try {
            await ensureTodaySnapshot(pair.client, pair.user.id, info.display);
            vocabCache.snapshot = info.display;
          } catch (error) {
            console.warn("[vocab] snapshot failed", error && error.message);
          }
        }
      }
      vocabApply(info, opts.apply);
      return info;
    },
    scheduleSnapshot: function (delay) {
      var wait = Number(delay);
      if (!(wait >= 0)) wait = 3000;
      if (vocabTimer) clearTimeout(vocabTimer);
      vocabTimer = setTimeout(function () {
        vocabTimer = null;
        console.log("[vocab] debounced snapshot fires");
        window.LearnHubVocab.refresh({ force: true });
      }, wait);
      console.log("[vocab] snapshot scheduled in " + Math.round(wait / 1000) + "s");
    },
    flushSnapshot: function (options) {
      var opts = options || {};
      if (vocabTimer) { clearTimeout(vocabTimer); vocabTimer = null; }
      return window.LearnHubVocab.refresh({ force: true, persist: true, apply: opts.apply || null });
    }
  };

  window.LearnHubProfile = {
    render: render,
    openNameModal: openNameModal,
    isVisible: isVisible
  };
})();
