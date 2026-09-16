/* LearnHub - Supabase bootstrap.
   The project URL and the anon key are public identifiers; the RLS policies in
   the database are what actually protect the data.
   This file owns the only createClient() call of the front end and publishes the
   result as window.supabaseClient, so every module shares one GoTrue client. */
window.LEARNHUB_SUPABASE = {
  url: "https://hzgywkarjqettdghydmo.supabase.co",
  anonKey: "sb_publishable_S8PQYXW0V9i-PmpAPpbfjA_JqHqHbmi"
};

(function () {
  var SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
  var CONFIG_URL = "/supabase-config.js";

  var sdkPromise = null;
  var clientPromise = null;
  var client = null;

  function config() {
    return window.LEARNHUB_SUPABASE || {};
  }

  function persistentStorage() {
    try {
      return window.localStorage || null;
    } catch (error) {
      return null;
    }
  }

  /* The supabase-js UMD bundle is fetched once, no matter how many modules ask. */
  function loadSdk() {
    if (window.supabase && typeof window.supabase.createClient === "function") return Promise.resolve();
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error("supabase-js failed to load")); };
      document.head.appendChild(script);
    }).catch(function (error) {
      sdkPromise = null;
      throw error;
    });
    return sdkPromise;
  }

  /* The one and only construction site. */
  function create() {
    var cfg = config();
    if (!window.supabase || typeof window.supabase.createClient !== "function") return null;
    if (!cfg.url || !cfg.anonKey) return null;
    var auth = {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "sb-hzgywkarjqettdghydmo-auth-token"
    };
    var storage = persistentStorage();
    if (storage) auth.storage = storage;
    client = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: auth });
    window.supabaseClient = client;
    return client;
  }

  function getClient() {
    if (client) return Promise.resolve(client);
    if (!clientPromise) {
      clientPromise = loadSdk()
        .then(function () { return client || create(); })
        .catch(function (error) {
          if (window.console && window.console.warn) window.console.warn("[supabase] " + (error && error.message ? error.message : error));
          return client || null;
        })
        .then(function (value) {
          if (!value) clientPromise = null;
          return value;
        });
    }
    return clientPromise;
  }

  window.LearnHubSupabase = {
    url: CONFIG_URL,
    getClient: getClient,
    peek: function () { return client; },
    isReady: function () { return !!client; },
    loadSdk: loadSdk,
    reset: function () { client = null; clientPromise = null; sdkPromise = null; window.supabaseClient = null; }
  };
})();
