/* Phase 4-1: cloud check-in, streaks and badges. */
(function () {
  "use strict";

  var TABLE = "user_checkin";
  var MIN_INTERVAL = 20000;
  var ROW_LIMIT = 1000;

  var badges = [
    { days: 3, icon: "\uD83C\uDF31", name: "3 \u5929\u65B0\u82BD", cond: "\u8FDE\u7EED\u6253\u5361 3 \u5929" },
    { days: 7, icon: "\uD83C\uDF3F", name: "7 \u5929\u5165\u95E8", cond: "\u8FDE\u7EED\u6253\u5361 7 \u5929" },
    { days: 10, icon: "\u2B50", name: "10 \u5929\u4E60\u60EF", cond: "\u8FDE\u7EED\u6253\u5361 10 \u5929" },
    { days: 15, icon: "\uD83D\uDD25", name: "15 \u5929\u575A\u6301", cond: "\u8FDE\u7EED\u6253\u5361 15 \u5929" },
    { days: 30, icon: "\uD83C\uDFC6", name: "30 \u5929\u8FBE\u4EBA", cond: "\u8FDE\u7EED\u6253\u5361 30 \u5929" }
  ];

  var clientRef = null;
  var cachedUser = null;
  var cachedKeys = [];
  var cachedStats = { total: 0, current: 0, best: 0 };
  var lastCheckAt = 0;
  var inflight = null;
  var monthCursor = new Date();
  var authBound = false;

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

  function startOfLocalDayIso() {
    var date = new Date();
    date.setHours(0, 0, 0, 0);
    return date.toISOString();
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function text(id, value) {
    var node = byId(id);
    if (node) node.textContent = value;
  }

  async function getClient() {
    if (clientRef) return clientRef;
    try {
      if (window.LearnHubPhase2 && typeof window.LearnHubPhase2.getCloudClient === "function") {
        clientRef = await window.LearnHubPhase2.getCloudClient();
        return clientRef;
      }
    } catch (error) {
      console.error("phase4 getCloudClient failed", error);
    }
    return null;
  }

  async function currentUser(client) {
    if (cachedUser) return cachedUser;
    try {
      var result = await client.auth.getUser();
      cachedUser = (result && result.data && result.data.user) || null;
    } catch (error) {
      cachedUser = null;
    }
    return cachedUser;
  }

  function computeStats(keys) {
    var set = {};
    keys.forEach(function (key) {
      set[key] = true;
    });
    var total = Object.keys(set).length;
    var cursor = todayKey();
    if (!set[cursor]) cursor = shiftKey(cursor, -1);
    var current = 0;
    while (set[cursor]) {
      current += 1;
      cursor = shiftKey(cursor, -1);
    }
    var sorted = Object.keys(set).sort();
    var best = 0;
    var run = 0;
    var previous = "";
    sorted.forEach(function (key) {
      if (previous && shiftKey(previous, 1) === key) run += 1;
      else run = 1;
      if (run > best) best = run;
      previous = key;
    });
    return { total: total, current: current, best: best };
  }

  function hasActivityToday(client, userId) {
    var since = startOfLocalDayIso();
    function countRows(table, column) {
      return client
        .from(table)
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte(column, since)
        .then(
          function (result) {
            return result.error ? 0 : Number(result.count || 0);
          },
          function () {
            return 0;
          }
        );
    }
    return Promise.all([
      countRows("user_word_state", "updated_at"),
      countRows("answer_records", "created_at"),
      countRows("memory_bank", "created_at")
    ]).then(function (counts) {
      return counts[0] + counts[1] + counts[2] > 0;
    });
  }

  async function loadRows(client, userId) {
    var result = await client
      .from(TABLE)
      .select("checkin_date")
      .eq("user_id", userId)
      .order("checkin_date", { ascending: false })
      .limit(ROW_LIMIT);
    if (result.error) throw result.error;
    cachedKeys = (result.data || []).map(function (row) {
      return String(row.checkin_date).slice(0, 10);
    });
    cachedStats = computeStats(cachedKeys);
    return cachedKeys;
  }

  async function checkAndCheckin(options) {
    var force = Boolean(options && options.force);
    if (inflight) return inflight;
    inflight = (async function () {
      try {
        var now = Date.now();
        if (!force && now - lastCheckAt < MIN_INTERVAL) {
          return { checked: cachedKeys.indexOf(todayKey()) >= 0, created: false, skipped: true };
        }
        lastCheckAt = now;
        var client = await getClient();
        if (!client) return null;
        var user = await currentUser(client);
        if (!user) return null;
        var key = todayKey();
        var existing = await client
          .from(TABLE)
          .select("checkin_date")
          .eq("user_id", user.id)
          .eq("checkin_date", key)
          .maybeSingle();
        if (!existing.error && existing.data) {
          await loadRows(client, user.id);
          renderCheckinPage();
          return { checked: true, created: false };
        }
        var active = await hasActivityToday(client, user.id);
        if (!active) {
          await loadRows(client, user.id);
          renderCheckinPage();
          return { checked: false, created: false };
        }
        var inserted = await client
          .from(TABLE)
          .upsert([{ user_id: user.id, checkin_date: key }], {
            onConflict: "user_id,checkin_date",
            ignoreDuplicates: true
          });
        if (inserted.error && inserted.error.code !== "23505") {
          console.error("phase4 checkin insert failed", inserted.error);
        }
        await loadRows(client, user.id);
        renderCheckinPage();
        return { checked: true, created: !inserted.error };
      } catch (error) {
        console.error("checkAndCheckin failed", error);
        return null;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  function renderTodayBanner(signedIn, checked) {
    var node = byId("checkinToday");
    if (!node) return;
    if (!signedIn) {
      node.className = "checkin-today pending";
      node.textContent = "\u8BF7\u5148\u767B\u5F55\u540C\u6B65";
      return;
    }
    node.className = "checkin-today " + (checked ? "done" : "pending");
    node.textContent = checked ? "\u4ECA\u65E5\u5DF2\u6253\u5361 \u2713" : "\u4ECA\u5929\u8FD8\u6CA1\u6709\u5B66\u4E60\u54E6";
  }

  function renderBadges(stats) {
    var host = byId("badgeWall");
    if (!host) return;
    var unlockedCount = 0;
    host.innerHTML = badges
      .map(function (badge) {
        var unlocked = stats.best >= badge.days;
        if (unlocked) unlockedCount += 1;
        return (
          "<div class=\"badge-item" + (unlocked ? " unlocked" : "") + "\">" +
          "<span class=\"badge-icon\">" + badge.icon + "</span>" +
          "<span class=\"badge-name\">" + badge.name + "</span>" +
          "<span class=\"badge-cond\">" + badge.cond + "</span>" +
          "</div>"
        );
      })
      .join("");
    text("badgeProgress", "\u5DF2\u89E3\u9501 " + String(unlockedCount) + "/" + String(badges.length));
  }

  function renderLast30(stats) {
    var host = byId("checkin30Grid");
    if (!host) return;
    var set = {};
    cachedKeys.forEach(function (key) {
      set[key] = true;
    });
    var today = todayKey();
    var weekdays = ["\u65E5", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D"];
    var html = weekdays
      .map(function (label) {
        return "<span class=\"checkin-30d-weekday\">" + label + "</span>";
      })
      .join("");
    var done = 0;
    for (var offset = 29; offset >= 0; offset -= 1) {
      var key = shiftKey(today, -offset);
      var hit = Boolean(set[key]);
      if (hit) done += 1;
      var classes = ["checkin-30d-cell"];
      if (hit) classes.push("done");
      if (key === today) classes.push("today");
      html +=
        "<span class=\"" + classes.join(" ") + "\" title=\"" + key + "\">" +
        (hit ? "\u2713" : String(Number(key.slice(8, 10)))) +
        "</span>";
    }
    host.innerHTML = html;
    text("checkin30Meta", "\u6700\u8FD1 30 \u5929\u6253\u5361 " + String(done) + " \u5929");
  }

  function renderMonthGrid() {
    var host = byId("calendarGrid");
    if (!host) return;
    var year = monthCursor.getFullYear();
    var month = monthCursor.getMonth();
    var first = new Date(year, month, 1);
    var lastDay = new Date(year, month + 1, 0).getDate();
    var lead = first.getDay();
    var set = {};
    cachedKeys.forEach(function (key) {
      set[key] = true;
    });
    var weekdays = ["\u65E5", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D"];
    var html = weekdays
      .map(function (label) {
        return "<div class=\"weekday\">" + label + "</div>";
      })
      .join("");
    var index;
    for (index = 0; index < lead; index += 1) html += "<div class=\"day muted\"></div>";
    var monthCount = 0;
    var today = todayKey();
    for (index = 1; index <= lastDay; index += 1) {
      var key = dateKey(new Date(year, month, index));
      var checked = Boolean(set[key]);
      if (checked) monthCount += 1;
      html +=
        "<div class=\"day" + (checked ? " checked" : "") + (key === today ? " today" : "") +
        "\" data-date=\"" + key + "\">" + String(index) + "</div>";
    }
    host.innerHTML = html;
    text("calendarTitle", String(year) + " \u5E74 " + String(month + 1) + " \u6708");
    text("monthDays", String(monthCount));
  }

  function renderSummary(signedIn, stats) {
    if (!signedIn) return;
    text("bigStreak", String(stats.current));
    text("bestStreak", String(stats.best));
    text("totalDays", String(stats.total));
    var quote = byId("streakQuote");
    if (quote) {
      quote.textContent = stats.current >= 7
        ? "\u7A33\u5B9A\u6B63\u5728\u6210\u4E3A\u4F60\u7684\u80FD\u529B\u3002\u4FDD\u6301\u8FD9\u4E2A\u8282\u594F\u3002"
        : stats.current
          ? "\u6BCF\u4E00\u6B21\u51FA\u73B0\uFF0C\u90FD\u4F1A\u8BA9\u4E60\u60EF\u66F4\u7262\u56FA\u3002"
          : "\u4ECE\u4ECA\u5929\u5F00\u59CB\uFF0C\u5EFA\u7ACB\u4F60\u7684\u5B66\u4E60\u8282\u594F\u3002";
    }
  }

  function renderSignedOut() {
    renderTodayBanner(false, false);
    renderBadges({ total: 0, current: 0, best: 0 });
    renderLast30({ total: 0, current: 0, best: 0 });
    text("checkin30Meta", "\u767B\u5F55\u540E\u663E\u793A\u4E91\u7AEF\u6253\u5361\u8BB0\u5F55");
  }

  async function renderCheckinPage() {
    try {
      var client = await getClient();
      if (!client) {
        renderSignedOut();
        return;
      }
      var user = await currentUser(client);
      if (!user) {
        renderSignedOut();
        return;
      }
      await loadRows(client, user.id);
      var checked = cachedKeys.indexOf(todayKey()) >= 0;
      renderTodayBanner(true, checked);
      renderSummary(true, cachedStats);
      renderBadges(cachedStats);
      renderLast30(cachedStats);
      renderMonthGrid();
    } catch (error) {
      console.error("renderCheckinPage failed", error);
      renderSignedOut();
    }
  }

  function bindAuthWatcher() {
    if (authBound) return;
    authBound = true;
    getClient().then(function (client) {
      if (!client || !client.auth || typeof client.auth.onAuthStateChange !== "function") return;
      client.auth.onAuthStateChange(function () {
        cachedUser = null;
        lastCheckAt = 0;
        cachedKeys = [];
        checkAndCheckin({ force: false });
      });
    });
  }

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== "function") return;
    if (target.closest("#checkinButton")) {
      checkAndCheckin({ force: true });
      return;
    }
    if (target.closest("#prevMonth") || target.closest("#nextMonth")) {
      var step = target.closest("#prevMonth") ? -1 : 1;
      setTimeout(function () {
        monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + step, 1);
        if (cachedUser) renderMonthGrid();
      }, 0);
      return;
    }
    checkAndCheckin({ force: false });
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) checkAndCheckin({ force: false });
  });

  window.addEventListener("load", function () {
    bindAuthWatcher();
    checkAndCheckin({ force: false });
  });

  window.LearnHubPhase4 = {
    checkAndCheckin: checkAndCheckin,
    renderCheckinPage: renderCheckinPage,
    refresh: function () {
      return checkAndCheckin({ force: true });
    },
    getStats: function () {
      return { keys: cachedKeys.slice(), stats: cachedStats };
    },
    computeStats: computeStats
  };
})();
