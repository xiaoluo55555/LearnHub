(function () {
  "use strict";

  const DAY = 86400000;
  const TOTAL_WORDS = 19466;

  const LEVEL_SCORE = {
    "\u5fc5\u5907": 0.12,
    CET4: 0.28,
    Oxford: 0.45,
    Collins: 0.5,
    CET6: 0.46,
    "\u8003\u7814": 0.58,
    IELTS: 0.68,
    TOEFL: 0.74,
    GRE: 0.9
  };

  function scoreWord(word, index) {
    const tags = Array.isArray(word.tags)
      ? word.tags
      : [word.level];

    const level = Math.max(
      ...tags.map((x) => LEVEL_SCORE[x] ?? 0.5)
    );

    const frequency = Math.min(
      1,
      Math.max(
        0,
        Number(word.frequencyRank || index + 1) / TOTAL_WORDS
      )
    );

    return level * 0.72 + frequency * 0.28;
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  }

  /* ---- FSRS scheduling: ts-fsrs (window.FSRS UMD build) with official default weights ---- */
  const FSRS_RECENT_LIMIT = 10;
  const fsrsRecent = [];
  let fsrsSchedulerInstance = null;

  function fsrsLib() {
    return typeof window !== "undefined" && window.FSRS ? window.FSRS : null;
  }

  function fsrsScheduler() {
    const lib = fsrsLib();
    if (!lib || typeof lib.fsrs !== "function") return null;
    /* Long-term scheduling: (re)learning steps are skipped so a rating schedules a real day-based interval. */
    if (!fsrsSchedulerInstance) fsrsSchedulerInstance = lib.fsrs({ request_retention: 0.9, enable_short_term: false });
    return fsrsSchedulerInstance;
  }

  function fsrsRatingValue(grade) {
    const lib = fsrsLib();
    const value = Number(grade);
    if (!lib) return 3;
    if (value <= 0) return lib.Rating.Again;
    if (value === 1) return lib.Rating.Hard;
    return lib.Rating.Good;
  }

  function fsrsRatingName(grade) {
    const value = Number(grade);
    if (value <= 0) return "Again";
    if (value === 1) return "Hard";
    return "Good";
  }

  function fsrsStateValue(name) {
    if (name === "learning") return 1;
    if (name === "review") return 2;
    if (name === "relearning") return 3;
    return 0;
  }

  function fsrsStateName(value) {
    const v = Number(value);
    if (v === 1) return "learning";
    if (v === 2) return "review";
    if (v === 3) return "relearning";
    return "new";
  }

  function fsrsDate(value) {
    if (value === null || value === undefined || value === "") return null;
    const date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  function fsrsCount(record, keys) {
    if (!record) return 0;
    for (const key of keys) {
      const value = Number(record[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return 0;
  }

  function fsrsStamp(record) {
    if (!record) return null;
    const date = fsrsDate(record.next_review_at);
    if (date) return date.getTime();
    const fallback = Number(record.due);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
  }

  function fsrsLastStamp(record) {
    if (!record) return 0;
    const date = fsrsDate(record.last_review_at) || fsrsDate(record.last_reviewed_at);
    if (date) return date.getTime();
    const fallback = Number(record.last);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
  }

  function fsrsRound(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  function fsrsDayLabel(date) {
    const pad = (n) => (n < 10 ? "0" + n : String(n));
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function fsrsCardFromRecord(record) {
    const lib = fsrsLib();
    const now = new Date();
    if (!lib) return null;
    const card = lib.createEmptyCard(now);
    if (!record) return card;
    const stability = Number(record.stability);
    const difficulty = Number(record.difficulty);
    if (Number.isFinite(stability) && stability > 0) card.stability = stability;
    if (Number.isFinite(difficulty) && difficulty > 0) card.difficulty = difficulty;
    const due = fsrsStamp(record);
    if (due) card.due = new Date(due);
    const last = fsrsLastStamp(record);
    if (last) card.last_review = new Date(last);
    card.reps = fsrsCount(record, ["review_count", "reps"]);
    card.lapses = fsrsCount(record, ["wrong_count", "mistakes"]);
    const scheduled = Number(record.scheduled_days);
    card.scheduled_days = Number.isFinite(scheduled) && scheduled > 0 ? scheduled : 0;
    card.elapsed_days = last ? Math.max(0, Math.floor((now.getTime() - last) / DAY)) : 0;
    card.state = fsrsStateValue(record.state);
    if (card.state === 0 && card.reps > 0) card.state = 2;
    return card;
  }

  function fsrsThreeGrade(record, grade, wordLabel) {
    const lib = fsrsLib();
    const scheduler = fsrsScheduler();
    if (!lib || !scheduler) return sm2FallbackGrade(record, grade);
    const base = record || {};
    const now = new Date();
    const reviewed = scheduler.next(fsrsCardFromRecord(record), now, fsrsRatingValue(grade));
    const card = reviewed && reviewed.card ? reviewed.card : fsrsCardFromRecord(record);
    const due = fsrsDate(card.due) || now;
    const lastReview = fsrsDate(card.last_review) || now;
    const scheduledDays = Math.max(0, Math.round(Number(card.scheduled_days) || 0));
    const intervalDays = scheduledDays;
    const reps = fsrsCount(base, ["review_count", "reps"]) + 1;
    const correct = fsrsCount(base, ["correct_count"]) + (Number(grade) >= 1 ? 1 : 0);
    const wrong = fsrsCount(base, ["wrong_count", "mistakes"]) + (Number(grade) <= 0 ? 1 : 0);
    let mastery = Number(base.mastery);
    if (!Number.isFinite(mastery)) mastery = 0;
    if (Number(grade) <= 0) mastery = Math.max(0, mastery - 15);
    else if (Number(grade) === 1) mastery = Math.min(100, mastery + 8);
    else mastery = Math.min(100, mastery + 20);
    let ease = Number(base.ease_factor !== undefined ? base.ease_factor : base.ease);
    if (!Number.isFinite(ease) || ease <= 0) ease = 2.5;
    ease = Math.min(4, Math.max(1.3, ease));
    const next = {
      difficulty: fsrsRound(card.difficulty),
      stability: fsrsRound(card.stability),
      state: fsrsStateName(card.state),
      scheduled_days: scheduledDays,
      learning_steps: Number(card.learning_steps) || 0,
      next_review_at: due.toISOString(),
      last_review_at: lastReview.toISOString(),
      last_reviewed_at: lastReview.toISOString(),
      review_count: reps,
      reps: reps,
      correct_count: correct,
      wrong_count: wrong,
      mistakes: wrong,
      interval_days: intervalDays,
      interval: intervalDays,
      due: due.getTime(),
      last: lastReview.getTime(),
      ease_factor: ease,
      ease: ease,
      mastery: mastery
    };
    if (wordLabel) {
      console.log("[FSRS] word=" + wordLabel + ", rating=" + fsrsRatingName(grade) +
        ", D=" + next.difficulty + ", S=" + next.stability + "\u5929" +
        ", next=" + fsrsDayLabel(new Date(due.getTime())));
      console.log("\u5199\u5e93 next_review_at:", due.toISOString(), "\u5f53\u524d\u65f6\u95f4:", now.toISOString());
    }
    return next;
  }

  function fsrsRecordFor(state, word) {
    if (!word) return null;
    let local = null;
    if (state) {
      if (state.records) local = state.records[word.id] || null;
      if (!local && state.userWordStates) local = state.userWordStates[word.id] || null;
      if (!local && state[word.id] && typeof state[word.id] === "object") local = state[word.id];
    }
    const cloud = cloudStates.has(word.id) ? cloudStates.get(word.id) : null;
    if (!local) return cloud;
    if (!cloud) return local;
    return fsrsLastStamp(cloud) > fsrsLastStamp(local) ? cloud : local;
  }

  function fsrsBucket(record, now) {
    if (!record) return "new";
    const reps = fsrsCount(record, ["review_count", "reps"]);
    const name = record.state ? String(record.state) : "";
    if (name === "new" || reps <= 0) return "new";
    const stamp = fsrsStamp(record);
    if (stamp === null) return "due";
    return stamp <= now ? "due" : "later";
  }

  function collectSession(chosen, list, count, total, allowRecent) {
    const out = chosen.slice();
    let left = count;
    for (let i = 0; i < list.length && left > 0 && out.length < total; i++) {
      const item = list[i];
      if (!allowRecent && fsrsRecent.indexOf(item.word.id) >= 0) continue;
      if (out.some((entry) => entry.word.id === item.word.id)) continue;
      out.push(item);
      left -= 1;
    }
    return out;
  }

  function rememberSessionWord(word) {
    if (!word || !word.id) return;
    const at = fsrsRecent.indexOf(word.id);
    if (at >= 0) fsrsRecent.splice(at, 1);
    fsrsRecent.push(word.id);
    while (fsrsRecent.length > FSRS_RECENT_LIMIT) fsrsRecent.shift();
  }

  function selectSession(words, state, size = 20) {
    const total = Math.max(1, Math.round(Number(size) || 20));
    const now = Date.now();
    const dueList = [];
    const newList = [];
    (words || []).forEach((word, index) => {
      const record = fsrsRecordFor(state, word);
      const bucket = fsrsBucket(record, now);
      if (bucket === "due") dueList.push({ word, at: fsrsStamp(record) || now, order: index, kind: "due" });
      else if (bucket === "new") newList.push({ word, order: index, kind: "new" });
    });
    dueList.sort((a, b) => a.at - b.at || a.order - b.order);
    newList.sort(() => Math.random() - 0.5);
    const freshDue = dueList.filter((item) => fsrsRecent.indexOf(item.word.id) < 0);
    const freshNew = newList.filter((item) => fsrsRecent.indexOf(item.word.id) < 0);
    const wantNew = Math.max(0, Math.round(total * 0.6));
    const wantDue = Math.max(0, total - wantNew);
    let takeDue = Math.min(wantDue, freshDue.length);
    let takeNew = Math.min(wantNew, freshNew.length);
    let gap = total - takeDue - takeNew;
    if (gap > 0) {
      const extraDue = Math.min(gap, freshDue.length - takeDue);
      takeDue += extraDue;
      gap -= extraDue;
    }
    if (gap > 0) {
      const extraNew = Math.min(gap, freshNew.length - takeNew);
      takeNew += extraNew;
      gap -= extraNew;
    }
    let chosen = [];
    chosen = collectSession(chosen, freshDue, takeDue, total);
    chosen = collectSession(chosen, freshNew, takeNew, total);
    if (chosen.length < total) chosen = collectSession(chosen, freshDue, total, total);
    if (chosen.length < total) chosen = collectSession(chosen, freshNew, total, total);
    if (chosen.length < total) chosen = collectSession(chosen, dueList, total, total, true);
    if (chosen.length < total) chosen = collectSession(chosen, newList, total, total, true);
    const pickedItems = chosen.slice(0, total);
    const picked = pickedItems.map((item) => item.word);
    const pickedDue = pickedItems.filter((item) => item.kind === "due").length;
    const pickedNew = pickedItems.length - pickedDue;
    picked.forEach(rememberSessionWord);
    console.log("[selectSession] \u5019\u9009\u6c60\uff1a\u5230\u671f " + dueList.length + " \u4e2a\uff0c\u65b0\u8bcd " + newList.length + " \u4e2a\uff1b\u62bd\u51fa\u524d 5 \u4e2a\uff1a" + picked.slice(0, 5).map((word) => word.word || word.id).join(", "));
    console.log("[selectSession] \u671f\u671b " + wantNew + " \u65b0 + " + wantDue + " \u590d\u4e60\uff0c\u5b9e\u9645 " + pickedNew + " \u65b0 + " + pickedDue + " \u590d\u4e60\uff0c\u7f3a\u53e3 " + Math.max(0, total - pickedItems.length) + "\u3002");
    return picked;
  }
  function sm2FallbackGrade(record, grade) {
    const r = {
      review_count: 0,
      wrong_count: 0,
      correct_count: 0,
      interval_days: 0,
      ease_factor: 2.5,
      next_review_at: new Date().toISOString(),
      last_reviewed_at: null,
      mastery: 0,
      ...(record || {})
    };

    const now = Date.now();

    r.review_count += 1;
    r.last_reviewed_at = new Date(now).toISOString();

    if (grade === 0) {
      r.wrong_count += 1;
      r.mastery = Math.max(
        0,
        Number(r.mastery || 0) - 15
      );
      r.ease_factor = Math.max(
        1.3,
        Number(r.ease_factor || 2.5) - 0.2
      );
      r.interval_days = 10 / 1440;
    } else if (grade === 1) {
      r.correct_count += 1;
      r.mastery = Math.min(
        100,
        Number(r.mastery || 0) + 8
      );
      r.ease_factor = Math.max(
        1.3,
        Number(r.ease_factor || 2.5) - 0.05
      );
      r.interval_days = Math.max(
        1,
        Number(r.interval_days || 0) * 1.25 || 1
      );
    } else {
      r.correct_count += 1;
      r.mastery = Math.min(
        100,
        Number(r.mastery || 0) + 20
      );
      r.ease_factor = Math.min(
        3.5,
        Number(r.ease_factor || 2.5) + 0.08
      );
      r.interval_days = Math.max(
        3,
        Number(r.interval_days || 0) * r.ease_factor || 3
      );
    }

    r.next_review_at = new Date(
      now + r.interval_days * DAY
    ).toISOString();

    return {
      review_count: r.review_count,
      wrong_count: r.wrong_count,
      correct_count: r.correct_count,
      interval_days: r.interval_days,
      ease_factor: r.ease_factor,
      next_review_at: r.next_review_at,
      last_reviewed_at: r.last_reviewed_at,
      mastery: r.mastery
    };
  }

  function sm2ThreeGrade(record, grade, wordLabel) {
    return fsrsThreeGrade(record, grade, wordLabel);
  }

  function spellingPrompt(word, difficulty) {
    if (difficulty === "hint") {
return String(word.word || "").slice(0, 2) + "\u00b7\u00b7\u00b7\u00b7";    }

    if (difficulty === "unknown") {
      return "\u4e0d\u8ba4\u8bc6\uff1f\u67e5\u770b\u7b54\u6848\u540e\u518d\u7ec3\u4e60";
    }

    return "\u8bf7\u8f93\u5165\u5b8c\u6574\u62fc\u5199";
  }

  function randomSpelling(words, deck) {
    const pool =
      deck && deck !== "all"
        ? words.filter(
            (w) =>
              w.level === deck ||
              (w.tags || []).includes(deck)
          )
        : words;

    return (
      pool[
        Math.floor(
          Math.random() * Math.max(1, pool.length)
        )
      ] || null
    );
  }

  function migrateLegacyRating(rating) {
    return Number(rating) <= 0
      ? 0
      : Number(rating) === 1
        ? 1
        : 2;
  }

  let cloudClient = null;
  let cloudPromise = null;
  let cloudUser = null;
  let cloudUserResolvedAt = 0;
  let cloudAuthListenerBound = false;
  /* The signed-in user is re-resolved instead of being frozen at the first call: a
     page can outlive the sign-in / sign-out that happens after it loaded, and every
     module reads this value long after boot. */
  const CLOUD_USER_TTL_MS = 2000;
  const PRACTICE_RECENT_LIMIT = 10;

  function createPracticeSession() {
    return {
      current: null,
      recent: []
    };
  }

  let currentProfile = null;
  let cardWord = null;
  let spellingAttempts = 0;
  let spellingDeck = "all";
  let hintLevel = "none";
  let sentenceSession = createPracticeSession();
  let spellingSession = createPracticeSession();

  const cloudStates = new Map();
  const cloudMemory = new Map();

  let assessState = {
    low: 0,
    high: 19466,
    current: 9720,
    answered: []
  };

  let assessmentWord = null;
  let mixedWord = null;
  let mixedRevealed = false;
  let memoryRecords = [];
  let memoryTab = "word";
  const memoryExpanded = new Set();
  let currentTranslationQuestion = null;
  let lastTranslationQuestionId = null;
  let currentWritingQuestion = null;
  let lastWritingQuestionId = null;
  let currentReadingQuestion = null;
  let lastReadingQuestionId = null;
  let readingAnswers = [];
  let readingActiveBlank = 0;
  let readingCurrentIndex = 0;
  let readingSubmitted = false;
  let readingStartedAt = 0;
  let readingPane = "passage";
  let currentListeningQuestion = null;
  let lastListeningQuestionId = null;
  let listeningAnswers = [];
  let listeningCurrentIndex = 0;
  let listeningSubmitted = false;
  let listeningStartedAt = 0;
  let listeningPlaying = false;
  let listeningRate = 1;
  let listeningPane = "passage";
  const examYears = {
    translation: "",
    writing: "",
    reading: "",
    listening: ""
  };
  const highlightModes = {
    translation: false,
    writing: false,
    reading: false,
    listening: false
  };
  let listeningAudioBound = false;
  let listeningStemsHidden = (function () {
    try {
      return localStorage.getItem("learnhub.listening.stemsHidden") === "1";
    } catch (error) {
      return false;
    }
  })();

  function setCurrentWord(word) {
    if (!word) return cardWord;
    cardWord = word;
    return cardWord;
  }

  /* Every module shares the singleton created in supabase-config.js. Nothing here
     builds a client of its own, so only one GoTrueClient ever exists. */
  async function sharedCloudClient() {
    if (window.supabaseClient) return window.supabaseClient;
    if (window.LearnHubSupabase && typeof window.LearnHubSupabase.getClient === "function") {
      return await window.LearnHubSupabase.getClient();
    }
    if (!window.__learnHubConfigLoading) {
      window.__learnHubConfigLoading = new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = "/supabase-config.js";
        script.onload = resolve;
        script.onerror = resolve;
        document.head.appendChild(script);
      });
    }
    await window.__learnHubConfigLoading;
    if (window.LearnHubSupabase && typeof window.LearnHubSupabase.getClient === "function") {
      return await window.LearnHubSupabase.getClient();
    }
    return window.supabaseClient || null;
  }

  /* Supabase fires SIGNED_IN / SIGNED_OUT / INITIAL_SESSION on the one shared
     GoTrue client; mirroring those events keeps cloudUser honest without polling. */
  function bindCloudAuthListener() {
    if (cloudAuthListenerBound || !cloudClient || !cloudClient.auth) return;
    if (typeof cloudClient.auth.onAuthStateChange !== "function") return;
    cloudAuthListenerBound = true;
    try {
      cloudClient.auth.onAuthStateChange((event, session) => {
        cloudUser = (session && session.user) || null;
        cloudUserResolvedAt = Date.now();
      });
    } catch (error) {
      cloudAuthListenerBound = false;
    }
  }

  async function ensureCloudClient() {
    if (cloudClient) return cloudClient;
    if (!cloudPromise) {
      cloudPromise = sharedCloudClient()
        .catch(() => null)
        .then((value) => {
          if (!value) cloudPromise = null;
          return value;
        });
    }
    const shared = await cloudPromise;
    if (!shared) return null;
    cloudClient = shared;
    bindCloudAuthListener();
    return cloudClient;
  }

  /* Always talks to the auth server. Public entry point for sign-in / sign-out. */
  async function refreshCloudUser() {
    const client = await ensureCloudClient();
    if (!client) {
      cloudUser = null;
      cloudUserResolvedAt = 0;
      return null;
    }
    cloudUserResolvedAt = Date.now();
    try {
      const userResult = await client.auth.getUser();
      cloudUser = userResult?.data?.user || null;
    } catch (error) {
      cloudUser = null;
    }
    return cloudUser;
  }

  function clearCloudUser() {
    cloudUser = null;
    cloudUserResolvedAt = 0;
    return null;
  }

  /* Throttled variant used by the hot paths, so one rating click cannot storm
     /auth/v1/user while a tab switch still picks up a fresh session. */
  async function syncCloudUser() {
    if (Date.now() - cloudUserResolvedAt < CLOUD_USER_TTL_MS) return cloudUser;
    return await refreshCloudUser();
  }

  async function getCloudClient() {
    const client = await ensureCloudClient();
    if (!client) return null;
    await syncCloudUser();
    return client;
  }

  async function loadCloudWordStates() {
    const client = await getCloudClient();

    if (!client || !cloudUser) return;

    const states = await client
      .from("user_word_state")
      .select("*")
      .eq("user_id", cloudUser.id);

    (states.data || []).forEach((row) => {
      cloudStates.set(row.word_id, row);
    });

    const memories = await client
      .from("memory_bank")
      .select("*")
      .eq("user_id", cloudUser.id)
      .eq("memory_type", "word");

    (memories.data || []).forEach((row) => {
      const wordId = row.content?.wordId;

      if (wordId) {
        cloudMemory.set(wordId, row);
      }
    });
  }

  function localPracticeRecords() {
    try {
      if (typeof state !== "undefined" && state && state.records) {
        return state.records;
      }
    } catch (error) {}
    return {};
  }

  function practiceWordCatalog() {
    const catalog = new Map();
    (window.LEARNHUB_WORDS || []).forEach((word) => {
      if (word && word.id !== null && word.id !== undefined) {
        catalog.set(String(word.id), word);
      }
    });
    return catalog;
  }

  function practiceWordFromMemory(row, id) {
    const content = row && row.content ? row.content : {};
    const word = content.word || row?.title || "";
    if (!id || !word) return null;
    return {
      id: id,
      word: word,
      phonetic: content.phonetic || "",
      meaning: content.meaning || "",
      pos: content.pos || "",
      level: content.level || "",
      tags: Array.isArray(content.tags) ? content.tags : []
    };
  }

  function selectedPracticeWords(catalog) {
    try {
      if (typeof filteredWords === "function") {
        const selected = filteredWords();
        if (Array.isArray(selected) && selected.length) return selected;
      }
    } catch (error) {}
    if (spellingDeck && spellingDeck !== "all") {
      return Array.from(catalog.values()).filter(
        (word) =>
          word.level === spellingDeck ||
          (word.tags || []).includes(spellingDeck)
      );
    }
    return Array.from(catalog.values());
  }

  function practiceTier(word, memory) {
    if (!word) return "";
    const id = String(word.id || "");
    const local = localPracticeRecords()[id] || null;
    const record = cloudStates.get(id) || local || null;
    const mastery = Number(record?.mastery);
    const reviews = fsrsCount(record, ["review_count", "reps"]);
    const correct = fsrsCount(record, ["correct_count"]);
    const wrong = fsrsCount(record, ["wrong_count", "mistakes"]);

    if (memory) {
      if (Number.isFinite(mastery) && mastery <= 0 && wrong > 0) {
        return "unknown";
      }
      if (
        Number.isFinite(mastery) &&
        mastery >= 20 &&
        correct >= 2 &&
        correct >= wrong
      ) {
        return "familiar";
      }
      return "vague";
    }

    if (record) {
      if (Number.isFinite(mastery) && mastery <= 0 && wrong > 0) {
        return "unknown";
      }
      if (
        (Number.isFinite(mastery) && mastery >= 20) ||
        (reviews >= 2 && correct > wrong)
      ) {
        return "familiar";
      }
      return "vague";
    }

    return "";
  }

  function randomPracticeWord(words) {
    if (!Array.isArray(words) || !words.length) return null;
    return words[Math.floor(Math.random() * words.length)] || null;
  }

  function isUnknownPracticeWord(word) {
    if (!word) return false;
    return practiceTier(
      word,
      cloudMemory.get(String(word.id || ""))
    ) === "unknown";
  }

  function weightedPracticeWord(familiar, vague) {
    if (!familiar.length) return randomPracticeWord(vague);
    if (!vague.length) return randomPracticeWord(familiar);
    return Math.random() < 0.7
      ? randomPracticeWord(familiar)
      : randomPracticeWord(vague);
  }

  function practiceSources() {
    const catalog = practiceWordCatalog();
    const local = localPracticeRecords();
    const memoryWords = [];
    const memoryIds = new Set();

    cloudMemory.forEach((row, key) => {
      const id = String(
        row?.source_id ||
        row?.content?.wordId ||
        key ||
        ""
      );
      if (!id || memoryIds.has(id)) return;
      const word = catalog.get(id) || practiceWordFromMemory(row, id);
      if (!word) return;
      memoryWords.push(word);
      memoryIds.add(id);
    });

    const stateWords = [];
    const stateIds = new Set();
    const addStateWord = (id) => {
      const key = String(id || "");
      if (!key || stateIds.has(key)) return;
      const word = catalog.get(key);
      if (!word) return;
      stateWords.push(word);
      stateIds.add(key);
    };

    cloudStates.forEach((row, id) => addStateWord(id));
    Object.keys(local).forEach(addStateWord);

    let libraryWords = selectedPracticeWords(catalog);
    if (!Array.isArray(libraryWords) || !libraryWords.length) {
      libraryWords = Array.from(catalog.values());
    }

    return [
      { kind: "memory", words: memoryWords },
      { kind: "state", words: stateWords },
      { kind: "library", words: libraryWords }
    ];
  }

  function freshPracticeWords(words, recent) {
    const seen = new Set();
    const fresh = [];
    (words || []).forEach((word) => {
      const id = String(word?.id || "");
      if (!id || recent.has(id) || seen.has(id)) return;
      seen.add(id);
      fresh.push(word);
    });
    return fresh;
  }

  function pickPracticeWord(session) {
    const recent = new Set(session?.recent || []);
    const sources = practiceSources();

    for (const source of sources) {
      const candidates = freshPracticeWords(source.words, recent);
      if (!candidates.length) continue;

      if (source.kind === "library") {
        const safeCandidates = candidates.filter(
          (word) => !isUnknownPracticeWord(word)
        );
        if (safeCandidates.length) {
          return randomPracticeWord(safeCandidates);
        }
        continue;
      }

      const familiar = [];
      const vague = [];
      candidates.forEach((word) => {
        const id = String(word.id);
        const tier = practiceTier(word, cloudMemory.get(id));
        if (tier === "familiar") familiar.push(word);
        else if (tier === "vague") vague.push(word);
      });

      const picked = weightedPracticeWord(familiar, vague);
      if (picked) return picked;
    }

    const allWords = Array.from(practiceWordCatalog().values());
    const safeWords = allWords.filter(
      (word) => !isUnknownPracticeWord(word)
    );
    const fallback = freshPracticeWords(safeWords, recent);
    return randomPracticeWord(
      fallback.length ? fallback : safeWords
    );
  }

  function rememberPracticeWord(session, word) {
    if (!session || !word) return word;
    const id = String(word.id || "");
    if (!id) return word;
    const index = session.recent.indexOf(id);
    if (index >= 0) session.recent.splice(index, 1);
    session.recent.push(id);
    while (session.recent.length > PRACTICE_RECENT_LIMIT) {
      session.recent.shift();
    }
    session.current = word;
    return word;
  }

  function nextSentencePracticeWord() {
    return rememberPracticeWord(
      sentenceSession,
      pickPracticeWord(sentenceSession)
    );
  }

  function nextSpellingPracticeWord() {
    return rememberPracticeWord(
      spellingSession,
      pickPracticeWord(spellingSession)
    );
  }

  function renderSentencePrompt(word) {
    const prompt = document.getElementById("sentencePrompt");
    if (!prompt || !word) return;
    const phonetic = word.phonetic
      ? "<div class=\"prompt-phonetic\">" + escapeHtml(word.phonetic) + "</div>"
      : "";
    prompt.innerHTML =
      "<div class=\"prompt-word\">" + escapeHtml(word.word || "") + "</div>" +
      phonetic +
      "<div class=\"prompt-divider\"></div>" +
      "<div class=\"prompt-meaning\">" + escapeHtml(word.meaning || "") + "</div>";
  }

  function setSpellingDeck(deck) {
    spellingDeck = deck || "all";
    spellingSession = createPracticeSession();
    spellingAttempts = 0;
    hintLevel = "none";
    const input = document.getElementById("spellingInput");
    const feedback = document.getElementById("spellingFeedback");
    const submit = document.getElementById("submitSpelling");
    const next = document.getElementById("nextSpelling");
    if (input) input.value = "";
    if (feedback) { feedback.hidden = true; feedback.textContent = ""; feedback.innerHTML = ""; }
    if (submit) { submit.disabled = false; submit.hidden = false; }
    if (next) next.hidden = true;
    const current = nextSpellingPracticeWord();
    if (current && !document.getElementById("spellingPanel")?.hidden) {
      renderSpellingPrompt(current, hintLevel);
    }
  }

  function getSpellingWord() {
    return nextSpellingPracticeWord();
  }

  function resetSpellingRound() {
    const current = nextSpellingPracticeWord();
    spellingAttempts = 0;
    const input = document.getElementById("spellingInput");
    const feedback = document.getElementById("spellingFeedback");
    const submit = document.getElementById("submitSpelling");
    const next = document.getElementById("nextSpelling");
    if (input) input.value = "";
    if (feedback) { feedback.hidden = true; feedback.textContent = ""; feedback.innerHTML = ""; }
    if (submit) { submit.disabled = false; submit.hidden = false; }
    if (next) next.hidden = true;
    if (current) renderSpellingPrompt(current, hintLevel);
  }

  function finishSpellingRound(message) {
    const feedback = document.getElementById("spellingFeedback");
    const submit = document.getElementById("submitSpelling");
    const next = document.getElementById("nextSpelling");
    if (feedback) { feedback.hidden = false; feedback.textContent = message; }
    if (submit) submit.disabled = true;
    if (next) next.hidden = false;
  }

  async function loadUserProfile() {
    const c = await getCloudClient();
    if (!c || !cloudUser) return null;
    const { data } = await c.from("user_profile").select("*").eq("user_id", cloudUser.id).maybeSingle();
    return data;
  }

  async function loadMemoryBank() {
    const c = await getCloudClient();
    if (!c || !cloudUser) return [];
    const { data, error } = await c
      .from("memory_bank")
      .select("*")
      .eq("user_id", cloudUser.id)
      .order("updated_at", { ascending: false });
    if (error) {
      console.error("loadMemoryBank failed", error);
      return memoryRecords;
    }
    memoryRecords = data || [];
    return memoryRecords;
  }

  function memoryKind(row) {
    return row && row.type === "question" ? "question" : "word";
  }

  function memoryModuleLabel(module) {
    if (module === "translation") return "\u7ffb\u8bd1";
    if (module === "writing") return "\u5199\u4f5c";
    if (module === "reading") return "\u9605\u8bfb";
    if (module === "listening") return "\u542c\u529b";
    return "\u7ec3\u4e60";
  }

  function memorySnippet(value, limit) {
    var text = String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
    var max = Number(limit) || 60;
    return text.length > max ? text.slice(0, max) + "\u2026" : text;
  }

  function memoryAnswerText(value) {
    if (Array.isArray(value)) {
      return value.map(function (item, index) {
        return String(index + 1) + ". " + memoryAnswerText(item || "\u672a\u4f5c\u7b54");
      }).join("\n");
    }
    if (value && typeof value === "object") {
      try {
        return JSON.stringify(value, null, 2);
      } catch (error) {
        return String(value);
      }
    }
    return String(value == null ? "" : value);
  }

  function memoryTime(value) {
    var date = value ? new Date(value) : null;
    return date && !isNaN(date.getTime()) ? date.toLocaleString() : "";
  }

  function memoryQuestionOriginal(row) {
    var content = row && row.content ? row.content : {};
    var prompt = memoryAnswerText(
      content.prompt ||
      (content.question && content.question.prompt) ||
      row.title ||
      ""
    );
    var rawOptions = content.options || (content.question && content.question.options);
    var parsed = readingJson(rawOptions);
    var lines = [];
    if (Array.isArray(parsed)) {
      parsed.forEach(function (item, index) {
        if (item && typeof item === "object") {
          var stem = readingInline(item.q || item.stem || item.question || "");
          var opts = Array.isArray(item.opts) ? item.opts : [];
          if (stem) lines.push(String(index + 1) + ". " + stem);
          opts.forEach(function (opt, optIndex) {
            lines.push(readingLetter(optIndex) + ". " + readingInline(opt));
          });
        } else {
          lines.push(String(index + 1) + ". " + readingInline(item));
        }
      });
    } else if (parsed && Array.isArray(parsed.bank)) {
      parsed.bank.forEach(function (item, index) {
        lines.push(readingLetter(index) + ". " + readingInline(item));
      });
    }
    return prompt + (lines.length ? "\n\n" + lines.join("\n") : "");
  }

  function memoryDetailRow(label, value, className) {
    return "<div class=\"memory-detail-row\"><div class=\"memory-detail-label\">" +
      escapeHtml(label) +
      "</div><div class=\"memory-detail-value " +
      escapeHtml(className || "") +
      "\">" +
      escapeHtml(memoryAnswerText(value)) +
      "</div></div>";
  }

  function renderMemoryQuestion(row) {
    var content = row.content || {};
    var id = String(row.id || "");
    var expanded = memoryExpanded.has(id);
    var corrected = Boolean(row.mastered);
    var prompt = content.prompt || (content.question && content.question.prompt) || row.title || "";
    var detail = expanded
      ? "<div class=\"memory-detail\">" +
        memoryDetailRow("\u539f\u9898", memoryQuestionOriginal(row), "") +
        memoryDetailRow("\u4f60\u7684\u7b54\u6848", row.user_answer || content.user_answer || "\u672a\u4f5c\u7b54", "") +
        memoryDetailRow("\u6b63\u786e\u7b54\u6848", row.correct_answer || content.correct_answer || "\u6682\u65e0", "answer") +
        memoryDetailRow("\u89e3\u6790", content.explanation || "\u6682\u65e0\u89e3\u6790", "") +
        "</div>"
      : "";
    return "<article class=\"memory-question\">" +
      "<div class=\"memory-question-summary\">" +
      "<button type=\"button\" class=\"memory-question-main\" data-memory-toggle=\"" +
      escapeHtml(id) +
      "\" aria-expanded=\"" +
      (expanded ? "true" : "false") +
      "\"><span class=\"memory-question-kicker\"><span class=\"memory-module-tag\">" +
      escapeHtml(memoryModuleLabel(row.module)) +
      "</span><time class=\"memory-time\">" +
      escapeHtml(memoryTime(row.last_wrong_at || row.updated_at || row.created_at)) +
      "</span></span><span class=\"memory-question-snippet\">" +
      escapeHtml(memorySnippet(prompt, 60)) +
      "</span></button><div class=\"memory-question-side\"><span class=\"memory-status " +
      (corrected ? "corrected" : "") +
      "\"><span class=\"memory-status-dot\"></span>" +
      (corrected ? "\u5df2\u8ba2\u6b63" : "\u672a\u8ba2\u6b63") +
      "</span><button type=\"button\" class=\"memory-mastered-button\" data-memory-mastered=\"" +
      escapeHtml(id) +
      "\">\u5df2\u638c\u63e1</button></div></div>" +
      detail +
      "</article>";
  }

  function renderMemoryBank() {
    const list = document.getElementById("memoryList");
    if (!list) return;
    const wordCount = memoryRecords.filter((row) => memoryKind(row) === "word").length;
    const questionCount = memoryRecords.length - wordCount;
    const wordCountEl = document.getElementById("memoryWordCount");
    const questionCountEl = document.getElementById("memoryQuestionCount");
    if (wordCountEl) wordCountEl.textContent = String(wordCount);
    if (questionCountEl) questionCountEl.textContent = String(questionCount);
    document.querySelectorAll("[data-memory-tab]").forEach((button) => {
      const active = button.getAttribute("data-memory-tab") === memoryTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    const rows = memoryRecords.filter((row) => memoryKind(row) === memoryTab);
    if (!rows.length) {
      list.innerHTML = "<div class=\"memory-empty\">" +
        (memoryTab === "word"
          ? "\u5728\u8bcd\u6c47\u6a21\u5757\u6807\u8bb0\u4e0d\u8ba4\u8bc6\u6216\u6a21\u7cca\u540e\uff0c\u751f\u8bcd\u4f1a\u51fa\u73b0\u5728\u8fd9\u91cc\u3002"
          : "\u7ffb\u8bd1\u3001\u5199\u4f5c\u3001\u9605\u8bfb\u6216\u542c\u529b\u7b54\u9519\u540e\uff0c\u9519\u9898\u4f1a\u81ea\u52a8\u51fa\u73b0\u5728\u8fd9\u91cc\u3002") +
        "</div>";
      return;
    }
    list.innerHTML = rows.map((row) => {
      if (memoryKind(row) === "question") return renderMemoryQuestion(row);
      const content = row.content || {};
      const title = content.word || row.title || "";
      const detail = content.meaning || "";
      const count = Number(row.recall_count || 0);
      return "<div class=\"memory-item\"><div class=\"memory-item-main\"><strong>" +
        escapeHtml(title) +
        "</strong><div class=\"memory-item-detail\">" +
        escapeHtml(detail) +
        "</div><small class=\"memory-item-meta\">\u4e0d\u719f\u6089 " +
        escapeHtml(String(count)) +
        " \u6b21</small></div><button type=\"button\" class=\"memory-mastered-button\" data-memory-mastered=\"" +
        escapeHtml(String(row.id || "")) +
        "\">\u5df2\u638c\u63e1</button></div>";
    }).join("");
  }

  function cacheQuestionMemory(row) {
    if (!row) return;
    const id = String(row.id || "");
    const index = memoryRecords.findIndex((item) => String(item.id || "") === id);
    if (index >= 0) memoryRecords[index] = Object.assign({}, memoryRecords[index], row);
    else if (memoryTab === "question") memoryRecords.unshift(row);
  }

  async function recordQuestionOutcome(payload) {
    try {
      const details = payload || {};
      const question = details.question || {};
      const sourceId = String(details.sourceId || question.id || "");
      if (!sourceId) return null;
      const client = await getCloudClient();
      if (!client || !cloudUser) return null;
      const existingResult = await client
        .from("memory_bank")
        .select("*")
        .eq("user_id", cloudUser.id)
        .eq("type", "question")
        .eq("source_id", sourceId)
        .maybeSingle();
      if (existingResult.error) {
        console.error("recordQuestionOutcome lookup failed", existingResult.error);
        return null;
      }
      const existing = existingResult.data;
      const now = new Date().toISOString();
      if (details.isCorrect) {
        if (!existing) return null;
        const corrected = Object.assign({}, existing, {
          mastered: true,
          updated_at: now
        });
        const updateResult = await client
          .from("memory_bank")
          .update({ mastered: true, updated_at: now })
          .eq("id", existing.id)
          .eq("user_id", cloudUser.id);
        if (updateResult.error) {
          console.error("recordQuestionOutcome correct failed", updateResult.error);
          return null;
        }
        cacheQuestionMemory(corrected);
        return corrected;
      }
      const moduleName = ["translation", "writing", "reading", "listening"].includes(details.module)
        ? details.module
        : "translation";
      const userAnswer = memoryAnswerText(details.userAnswer);
      const correctAnswer = memoryAnswerText(
        details.correctAnswer != null ? details.correctAnswer : question.answer
      );
      const prompt = question.prompt || details.prompt || existing?.title || "";
      const row = {
        user_id: cloudUser.id,
        type: "question",
        source_id: sourceId,
        module: moduleName,
        memory_type: moduleName,
        title: memorySnippet(prompt, 120),
        content: {
          questionId: sourceId,
          prompt,
          options: question.options || null,
          explanation: details.explanation || question.explanation || "",
          question_type: question.question_type || "",
          exam_type: question.exam_type || "",
          tags: Array.isArray(question.tags) ? question.tags : [],
          audio_url: question.audio_url || "",
          user_answer: userAnswer,
          correct_answer: correctAnswer
        },
        user_answer: userAnswer,
        correct_answer: correctAnswer,
        mastered: false,
        wrong_count: Number(existing?.wrong_count || 0) + 1,
        last_wrong_at: now,
        updated_at: now
      };
      const result = await client
        .from("memory_bank")
        .upsert(row, { onConflict: "user_id,type,source_id" })
        .select("*")
        .single();
      if (result.error) {
        console.error("recordQuestionOutcome wrong failed", result.error);
        return null;
      }
      cacheQuestionMemory(result.data);
      return result.data;
    } catch (error) {
      console.error("recordQuestionOutcome failed", error);
      return null;
    }
  }

  function renderMixedWord() {
    const target = document.getElementById("mixedWord");
    if (!target || !mixedWord) return;
    const phonetic = mixedWord.phonetic ? "<div class=\"prompt-phonetic\">" + escapeHtml(mixedWord.phonetic) + "</div>" : "";
    target.innerHTML = "<div class=\"prompt-word\">" + escapeHtml(mixedWord.word || "") + "</div>" + phonetic + (mixedRevealed ? "<div class=\"prompt-divider\"></div><div class=\"prompt-meaning\">" + escapeHtml(mixedWord.meaning || "") + "</div>" : "");
    const feedback = document.getElementById("mixedFeedback");
    if (feedback) { feedback.hidden = !mixedRevealed; feedback.innerHTML = mixedRevealed ? "<div class=\"mixed-actions\"><button data-mixed-grade=\"2\">\u8ba4\u8bc6</button><button data-mixed-grade=\"1\">\u6a21\u7cca</button><button data-mixed-grade=\"0\">\u4e0d\u8ba4\u8bc6</button></div>" : ""; }
  }

  function nextMixedWord() { const records = {}; cloudStates.forEach((row, id) => { records[id] = row; }); const words = selectSession(window.LEARNHUB_WORDS || [], { records }, 1); mixedWord = words[0] || null; mixedRevealed = false; renderMixedWord(); }

  function extractExamYears(tags) {
    const values = Array.isArray(tags) ? tags : readingJson(tags);
    if (!Array.isArray(values)) return [];
    return values
      .map((tag) => String(tag || "").trim())
      .filter((tag) => /^\d{4}[.\-]\d{1,2}$/.test(tag));
  }

  async function populateExamYearFilter(module, selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.disabled = true;
    const client = await getCloudClient();
    if (!client) {
      select.disabled = false;
      return;
    }
    const result = await client
      .from("question_bank")
      .select("tags")
      .eq("module", module);
    if (result.error) {
      select.disabled = false;
      return;
    }
    const years = new Set();
    (result.data || []).forEach((row) => {
      extractExamYears(row.tags).forEach((year) => years.add(year));
    });
    const sorted = Array.from(years).sort((a, b) => b.localeCompare(a));
    select.innerHTML =
      "<option value=\"\">\u5168\u90e8\u5e74\u4efd</option>" +
      sorted.map((year) => {
        return "<option value=\"" + escapeHtml(year) + "\">" +
          escapeHtml(year) + "</option>";
      }).join("");
    select.value = examYears[module] || "";
    select.disabled = false;
  }

  async function populateExamYears() {
    await Promise.all([
      populateExamYearFilter("translation", "translationYear"),
      populateExamYearFilter("writing", "writingYear"),
      populateExamYearFilter("reading", "readingYear"),
      populateExamYearFilter("listening", "listeningYear")
    ]);
  }

  function applyExamYear(query, module) {
    const year = examYears[module];
    return year ? query.contains("tags", [year]) : query;
  }

  function examHighlightKey(module, questionId) {
    const userId = cloudUser?.id || "guest";
    return "learnhub.highlight:" + String(userId) + ":" +
      String(module) + ":" + String(questionId || "none");
  }

  function readExamHighlights(module, questionId) {
    try {
      const raw = localStorage.getItem(
        examHighlightKey(module, questionId)
      );
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.map((item) => String(item)).filter(Boolean)
        : [];
    } catch (error) {
      return [];
    }
  }

  function writeExamHighlights(module, questionId, values) {
    try {
      localStorage.setItem(
        examHighlightKey(module, questionId),
        JSON.stringify(Array.from(new Set(values || [])))
      );
    } catch (error) {}
  }

  function examQuestionId(module) {
    if (module === "translation") return currentTranslationQuestion?.id || "";
    if (module === "writing") return currentWritingQuestion?.id || "";
    if (module === "reading") return currentReadingQuestion?.id || "";
    if (module === "listening") return currentListeningQuestion?.id || "";
    return "";
  }

  function examHighlightRoots(module) {
    const ids = {
      translation: ["translationPrompt"],
      writing: ["writingPrompt", "writingHint"],
      reading: ["readingArticle", "readingQuestions"],
      listening: ["listeningTranscript", "listeningQuestions"]
    }[module] || [];
    return ids
      .map((id) => document.getElementById(id))
      .filter(Boolean);
  }

  function clearExamHighlights(root) {
    if (!root) return;
    root.querySelectorAll("mark.exam-highlight").forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(
        document.createTextNode(mark.textContent || ""),
        mark
      );
      parent.normalize();
    });
  }

  function wrapExamHighlight(root, value) {
    const text = String(value || "").trim();
    if (!root || text.length < 2) return;
    const ignoredSelector =
      "mark.exam-highlight,button,input,textarea,select,audio,code," +
      ".exam-paragraph-no,.exam-reading-label,.reading-question-no," +
      ".exam-cloze-guide";
    const nodes = [];
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT
    );
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (
        node.nodeValue &&
        !parent?.closest(ignoredSelector)
      ) {
        nodes.push(node);
      }
      node = walker.nextNode();
    }
    let combined = "";
    const positions = [];
    nodes.forEach((textNode) => {
      if (combined && combined.charAt(combined.length - 1) !== " ") {
        combined += " ";
        positions.push({
          node: textNode,
          start: 0,
          end: 0
        });
      }
      const source = textNode.nodeValue || "";
      for (let index = 0; index < source.length; index += 1) {
        const character = source.charAt(index);
        if (/\s/.test(character)) {
          if (!combined || combined.charAt(combined.length - 1) === " ") {
            continue;
          }
          combined += " ";
        } else {
          combined += character;
        }
        positions.push({
          node: textNode,
          start: index,
          end: index + 1
        });
      }
    });
    const needle = text.replace(/\s+/g, " ");
    const leading = combined.length - combined.trimStart().length;
    const haystack = combined.slice(leading).trimEnd();
    const matchIndex = haystack.indexOf(needle);
    if (matchIndex < 0) return;
    const segments = [];
    positions
      .slice(leading + matchIndex, leading + matchIndex + needle.length)
      .forEach((position) => {
        const previous = segments[segments.length - 1];
        if (previous && previous.node === position.node) {
          previous.end = position.end;
          return;
        }
        segments.push({
          node: position.node,
          start: position.start,
          end: position.end
        });
      });
    segments.reverse().forEach((segment) => {
      const range = document.createRange();
      range.setStart(segment.node, segment.start);
      range.setEnd(segment.node, segment.end);
      const mark = document.createElement("mark");
      mark.className = "exam-highlight";
      try {
        range.surroundContents(mark);
      } catch (error) {
        void error;
      }
    });
  }

  function applyExamHighlights(module) {
    const roots = examHighlightRoots(module);
    if (!roots.length) return;
    const questionId = examQuestionId(module);
    roots.forEach(clearExamHighlights);
    readExamHighlights(module, questionId).forEach((value) => {
      roots.forEach((root) => wrapExamHighlight(root, value));
    });
  }

  function setExamHighlightButton(module, active) {
    document
      .querySelectorAll("[data-highlight-mode=\"" + module + "\"]")
      .forEach((button) => {
        button.classList.toggle("active", Boolean(active));
        button.setAttribute(
          "aria-pressed",
          active ? "true" : "false"
        );
      });
  }

  function setExamHighlightMode(module, active) {
    Object.keys(highlightModes).forEach((key) => {
      highlightModes[key] = key === module ? Boolean(active) : false;
      setExamHighlightButton(key, highlightModes[key]);
    });
    const anyActive = Object.values(highlightModes).some(Boolean);
    document.body.classList.toggle("exam-highlighting", anyActive);
  }

  function captureExamHighlight() {
    const module = Object.keys(highlightModes).find(
      (key) => highlightModes[key]
    );
    if (!module) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const anchor = selection.anchorNode;
    const roots = examHighlightRoots(module);
    const root = roots.find((item) => item.contains(anchor));
    if (!root || !root.contains(range.endContainer)) return;
    if (
      anchor?.parentElement?.closest(
        "button,input,textarea,select,audio,code"
      )
    ) {
      return;
    }
    const fragment = range.cloneContents();
    fragment
      .querySelectorAll(
        "button,input,textarea,select,audio,code,.exam-paragraph-no," +
        ".exam-reading-label,.reading-question-no,.exam-cloze-guide"
      )
      .forEach((node) => node.remove());
    fragment
      .querySelectorAll("p,div,li")
      .forEach((node) => node.appendChild(document.createTextNode(" ")));
    const text = String(fragment.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 2) return;
    const questionId = examQuestionId(module);
    const values = readExamHighlights(module, questionId);
    if (!values.includes(text)) values.push(text);
    writeExamHighlights(module, questionId, values);
    applyExamHighlights(module);
    selection.removeAllRanges();
  }

  function renderExamPaneState(module) {
    const pane = module === "reading" ? readingPane : listeningPane;
    document
      .querySelectorAll(
        "[data-exam-pane][data-exam-module=\"" + module + "\"]"
      )
      .forEach((button) => {
        const active = button.getAttribute("data-exam-pane") === pane;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });
    const passagePane = document.getElementById(
      module === "reading" ? "readingPassagePane" : "listeningPassagePane"
    );
    const questionsPane = document.getElementById(
      module === "reading" ? "readingQuestionsPane" : "listeningQuestionsPane"
    );
    if (passagePane) passagePane.hidden = pane !== "passage";
    if (questionsPane) questionsPane.hidden = pane !== "questions";
  }

  function setExamPane(module, pane) {
    const next = pane === "questions" ? "questions" : "passage";
    if (module === "reading") readingPane = next;
    else if (module === "listening") listeningPane = next;
    renderExamPaneState(module);
    applyExamHighlights(module);
  }

  function examQuestionNumber(module, type, index) {
    if (module === "reading" && type === "cloze") {
      return String(index + 26);
    }
    return String(index + 1);
  }

  function renderExamQuestionNav(module) {
    const host = document.getElementById(
      module === "reading" ? "readingQuestionNav" : "listeningQuestionNav"
    );
    if (!host) return;
    const question = module === "reading"
      ? currentReadingQuestion
      : currentListeningQuestion;
    const items = readingItems(question);
    const answers = module === "reading"
      ? readingAnswers
      : listeningAnswers;
    const active = module === "reading"
      ? (question?.question_type === "cloze"
        ? readingActiveBlank
        : readingCurrentIndex)
      : listeningCurrentIndex;
    if (!items.length) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    host.hidden = false;
    host.innerHTML = items.map((item, index) => {
      const answered = Boolean(answers[index]);
      const classes = ["exam-question-jump"];
      if (answered) classes.push("answered");
      if (index === active) classes.push("active");
      return "<button type=\"button\" class=\"" + classes.join(" ") +
        "\" data-question-jump=\"" + module +
        "\" data-question-index=\"" + String(index) +
        "\" aria-label=\"" +
        escapeHtml("\u7b2c " + examQuestionNumber(
          module,
          question?.question_type || "",
          index
        ) + " \u9898") + "\">" +
        escapeHtml(examQuestionNumber(
          module,
          question?.question_type || "",
          index
        )) + "</button>";
    }).join("");
  }

  function scrollToExamTarget(selector) {
    const target = document.querySelector(selector);
    if (!target) return;
    target.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }

  function renderTranslationQuestion(question) {
    const prompt = document.getElementById("translationPrompt");
    const input = document.getElementById("translationInput");
    const feedback = document.getElementById("translationFeedback");
    const submit = document.getElementById("submitTranslation");
    const next = document.getElementById("nextTranslation");
    const highlight = document.querySelector(
      "[data-highlight-mode=\"translation\"]"
    );
    if (input) input.value = "";
    if (feedback) { feedback.hidden = true; feedback.textContent = ""; feedback.innerHTML = ""; }
    if (next) next.hidden = true;
    if (highlight) highlight.disabled = !question;
    if (!prompt) return;
    if (!question) {
      prompt.innerHTML = "<div class=\"prompt-meaning\">\u5f53\u524d\u6761\u4ef6\u4e0b\u6682\u65e0\u9898\u76ee\uff0c\u8bd5\u8bd5\u5207\u6362\u8003\u8bd5\u7c7b\u578b</div>";
      if (submit) submit.disabled = true;
      setExamHighlightMode("translation", false);
      applyExamHighlights("translation");
      return;
    }
    if (submit) submit.disabled = false;
    prompt.innerHTML = "<div class=\"prompt-word prompt-sentence\">" + escapeHtml(question.prompt || "") + "</div>";
    applyExamHighlights("translation");
  }

  async function loadRandomTranslationQuestion() {
    const client = await getCloudClient();
    const examType = document.querySelector('input[name="examType"]:checked')?.value || "CET4";
    if (!client) { currentTranslationQuestion = null; renderTranslationQuestion(null); return null; }
    let countQuery = client.from("question_bank").select("id", { count: "exact", head: true }).eq("module", "translation").eq("question_type", "translation").eq("exam_type", examType);
    countQuery = applyExamYear(countQuery, "translation");
    if (lastTranslationQuestionId) countQuery = countQuery.neq("id", lastTranslationQuestionId);
    const countResult = await countQuery;
    const count = Number(countResult.count || 0);
    if (!count) { currentTranslationQuestion = null; renderTranslationQuestion(null); return null; }
    const offset = Math.floor(Math.random() * count);
    let query = client.from("question_bank").select("id,prompt,answer,explanation,tags").eq("module", "translation").eq("question_type", "translation").eq("exam_type", examType);
    query = applyExamYear(query, "translation");
    if (lastTranslationQuestionId) query = query.neq("id", lastTranslationQuestionId);
    const result = await query.range(offset, offset).limit(1).maybeSingle();
    currentTranslationQuestion = result.data || null;
    if (currentTranslationQuestion) lastTranslationQuestionId = currentTranslationQuestion.id;
    renderTranslationQuestion(currentTranslationQuestion);
    return currentTranslationQuestion;
  }

  function writingReferenceHtml(text) {
    const parts = String(text || "")
      .replace(/\\n/g, "\n")
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    return parts
      .map((line) => "<p>" + escapeHtml(line) + "</p>")
      .join("");
  }

  function renderWritingQuestion(question) {
    const prompt = document.getElementById("writingPrompt");
    const input = document.getElementById("writingInput");
    const feedback = document.getElementById("writingFeedback");
    const submit = document.getElementById("submitWriting");
    const change = document.getElementById("changeWriting");
    const details = document.getElementById("writingReference");
    const hint = document.getElementById("writingHint");
    const ref = document.getElementById("writingReferenceBody");
    const highlight = document.querySelector(
      "[data-highlight-mode=\"writing\"]"
    );
    if (input) input.value = "";
    if (feedback) { feedback.hidden = true; feedback.innerHTML = ""; }
    if (details) details.open = false;
    if (submit) { submit.disabled = !question; submit.hidden = false; }
    if (change) change.disabled = !question;
    if (highlight) highlight.disabled = !question;
    const promptText = question ? String(question.prompt || "") : "";
    if (prompt) prompt.textContent = question ? promptText : "\u5f53\u524d\u6761\u4ef6\u4e0b\u6682\u65e0\u5199\u4f5c\u9898\uff0c\u8bd5\u8bd5\u5207\u6362\u8003\u8bd5\u7c7b\u578b";
    if (hint) {
      if (!question) {
        hint.hidden = true;
        hint.textContent = "";
      } else {
        hint.hidden = false;
        hint.textContent = "\u63d0\u793a\uff1a\u8bf7\u6839\u636e\u9898\u76ee\u8981\u6c42\u5c55\u5f00\u8bba\u8ff0\uff0c\u6ce8\u610f\u7ed3\u6784\u6e05\u6670\u3001\u8bba\u636e\u5145\u5206\u3001\u8bed\u8a00\u51c6\u786e\u3002";
      }
    }
    if (ref) ref.innerHTML = question ? writingReferenceHtml(question.answer) : "";
    const count = document.getElementById("writingCount"); if (count) count.textContent = "0 \u8bcd";
    if (!question) setExamHighlightMode("writing", false);
    applyExamHighlights("writing");
  }

  async function loadRandomWritingQuestion() {
    const client = await getCloudClient();
    const examType = document.querySelector('input[name="writingExamType"]:checked')?.value || "CET6";
    if (!client) { currentWritingQuestion = null; renderWritingQuestion(null); return null; }
    const countQuery = () => applyExamYear(
      client
        .from("question_bank")
        .select("id", { count: "exact", head: true })
        .eq("module", "writing")
        .eq("question_type", "writing")
        .eq("exam_type", examType),
      "writing"
    );
    let cq = countQuery();
    if (lastWritingQuestionId) cq = cq.neq("id", lastWritingQuestionId);
    const cr = await cq;
    let count = Number(cr.count || 0);
    let excludeLast = Boolean(lastWritingQuestionId);
    if (!count && lastWritingQuestionId) {
      const total = Number((await countQuery()).count || 0);
      if (!total) { currentWritingQuestion = null; renderWritingQuestion(null); return null; }
      excludeLast = false;
      count = total;
    }
    if (!count) { currentWritingQuestion = null; renderWritingQuestion(null); return null; }
    const offset = Math.floor(Math.random() * count);
    let q = applyExamYear(
      client
        .from("question_bank")
        .select("id,prompt,answer,explanation")
        .eq("module", "writing")
        .eq("question_type", "writing")
        .eq("exam_type", examType),
      "writing"
    );
    if (excludeLast) q = q.neq("id", lastWritingQuestionId);
    const result = await q.range(offset, offset).limit(1).maybeSingle();
    currentWritingQuestion = result.data || null;
    if (currentWritingQuestion) lastWritingQuestionId = currentWritingQuestion.id;
    renderWritingQuestion(currentWritingQuestion);
    return currentWritingQuestion;
  }

  function renderWritingResult(result) {
    const box = document.getElementById("writingFeedback"); if (!box) return;
    const strengths = Array.isArray(result?.strengths) ? result.strengths : [];
    const errors = Array.isArray(result?.errors) ? result.errors : [];
    box.hidden = false;
    box.innerHTML = "<b>\u603b\u5206 " + escapeHtml(result?.total_score ?? 0) + " / 15</b>" +
      "<div>\u7ed3\u6784 " + escapeHtml(result?.structure_score ?? 0) + " / \u8bed\u8a00 " + escapeHtml(result?.language_score ?? 0) + " / \u5185\u5bb9 " + escapeHtml(result?.content_score ?? 0) + "</div>" +
      "<div><strong>\u4f18\u70b9：</strong>" + escapeHtml(strengths.join(" ")) + "</div>" +
      "<div><strong>\u95ee\u9898：</strong>" + errors.map((e) => escapeHtml((e.sentence || "") + " " + (e.issue || "") + " " + (e.suggestion || ""))).join("；") + "</div>" +
      "<div><strong>\u6539\u8fdb\u5efa\u8bae：</strong>" + escapeHtml(result?.advice || "") + "</div>" +
      "<div><strong>\u9898\u5e93\u89e3\u6790：</strong>" + escapeHtml(currentWritingQuestion?.explanation || "") + "</div>";
  }

  function readingText(value) {
    return String(value == null ? "" : value)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, " ");
  }

  function readingInline(value) {
    return readingText(value)
      .replace(/\s*\n\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function readingParagraphs(value) {
    return readingText(value)
      .split(/\n\s*\n+/)
      .map(readingInline)
      .filter(Boolean);
  }

  function readingJson(value) {
    if (value && typeof value === "object") return value;
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function readingTypeLabel(type) {
    if (type === "cloze") return "\u9009\u8bcd\u586b\u7a7a";
    if (type === "matching") return "\u957f\u7bc7\u5339\u914d";
    if (type === "careful_reading") return "\u4ed4\u7ec6\u9605\u8bfb";
    return "\u9605\u8bfb";
  }

  function readingLetter(index) {
    return String.fromCharCode(65 + index);
  }

  function readingLetters(correct) {
    let count = 15;
    if (Array.isArray(correct)) {
      correct.forEach((answer) => {
        const letter = readingNormalize(answer);
        if (/^[A-Z]$/.test(letter)) {
          count = Math.max(count, letter.charCodeAt(0) - 64);
        }
      });
    }
    const list = [];
    for (let i = 0; i < count; i += 1) list.push(readingLetter(i));
    return list;
  }

  function readingNormalize(value) {
    const text = String(value == null ? "" : value).trim().toUpperCase();
    if (/^[A-Z]([.\u3001)\u3002:\uff1a]|$)/.test(text)) return text.charAt(0);
    return text.replace(/\s+/g, " ");
  }

  function readingItems(question) {
    const type = question ? question.question_type : "";
    if (type === "cloze") {
      return readingCorrectAnswers(question).map(() => ({ stem: "", opts: [] }));
    }
    const parsed = readingJson(question ? question.options : null);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => {
      if (item && typeof item === "object") {
        const opts = Array.isArray(item.opts)
          ? item.opts.map(readingInline).filter(Boolean)
          : [];
        return {
          stem: readingInline(item.q || item.stem || item.question || ""),
          opts
        };
      }
      return { stem: readingInline(item), opts: [] };
    });
  }

  function readingCorrectAnswers(question) {
    const parsed = readingJson(question ? question.answer : null);
    if (Array.isArray(parsed)) return parsed.map((item) => readingNormalize(item));
    if (question && typeof question.answer === "string" && question.answer.trim()) {
      return [readingNormalize(question.answer)];
    }
    return [];
  }

  function readingBank(question) {
    const parsed = readingJson(question ? question.options : null);
    const source =
      parsed && !Array.isArray(parsed) && Array.isArray(parsed.bank)
        ? parsed.bank
        : Array.isArray(parsed) && parsed.length && parsed[0] && typeof parsed[0] === "object" && Array.isArray(parsed[0].bank)
          ? parsed[0].bank
          : [];
    const list = source.map((item) => readingInline(item)).filter(Boolean);
    if (list.length) return list;
    const fallback = [];
    readingCorrectAnswers(question).forEach((item) => {
      if (item && !fallback.includes(item)) fallback.push(item);
    });
    return fallback;
  }

  function readingClozeBank(question) {
    const parsed = readingJson(question ? question.options : null);
    const source = Array.isArray(parsed)
      ? parsed
      : parsed && Array.isArray(parsed.bank)
        ? parsed.bank
        : [];
    return source.map((item, index) => {
      const raw = readingInline(item);
      const match = /^([A-Z])\s*[.)\u3001\u3002:\uff1a]\s*(.+)$/i.exec(raw);
      return {
        letter: match ? match[1].toUpperCase() : readingLetter(index),
        text: match ? match[2].trim() : raw
      };
    }).filter((item) => item.text);
  }

  function readingStemParts(item, index, type) {
    let stem = readingInline(item ? item.stem : "");
    if (type === "matching") {
      const match = /^\s*(\d+)\s*[.)\u3001\u3002:\uff1a]?\s*(.*)$/.exec(stem);
      if (match) return { no: match[1], stem: match[2] };
    }
    return { no: String(index + 1), stem };
  }

  function readingClozeEntry(question, letter) {
    const bank = readingClozeBank(question);
    return bank.find((entry) => entry.letter === letter) || null;
  }

  function readingClozeBlankHtml(question, index, correct, chosen) {
    const entry = chosen ? readingClozeEntry(question, chosen) : null;
    const classes = ["reading-blank"];
    if (index === readingActiveBlank && !readingSubmitted) classes.push("active");
    if (chosen) classes.push("filled");
    if (readingSubmitted && chosen) classes.push(chosen === correct ? "correct" : "wrong");
    const number = String(index + 26);
    const word = entry
      ? "<span class=\"reading-blank-word\">" + escapeHtml(entry.letter + ") " + entry.text) + "</span>"
      : "";
    return "<button type=\"button\" class=\"" + classes.join(" ") + "\" data-reading-blank=\"" + String(index) + "\">" +
      "<span>[" + number + "]</span>" + word +
      "</button>";
  }

  function readingClozeBankHtml(question, correct) {
    const bank = readingClozeBank(question);
    const entries = bank.length
      ? bank
      : readingCorrectAnswers(question).map((letter, index) => ({ letter: readingLetter(index), text: letter }));
    return "<div class=\"reading-cloze-shell\"><div class=\"reading-cloze-bank\" aria-label=\"Word bank\">" +
      entries.map((entry) => {
        const selectedIndex = readingAnswers.indexOf(entry.letter);
        const isActive = selectedIndex === readingActiveBlank;
        const isUsed = selectedIndex >= 0 && !isActive;
        const isCorrect = readingSubmitted && entry.letter === correct[readingActiveBlank];
        const isWrong = readingSubmitted && isActive && entry.letter !== correct[readingActiveBlank];
        const classes = ["reading-cloze-pill"];
        if (isActive) classes.push("selected");
        if (isCorrect) classes.push("correct");
        if (isWrong) classes.push("wrong");
        return "<button type=\"button\" class=\"" + classes.join(" ") + "\" data-reading-pick=\"" +
          escapeHtml(entry.letter) + "\"" + (isUsed ? " disabled" : "") + ">" +
          escapeHtml(entry.letter + ") " + entry.text) + "</button>";
      }).join("") +
      "</div></div>";
  }

  function readingClozeArticleHtml(question) {
    const blocks = readingParagraphs(question ? question.prompt : "");
    const correct = readingCorrectAnswers(question);
    let blankIndex = 0;
    const paragraphs = blocks.map((block, blockIndex) => {
      let html = "";
      let cursor = 0;
      const matcher = /_{2,}/g;
      let match = matcher.exec(block);
      while (match) {
        html += escapeHtml(block.slice(cursor, match.index));
        const index = blankIndex;
        html += index < correct.length
          ? readingClozeBlankHtml(
            question,
            index,
            correct[index] || "",
            readingAnswers[index] || ""
          )
          : escapeHtml(match[0]);
        blankIndex += 1;
        cursor = match.index + match[0].length;
        match = matcher.exec(block);
      }
      html += escapeHtml(block.slice(cursor));
      return "<div class=\"exam-reading-paragraph\"><span class=\"exam-paragraph-no\">P" +
        String(blockIndex + 1) + "</span><p>" + html + "</p></div>";
    });
    return "<div class=\"exam-reading-label\">READING PASSAGE</div>" +
      readingClozeBankHtml(question, correct) +
      "<div class=\"exam-reading-body\">" + paragraphs.join("") + "</div>";
  }

  function readingOptionHtml(letter, text, chosen, correct, revealed, compact) {
    const classes = ["reading-option"];
    if (compact) classes.push("reading-letter");
    if (chosen === letter) classes.push("selected");
    if (revealed) {
      if (letter === correct) classes.push("correct");
      else if (chosen === letter) classes.push("wrong");
    }
    const label = compact
      ? "<span class=\"reading-option-key\">" + escapeHtml(letter) + "</span>"
      : "<span class=\"reading-option-key\">" + escapeHtml(letter) + ".</span><span>" + escapeHtml(text) + "</span>";
    const mark = revealed && letter === correct
      ? "<span class=\"reading-mark ok\">" + "\u2713" + "</span>"
      : revealed && chosen === letter && chosen !== correct
        ? "<span class=\"reading-mark no\">" + "\u2717" + "</span>"
        : "";
    return "<button type=\"button\" class=\"" + classes.join(" ") + "\" data-reading-pick=\"" + escapeHtml(letter) + "\">" + label + mark + "</button>";
  }

  function readingSelectHtml(index, chosen, correct, revealed, bank) {
    const options = bank.slice();
    if (chosen && !options.includes(chosen)) options.unshift(chosen);
    if (revealed && correct && !options.includes(correct)) options.unshift(correct);
    return "<select class=\"reading-select\" data-reading-select=\"" + String(index) + "\">" +
      "<option value=\"\">" + "\u8bf7\u9009\u62e9" + "</option>" +
      options.map((word) => "<option value=\"" + escapeHtml(word) + "\"" + (word === chosen ? " selected" : "") + ">" + escapeHtml(word) + "</option>").join("") +
      "</select>";
  }

  function readingQuestionHtml(item, index, type, correct, chosen, revealed, bank) {
    const ok = Boolean(correct) && Boolean(chosen) && readingNormalize(chosen) === correct;
    const mark = revealed
      ? "<span class=\"reading-mark " + (ok ? "ok" : "no") + "\">" + (ok ? "\u2713" : "\u2717") + "</span>"
      : "";
    const stemParts = readingStemParts(item, index, type);
    const head = "<div class=\"reading-question-head\"><div class=\"reading-question-no\">" + escapeHtml(stemParts.no) + ".</div>" +
      (stemParts.stem ? "<div class=\"reading-question-stem\">" + escapeHtml(stemParts.stem) + "</div>" : "") + mark + "</div>";
    let body = "";
    if (item.opts.length) {
      body = "<div class=\"reading-options\">" + item.opts.map((opt, optIndex) => readingOptionHtml(readingLetter(optIndex), opt, chosen, correct, revealed, false)).join("") + "</div>";
    } else if (type === "matching") {
      body = "<div class=\"reading-letters\">" + readingLetters(correct ? [correct] : []).map((letter) => readingOptionHtml(letter, letter, chosen, correct, revealed, true)).join("") + "</div>";
    } else if (type !== "cloze") {
      body = readingSelectHtml(index, chosen, correct, revealed, bank);
    }
    const line = revealed
      ? "<div class=\"reading-answer-line\">" + "\u6b63\u786e\u7b54\u6848\uff1a<b>" + escapeHtml(correct || "-") + "</b>" +
        (chosen ? "\uff0c" + "\u4f60\u7684\u7b54\u6848\uff1a" + escapeHtml(chosen) : "\uff0c" + "\u672a\u4f5c\u7b54") + "</div>"
      : "";
    return "<div class=\"reading-question\" data-reading-question=\"" + String(index) + "\">" + head + body + line + "</div>";
  }

  /* ---------- Listening module ---------- */

  function listeningTypeLabel(type) {
    if (type === "full_set") return "\u6574\u5957";
    if (type === "short_conversation") return "\u77ed\u5bf9\u8bdd";
    if (type === "long_conversation") return "\u957f\u5bf9\u8bdd";
    if (type === "passage") return "\u77ed\u6587";
    if (type === "lecture") return "\u8bb2\u5ea7";
    return "\u542c\u529b";
  }

  function listeningTagSuffix(question) {
    const tags = question && Array.isArray(question.tags)
      ? question.tags.map((tag) => String(tag))
      : [];
    const year = tags.filter((tag) => /^\d{4}[.\-]\d{1,2}$/.test(tag))[0] || "";
    const set = tags.filter((tag) => /^set:\d+$/.test(tag))[0] || "";
    const label = set ? set.replace("set:", "\u7b2c") + "\u5957" : "";
    const parts = [year, label].filter(Boolean);
    return parts.length ? " \u00b7 " + parts.join(" ") : "";
  }

  function listeningAudioUrl(question) {
    const raw = question && question.audio_url
      ? String(question.audio_url).trim()
      : "";
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    const config = window.LEARNHUB_SUPABASE || {};
    const base = String(config.url || "").replace(/\/+$/, "");
    if (!base) return raw;
    return base + "/storage/v1/object/public/listening_audio/" + raw.replace(/^\/+/, "");
  }

  function listeningTranscriptHtml(question) {
    const blocks = question ? readingParagraphs(question.prompt) : [];
    if (!blocks.length) return "";
    return "<div class=\"exam-reading-label\">LISTENING TRANSCRIPT</div>" +
      "<div class=\"exam-reading-body\">" +
      blocks.map((block, index) => {
        return "<div class=\"exam-reading-paragraph\"><span class=\"exam-paragraph-no\">P" +
          String(index + 1) + "</span><p>" + escapeHtml(block) + "</p></div>";
      }).join("") +
      "</div>";
  }

  function listeningSubmitState() {
    const submit = document.getElementById("submitListening");
    if (!submit) return;
    const items = currentListeningQuestion
      ? readingItems(currentListeningQuestion)
      : [];
    submit.disabled = !items.length || listeningSubmitted || listeningPlaying;
    submit.textContent = listeningPlaying
      ? "\u64ad\u653e\u4e2d\u00b7\u6682\u505c\u540e\u63d0\u4ea4"
      : "\u63d0\u4ea4\u7b54\u6848";
  }

  function listeningAudioFallback() {
    const wrap = document.getElementById("listeningAudioWrap");
    const hint = document.getElementById("listeningNoAudio");
    const transcript = document.getElementById("listeningTranscript");
    if (wrap) wrap.hidden = true;
    if (hint) {
      hint.hidden = false;
      hint.textContent = "\u97f3\u9891\u52a0\u8f7d\u5931\u8d25\uff0c\u53ef\u7528\u6587\u672c\u6a21\u5f0f\u7ec3\u4e60";
    }
    if (transcript) {
      const html = listeningTranscriptHtml(currentListeningQuestion);
      transcript.innerHTML = html;
      transcript.hidden = !html;
      applyExamHighlights("listening");
    }
  }

  function bindListeningAudio() {
    const audio = document.getElementById("listeningAudio");
    if (!audio || listeningAudioBound) return;
    listeningAudioBound = true;
    const start = () => { listeningPlaying = true; listeningSubmitState(); };
    const stop = () => { listeningPlaying = false; listeningSubmitState(); };
    audio.addEventListener("play", start);
    audio.addEventListener("playing", start);
    audio.addEventListener("pause", stop);
    audio.addEventListener("ended", stop);
    audio.addEventListener("error", () => {
      if (!audio.getAttribute("src")) return;
      listeningPlaying = false;
      listeningAudioFallback();
      listeningSubmitState();
    });
  }

  function listeningOptionHtml(letter, text, chosen, correct, revealed) {
    const classes = ["reading-option"];
    if (chosen === letter) classes.push("selected");
    if (revealed) {
      if (letter === correct) classes.push("correct");
      else if (chosen === letter) classes.push("wrong");
    }
    const label = "<span class=\"reading-option-key\">" + escapeHtml(letter) +
      ".</span><span>" + escapeHtml(text) + "</span>";
    const mark = revealed && letter === correct
      ? "<span class=\"reading-mark ok\">" + "\u2713" + "</span>"
      : revealed && chosen === letter && chosen !== correct
        ? "<span class=\"reading-mark no\">" + "\u2717" + "</span>"
        : "";
    return "<button type=\"button\" class=\"" + classes.join(" ") +
      "\" data-listening-pick=\"" + escapeHtml(letter) + "\">" + label + mark + "</button>";
  }

  function listeningQuestionHtml(item, index, correct, chosen, revealed) {
    const ok = Boolean(correct) && Boolean(chosen) && readingNormalize(chosen) === correct;
    const mark = revealed
      ? "<span class=\"reading-mark " + (ok ? "ok" : "no") + "\">" + (ok ? "\u2713" : "\u2717") + "</span>"
      : "";
    const head = "<div class=\"reading-question-head\"><div class=\"reading-question-no\">" +
      escapeHtml(String(index + 1)) + ".</div>" +
      (item.stem && !listeningStemsHidden ? "<div class=\"reading-question-stem\">" + escapeHtml(item.stem) + "</div>" : "") +
      mark + "</div>";
    const body = item.opts.length
      ? "<div class=\"reading-options\">" + item.opts
        .map((opt, optIndex) => listeningOptionHtml(readingLetter(optIndex), opt, chosen, correct, revealed))
        .join("") + "</div>"
      : "";
    const line = revealed
      ? "<div class=\"reading-answer-line\">" + "\u6b63\u786e\u7b54\u6848\uff1a<b>" + escapeHtml(correct || "-") + "</b>" +
        (chosen ? "\uff0c" + "\u4f60\u7684\u7b54\u6848\uff1a" + escapeHtml(chosen) : "\uff0c" + "\u672a\u4f5c\u7b54") + "</div>"
      : "";
    return "<div class=\"reading-question\" data-listening-question=\"" + String(index) + "\">" +
      head + body + line + "</div>";
  }

  function renderListeningQuestions() {
    const host = document.getElementById("listeningQuestions");
    if (!host) return;
    const question = currentListeningQuestion;
    if (!question) {
      host.innerHTML = "";
      renderExamQuestionNav("listening");
      return;
    }
    const items = readingItems(question);
    const correct = readingCorrectAnswers(question);
    const toolbar = "<div class=\"listening-stem-row\"><button type=\"button\" id=\"toggleListeningStems\" class=\"listening-stem-toggle\">" +
      (listeningStemsHidden ? "\u663e\u793a\u9898\u76ee" : "\u9690\u85cf\u9898\u76ee") +
      "</button></div>";
    host.innerHTML = toolbar + items
      .map((item, index) => listeningQuestionHtml(item, index, correct[index] || "", listeningAnswers[index] || "", listeningSubmitted))
      .join("");
    applyExamHighlights("listening");
    renderExamQuestionNav("listening");
  }

  function setListeningStemsHidden(hidden) {
    listeningStemsHidden = Boolean(hidden);
    try {
      localStorage.setItem("learnhub.listening.stemsHidden", listeningStemsHidden ? "1" : "0");
    } catch (error) {
      void error;
    }
    renderListeningQuestions();
  }

  function renderListeningQuestion(question) {
    currentListeningQuestion = question || null;
    const empty = document.getElementById("listeningEmpty");
    const meta = document.getElementById("listeningMeta");
    const score = document.getElementById("listeningScore");
    const feedback = document.getElementById("listeningFeedback");
    const wrap = document.getElementById("listeningAudioWrap");
    const audio = document.getElementById("listeningAudio");
    const hint = document.getElementById("listeningNoAudio");
    const transcript = document.getElementById("listeningTranscript");
    const passageHint = document.getElementById("listeningPassageHint");
    const change = document.getElementById("changeListening");
    const actions = document.getElementById("listeningActions");
    const highlight = document.querySelector(
      "[data-highlight-mode=\"listening\"]"
    );
    const items = readingItems(question);
    listeningAnswers = items.map(() => "");
    listeningCurrentIndex = 0;
    listeningSubmitted = false;
    listeningPlaying = false;
    listeningPane = "passage";
    listeningStartedAt = Date.now();
    if (score) {
      score.hidden = true;
      score.textContent = "";
    }
    if (feedback) {
      feedback.hidden = true;
      feedback.innerHTML = "";
    }
    if (empty) {
      empty.hidden = Boolean(question);
      empty.textContent = question
        ? ""
        : "\u5f53\u524d\u6761\u4ef6\u4e0b\u6682\u65e0\u542c\u529b\u9898\uff0c\u8bd5\u8bd5\u5207\u6362\u8003\u8bd5\u7c7b\u578b\u6216\u9898\u578b";
    }
    if (meta) {
      meta.hidden = !question;
      meta.textContent = question
        ? "\u9898\u578b\uff1a" + listeningTypeLabel(question.question_type) + listeningTagSuffix(question) +
          " \u00b7 " + String(items.length) + " \u9053\u5c0f\u9898"
        : "";
    }
    const url = listeningAudioUrl(question);
    if (wrap && audio) {
      if (url) {
        bindListeningAudio();
        wrap.hidden = false;
        if (audio.getAttribute("src") !== url) audio.setAttribute("src", url);
        audio.playbackRate = listeningRate;
        if (hint) {
          hint.hidden = true;
          hint.textContent = "";
        }
        if (transcript) {
          transcript.hidden = true;
          transcript.innerHTML = "";
        }
        if (passageHint) {
          passageHint.hidden = false;
          passageHint.textContent =
            "\u4f7f\u7528\u4e0a\u65b9\u97f3\u9891\u4f5c\u7b54\uff0cQuestions \u4e2d\u53ef\u67e5\u770b\u9898\u76ee\u3002";
        }
      } else {
        wrap.hidden = true;
        try { audio.pause(); } catch (error) { void error; }
        audio.removeAttribute("src");
        if (hint) {
          hint.hidden = !question;
          hint.textContent = question
            ? "\u6682\u65e0\u97f3\u9891\uff0c\u53ef\u7528\u6587\u672c\u6a21\u5f0f\u7ec3\u4e60"
            : "";
        }
        const transcriptHtml = question ? listeningTranscriptHtml(question) : "";
        if (transcript) {
          transcript.innerHTML = transcriptHtml;
          transcript.hidden = !transcriptHtml;
        }
        if (passageHint) {
          passageHint.hidden = Boolean(question && transcript && !transcript.hidden);
          passageHint.textContent = question && !transcriptHtml
            ? "\u5f53\u524d\u9898\u76ee\u672a\u63d0\u4f9b\u97f3\u9891\u6216\u539f\u6587\u3002"
            : "";
        }
      }
    }
    if (change) change.disabled = !question;
    if (highlight) highlight.disabled = !question;
    if (actions) actions.hidden = !items.length;
    if (!question) setExamHighlightMode("listening", false);
    renderExamPaneState("listening");
    listeningSubmitState();
    renderListeningQuestions();
  }

  function resetListeningPanel() {
    if (currentListeningQuestion) return currentListeningQuestion;
    ["listeningEmpty", "listeningMeta", "listeningScore", "listeningFeedback", "listeningNoAudio", "listeningTranscript", "listeningPassageHint"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.hidden = true;
      el.innerHTML = "";
    });
    const wrap = document.getElementById("listeningAudioWrap");
    if (wrap) wrap.hidden = true;
    const audio = document.getElementById("listeningAudio");
    if (audio) {
      try { audio.pause(); } catch (error) { void error; }
      audio.removeAttribute("src");
    }
    const host = document.getElementById("listeningQuestions");
    if (host) host.innerHTML = "";
    const submit = document.getElementById("submitListening");
    const change = document.getElementById("changeListening");
    const actions = document.getElementById("listeningActions");
    if (submit) submit.disabled = true;
    if (change) change.disabled = true;
    if (actions) actions.hidden = true;
    const nav = document.getElementById("listeningQuestionNav");
    if (nav) {
      nav.hidden = true;
      nav.innerHTML = "";
    }
    const highlight = document.querySelector(
      "[data-highlight-mode=\"listening\"]"
    );
    if (highlight) highlight.disabled = true;
    setExamHighlightMode("listening", false);
    listeningAnswers = [];
    listeningCurrentIndex = 0;
    listeningSubmitted = false;
    listeningPlaying = false;
    return null;
  }

  async function loadRandomListeningQuestion() {
    const client = await getCloudClient();
    const examType = document.querySelector('input[name="listeningExamType"]:checked')?.value || "CET6";
    const questionType = document.querySelector('input[name="listeningQuestionType"]:checked')?.value || "full_set";
    if (!client) {
      currentListeningQuestion = null;
      renderListeningQuestion(null);
      return null;
    }
    const countQuery = () => client
      .from("question_bank")
      .select("id", { count: "exact", head: true })
      .eq("module", "listening")
      .eq("question_type", questionType)
      .eq("exam_type", examType);
    let excluded = applyExamYear(countQuery(), "listening");
    if (lastListeningQuestionId) excluded = excluded.neq("id", lastListeningQuestionId);
    const excludedResult = await excluded;
    let count = Number(excludedResult.count || 0);
    let excludeLast = Boolean(lastListeningQuestionId);
    if (!count && lastListeningQuestionId) {
      const total = Number((await applyExamYear(countQuery(), "listening")).count || 0);
      if (!total) {
        currentListeningQuestion = null;
        renderListeningQuestion(null);
        return null;
      }
      excludeLast = false;
      count = total;
    }
    if (!count) {
      currentListeningQuestion = null;
      renderListeningQuestion(null);
      return null;
    }
    const offset = Math.floor(Math.random() * count);
    let query = client
      .from("question_bank")
      .select("id,prompt,options,answer,explanation,question_type,exam_type,audio_url,tags")
      .eq("module", "listening")
      .eq("question_type", questionType)
      .eq("exam_type", examType);
    query = applyExamYear(query, "listening");
    if (excludeLast) query = query.neq("id", lastListeningQuestionId);
    const result = await query.range(offset, offset).limit(1).maybeSingle();
    currentListeningQuestion = result.data || null;
    if (currentListeningQuestion) lastListeningQuestionId = currentListeningQuestion.id;
    renderListeningQuestion(currentListeningQuestion);
    return currentListeningQuestion;
  }

  async function saveListeningRecord(correctCount, total, score) {
    try {
      const client = await getCloudClient();
      if (!client || !cloudUser || !currentListeningQuestion) return;
      await client.from("answer_records").insert({
        user_id: cloudUser.id,
        question_id: currentListeningQuestion.id || null,
        module: "listening",
        submitted_answer: listeningAnswers.slice(),
        score,
        is_correct: correctCount === total,
        ai_analysis: {
          exam_type: currentListeningQuestion.exam_type || "",
          question_type: currentListeningQuestion.question_type || "",
          accuracy: total ? correctCount / total : 0,
          correct_count: correctCount,
          total,
          audio_url: currentListeningQuestion.audio_url || "",
          playback_rate: listeningRate
        },
        duration_ms: listeningStartedAt ? Math.max(0, Date.now() - listeningStartedAt) : null
      });
      await recordQuestionOutcome({
        module: "listening",
        question: currentListeningQuestion,
        isCorrect: correctCount === total,
        userAnswer: listeningAnswers.slice(),
        correctAnswer: readingCorrectAnswers(currentListeningQuestion),
        explanation: currentListeningQuestion.explanation || ""
      });
    } catch (error) {
      console.error("saveListeningRecord failed", error);
    }
  }

  function gradeListening() {
    if (!currentListeningQuestion || listeningSubmitted || listeningPlaying) return;
    const correct = readingCorrectAnswers(currentListeningQuestion);
    if (!correct.length) return;
    listeningSubmitted = true;
    let hit = 0;
    correct.forEach((answer, index) => {
      if (answer && readingNormalize(listeningAnswers[index]) === answer) hit += 1;
    });
    renderListeningQuestions();
    const total = correct.length;
    const score = Math.round((hit / total) * 100);
    const scoreBox = document.getElementById("listeningScore");
    if (scoreBox) {
      scoreBox.hidden = false;
      scoreBox.textContent = "\u603b\u5206 " + String(hit) + "/" + String(total);
    }
    const feedback = document.getElementById("listeningFeedback");
    const explanation = readingInline(currentListeningQuestion.explanation || "");
    if (feedback) {
      feedback.hidden = !explanation;
      feedback.innerHTML = explanation
        ? "<strong>" + "\u89e3\u6790\uff1a" + "</strong>" + escapeHtml(explanation)
        : "";
    }
    const submit = document.getElementById("submitListening");
    if (submit) submit.disabled = true;
    saveListeningRecord(hit, total, score).catch((error) => console.error("saveListeningRecord failed", error));
  }

  function pickListeningOption(target) {
    if (listeningSubmitted || !currentListeningQuestion) return false;
    const button = target.closest("[data-listening-pick]");
    if (!button) return false;
    const box = button.closest("[data-listening-question]");
    const index = Number(box ? box.getAttribute("data-listening-question") : 0);
    const total = readingItems(currentListeningQuestion).length;
    if (!Number.isFinite(index) || index < 0 || index >= total) return false;
    listeningAnswers[index] = button.getAttribute("data-listening-pick") || "";
    listeningCurrentIndex = index;
    renderListeningQuestions();
    return true;
  }

  function setListeningRate(rate) {
    const value = Number(rate);
    if (!Number.isFinite(value) || value <= 0) return;
    listeningRate = value;
    document.querySelectorAll("[data-listening-rate]").forEach((button) => {
      button.classList.toggle("active", Number(button.getAttribute("data-listening-rate")) === value);
    });
    const audio = document.getElementById("listeningAudio");
    if (audio) audio.playbackRate = value;
  }

  function renderReadingArticle() {
    const article = document.getElementById("readingArticle");
    if (!article) return;
    const question = currentReadingQuestion;
    if (!question) {
      article.innerHTML = "";
      article.hidden = true;
      return;
    }
    if (question.question_type === "cloze") {
      article.innerHTML = readingClozeArticleHtml(question);
      article.hidden = false;
      applyExamHighlights("reading");
      renderExamQuestionNav("reading");
      return;
    }
    const blocks = readingParagraphs(question.prompt);
    article.innerHTML =
      "<div class=\"exam-reading-label\">READING PASSAGE</div>" +
      "<div class=\"exam-reading-body\">" +
      blocks.map((block, index) => {
        return "<div class=\"exam-reading-paragraph\"><span class=\"exam-paragraph-no\">P" +
          String(index + 1) + "</span><p>" + escapeHtml(block) + "</p></div>";
      }).join("") +
      "</div>";
    article.hidden = !blocks.length;
    applyExamHighlights("reading");
    renderExamQuestionNav("reading");
  }

  function renderReadingQuestions() {
    const host = document.getElementById("readingQuestions");
    if (!host) return;
    const question = currentReadingQuestion;
    if (!question) {
      host.innerHTML = "";
      return;
    }
    if (question.question_type === "cloze") {
      const correct = readingCorrectAnswers(question);
      host.innerHTML =
        "<div class=\"exam-cloze-guide\"><strong>\u5728\u539f\u6587\u4e2d\u4f5c\u7b54</strong><span>\u70b9\u51fb\u4e0b\u65b9\u9898\u53f7\u53ef\u8fd4\u56de\u5bf9\u5e94\u7a7a\u683c\u3002</span></div>" +
        correct.map((answer, index) => {
          const chosen = readingAnswers[index] || "";
          const entry = chosen ? readingClozeEntry(question, chosen) : null;
          return "<div class=\"reading-question cloze-question-row\" data-reading-question=\"" +
            String(index) + "\"><div class=\"reading-question-head\"><div class=\"reading-question-no\">[" +
            escapeHtml(String(index + 26)) + "]</div><div class=\"reading-question-stem\">" +
            escapeHtml(entry ? entry.letter + ") " + entry.text : "\u672a\u4f5c\u7b54") +
            "</div></div></div>";
        }).join("");
      applyExamHighlights("reading");
      renderExamQuestionNav("reading");
      return;
    }
    const items = readingItems(question);
    const correct = readingCorrectAnswers(question);
    const type = question.question_type || "careful_reading";
    const bank = readingBank(question);
    host.innerHTML = items
      .map((item, index) => readingQuestionHtml(item, index, type, correct[index] || "", readingAnswers[index] || "", readingSubmitted, bank))
      .join("");
    applyExamHighlights("reading");
    renderExamQuestionNav("reading");
  }

  function renderReadingQuestion(question) {
    currentReadingQuestion = question || null;
    const empty = document.getElementById("readingEmpty");
    const meta = document.getElementById("readingMeta");
    const score = document.getElementById("readingScore");
    const feedback = document.getElementById("readingFeedback");
    const submit = document.getElementById("submitReading");
    const change = document.getElementById("changeReading");
    const actions = document.getElementById("readingActions");
    const highlight = document.querySelector(
      "[data-highlight-mode=\"reading\"]"
    );
    const items = readingItems(question);
    readingAnswers = items.map(() => "");
    readingActiveBlank = 0;
    readingCurrentIndex = 0;
    readingSubmitted = false;
    readingStartedAt = Date.now();
    readingPane = "passage";
    if (score) {
      score.hidden = true;
      score.textContent = "";
    }
    if (feedback) {
      feedback.hidden = true;
      feedback.innerHTML = "";
    }
    if (empty) {
      empty.hidden = Boolean(question);
      empty.textContent = question ? "" : "\u5f53\u524d\u6761\u4ef6\u4e0b\u6682\u65e0\u9605\u8bfb\u9898\uff0c\u8bd5\u8bd5\u5207\u6362\u8003\u8bd5\u7c7b\u578b\u6216\u9898\u578b";
    }
    if (meta) {
      meta.hidden = !question;
      meta.textContent = question
        ? "\u9898\u578b\uff1a" + readingTypeLabel(question.question_type) + " \u00b7 " + String(items.length) + " \u9053\u5c0f\u9898"
        : "";
    }
    if (submit) submit.disabled = !items.length;
    if (change) change.disabled = !question;
    if (highlight) highlight.disabled = !question;
    if (actions) actions.hidden = !items.length;
    if (!question) setExamHighlightMode("reading", false);
    renderExamPaneState("reading");
    renderReadingArticle();
    renderReadingQuestions();
  }

  function resetReadingPanel() {
    if (currentReadingQuestion) return currentReadingQuestion;
    ["readingEmpty", "readingArticle", "readingMeta", "readingScore", "readingFeedback"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.hidden = true;
      el.innerHTML = "";
    });
    const host = document.getElementById("readingQuestions");
    if (host) host.innerHTML = "";
    const submit = document.getElementById("submitReading");
    const change = document.getElementById("changeReading");
    const actions = document.getElementById("readingActions");
    if (submit) submit.disabled = true;
    if (change) change.disabled = true;
    if (actions) actions.hidden = true;
    const nav = document.getElementById("readingQuestionNav");
    if (nav) {
      nav.hidden = true;
      nav.innerHTML = "";
    }
    const highlight = document.querySelector(
      "[data-highlight-mode=\"reading\"]"
    );
    if (highlight) highlight.disabled = true;
    setExamHighlightMode("reading", false);
    readingAnswers = [];
    readingActiveBlank = 0;
    readingCurrentIndex = 0;
    readingSubmitted = false;
    return null;
  }

  async function loadRandomReadingQuestion() {
    const client = await getCloudClient();
    const examType = document.querySelector('input[name="readingExamType"]:checked')?.value || "CET6";
    const questionType = document.querySelector('input[name="readingQuestionType"]:checked')?.value || "careful_reading";
    if (!client) {
      currentReadingQuestion = null;
      renderReadingQuestion(null);
      return null;
    }
    const countQuery = () => client
      .from("question_bank")
      .select("id", { count: "exact", head: true })
      .eq("module", "reading")
      .eq("question_type", questionType)
      .eq("exam_type", examType);
    let excluded = applyExamYear(countQuery(), "reading");
    if (lastReadingQuestionId) excluded = excluded.neq("id", lastReadingQuestionId);
    const excludedResult = await excluded;
    let count = Number(excludedResult.count || 0);
    let excludeLast = Boolean(lastReadingQuestionId);
    if (!count && lastReadingQuestionId) {
      const total = Number((await applyExamYear(countQuery(), "reading")).count || 0);
      if (!total) {
        currentReadingQuestion = null;
        renderReadingQuestion(null);
        return null;
      }
      excludeLast = false;
      count = total;
    }
    if (!count) {
      currentReadingQuestion = null;
      renderReadingQuestion(null);
      return null;
    }
    const offset = Math.floor(Math.random() * count);
    let query = client
      .from("question_bank")
      .select("id,prompt,options,answer,explanation,question_type,exam_type")
      .eq("module", "reading")
      .eq("question_type", questionType)
      .eq("exam_type", examType);
    query = applyExamYear(query, "reading");
    if (excludeLast) query = query.neq("id", lastReadingQuestionId);
    const result = await query.range(offset, offset).limit(1).maybeSingle();
    currentReadingQuestion = result.data || null;
    if (currentReadingQuestion) lastReadingQuestionId = currentReadingQuestion.id;
    renderReadingQuestion(currentReadingQuestion);
    return currentReadingQuestion;
  }

  async function saveReadingRecord(correctCount, total, score) {
    try {
      const client = await getCloudClient();
      if (!client || !cloudUser || !currentReadingQuestion) return;
      await client.from("answer_records").insert({
        user_id: cloudUser.id,
        question_id: currentReadingQuestion.id || null,
        module: "reading",
        submitted_answer: readingAnswers.slice(),
        score,
        is_correct: correctCount === total,
        ai_analysis: {
          exam_type: currentReadingQuestion.exam_type || "",
          question_type: currentReadingQuestion.question_type || "",
          accuracy: total ? correctCount / total : 0,
          correct_count: correctCount,
          total
        },
        duration_ms: readingStartedAt ? Math.max(0, Date.now() - readingStartedAt) : null
      });
      await recordQuestionOutcome({
        module: "reading",
        question: currentReadingQuestion,
        isCorrect: correctCount === total,
        userAnswer: readingAnswers.slice(),
        correctAnswer: readingCorrectAnswers(currentReadingQuestion),
        explanation: currentReadingQuestion.explanation || ""
      });
    } catch (error) {
      console.error("saveReadingRecord failed", error);
    }
  }

  function gradeReading() {
    if (!currentReadingQuestion || readingSubmitted) return;
    const correct = readingCorrectAnswers(currentReadingQuestion);
    if (!correct.length) return;
    readingSubmitted = true;
    let hit = 0;
    correct.forEach((answer, index) => {
      if (answer && readingNormalize(readingAnswers[index]) === answer) hit += 1;
    });
    renderReadingArticle();
    renderReadingQuestions();
    const total = correct.length;
    const score = Math.round((hit / total) * 100);
    const scoreBox = document.getElementById("readingScore");
    if (scoreBox) {
      scoreBox.hidden = false;
      scoreBox.textContent = "\u603b\u5206 " + String(hit) + "/" + String(total);
    }
    const feedback = document.getElementById("readingFeedback");
    const explanation = readingInline(currentReadingQuestion.explanation || "");
    if (feedback) {
      feedback.hidden = !explanation;
      feedback.innerHTML = explanation
        ? "<strong>" + "\u89e3\u6790\uff1a" + "</strong>" + escapeHtml(explanation)
        : "";
    }
    const submit = document.getElementById("submitReading");
    if (submit) submit.disabled = true;
    saveReadingRecord(hit, total, score).catch((error) => console.error("saveReadingRecord failed", error));
  }

  function pickReadingBlank(target) {
    if (readingSubmitted || !currentReadingQuestion) return false;
    const button = target.closest("[data-reading-blank]");
    if (!button) return false;
    const index = Number(button.getAttribute("data-reading-blank"));
    const total = readingItems(currentReadingQuestion).length;
    if (!Number.isFinite(index) || index < 0 || index >= total) return false;
    readingActiveBlank = index;
    readingCurrentIndex = index;
    renderReadingArticle();
    renderReadingQuestions();
    return true;
  }

  function pickReadingOption(target) {
    if (readingSubmitted || !currentReadingQuestion) return false;
    const button = target.closest("[data-reading-pick]");
    if (!button) return false;
    const letter = button.getAttribute("data-reading-pick") || "";
    if (button.closest(".reading-cloze-bank")) {
      const total = readingItems(currentReadingQuestion).length;
      if (!Number.isFinite(readingActiveBlank) || readingActiveBlank < 0 || readingActiveBlank >= total) {
        readingActiveBlank = 0;
      }
      const usedIndex = readingAnswers.indexOf(letter);
      if (usedIndex >= 0 && usedIndex !== readingActiveBlank) return true;
      readingAnswers[readingActiveBlank] = letter;
      readingCurrentIndex = readingActiveBlank;
      let next = readingAnswers.findIndex((value, index) => index > readingActiveBlank && !value);
      if (next < 0) next = readingAnswers.findIndex((value) => !value);
      readingActiveBlank = next >= 0 ? next : readingActiveBlank;
      renderReadingArticle();
      renderReadingQuestions();
      return true;
    }
    const box = button.closest("[data-reading-question]");
    const index = Number(box ? box.getAttribute("data-reading-question") : 0);
    const total = readingItems(currentReadingQuestion).length;
    if (!Number.isFinite(index) || index < 0 || index >= total) return false;
    readingAnswers[index] = letter;
    readingCurrentIndex = index;
    renderReadingQuestions();
    return true;
  }

  function selectReadingOption(target) {
    if (readingSubmitted || !currentReadingQuestion) return false;
    const select = target.closest("[data-reading-select]");
    if (!select) return false;
    const index = Number(select.getAttribute("data-reading-select") || 0);
    const total = readingItems(currentReadingQuestion).length;
    if (!Number.isFinite(index) || index < 0 || index >= total) return false;
    readingAnswers[index] = String(select.value || "");
    readingCurrentIndex = index;
    renderExamQuestionNav("reading");
    return true;
  }

  async function upsertWordState(word, grade, localRecord) {
    if (!word) return null;

    const client = await getCloudClient();
    let previous = cloudStates.get(word.id) || localRecord || null;

    if (client && cloudUser) {
      const stored = await client
        .from("user_word_state")
        .select("mastery,review_count,correct_count,wrong_count,ease_factor,interval_days,next_review_at,last_reviewed_at,difficulty,stability,last_review_at,state")
        .eq("user_id", cloudUser.id)
        .eq("word_id", word.id)
        .maybeSingle();

      if (stored && stored.data) previous = stored.data;
    }

    const next = fsrsThreeGrade(previous, grade, word.word);

    if (!next) return null;

    if (client && cloudUser) {
      const row = {
        user_id: cloudUser.id,
        word_id: word.id,
        mastery: next.mastery,
        review_count: next.review_count,
        correct_count: next.correct_count,
        wrong_count: next.wrong_count,
        ease_factor: next.ease_factor,
        interval_days: next.interval_days,
        next_review_at: next.next_review_at,
        last_reviewed_at: next.last_reviewed_at,
        difficulty: next.difficulty,
        stability: next.stability,
        last_review_at: next.last_review_at,
        state: next.state
      };

      await client
        .from("user_word_state")
        .upsert(row, {
          onConflict: "user_id,word_id"
        });

      cloudStates.set(word.id, row);
    }

    if (Number(grade) < 2) {
      await upsertMemory(word);
    }

    return next;
  }

  async function upsertMemory(word) {
    const client = await getCloudClient();

    if (!client || !cloudUser) return;

    const previous = cloudMemory.get(word.id);

    const row = {
      user_id: cloudUser.id,
      type: "word",
      source_id: String(word.id),
      memory_type: "word",
      title: word.word,
      content: {
        wordId: word.id,
        word: word.word,
        meaning: word.meaning
      },
      recall_count:
        Number(previous?.recall_count || 0) + 1,
      mastered: false,
      wrong_count: Number(previous?.wrong_count || 0),
      updated_at: new Date().toISOString()
    };

    if (previous) {
      await client
        .from("memory_bank")
        .update(row)
        .eq("id", previous.id)
        .eq("user_id", cloudUser.id);
    } else {
      const result = await client
        .from("memory_bank")
        .insert(row)
        .select("*")
        .single();

      if (result.data) {
        cloudMemory.set(word.id, result.data);
      }
    }
  }

  async function gradeSpelling(answer, word) {
    const correct =
      String(answer || "").trim().toLowerCase() ===
      String(word?.word || "").trim().toLowerCase();

    const client = await getCloudClient();

    if (client && cloudUser) {
      await client.from("answer_records").insert({
        user_id: cloudUser.id,
        question_id: null,
        module: "vocabulary",
        submitted_answer: {
          answer,
          wordId: word?.id
        },
        score: correct ? 100 : 0,
        is_correct: correct
      });
    }

    return correct;
  }

  async function callPhase2AI(
    action,
    input,
    extra = {}
  ) {
    const client = await getCloudClient();

    if (!client) {
      throw new Error("Not logged in");
    }

    const { data, error } =
      await client.functions.invoke("ai", {
        body: {
          action,
          input,
          ...extra
        }
      });

    if (error) {
      throw new Error(
        error.message || "AI request failed"
      );
    }

    return data?.result || data;
  }

  function renderSentenceResult(
    result,
    targetId = "quizFeedback"
  ) {
    const target =
      document.getElementById(targetId);

    if (!target) return;

    const errors = (result.errors || [])
      .map(
        (item) =>
          `<div><mark>${escapeHtml(
            item.text || ""
          )}</mark> ${escapeHtml(
            item.comment || item.type || ""
          )}</div>`
      )
      .join("");

    const rawScore = Number(result.score || 0);

    const score =
      rawScore > 0 && rawScore <= 1
        ? Math.round(rawScore * 100)
        : Math.round(rawScore);

    target.hidden = false;
    target.innerHTML = `
      <b>${score} \u5206</b>
      <div>${escapeHtml(
        result.strengths?.join
          ? result.strengths.join(" ")
          : String(result.strengths || "")
      )}</div>
      ${errors}
      <div>${escapeHtml(
        result.suggestion || ""
      )}</div>
    `;
  }

  async function bindPhase2UI() {
    await loadCloudWordStates();
    currentProfile = await loadUserProfile();
    const sentenceWord =
      sentenceSession.current ||
      nextSentencePracticeWord();
    if (!document.getElementById("sentencePanel")?.hidden) {
      renderSentencePrompt(sentenceWord);
    }
    if (!spellingSession.current) {
      nextSpellingPracticeWord();
    }
    renderExamPaneState("reading");
    renderExamPaneState("listening");
    populateExamYears().catch((error) => {
      console.error("populateExamYears failed", error);
    });

    /* Rating clicks are handled once, by the study card entry point in index.html. */
    (async () => {
      let waited = 0;
      const check = setInterval(async () => {
        waited += 500;
        const client = await getCloudClient();
        if (client && cloudUser) {
          clearInterval(check);
          await startAssessment();
        } else if (waited >= 10000) {
          clearInterval(check);
        }
      }, 500);
    })();
  }

  function assessmentWords() {
    return (window.LEARNHUB_WORDS || [])
      .slice()
      .sort(
        (a, b) =>
          Number(a.frequencyRank || a.index || 0) -
          Number(b.frequencyRank || b.index || 0)
      );
  }

  function pickAssessmentWord() {
    const words = assessmentWords();

    if (!words.length) return null;

    const answered = new Set(
      assessState.answered
    );

    const index = Math.max(
      0,
      Math.min(
        words.length - 1,
        assessState.current
      )
    );

    const candidates = words
      .slice(
        Math.max(0, index - 120),
        Math.min(words.length, index + 121)
      )
      .filter((word) => !answered.has(word.id));

    return (
      candidates[
        Math.floor(
          Math.random() *
            Math.max(1, candidates.length)
        )
      ] || words[index]
    );
  }

  function renderAssessment() {
    const panel =
      document.getElementById("assessmentPanel");

    const target =
      document.getElementById("assessWord");

    if (!panel || !target || !assessmentWord) {
      return;
    }

    panel.hidden = false;
    const backdrop = document.getElementById("assessmentBackdrop");
    if (backdrop) backdrop.hidden = false;

    const questionNumber = Math.min(
      20,
      assessState.answered.length + 1
    );

    const progress =
      document.getElementById("assessProgress");

    const barFill =
      document.getElementById("assessBarFill");

    if (progress) {
      progress.textContent =
        String(questionNumber);
    }

    if (barFill) {
      barFill.style.width =
        `${((questionNumber - 1) / 20) * 100}%`;
    }

    const phonetic = assessmentWord.phonetic
      ? `<div class="prompt-phonetic">${escapeHtml(
          assessmentWord.phonetic
        )}</div>`
      : "";

    target.innerHTML = `
      <div class="prompt-word">
        ${escapeHtml(assessmentWord.word || "")}
      </div>
      ${phonetic}
      <div class="prompt-divider"></div>
      <div class="prompt-meaning">
        ${escapeHtml(assessmentWord.meaning || "")}
      </div>
    `;
  }

  async function shouldStartAssessment() {
    const client = await getCloudClient();

    if (!client || !cloudUser) {
      return false;
    }

    const { data, error } = await client
      .from("user_profile")
      .select(
        "vocabulary_size,assessment_completed_at"
      )
      .eq("user_id", cloudUser.id)
      .maybeSingle();

    if (error) {
      console.error(
        "assessment profile query failed",
        error
      );
      return false;
    }

    return (
      !data ||
      Number(data.vocabulary_size || 0) === 0 ||
      !data.assessment_completed_at
    );
  }

  async function startAssessment() {
    const shouldStart =
      await shouldStartAssessment();

    if (!shouldStart) return false;

    if (!window.LEARNHUB_WORDS || !window.LEARNHUB_WORDS.length) {
      await new Promise((resolve) => {
        let waited = 0;
        const check = setInterval(() => {
          waited += 200;
          if ((window.LEARNHUB_WORDS && window.LEARNHUB_WORDS.length) || waited >= 5000) {
            clearInterval(check);
            resolve();
          }
        }, 200);
      });
    }

    assessState = {
      low: 0,
      high: 19466,
      current: 9720,
      answered: []
    };

    assessmentWord = pickAssessmentWord();
    renderAssessment();

    return true;
  }

  async function finishAssessment() {
    const vocabularySize = Math.floor(
      (assessState.low + assessState.high) / 2
    );

    const client = await getCloudClient();

    if (!client || !cloudUser) return;

    let abilityDescription = "";

    try {
      const result = await callPhase2AI(
        "describe_ability",
        {
          vocabulary_size: vocabularySize,
          lower: assessState.low,
          upper: assessState.high
        }
      );

      abilityDescription =
        result?.description ||
        result?.ability_description ||
        "";
    } catch (error) {
      console.error(
        "ability description failed",
        error
      );
    }

    const { error } = await client
      .from("user_profile")
      .upsert(
        {
          user_id: cloudUser.id,
          vocabulary_size: vocabularySize,
          assessment_lower: assessState.low,
          assessment_upper: assessState.high,
          assessment_completed_at:
            new Date().toISOString(),
          assessment_version: 1,
          ability_description: abilityDescription
        },
        {
          onConflict: "user_id"
        }
      );

    if (error) {
      console.error(
        "assessment profile update failed",
        error
      );
      return;
    }

    currentProfile = await loadUserProfile();

    const panel =
      document.getElementById("assessmentPanel");
    const backdrop =
      document.getElementById("assessmentBackdrop");

    if (panel) {
      panel.hidden = true;
    }
    if (backdrop) {
      backdrop.hidden = true;
    }

    const toast =
      document.getElementById("toast");

    if (toast) {
      toast.textContent =
        `\u4f60\u7684\u8bcd\u6c47\u91cf\u7ea6 ${vocabularySize} \u8bcd`;
      toast.classList.add("show");
    }

    setTimeout(() => {
      if (typeof window.go === "function") {
        window.go("learn");
      }
    }, 1500);
  }

  function handleAssessmentAnswer(answer) {
    if (!assessmentWord) return;

    assessState.answered.push(
      assessmentWord.id
    );

    if (answer === "know") {
      assessState.low = assessState.current;
    } else {
      assessState.high = assessState.current;
    }

    assessState.current = Math.floor(
      (assessState.low + assessState.high) / 2
    );

    const shouldFinish =
      assessState.high - assessState.low < 500 ||
      assessState.answered.length >= 20;

    if (shouldFinish) {
      return finishAssessment();
    }

    assessmentWord = pickAssessmentWord();
    renderAssessment();
  }

  function bindAssessmentUI() {
    document.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest(
          "#assessmentPanel [data-answer]"
        );

        if (!button) return;

        handleAssessmentAnswer(
          button.dataset.answer
        );
      }
    );
  }

  window.LearnHubPhase2 = {
    selectSession,
    fsrsThreeGrade,
    fsrsCardFromRecord,
    fsrsScheduler,
    sm2ThreeGrade,
    spellingPrompt,
    randomSpelling,
    migrateLegacyRating,
    setSpellingDeck,
    getCloudClient,
    refreshCloudUser,
    clearCloudUser,
    loadCloudWordStates,
    upsertWordState,
    upsertMemory,
    loadMemoryBank,
    renderMemoryBank,
    recordQuestionOutcome,
    gradeSpelling,
    callPhase2AI,
    renderSentenceResult,
    loadRandomWritingQuestion,
    renderWritingQuestion,
    loadRandomReadingQuestion,
    renderReadingQuestion,
    renderReadingQuestions,
    resetReadingPanel,
    gradeReading,
    readingNormalize,
    readingItems,
    readingCorrectAnswers,
    loadRandomListeningQuestion,
    renderListeningQuestion,
    renderListeningQuestions,
    resetListeningPanel,
    gradeListening,
    setListeningRate,
    bindPhase2UI,
    setCurrentWord,
    nextSentencePracticeWord,
    nextSpellingPracticeWord,
    renderSentencePrompt,
    populateExamYears,
    setExamPane,
    renderExamQuestionNav,
    applyExamHighlights,
    pickAssessmentWord,
    renderAssessment,
    shouldStartAssessment,
    startAssessment,
    finishAssessment,
    handleAssessmentAnswer,
    bindAssessmentUI
  };

  function setActiveTab(
    containerSelector,
    activeId
  ) {
    const container =
      document.querySelector(containerSelector);

    if (!container) return;

    container
      .querySelectorAll(
        ".tab-btn, .mode-tab, [data-tab]"
      )
      .forEach((button) => {
        button.classList.toggle(
          "active",
          button.id === activeId
        );
      });
  }

  const renderSpellingPrompt = (
    word,
    difficulty
  ) => {
    const hint =
      document.getElementById("spellingHint");

    if (!hint || !word) return;

    const phonetic = word.phonetic
      ? `<div class="prompt-phonetic">${escapeHtml(
          word.phonetic
        )}</div>`
      : "";

    const meaning = `
      <div class="prompt-meaning">
        ${escapeHtml(word.meaning || "")}
      </div>
    `;

    let slots = "";

    if (difficulty === "hint") {
      slots = `
        <div class="letter-slots">
          ${Array.from(String(word.word || ""))
            .map((character, index) =>
              character === " "
                ? '<span class="space"></span>'
                : `<span class="slot ${
                    index < 2 ? "given" : ""
                  }">${
                    index < 2
                      ? escapeHtml(character)
                      : ""
                  }</span>`
            )
            .join("")}
        </div>
      `;
    }

    if (difficulty === "unknown") {
      slots = `
        <div class="prompt-word spelling-answer">
          ${escapeHtml(word.word || "")}
        </div>
      `;
    }

    hint.innerHTML = `
      <div class="prompt-word">
        ${
          difficulty === "unknown"
            ? escapeHtml(word.word || "")
            : ""
        }
      </div>
      ${phonetic}
      <div class="prompt-divider"></div>
      ${meaning}
      ${slots}
    `;
  };

  document.addEventListener(
    "click",
    async (event) => {
      const assessmentButton = event.target.closest(
        "#assessmentPanel [data-answer]"
      );

      if (assessmentButton) {
        await handleAssessmentAnswer(
          assessmentButton.dataset.answer
        );
        return;
      }

      const highlightToggle = event.target.closest(
        "[data-highlight-mode]"
      );
      if (highlightToggle) {
        const module = highlightToggle.getAttribute(
          "data-highlight-mode"
        ) || "";
        setExamHighlightMode(module, !highlightModes[module]);
        return;
      }

      const paneButton = event.target.closest("[data-exam-pane]");
      if (paneButton) {
        setExamPane(
          paneButton.getAttribute("data-exam-module") || "",
          paneButton.getAttribute("data-exam-pane") || ""
        );
        return;
      }

      const questionJump = event.target.closest(
        "[data-question-jump]"
      );
      if (questionJump) {
        const module = questionJump.getAttribute(
          "data-question-jump"
        ) || "";
        const index = Number(
          questionJump.getAttribute("data-question-index") || 0
        );
        if (module === "reading" && currentReadingQuestion) {
          const total = readingItems(currentReadingQuestion).length;
          if (index >= 0 && index < total) {
            readingCurrentIndex = index;
            if (currentReadingQuestion.question_type === "cloze") {
              readingActiveBlank = index;
              setExamPane("reading", "passage");
              renderReadingArticle();
              setTimeout(() => {
                scrollToExamTarget(
                  "[data-reading-blank=\"" + String(index) + "\"]"
                );
              }, 40);
            } else {
              setExamPane("reading", "questions");
              renderReadingQuestions();
              setTimeout(() => {
                scrollToExamTarget(
                  "[data-reading-question=\"" + String(index) + "\"]"
                );
              }, 40);
            }
            renderExamQuestionNav("reading");
          }
        }
        if (module === "listening" && currentListeningQuestion) {
          const total = readingItems(currentListeningQuestion).length;
          if (index >= 0 && index < total) {
            listeningCurrentIndex = index;
            setExamPane("listening", "questions");
            renderListeningQuestions();
            setTimeout(() => {
              scrollToExamTarget(
                "[data-listening-question=\"" + String(index) + "\"]"
              );
            }, 40);
          }
        }
        return;
      }

      const cardTab =
        event.target.closest("#tabCard");

      const spellingTab =
        event.target.closest("#tabSpelling");

      const mixedTab = event.target.closest("#tabMixed");

      const sentenceTab =
        event.target.closest("#tabSentence");

      const translationTab =
        event.target.closest("#tabTranslation");

      const cardPanel =
        document.querySelector(".session-panel");

      const spellingPanel =
        document.getElementById("spellingPanel");

      const mixedPanel = document.getElementById("mixedPanel");

      const sentencePanel =
        document.getElementById("sentencePanel");

      const translationPanel =
        document.getElementById("translationPanel");

      if (cardTab) {
        setActiveTab(".study-tabs", "tabCard");
        cardPanel?.removeAttribute("hidden");

        if (spellingPanel) {
          spellingPanel.hidden = true;
        }
        if (mixedPanel) {
          mixedPanel.hidden = true;
        }

        return;
      }

      if (spellingTab) {
        setActiveTab(".study-tabs", "tabSpelling");

        if (cardPanel) {
          cardPanel.hidden = true;
        }

        if (mixedPanel) {
          mixedPanel.hidden = true;
        }

        spellingPanel?.removeAttribute("hidden");
        const spellingWord = nextSpellingPracticeWord();

        const hint =
          document.getElementById("spellingHint");

        if (hint && spellingWord) {
          renderSpellingPrompt(
            spellingWord,
            hintLevel || "none"
          );
        }

        return;
      }

      if (mixedTab) {
        setActiveTab(".study-tabs", "tabMixed");
        if (cardPanel) cardPanel.hidden = true;
        if (spellingPanel) spellingPanel.hidden = true;
        if (mixedPanel) mixedPanel.hidden = false;
        nextMixedWord();
        return;
      }

      if (event.target.closest("#showMixedAnswer")) {
        mixedRevealed = true;
        renderMixedWord();
        return;
      }

      const mixedGrade = event.target.closest("[data-mixed-grade]");
      if (mixedGrade && mixedWord) {
        const grade = Number(mixedGrade.dataset.mixedGrade);
        await upsertWordState(mixedWord, grade);
        if (grade < 2) await upsertMemory(mixedWord);
        nextMixedWord();
        return;
      }

      const memoryView = event.target.closest('[data-view="memory"]');
      if (memoryView) {
        await loadMemoryBank();
        renderMemoryBank();
        return;
      }

      const memoryTabButton = event.target.closest("[data-memory-tab]");
      if (memoryTabButton) {
        memoryTab = memoryTabButton.getAttribute("data-memory-tab") === "question" ? "question" : "word";
        renderMemoryBank();
        return;
      }

      const memoryToggle = event.target.closest("[data-memory-toggle]");
      if (memoryToggle) {
        const id = String(memoryToggle.getAttribute("data-memory-toggle") || "");
        if (memoryExpanded.has(id)) memoryExpanded.delete(id);
        else memoryExpanded.add(id);
        renderMemoryBank();
        return;
      }

      const mastered = event.target.closest("[data-memory-mastered]");
      if (mastered) {
        const id = String(mastered.getAttribute("data-memory-mastered") || "");
        const c = await getCloudClient();
        if (c && cloudUser) {
          const result = await c
            .from("memory_bank")
            .delete()
            .eq("id", id)
            .eq("user_id", cloudUser.id);
          if (result.error) {
            console.error("delete memory failed", result.error);
            return;
          }
        }
        const removed = memoryRecords.find((row) => String(row.id || "") === id);
        if (removed && memoryKind(removed) === "word" && removed.source_id) {
          cloudMemory.delete(String(removed.source_id));
        }
        memoryExpanded.delete(id);
        memoryRecords = memoryRecords.filter((r) => String(r.id) !== id);
        renderMemoryBank();
        return;
      }

      if (sentenceTab) {
        setActiveTab(
          ".translation-tabs",
          "tabSentence"
        );

        sentencePanel?.removeAttribute(
          "hidden"
        );

        if (translationPanel) {
          translationPanel.hidden = true;
        }

        const sentenceWord = nextSentencePracticeWord();
        renderSentencePrompt(sentenceWord);
        return;
      }

      if (translationTab) {
        setActiveTab(
          ".translation-tabs",
          "tabTranslation"
        );

        if (sentencePanel) {
          sentencePanel.hidden = true;
        }

        translationPanel?.removeAttribute(
          "hidden"
        );

        await loadRandomTranslationQuestion();

        return;
      }

      if (event.target.closest("#submitWriting")) {
        if (!currentWritingQuestion) return;
        const question = currentWritingQuestion;
        const input = document.getElementById("writingInput")?.value || "";
        const submit = document.getElementById("submitWriting");
        const loading = document.getElementById("writingLoading");
        if (submit) submit.disabled = true;
        if (loading) loading.hidden = false;
        try {
          const result = await callPhase2AI("grade_writing", {
            prompt: question.prompt || "",
            answer: question.answer || "",
            user_answer: input
          }, { questionId: question.id || null, module: "writing" });
          if (currentWritingQuestion !== question) return;
          renderWritingResult(result);
          await recordQuestionOutcome({
            module: "writing",
            question,
            sourceId: question.id || "",
            isCorrect: Number(result?.total_score || 0) >= 9,
            userAnswer: input,
            correctAnswer: question.answer || "",
            explanation: question.explanation || ""
          });
          const change = document.getElementById("changeWriting"); if (change) change.disabled = false;
        } catch (error) {
          if (currentWritingQuestion !== question) return;
          const feedback = document.getElementById("writingFeedback");
          if (feedback) { feedback.hidden = false; feedback.textContent = "\u0041\u0049 \u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5"; }
        } finally { if (loading) loading.hidden = true; }
        return;
      }
      if (event.target.closest("#changeWriting")) { await loadRandomWritingQuestion(); return; }

      if (event.target.closest("#startReading")) { await loadRandomReadingQuestion(); return; }
      if (event.target.closest("#changeReading")) { await loadRandomReadingQuestion(); return; }
      if (event.target.closest("#submitReading")) { gradeReading(); return; }
      if (pickReadingBlank(event.target)) return;
      if (pickReadingOption(event.target)) return;

      if (event.target.closest("#startListening")) { await loadRandomListeningQuestion(); return; }
      if (event.target.closest("#changeListening")) { await loadRandomListeningQuestion(); return; }
      if (event.target.closest("#submitListening")) { gradeListening(); return; }
      if (event.target.closest("#toggleListeningStems")) { setListeningStemsHidden(!listeningStemsHidden); return; }
      const rateButton = event.target.closest("[data-listening-rate]");
      if (rateButton) { setListeningRate(rateButton.getAttribute("data-listening-rate")); return; }
      if (pickListeningOption(event.target)) return;

      const diffButton =
        event.target.closest(
          "[data-difficulty]"
      );

      if (diffButton) {
        if (!spellingSession.current) {
          nextSpellingPracticeWord();
        }
        const spellingWord = spellingSession.current;

        document
          .querySelectorAll("[data-difficulty]")
          .forEach((button) => {
            button.classList.toggle(
              "active",
              button === diffButton
            );
          });

        const difficulty = diffButton.dataset.difficulty || "none";
        hintLevel = difficulty;

        if (spellingWord) {
          renderSpellingPrompt(
            spellingWord,
            difficulty
          );

          if (difficulty === "unknown") {
            await upsertWordState(spellingWord, 0);
            finishSpellingRound("\u5df2\u6807\u8bb0\u4e3a\u4e0d\u8ba4\u8bc6\uff0c\u6b63\u786e\u7b54\u6848\u662f\uff1a" + String(spellingWord.word || ""));
          } else {
            const feedback = document.getElementById("spellingFeedback");
            const submit = document.getElementById("submitSpelling");
            const next = document.getElementById("nextSpelling");
            if (feedback) { feedback.hidden = true; feedback.textContent = ""; feedback.innerHTML = ""; }
            if (submit) submit.disabled = false;
            if (next) next.hidden = true;
          }
        }

        return;
      }

      if (event.target.closest("#submitSpelling")) {
        if (!spellingSession.current) {
          const nextWord = nextSpellingPracticeWord();
          if (nextWord) renderSpellingPrompt(nextWord, hintLevel);
        }
        const spellingWord = spellingSession.current;
        if (!spellingWord) return;
        const input = document.getElementById("spellingInput")?.value || "";
        const correct = await gradeSpelling(input, spellingWord);
        if (correct) {
          spellingAttempts = 0;
          finishSpellingRound("\u62fc\u5199\u6b63\u786e\uff0c\u7ee7\u7eed\u52a0\u6cb9\uff01");
        } else {
          spellingAttempts += 1;
          finishSpellingRound("\u62fc\u5199\u6709\u8bef\uff0c\u6b63\u786e\u7b54\u6848\u662f\uff1a" + String(spellingWord.word || ""));
        }
        return;
      }

      if (event.target.closest("#nextSpelling")) {
        resetSpellingRound();
        return;
      }
      if (event.target.closest("#nextSentence, #changeSentence")) {
        const nextWord = nextSentencePracticeWord();
        renderSentencePrompt(nextWord);
        const input = document.getElementById("sentenceInput");
        const feedback = document.getElementById("sentenceFeedback");
        if (input) input.value = "";
        if (feedback) {
          feedback.hidden = true;
          feedback.textContent = "";
          feedback.innerHTML = "";
        }
        return;
      }
      if (event.target.closest("#submitSentence")) {
        if (!sentenceSession.current) {
          const nextWord = nextSentencePracticeWord();
          renderSentencePrompt(nextWord);
        }

        const sentenceWord = sentenceSession.current;
        if (!sentenceWord) return;

        const sentence =
          document.getElementById(
            "sentenceInput"
          )?.value || "";

        const submit =
          document.getElementById(
            "submitSentence"
          );

        const loading =
          document.getElementById(
            "sentenceLoading"
          );

        const feedback =
          document.getElementById(
            "sentenceFeedback"
          );

        const loadingText =
          loading?.querySelector(
            ".loading-text"
          );

        if (loading) {
          loading.hidden = false;
        }

        if (loadingText) {
          loadingText.textContent =
            "\u0041\u0049 \u6b63\u5728\u5206\u6790\uff0c\u8bf7\u7a0d\u5019...";
        }

        if (feedback) {
          feedback.hidden = true;
        }

        if (submit) {
          submit.disabled = true;
        }

        const timer = setTimeout(() => {
          if (loadingText) {
            loadingText.textContent =
              "\u0041\u0049 \u6b63\u5728\u601d\u8003\uff0c\u9a6c\u4e0a\u5c31\u597d...";
          }
        }, 3000);

        try {
          const result = await callPhase2AI(
            "grade_sentence",
            {
              word: sentenceWord.word,
              sentence
            }
          );

          renderSentenceResult(
            result,
            "sentenceFeedback"
          );
        } catch {
          if (feedback) {
            feedback.hidden = false;
            feedback.textContent =
              "\u0041\u0049 \u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5";
          }
        } finally {
          clearTimeout(timer);

          if (loading) {
            loading.hidden = true;
          }

          if (submit) {
            submit.disabled = false;
          }
        }

        return;
      }

      if (event.target.closest("#submitTranslation")) {
        const examType =
          document.querySelector(
            'input[name="examType"]:checked'
          )?.value;

        const userTranslation =
          document.getElementById(
            "translationInput"
          )?.value || "";

        const prompt = currentTranslationQuestion?.prompt || "";

        const feedback =
          document.getElementById(
            "translationFeedback"
          );

        const submit =
          document.getElementById(
            "submitTranslation"
          );

        const loading =
          document.getElementById(
            "translationLoading"
          );

        const loadingText =
          loading?.querySelector(
            ".loading-text"
          );

        if (loading) {
          loading.hidden = false;
        }

        if (loadingText) {
          loadingText.textContent =
            "\u0041\u0049 \u6b63\u5728\u5206\u6790\uff0c\u8bf7\u7a0d\u5019...";
        }

        if (feedback) {
          feedback.hidden = true;
        }

        if (submit) {
          submit.disabled = true;
        }

        const timer = setTimeout(() => {
          if (loadingText) {
            loadingText.textContent =
              "\u0041\u0049 \u6b63\u5728\u601d\u8003\uff0c\u9a6c\u4e0a\u5c31\u597d...";
          }
        }, 3000);

        try {
          const result = await callPhase2AI(
            "grade_translation",
            {
              prompt,
              reference: currentTranslationQuestion?.answer || "",
              userTranslation,
              examType
            },
            { questionId: currentTranslationQuestion?.id || null, module: "translation" }
          );

          if (feedback) {
            feedback.hidden = false;
            feedback.innerHTML = "<b>\u603b\u5206 " + escapeHtml(result.score ?? 0) + "</b>" +
              "<div>\u8bed\u4e49 " + escapeHtml(result.meaningScore ?? 0) + " / \u8bed\u6cd5 " + escapeHtml(result.grammarScore ?? 0) + " / \u81ea\u7136\u5ea6 " + escapeHtml(result.naturalScore ?? 0) + "</div>" +
              "<div>\u4eae\u70b9\uff1a" + escapeHtml(result.strengths || "") + "</div>" +
              "<div>\u95ee\u9898\uff1a" + escapeHtml(result.issues || "") + "</div>" +
              "<div>\u5efa\u8bae\uff1a" + escapeHtml(result.suggestion || "") + "</div>" +
              "<div>\u9898\u5e93\u89e3\u6790\uff1a" + escapeHtml(currentTranslationQuestion?.explanation || "") + "</div>";
            const next = document.getElementById("nextTranslation");
            if (next) next.hidden = false;
          }
          await recordQuestionOutcome({
            module: "translation",
            question: currentTranslationQuestion,
            sourceId: currentTranslationQuestion?.id || "",
            isCorrect: Number(result?.score || 0) >= 60,
            userAnswer: userTranslation,
            correctAnswer: currentTranslationQuestion?.answer || "",
            explanation: currentTranslationQuestion?.explanation || ""
          });
        } catch {
          if (feedback) {
            feedback.hidden = false;
            feedback.textContent =
              "\u0041\u0049 \u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5";
          }
        } finally {
          clearTimeout(timer);

          if (loading) {
            loading.hidden = true;
          }

          if (submit) {
            submit.disabled = false;
          }
        }
      }

      if (event.target.closest("#nextTranslation")) {
        await loadRandomTranslationQuestion();
        return;
      }
    }
  );

  document.addEventListener("mouseup", () => {
    setTimeout(captureExamHighlight, 0);
  });

  document.addEventListener("touchend", () => {
    setTimeout(captureExamHighlight, 80);
  });

  document.addEventListener("DOMContentLoaded", () => {
    window.LearnHubPhase2.bindPhase2UI().catch((error) => {
      console.error("bindPhase2UI failed", error);
    });
  });

  document.addEventListener("change", (event) => {
    const yearSelect = event.target.closest("[data-exam-year]");
    if (yearSelect) {
      const module = yearSelect.getAttribute("data-exam-year") || "";
      if (Object.prototype.hasOwnProperty.call(examYears, module)) {
        examYears[module] = String(yearSelect.value || "");
      }
      if (module === "translation") {
        loadRandomTranslationQuestion().catch((error) => console.error("loadRandomTranslationQuestion failed", error));
      } else if (module === "writing") {
        lastWritingQuestionId = null;
        loadRandomWritingQuestion().catch((error) => console.error("loadRandomWritingQuestion failed", error));
      } else if (module === "reading") {
        lastReadingQuestionId = null;
        loadRandomReadingQuestion().catch((error) => console.error("loadRandomReadingQuestion failed", error));
      } else if (module === "listening") {
        lastListeningQuestionId = null;
        loadRandomListeningQuestion().catch((error) => console.error("loadRandomListeningQuestion failed", error));
      }
      return;
    }
    if (event.target.matches('input[name="examType"]') && !document.getElementById("translationPanel")?.hidden) {
      loadRandomTranslationQuestion().catch((error) => console.error("loadRandomTranslationQuestion failed", error));
    }
    if (event.target.matches('input[name="writingExamType"]') && !document.getElementById("writingPanel")?.hidden) {
      lastWritingQuestionId = null;
      loadRandomWritingQuestion().catch((error) => console.error("loadRandomWritingQuestion failed", error));
    }
    if (event.target.matches('input[name="readingExamType"], input[name="readingQuestionType"]')) {
      if (currentReadingQuestion) {
        lastReadingQuestionId = null;
        loadRandomReadingQuestion().catch((error) => console.error("loadRandomReadingQuestion failed", error));
      }
      return;
    }
    if (event.target.matches('input[name="listeningExamType"], input[name="listeningQuestionType"]')) {
      if (currentListeningQuestion) {
        lastListeningQuestionId = null;
        loadRandomListeningQuestion().catch((error) => console.error("loadRandomListeningQuestion failed", error));
      }
      return;
    }
    if (selectReadingOption(event.target)) return;
  });

  document.addEventListener("input", (event) => {
    if (event.target.id === "writingInput") {
      const words = String(event.target.value || "").trim().split(/\s+/).filter(Boolean).length;
      const count = document.getElementById("writingCount");
      if (count) count.textContent = String(words) + " \u8bcd";
    }
  });
})();

