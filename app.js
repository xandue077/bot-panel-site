(function () {
  "use strict";

  var API = (window.BOTPANEL_API || "").replace(/\/+$/, "");
  var BRIDGE = (window.BOTPANEL_BRIDGE_URL || "").replace(/\/+$/, "");
  var TOKEN_KEY = "botpanel.token";
  var LINK_RE = /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\//i;

  var state = {
    token: null,
    account: null,
    groups: [],
    guildId: "",
    channelId: "",
    mode: null,
    source: "youtube",
    results: [],
    selected: null,
    queue: [],
    busy: false,
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function show(el) {
    el.classList.remove("hidden");
  }
  function hide(el) {
    el.classList.add("hidden");
  }

  function setText(el, text) {
    el.textContent = text;
  }

  function api(path, options) {
    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {});
    if (state.token) headers["x-bot-token"] = state.token;
    if (BRIDGE) headers["x-bot-bridge-url"] = BRIDGE;
    return fetch(API + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body,
      cache: "no-store",
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return { ok: false, error: "Unexpected response from the API." };
        })
        .then(function (data) {
          return { status: res.status, data: data };
        });
    });
  }

  function signedOut(message) {
    state.token = null;
    state.account = null;
    state.groups = [];
    localStorage.removeItem(TOKEN_KEY);
    hide($("app"));
    hide($("boot"));
    show($("login"));
    if (message) {
      setText($("login-error"), message);
      show($("login-error"));
    }
    $("token").focus();
  }

  function avatarUrl(account) {
    if (!account || !account.avatar) return null;
    var ext = account.avatar.indexOf("a_") === 0 ? "gif" : "png";
    return "https://cdn.discordapp.com/avatars/" + account.id + "/" + account.avatar + "." + ext + "?size=96";
  }

  function renderAccount() {
    var account = state.account;
    var name = account.globalName || account.username;
    setText($("me-name"), name);
    setText($("me-sub"), (account.isBot ? "Bot account" : "User account") + " · " + account.username);
    var src = avatarUrl(account);
    var img = $("me-avatar");
    var fallback = $("me-fallback");
    if (src) {
      img.src = src;
      img.alt = name;
      show(img);
      hide(fallback);
    } else {
      hide(img);
      show(fallback);
      setText(fallback, name.slice(0, 1).toUpperCase());
    }
  }

  function renderVoice(loading) {
    var select = $("voice");
    select.innerHTML = "";
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = loading ? "Loading voice channels…" : "Choose a voice channel…";
    select.appendChild(placeholder);

    state.groups.forEach(function (group) {
      var optgroup = document.createElement("optgroup");
      optgroup.label = group.name;
      group.channels.forEach(function (channel) {
        var option = document.createElement("option");
        option.value = group.id + ":" + channel.id;
        option.textContent = (channel.type === 13 ? "Stage · " : "#") + channel.name;
        optgroup.appendChild(option);
      });
      select.appendChild(optgroup);
    });

    select.disabled = loading || state.groups.length === 0;
    select.value = state.guildId && state.channelId ? state.guildId + ":" + state.channelId : "";

    var total = state.groups.reduce(function (sum, group) {
      return sum + group.channels.length;
    }, 0);
    setText(
      $("voice-summary"),
      loading
        ? "Reading servers…"
        : state.groups.length === 0
        ? ""
        : state.groups.length + " server" + (state.groups.length === 1 ? "" : "s") + " · " + total + " voice channel" + (total === 1 ? "" : "s")
    );
    if (!loading) {
      if (state.groups.length === 0) show($("no-guilds"));
      else hide($("no-guilds"));
    }
  }

  function loadVoice() {
    renderVoice(true);
    return api("/api/voice")
      .then(function (result) {
        if (result.status === 401) {
          signedOut("Session expired. Sign in again.");
          return;
        }
        state.groups = result.status === 200 && result.data.ok ? result.data.groups || [] : [];
        renderVoice(false);
        updatePlayState();
      })
      .catch(function () {
        state.groups = [];
        renderVoice(false);
      });
  }

  function renderResults() {
    var list = $("results");
    list.innerHTML = "";
    hide($("skeletons"));
    hide($("no-results"));
    hide($("results-hint"));

    if (state.mode === "search" && state.results.length > 0) {
      state.results.forEach(function (video) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "result" + (state.selected && state.selected.id === video.id ? " active" : "");

        var img = document.createElement("img");
        img.className = "thumb";
        img.src = video.thumb;
        img.alt = "";
        img.loading = "lazy";

        var body = document.createElement("span");
        body.className = "result-body";

        var title = document.createElement("span");
        title.className = "result-title";
        title.textContent = video.title;

        var meta = document.createElement("span");
        meta.className = "result-meta";
        var channel = document.createElement("span");
        channel.textContent = video.channel;
        meta.appendChild(channel);
        if (video.duration) {
          var pill = document.createElement("span");
          pill.className = "pill";
          pill.textContent = video.duration;
          meta.appendChild(pill);
        }

        body.appendChild(title);
        body.appendChild(meta);
        button.appendChild(img);
        button.appendChild(body);
        button.addEventListener("click", function () {
          choose(video);
        });
        list.appendChild(button);
      });
      show(list);
      show($("results-hint"));
      return;
    }

    hide(list);
    if (state.mode === "search" && state.results.length === 0) show($("no-results"));
  }

  function renderSelected() {
    var video = state.selected;
    if (!video) {
      hide($("selected"));
      show($("no-selection"));
      return;
    }
    hide($("no-selection"));
    show($("selected"));
    $("sel-thumb").src = video.thumb;
    $("sel-thumb").alt = "";
    setText($("sel-title"), video.title);
    setText($("sel-channel"), video.channel);
    if (video.duration) {
      setText($("sel-duration"), video.duration);
      show($("sel-duration"));
    } else {
      hide($("sel-duration"));
    }
    $("sel-link").href = video.url;
    updatePlayState();
  }

  function updatePlayState() {
    var canPlay = Boolean(state.selected && state.guildId && state.channelId);
    $("play").disabled = !canPlay || state.busy;
    if (state.selected && !canPlay) show($("need-target"));
    else hide($("need-target"));
  }

  function renderQueue() {
    var list = $("queue");
    list.innerHTML = "";
    if (state.queue.length === 0) {
      hide(list);
      show($("queue-empty"));
      hide($("queue-clear"));
      setText($("queue-sub"), "Empty.");
      return;
    }
    hide($("queue-empty"));
    show(list);
    show($("queue-clear"));
    setText($("queue-sub"), state.queue.length + " video" + (state.queue.length === 1 ? "" : "s"));
    state.queue.forEach(function (video, index) {
      var row = document.createElement("div");
      row.className = "queue-item";

      var num = document.createElement("span");
      num.className = "queue-num";
      num.textContent = String(index + 1);

      var title = document.createElement("span");
      title.className = "queue-title";
      title.textContent = video.title;

      var remove = document.createElement("button");
      remove.className = "icon-btn";
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove " + video.title);
      remove.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>';
      remove.addEventListener("click", function () {
        state.queue = state.queue.filter(function (v) {
          return v.id !== video.id;
        });
        if (state.selected && state.selected.id === video.id) state.selected = null;
        renderQueue();
        renderSelected();
        renderResults();
      });

      row.appendChild(num);
      row.appendChild(title);
      row.appendChild(remove);
      list.appendChild(row);
    });
  }

  function choose(video) {
    state.selected = video;
    var exists = state.queue.some(function (v) {
      return v.id === video.id;
    });
    if (!exists) state.queue = state.queue.concat([video]);
    hide($("play-msg"));
    renderResults();
    renderSelected();
    renderQueue();
  }

  function loadSession() {
    return api("/api/session").then(function (result) {
      if (result.status === 200 && result.data.ok) {
        state.account = result.data.account;
        hide($("boot"));
        hide($("login"));
        show($("app"));
        renderAccount();
        loadVoice();
        renderSelected();
        renderQueue();
        return true;
      }
      signedOut(result.status === 401 ? "" : result.data.error || "");
      return false;
    });
  }

  function login(event) {
    event.preventDefault();
    var token = $("token").value.trim();
    if (token.length < 20) return;
    hide($("login-error"));
    $("login-btn").disabled = true;
    setText($("login-label"), "Connecting…");
    state.token = token;
    api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token }),
    })
      .then(function (result) {
        if (result.status === 200 && result.data.ok) {
          localStorage.setItem(TOKEN_KEY, token);
          $("token").value = "";
          return loadSession();
        }
        state.token = null;
        setText($("login-error"), result.data.error || "Sign-in failed.");
        show($("login-error"));
      })
      .catch(function () {
        state.token = null;
        setText($("login-error"), "Network error. Try again.");
        show($("login-error"));
      })
      .then(function () {
        $("login-btn").disabled = false;
        setText($("login-label"), "Sign in as bot");
      });
  }

  function search(event) {
    event.preventDefault();
    var query = $("query").value.trim();
    if (!query) return;
    hide($("search-error"));
    hide($("results"));
    hide($("results-hint"));
    hide($("no-results"));
    show($("skeletons"));
    $("search-btn").disabled = true;
    setText($("search-label"), "Searching…");
    state.busy = true;
    api("/api/search?source=" + encodeURIComponent(state.source) + "&q=" + encodeURIComponent(query))
      .then(function (result) {
        if (result.status === 401) {
          signedOut("Session expired. Sign in again.");
          return;
        }
        if (result.status === 200 && result.data.ok) {
          state.mode = result.data.mode;
          if (result.data.mode === "url") {
            state.results = [];
            choose(result.data.items[0]);
          } else {
            state.results = result.data.items || [];
          }
          renderResults();
          return;
        }
        setText($("search-error"), result.data.error || "Search failed.");
        show($("search-error"));
      })
      .catch(function () {
        setText($("search-error"), "Network error while searching.");
        show($("search-error"));
      })
      .then(function () {
        hide($("skeletons"));
        $("search-btn").disabled = false;
        setText($("search-label"), "Search");
        state.busy = false;
      });
  }

  function play() {
    if (!state.selected || !state.guildId || !state.channelId) return;
    state.busy = true;
    hide($("play-msg"));
    $("play").disabled = true;
    setText($("play-label"), "Sending…");
    api("/api/play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: state.guildId,
        channelId: state.channelId,
        source: state.selected.source || "youtube",
        url: state.selected.url,
        title: state.selected.title,
      }),
    })
      .then(function (result) {
        var message = $("play-msg");
        if (result.status === 200 && result.data.ok) {
          message.className = "alert alert-ok";
          message.textContent = "Sent to the bot — joining the voice channel.";
        } else {
          message.className = "alert alert-error";
          message.textContent = result.data.error || "The bot refused the request.";
        }
        show(message);
      })
      .catch(function () {
        var message = $("play-msg");
        message.className = "alert alert-error";
        message.textContent = "Network error while contacting the bot.";
        show(message);
      })
      .then(function () {
        setText($("play-label"), "Play in voice");
        state.busy = false;
        updatePlayState();
      });
  }

  function setSource(source) {
    state.source = source;
    var tabs = document.querySelectorAll(".source-tab");
    for (var i = 0; i < tabs.length; i += 1) {
      tabs[i].classList.toggle("active", tabs[i].getAttribute("data-source") === source);
    }
    $("query").placeholder =
      source === "kisskh"
        ? "John Wick, The Glory, Breaking Bad…"
        : "https://youtube.com/watch?v=…  or  lofi hip hop";
    state.results = [];
    state.mode = null;
    renderResults();
    hide($("no-results"));
  }

  function bind() {
    var tabs = document.querySelectorAll(".source-tab");
    for (var i = 0; i < tabs.length; i += 1) {
      tabs[i].addEventListener("click", function () {
        setSource(this.getAttribute("data-source"));
      });
    }
    $("login-form").addEventListener("submit", login);
    $("search-form").addEventListener("submit", search);
    $("query").addEventListener("input", function () {
      if (LINK_RE.test($("query").value.trim())) show($("link-chip"));
      else hide($("link-chip"));
    });
    $("voice").addEventListener("change", function (event) {
      var parts = event.target.value.split(":");
      state.guildId = parts[0] || "";
      state.channelId = parts[1] || "";
      hide($("play-msg"));
      updatePlayState();
    });
    $("play").addEventListener("click", play);
    $("queue-clear").addEventListener("click", function () {
      state.queue = [];
      state.selected = null;
      renderQueue();
      renderSelected();
      renderResults();
    });
    $("logout").addEventListener("click", function () {
      api("/api/logout", { method: "POST" }).catch(function () {});
      signedOut("");
      hide($("login-error"));
    });
  }

  function boot() {
    bind();
    var saved = localStorage.getItem(TOKEN_KEY);
    if (!saved) {
      signedOut("");
      return;
    }
    state.token = saved;
    loadSession().catch(function () {
      signedOut("Could not reach the API.");
    });
  }

  boot();
})();
