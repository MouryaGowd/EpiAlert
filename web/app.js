/* EpiAlert web prototype.
   Strict CSP: no inline script or style, no innerHTML. Every string goes through textContent and every
   element is built with the tiny h() helper below. Styling is class-based only. */
(function () {
  "use strict";

  // ---- constants -------------------------------------------------------------------------
  var DEFAULT_LOC = { lat: 12.9759, lng: 77.605 }; // Bangalore city centre
  var FRESH_MS = 10 * 60 * 1000; // server only alerts responders whose location is newer than this
  var PROBLEMS = {
    cardiac: { name: "Cardiac / collapse", short: "Cardiac", hint: "Unresponsive, chest pain, fainted", icon: "heart" },
    bleeding: { name: "Trauma / bleeding", short: "Trauma", hint: "Accident, injury, heavy bleeding", icon: "drop" },
    bone: { name: "Bone / spine", short: "Bone", hint: "Bad fall, fracture, cannot move", icon: "bone" },
    breathing: { name: "Breathing / choking", short: "Breathing", hint: "Cannot breathe, choking, asthma", icon: "wind" },
    other: { name: "Other / not sure", short: "Other", hint: "Seizure, allergy, anything else", icon: "help" },
  };
  var PROBLEM_ORDER = ["cardiac", "bleeding", "bone", "breathing", "other"];
  var SPECS = {
    cardiac: { name: "Cardiac", icon: "heart" },
    trauma: { name: "Trauma / bleeding", icon: "drop" },
    bone: { name: "Bone / spine", icon: "bone" },
    breathing: { name: "Breathing / choking", icon: "wind" },
    general: { name: "General", icon: "plus" },
  };
  var COUNCILS = ["KMC", "TNMC", "MMC", "DMC", "Other"];
  var VERIFY = {
    verified: { tone: "ok", icon: "shield", title: "Verified responder", pill: "Verified" },
    needs_review: { tone: "warn", icon: "hourglass", title: "Under review", pill: "In review" },
    pending: { tone: "warn", icon: "hourglass", title: "Checking the registry", pill: "Pending" },
    rejected: { tone: "bad", icon: "xcircle", title: "Not verified", pill: "Rejected" },
    revoked: { tone: "bad", icon: "xcircle", title: "Verification revoked", pill: "Revoked" },
  };
  var STATUS_LABEL = { OPEN: "Live", ACKNOWLEDGED: "Volunteer coming", RESOLVED: "Resolved", CANCELLED: "Cancelled", FLAGGED: "Flagged false", EXPIRED: "Expired" };

  function isLive(status) { return status === "OPEN" || status === "ACKNOWLEDGED"; }
  function problem(k) { return PROBLEMS[k] || PROBLEMS.other; }

  var state = {
    token: sessionStorage.getItem("epialert_token") || "",
    me: null,
    tab: sessionStorage.getItem("epialert_tab") || "report",
    loc: { lat: DEFAULT_LOC.lat, lng: DEFAULT_LOC.lng, accuracyM: 0, source: "default" },
    skew: 0, // server clock (includes demo offset) minus local clock
    es: null,
    view: null,
    shell: null,
    duty: { loc: null, sentAt: 0 }, // last location this tab sent while going on duty (local knowledge only)
  };

  // ---- tiny DOM helpers ------------------------------------------------------------------
  function h(tag, props) {
    var el = document.createElement(tag);
    var i, k;
    if (props) {
      for (k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        if (k === "class") el.className = props[k];
        else if (k === "text") el.textContent = props[k];
        else if (k.slice(0, 2) === "on" && typeof props[k] === "function") el.addEventListener(k.slice(2), props[k]);
        else if (props[k] === true) el.setAttribute(k, "");
        else if (props[k] !== false && props[k] != null) el.setAttribute(k, props[k]);
      }
    }
    for (i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { append(el, x); });
    else el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function replaceKids(el) { clear(el); for (var i = 1; i < arguments.length; i++) append(el, arguments[i]); }

  // ---- icons (inline SVG, built with createElementNS) ----------------------------------------
  var SVGNS = "http://www.w3.org/2000/svg"; // namespace identifier, not fetched
  var ICONS = {
    pulse: ["M2 12h4.5l2-5 4 10 2.5-6.5 1.5 1.5H22"],
    siren: ["M7 18v-5a5 5 0 0 1 10 0v5", "M5 18h14v3H5z", "M12 2v2", "M4.5 5.5l1.4 1.4", "M19.5 5.5l-1.4 1.4", "M12 13v2"],
    plus: ["M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"],
    bell: ["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.9 1.9 0 0 0 3.4 0"],
    shield: ["M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z", "M8.5 12l2.5 2.5 4.5-5"],
    sliders: ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6", "M9 8h6", "M17 16h6"],
    heart: ["M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z", "M7 12h2.5l1.5-2.5 2 5 1.5-2.5H17"],
    drop: ["M12 2.7l5.7 5.6a8 8 0 1 1-11.4 0z"],
    bone: ["M17 10c.7-.7 1.6-.7 2.5-.4a2.5 2.5 0 1 0-1.9-4.1 2.5 2.5 0 1 0-4.1-1.9c.3.9.3 1.8-.4 2.5L6.9 13.9c-.7.7-1.6.7-2.5.4a2.5 2.5 0 1 0 1.9 4.1 2.5 2.5 0 1 0 4.1 1.9c-.3-.9-.3-1.8.4-2.5z"],
    wind: ["M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2", "M9.6 4.6A2 2 0 1 1 11 8H2", "M12.6 19.4A2 2 0 1 0 14 16H2"],
    help: [{ c: [12, 12, 9.5] }, "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01"],
    pin: ["M12 21.5s-7-6.3-7-12a7 7 0 0 1 14 0c0 5.7-7 12-7 12z", { c: [12, 9.5, 2.5] }],
    gps: [{ c: [12, 12, 7] }, { c: [12, 12, 2.5] }, "M12 2v3", "M12 19v3", "M2 12h3", "M19 12h3"],
    camera: ["M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5z", { c: [12, 13, 3.5] }],
    chev: ["M6 9l6 6 6-6"],
    check: ["M5 12.5l4.5 4.5L19 7.5"],
    x: ["M6 6l12 12", "M18 6L6 18"],
    clock: [{ c: [12, 12, 9.5] }, "M12 7v5l3 2"],
    users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", { c: [9, 7, 4] }, "M22 21v-2a4 4 0 0 0-3-3.9", "M16 3.1a4 4 0 0 1 0 7.8"],
    nav: ["M3 11l19-9-9 19-2-8z"],
    flag: ["M4 22V4", "M4 4h13l-2.5 4.5L17 13H4"],
    phone: ["M6.6 3.5h3l1.6 4.4-2 1.4a11.5 11.5 0 0 0 5.5 5.5l1.4-2 4.4 1.6v3a2 2 0 0 1-2.1 2A16.6 16.6 0 0 1 4.5 5.6a2 2 0 0 1 2.1-2.1z"],
    alert: ["M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z", "M12 9v4", "M12 17h.01"],
    info: [{ c: [12, 12, 9.5] }, "M12 16v-4", "M12 8h.01"],
    hourglass: ["M6 2h12", "M6 22h12", "M7 2c0 5 5 6 5 10s-5 5-5 10", "M17 2c0 5-5 6-5 10s5 5 5 10"],
    xcircle: [{ c: [12, 12, 9.5] }, "M15 9l-6 6", "M9 9l6 6"],
    logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
    eyeoff: ["M3 3l18 18", "M10.6 10.6a2 2 0 0 0 2.8 2.8", "M9.9 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.1", "M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"],
    send: ["M22 2L11 13", "M22 2l-7 20-4-9-9-4z"],
    moon: ["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"],
    forward: ["M13 19l9-7-9-7z", "M2 19l9-7-9-7z"],
    userplus: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", { c: [9, 7, 4] }, "M19 8v6", "M22 11h-6"],
    file: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M8 13h8", "M8 17h5"],
    map: ["M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z", "M9 4v14", "M15 6v14"],
    lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"],
    message: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
    image: ["M3 5h18v14H3z", { c: [8.5, 9.5, 1.5] }, "M21 16l-5-5L5 19"],
    refresh: ["M21 12a9 9 0 1 1-2.6-6.4", "M21 3v6h-6"],
  };
  function icon(name, cls) {
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "icon" + (cls ? " " + cls : ""));
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    (ICONS[name] || ICONS.info).forEach(function (spec) {
      var node;
      if (typeof spec === "string") {
        node = document.createElementNS(SVGNS, "path");
        node.setAttribute("d", spec);
      } else {
        node = document.createElementNS(SVGNS, "circle");
        node.setAttribute("cx", spec.c[0]); node.setAttribute("cy", spec.c[1]); node.setAttribute("r", spec.c[2]);
      }
      svg.appendChild(node);
    });
    return svg;
  }

  // ---- UI primitives ---------------------------------------------------------------------------
  function button(label, cls, iconName, onclick, attrs) {
    var lab = h("span", { text: label });
    var b = h("button", Object.assign({ type: "button", class: "btn " + (cls || "btn-secondary") }, attrs || {}), iconName ? icon(iconName) : null, lab);
    b._label = lab;
    if (onclick) b.addEventListener("click", onclick);
    return b;
  }
  function setLabel(b, text) { if (b._label) b._label.textContent = text; else b.textContent = text; }
  function busy(b, on) {
    if (!b) return;
    b.disabled = !!on;
    b.classList.toggle("is-busy", !!on);
    if (on) b.setAttribute("aria-busy", "true"); else b.removeAttribute("aria-busy");
  }
  /** Disable a button while the promise runs; surface errors in the slot. */
  function run(b, slot, fn) {
    if (slot) showErr(slot, "");
    busy(b, true);
    var p;
    try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
    return p.catch(function (e) { if (slot) showErr(slot, (e && e.message) || "Something went wrong."); })
      .then(function () { busy(b, false); });
  }
  /** Destructive actions need a second tap within 4 s. */
  function confirmTap(b, armedLabel, fn) {
    var original = b._label ? b._label.textContent : b.textContent, timer = null;
    b.addEventListener("click", function () {
      if (b.disabled) return;
      if (!b.classList.contains("is-armed")) {
        b.classList.add("is-armed"); setLabel(b, armedLabel);
        timer = setTimeout(function () { b.classList.remove("is-armed"); setLabel(b, original); }, 4000);
        return;
      }
      clearTimeout(timer); b.classList.remove("is-armed"); setLabel(b, original);
      fn();
    });
    return b;
  }
  function errSlot() { return h("div", { class: "err-slot", role: "alert" }); }
  function showErr(slot, msg) {
    clear(slot);
    if (msg) slot.appendChild(h("div", { class: "form-error" }, icon("alert"), h("span", { text: msg })));
  }
  function pill(text, kind, iconName) {
    return h("span", { class: "pill" + (kind ? " pill-" + kind : "") }, iconName ? icon(iconName) : null, text);
  }
  function livePill(text) { return h("span", { class: "pill pill-live" }, h("span", { class: "dot", "aria-hidden": "true" }), text); }
  function callout(kind, iconName, body, extraCls) {
    return h("div", { class: "callout callout-" + kind + (extraCls ? " " + extraCls : "") }, icon(iconName, "callout-icon"), h("div", { class: "callout-body" }, body));
  }
  function field(labelText, input, hintText, id) {
    var fid = id || "f" + Math.random().toString(36).slice(2, 9);
    input.id = fid;
    var hint = hintText ? h("span", { class: "hint", id: fid + "-hint", text: hintText }) : null;
    if (hint) input.setAttribute("aria-describedby", fid + "-hint");
    return h("div", { class: "field" }, h("label", { class: "label", for: fid, text: labelText }), input, hint);
  }
  function disclosure(title, sub, iconName, body, cls) {
    return h("details", { class: "disclosure" + (cls ? " " + cls : "") },
      h("summary", null,
        iconName ? h("span", { class: "disc-icon" }, icon(iconName)) : null,
        h("span", { class: "disc-title" }, title, sub ? h("span", { class: "disc-sub", text: sub }) : null),
        icon("chev", "chev")),
      h("div", { class: "disc-body" }, body));
  }
  function loadingRow(text) { return h("div", { class: "loading", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), text); }
  function emptyState(iconName, title, text, action, tone) {
    return h("div", { class: "card empty" }, h("div", { class: "empty-art" + (tone ? " tone-" + tone : "") }, icon(iconName)), h("h2", { text: title }), h("p", { text: text }), action || null);
  }
  function pbadge(k, cls) { return h("div", { class: "pbadge" + (cls ? " " + cls : "") }, icon(problem(k).icon)); }

  /** Re-render a section only when its key changes, and never while the user is typing inside it. */
  function isTyping(el) {
    var a = document.activeElement;
    if (!a || !el.contains(a)) return false;
    if (a.tagName === "TEXTAREA" || a.tagName === "SELECT") return true;
    return a.tagName === "INPUT" && !/^(checkbox|radio|button|submit|file)$/.test(a.type);
  }
  function patch(el, key, build) {
    if (el._key === key) return false;
    if (el._key !== undefined && isTyping(el)) return false;
    el._key = key;
    clear(el);
    append(el, build());
    return true;
  }
  /** Keyed list: reuse unchanged children, rebuild changed ones, keep focus on the same control if possible. */
  function syncList(container, items, getId, getKey, build) {
    var cache = container._cache || (container._cache = {});
    var seen = {};
    items.forEach(function (it, idx) {
      var id = getId(it), key = getKey(it), entry = cache[id];
      if (!entry || entry.key !== key) {
        var el = build(it), fk = null;
        if (entry && entry.el.contains(document.activeElement)) fk = document.activeElement.getAttribute("data-fk");
        if (entry && entry.el.parentNode === container) container.replaceChild(el, entry.el);
        entry = cache[id] = { key: key, el: el };
        if (fk) {
          var again = el.querySelector('[data-fk="' + fk + '"]') || el.querySelector(".card-title");
          if (again) again.focus({ preventScroll: true });
        }
      }
      seen[id] = true;
      var at = container.children[idx];
      if (at !== entry.el) container.insertBefore(entry.el, at || null);
    });
    Object.keys(cache).forEach(function (id) {
      if (seen[id]) return;
      if (cache[id].el.parentNode === container) container.removeChild(cache[id].el);
      delete cache[id];
    });
  }

  // ---- formatting -----------------------------------------------------------------------------
  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m) + " m"; }
  function splitDist(m) { return m >= 1000 ? [(m / 1000).toFixed(1), "km away"] : [String(Math.round(m)), "m away"]; }
  function fmtLeft(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    if (s >= 3600) return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
    if (s >= 60) return Math.floor(s / 60) + "m " + (s % 60) + "s";
    return s + "s";
  }
  function fmtAgo(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Math.floor(s / 86400) + " d ago";
  }
  function fmtClock(ts) {
    try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return new Date(ts).toLocaleTimeString(); }
  }
  function fmtOffset(sec) {
    if (!sec) return "none (real time)";
    var d = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
    var parts = [];
    if (d) parts.push(d + "d"); if (hh) parts.push(hh + "h"); if (mm) parts.push(mm + "m"); if (ss && !d) parts.push(ss + "s");
    return "+" + parts.join(" ");
  }
  function fmtKm(km) { return (Math.round(km * 10) / 10) + " km"; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function serverNow() { return Date.now() + state.skew; }
  function mapsLink(lat, lng) { return "https://www.google.com/maps/dir/?api=1&destination=" + lat + "," + lng; }

  // ---- 1 s tickers (countdowns, freshness) ----------------------------------------------------
  var tickers = [];
  function ticker(el, fn) {
    var t = { el: el, fn: fn, born: Date.now() };
    tickers.push(t);
    fn(el);
    return el;
  }
  setInterval(function () {
    tickers = tickers.filter(function (t) {
      if (!t.el.isConnected) return Date.now() - t.born < 5000;
      t.fn(t.el);
      return true;
    });
    maps = maps.filter(function (m) {
      if (m.canvas.isConnected || Date.now() - m.born < 5000) return true;
      if (ro) ro.unobserve(m.canvas);
      return false;
    });
  }, 1000);
  function countdown(expireAt) {
    return ticker(h("span", { class: "tabular" }), function (el) { el.textContent = fmtLeft(expireAt - serverNow()); });
  }
  function agoText(ts) {
    return ticker(h("span"), function (el) { el.textContent = fmtAgo(serverNow() - ts); });
  }

  // ---- api ------------------------------------------------------------------------------------
  function api(method, path, body) {
    var headers = { "Content-Type": "application/json" };
    if (state.token) headers.Authorization = "Bearer " + state.token;
    return fetch(path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
      .catch(function () { throw new Error("Network error. Check your connection and try again."); })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (res.status === 401 && state.token) logout();
          if (!res.ok) throw new Error(j.error || "Request failed (" + res.status + ")");
          return j;
        });
      });
  }

  // ---- toasts ---------------------------------------------------------------------------------
  function toast(text, kind) {
    var root = document.getElementById("toasts");
    var iconName = kind === "danger" ? "alert" : kind === "warn" ? "alert" : kind === "ok" ? "check" : "info";
    var t = h("div", { class: "toast" + (kind ? " toast-" + kind : "") }, icon(iconName), h("span", { class: "toast-text", text: text }));
    var close = h("button", { type: "button", class: "toast-close", "aria-label": "Dismiss notification", onclick: function () { t.remove(); } }, icon("x"));
    t.appendChild(close);
    root.appendChild(t);
    while (root.children.length > 3) root.removeChild(root.firstChild);
    setTimeout(function () { if (t.isConnected) t.remove(); }, kind === "danger" || kind === "warn" ? 12000 : 6000);
  }

  // ---- canvas map (no tiles, no network) -------------------------------------------------------
  var maps = [];
  var ro = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(function (entries) {
    entries.forEach(function (e) { if (e.target._map) paintMap(e.target._map); });
  }) : null;
  if (!ro) window.addEventListener("resize", function () { requestAnimationFrame(repaintMaps); });
  (function () {
    var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    if (!mq) return;
    if (mq.addEventListener) mq.addEventListener("change", repaintMaps); else if (mq.addListener) mq.addListener(repaintMaps);
  })();
  function repaintMaps() { maps.forEach(paintMap); }
  function paintMap(m) { if (m.canvas.isConnected) drawMap(m.canvas, m.spec); }
  function mapCanvas(spec, label, cls) {
    var canvas = h("canvas", { class: "map" + (cls ? " " + cls : ""), role: "img", "aria-label": label });
    var m = { canvas: canvas, spec: spec, born: Date.now() };
    canvas._map = m;
    maps.push(m);
    if (ro) ro.observe(canvas); else requestAnimationFrame(function () { paintMap(m); });
    return canvas;
  }
  function setMapSpec(canvas, spec, label) {
    canvas._map.spec = spec;
    if (label) canvas.setAttribute("aria-label", label);
    paintMap(canvas._map);
  }
  function legend(items) {
    return h("ul", { class: "legend", "aria-label": "Map legend" }, items.map(function (it) {
      return h("li", null, h("span", { class: "sw sw-" + it[0], "aria-hidden": "true" }), it[1]);
    }));
  }

  /** spec: { centre, rings: [{ km, active, at? }], points: [{ lat, lng, kind: incident|responder|you, label, muted, stale }] } */
  function drawMap(canvas, spec) {
    var w = canvas.clientWidth, H = canvas.clientHeight;
    if (!w || !H) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(H * dpr);
    var c = canvas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    var cs = getComputedStyle(document.documentElement);
    function tok(n) { return cs.getPropertyValue(n).trim(); }
    var col = {
      bg: tok("--map-bg"), grid: tok("--map-grid"), major: tok("--map-grid-major"), ring: tok("--map-ring"), ringFill: tok("--map-ring-fill"),
      ringMuted: tok("--map-ring-muted"), incident: tok("--map-incident"), responder: tok("--map-responder"), you: tok("--map-you"),
      label: tok("--map-label"), halo: tok("--map-halo"), stroke: tok("--map-marker-stroke"),
    };
    var centre = spec.centre, rings = spec.rings || [], points = spec.points || [];
    var kmLat = 111.195, kmLng = 111.195 * Math.cos(centre.lat * Math.PI / 180);
    function km(p) { return [(p.lng - centre.lng) * kmLng, (p.lat - centre.lat) * kmLat]; }
    function dist(p) { var d = km(p); return Math.sqrt(d[0] * d[0] + d[1] * d[1]); }
    var extent = 1;
    rings.forEach(function (r) { extent = Math.max(extent, (r.at ? dist(r.at) : 0) + r.km); });
    points.forEach(function (p) { extent = Math.max(extent, dist(p)); });
    extent = Math.min(extent * 1.12, 60);
    var ppk = (Math.min(w, H) / 2 - 12) / extent;
    function xy(p) { var d = km(p); return [w / 2 + d[0] * ppk, H / 2 - d[1] * ppk]; }

    c.fillStyle = col.bg; c.fillRect(0, 0, w, H);

    // grid aligned on the centre
    var steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20], step = steps[steps.length - 1];
    for (var si = 0; si < steps.length; si++) { if (steps[si] * ppk >= 26) { step = steps[si]; break; } }
    var gpx = step * ppk, n, x, y;
    c.lineWidth = 1;
    for (n = -Math.ceil(w / 2 / gpx); n <= Math.ceil(w / 2 / gpx); n++) {
      x = Math.round(w / 2 + n * gpx) + 0.5;
      c.strokeStyle = n % 4 === 0 ? col.major : col.grid;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
    }
    for (n = -Math.ceil(H / 2 / gpx); n <= Math.ceil(H / 2 / gpx); n++) {
      y = Math.round(H / 2 + n * gpx) + 0.5;
      c.strokeStyle = n % 4 === 0 ? col.major : col.grid;
      c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
    }

    c.font = "600 11px system-ui, -apple-system, sans-serif";
    c.textBaseline = "middle";
    function tag(text, tx, ty, fg) {
      var tw = c.measureText(text).width, pw = tw + 12, ph = 18;
      tx = Math.max(4 + pw / 2, Math.min(w - 4 - pw / 2, tx));
      ty = Math.max(4 + ph / 2, Math.min(H - 4 - ph / 2, ty));
      c.fillStyle = col.halo;
      roundRect(c, tx - pw / 2, ty - ph / 2, pw, ph, 9); c.fill();
      c.fillStyle = fg; c.textAlign = "center"; c.fillText(text, tx, ty + 0.5); c.textAlign = "left";
    }

    // rings: reference (dashed) first, active (filled) on top
    rings.slice().sort(function (a, b) { return Number(a.active) - Number(b.active); }).forEach(function (r) {
      var o = xy(r.at || centre), rad = r.km * ppk;
      c.beginPath(); c.arc(o[0], o[1], rad, 0, Math.PI * 2);
      if (r.active) {
        c.fillStyle = col.ringFill; c.fill();
        c.setLineDash([]); c.lineWidth = 2; c.strokeStyle = col.ring; c.stroke();
      } else {
        c.setLineDash([5, 5]); c.lineWidth = 1.25; c.strokeStyle = col.ringMuted; c.stroke(); c.setLineDash([]);
      }
    });
    rings.forEach(function (r) {
      var o = xy(r.at || centre), rad = r.km * ppk;
      tag(fmtKm(r.km), o[0], o[1] - rad, r.active ? col.ring : col.label);
    });

    // markers: you, responders, then incidents on top
    var order = { you: 0, responder: 1, incident: 2 };
    var placed = [];
    points.slice().sort(function (a, b) { return (order[a.kind] || 0) - (order[b.kind] || 0); }).forEach(function (p) {
      var q = xy(p), px = q[0], py = q[1];
      c.globalAlpha = p.muted ? 0.4 : 1;
      if (p.kind === "incident") {
        if (!p.muted) { c.beginPath(); c.arc(px, py, 15, 0, Math.PI * 2); c.fillStyle = col.ringFill; c.fill(); }
        c.beginPath(); c.moveTo(px, py - 10); c.lineTo(px + 10, py); c.lineTo(px, py + 10); c.lineTo(px - 10, py); c.closePath();
        c.fillStyle = col.incident; c.fill(); c.lineWidth = 2; c.strokeStyle = col.stroke; c.stroke();
        c.fillStyle = col.stroke; c.fillRect(px - 1, py - 5, 2, 6); c.fillRect(px - 1, py + 3, 2, 2);
      } else if (p.kind === "you") {
        c.beginPath(); c.arc(px, py, 12, 0, Math.PI * 2); c.globalAlpha = 0.22; c.fillStyle = col.you; c.fill(); c.globalAlpha = 1;
        c.beginPath(); c.arc(px, py, 6.5, 0, Math.PI * 2); c.fillStyle = col.you; c.fill(); c.lineWidth = 2.5; c.strokeStyle = col.stroke; c.stroke();
      } else {
        c.beginPath(); c.arc(px, py, 6, 0, Math.PI * 2);
        if (p.stale) { c.fillStyle = col.bg; c.fill(); c.lineWidth = 2.5; c.strokeStyle = col.responder; c.stroke(); }
        else { c.fillStyle = col.responder; c.fill(); c.lineWidth = 2; c.strokeStyle = col.stroke; c.stroke(); }
      }
      c.globalAlpha = 1;
      if (p.label) {
        var tw = c.measureText(p.label).width, lx = px + 13, ly = py;
        if (lx + tw > w - 4) lx = px - 13 - tw;
        for (var k = 0; k < placed.length; k++) { if (Math.abs(placed[k][1] - ly) < 13 && Math.abs(placed[k][0] - lx) < tw) ly += 13; }
        placed.push([lx, ly]);
        c.lineWidth = 4; c.lineJoin = "round"; c.strokeStyle = col.halo; c.strokeText(p.label, lx, ly);
        c.fillStyle = col.label; c.globalAlpha = p.muted ? 0.6 : 1; c.fillText(p.label, lx, ly); c.globalAlpha = 1;
      }
    });

    // scale bar
    var bars = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20], bar = bars[0];
    for (var bi = 0; bi < bars.length; bi++) { if (bars[bi] * ppk <= 110) bar = bars[bi]; }
    var bx = 12, by = H - 14, bw = bar * ppk;
    c.lineWidth = 4; c.strokeStyle = col.halo; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + bw, by); c.stroke();
    c.lineWidth = 2; c.strokeStyle = col.label; c.beginPath(); c.moveTo(bx, by - 4); c.lineTo(bx, by); c.lineTo(bx + bw, by); c.lineTo(bx + bw, by - 4); c.stroke();
    var bl = bar < 1 ? Math.round(bar * 1000) + " m" : bar + " km";
    c.lineWidth = 4; c.strokeStyle = col.halo; c.strokeText(bl, bx + bw + 6, by - 2);
    c.fillStyle = col.label; c.fillText(bl, bx + bw + 6, by - 2);

    // north
    var nx = w - 18, ny = 20;
    c.beginPath(); c.moveTo(nx, ny - 9); c.lineTo(nx + 6, ny + 6); c.lineTo(nx, ny + 3); c.lineTo(nx - 6, ny + 6); c.closePath();
    c.fillStyle = col.label; c.fill();
    c.textAlign = "center"; c.lineWidth = 4; c.strokeStyle = col.halo; c.strokeText("N", nx, ny + 15); c.fillText("N", nx, ny + 15); c.textAlign = "left";
  }
  function roundRect(c, x, y, w, hh, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
    c.lineTo(x + w, y + hh - r); c.arcTo(x + w, y + hh, x + w - r, y + hh, r);
    c.lineTo(x + r, y + hh); c.arcTo(x, y + hh, x, y + hh - r, r);
    c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r); c.closePath();
  }
  function incidentMapSpec(lat, lng, radiusKm, extra) {
    var rings = [{ km: radiusKm, active: true }];
    [2, 3].forEach(function (r) { if (r !== radiusKm) rings.push({ km: r, active: false }); });
    return { centre: { lat: lat, lng: lng }, rings: rings, points: [{ lat: lat, lng: lng, kind: "incident", label: "Incident" }].concat(extra || []) };
  }

  // ---- location control (shared) ---------------------------------------------------------------
  function locationControl(opts) {
    opts = opts || {};
    var iconBox = h("div", { class: "loc-icon" }, icon("pin"));
    var status = h("p", { class: "loc-status", "aria-live": "polite" });
    var coords = h("p", { class: "loc-coords" });
    var lat = h("input", { class: "input", type: "number", step: "any", inputmode: "decimal", value: String(state.loc.lat) });
    var lng = h("input", { class: "input", type: "number", step: "any", inputmode: "decimal", value: String(state.loc.lng) });
    var phase = null, phaseMsg = "";

    function paint() {
      var l = state.loc, tone = "", text;
      if (phase === "locating") { text = "Finding your location..."; }
      else if (phase === "error") { text = phaseMsg; tone = "warn"; }
      else if (!Number.isFinite(l.lat) || !Number.isFinite(l.lng)) { text = "Enter valid coordinates."; tone = "warn"; }
      else if (l.source === "gps") { text = "GPS fix, accurate to about " + Math.round(l.accuracyM) + " m"; tone = "ok"; }
      else if (l.source === "manual") { text = "Coordinates entered by hand"; }
      else { text = opts.defaultText || "Demo default: Bangalore city centre. Use GPS for a real location."; tone = "warn"; }
      status.textContent = text;
      status.className = "loc-status" + (tone === "warn" ? " tone-warn" : "");
      iconBox.className = "loc-icon" + (tone ? " tone-" + tone : "");
      coords.textContent = Number.isFinite(l.lat) && Number.isFinite(l.lng) ? l.lat.toFixed(5) + ", " + l.lng.toFixed(5) : "";
      if (opts.onChange) opts.onChange();
    }
    function fromInputs() {
      phase = null;
      state.loc = { lat: lat.value === "" ? NaN : Number(lat.value), lng: lng.value === "" ? NaN : Number(lng.value), accuracyM: 0, source: "manual" };
      paint();
    }
    lat.addEventListener("input", fromInputs); lng.addEventListener("input", fromInputs);

    var gps = button("Use my GPS", "btn-secondary btn-sm", "gps", function () {
      if (!navigator.geolocation) { phase = "error"; phaseMsg = "This browser has no location access. Enter coordinates instead."; paint(); return; }
      phase = "locating"; paint(); busy(gps, true);
      navigator.geolocation.getCurrentPosition(function (p) {
        busy(gps, false); phase = null;
        state.loc = { lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy || 0, source: "gps" };
        lat.value = String(state.loc.lat); lng.value = String(state.loc.lng);
        paint();
      }, function (e) {
        busy(gps, false); phase = "error";
        phaseMsg = (e && e.code === 1 ? "Location permission denied." : "Could not get a GPS fix.") + " Try again or enter coordinates.";
        paint();
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 });
    });

    var el = h("div", { class: "loc" },
      h("div", { class: "loc-main" }, iconBox, h("div", { class: "loc-text" }, h("p", { class: "loc-title", text: opts.title || "Location" }), status, coords)),
      h("div", { class: "actions" }, gps),
      disclosure("Enter coordinates manually", null, null, h("div", { class: "grid-2" }, field("Latitude", lat), field("Longitude", lng)), "flat"));
    paint();
    return { el: el };
  }

  // ---- login -----------------------------------------------------------------------------------
  function renderLogin(root) {
    var err = errSlot();
    var phone = h("input", { class: "input", type: "tel", value: "+91", autocomplete: "tel", inputmode: "tel", required: true });
    var name = h("input", { class: "input", type: "text", maxlength: "40", autocomplete: "given-name", placeholder: "e.g. Priya" });
    var code = h("input", { class: "input input-otp", type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "6", pattern: "[0-9]*" });
    var bars = [h("span", { class: "on" }), h("span")];
    var stepTitle = h("h2", { class: "section-title", tabindex: "-1", text: "Sign in with your phone" });
    var stepSub = h("p", { class: "muted", text: "Step 1 of 2. We send a one-time code to confirm your number." });
    var demoCode = h("div", { class: "otp-demo", hidden: true });

    var sendBtn = button("Send code", "btn-primary btn-block", "send", null, { type: "submit" });
    var verifyBtn = button("Verify and sign in", "btn-primary btn-block", "check", null, { type: "submit" });

    var form1 = h("form", { class: "stack-md", novalidate: true },
      field("Phone number", phone, "Include the country code, e.g. +91."),
      field("Your name (optional)", name, "Only shown to you. Never shared with responders or reporters."),
      sendBtn);
    var changeBtn = h("button", { type: "button", class: "link-btn", text: "Change number" });
    var form2 = h("form", { class: "stack-md", novalidate: true, hidden: true },
      demoCode,
      field("6-digit code", code, "Three wrong codes lock this number for 5 minutes."),
      verifyBtn, changeBtn);

    form1.addEventListener("submit", function (e) {
      e.preventDefault();
      run(sendBtn, err, function () {
        return api("POST", "/api/otp/request", { phone: phone.value.trim() }).then(function (r) {
          var fill = h("button", { type: "button", class: "btn btn-secondary btn-sm", text: "Use code" });
          fill.addEventListener("click", function () { code.value = String(r.code); verifyBtn.focus(); });
          replaceKids(demoCode, h("div", null, h("div", { text: "Demo mode: no SMS is sent. Your code is" }), h("strong", { text: String(r.code) })), fill);
          demoCode.hidden = false;
          form1.hidden = true; form2.hidden = false;
          bars[1].className = "on";
          stepTitle.textContent = "Enter your code";
          stepSub.textContent = "Step 2 of 2. Code sent to " + phone.value.trim() + ".";
          code.value = ""; code.focus();
        });
      });
    });
    form2.addEventListener("submit", function (e) {
      e.preventDefault();
      run(verifyBtn, err, function () {
        return api("POST", "/api/otp/verify", { phone: phone.value.trim(), code: code.value.trim(), name: name.value }).then(function (r) {
          state.token = r.token; sessionStorage.setItem("epialert_token", r.token);
          boot();
        });
      });
    });
    changeBtn.addEventListener("click", function () {
      form2.hidden = true; form1.hidden = false; bars[1].className = "";
      stepTitle.textContent = "Sign in with your phone";
      stepSub.textContent = "Step 1 of 2. We send a one-time code to confirm your number.";
      showErr(err, ""); phone.focus();
    });

    var useAdmin = h("button", { type: "button", class: "btn btn-secondary btn-sm", text: "Fill admin number" });
    useAdmin.addEventListener("click", function () { if (!form1.hidden) { phone.value = "+919999999999"; phone.focus(); } });

    root.appendChild(h("div", { class: "login" },
      h("div", { class: "login-hero" },
        h("div", { class: "brand-mark", "aria-hidden": "true" }, icon("pulse")),
        h("h1", null, "Epi", h("span", { text: "Alert" })),
        h("p", { class: "lead", text: "When someone collapses near you, EpiAlert pings verified medical volunteers within 2 to 3 km so trained help can reach them while the ambulance is on its way." })),
      h("ol", { class: "how", "aria-label": "How it works" },
        h("li", null, h("span", { class: "how-icon" }, icon("siren")), "You report what is happening"),
        h("li", null, h("span", { class: "how-icon" }, icon("bell")), "Nearby on-duty volunteers get an alert"),
        h("li", null, h("span", { class: "how-icon" }, icon("users")), "One taps \"I'm coming\" and heads over")),
      h("main", { class: "card stack" },
        h("div", { class: "step-indicator", "aria-hidden": "true" }, bars),
        h("div", { class: "stack-sm" }, stepTitle, stepSub),
        form1, form2, err),
      disclosure("Demo hints", "For evaluators and testers", "info",
        [h("ul", { class: "demo-list" },
          h("li", null, "Admin phone ", h("code", { text: "+919999999999" }), " reviews responders and controls the demo clock."),
          h("li", null, "Use any other number for a normal user. Open a second private window to act as a second person."),
          h("li", null, "Responder registry (council KMC): ", h("code", { text: "12345" }), " Dr. Anita Desai verifies, ", h("code", { text: "56789" }), " Kavya Shetty is ambiguous, others are rejected or go to manual review."),
          h("li", null, "Prototype: runs locally, no SMS is sent and nothing leaves this machine.")),
          h("div", { class: "actions" }, useAdmin)], "subtle")));
    phone.focus();
  }

  // ---- shell -----------------------------------------------------------------------------------
  var TABS = [
    { id: "report", label: "Report", icon: "siren" },
    { id: "responder", label: "Respond", icon: "plus" },
    { id: "alerts", label: "Alerts", icon: "bell" },
    { id: "admin", label: "Admin", icon: "sliders", admin: true },
  ];
  var views = { report: reportView, responder: responderView, alerts: alertsView, admin: adminView };

  function logout() {
    state.token = ""; state.me = null; sessionStorage.removeItem("epialert_token");
    if (state.es) { state.es.close(); state.es = null; }
    closeOverlay(true);
    render();
  }

  function buildShell(root) {
    var me = state.me;
    var tabButtons = {};
    var badge = h("span", { class: "badge", hidden: true, "aria-hidden": "true" });
    var nav = h("nav", { class: "tabbar", "aria-label": "Main" }, TABS.filter(function (t) { return !t.admin || me.user.isAdmin; }).map(function (t) {
      var b = h("button", { type: "button", class: "tab", "data-tab": t.id },
        h("span", { class: "tab-icon" }, icon(t.icon), t.id === "alerts" ? badge : null),
        h("span", { class: "tab-label", text: t.label }));
      b.addEventListener("click", function () { switchTab(t.id, true); });
      tabButtons[t.id] = b;
      return b;
    }));
    var conn = h("span", { class: "conn", hidden: true, role: "status" }, h("span", { class: "dot", "aria-hidden": "true" }), "Reconnecting");
    var userName = h("span", { class: "user-name hide-sm" });
    var out = h("button", { type: "button", class: "btn btn-ghost btn-icon", "aria-label": "Sign out", title: "Sign out", onclick: logout }, icon("logout"));
    var header = h("header", { class: "app-header" }, h("div", { class: "app-header-inner" },
      h("div", { class: "brand" }, h("span", { class: "brand-mark", "aria-hidden": "true" }, icon("pulse")), h("span", { class: "brand-name" }, "Epi", h("span", { text: "Alert" }))),
      nav, h("div", { class: "user" }, conn, userName, out)));
    var notice = h("div", { class: "shell-notice" });
    var main = h("main", { class: "view", id: "main" });
    root.appendChild(header); root.appendChild(notice); root.appendChild(main);
    state.shell = { tabs: tabButtons, badge: badge, conn: conn, userName: userName, notice: notice, main: main, isAdmin: me.user.isAdmin };
    updateShell(me);
  }

  function updateShell(me) {
    var s = state.shell;
    if (!s) return;
    s.userName.textContent = me.user.name;
    var n = me.alerts.length;
    s.badge.textContent = n > 9 ? "9+" : String(n);
    s.badge.hidden = !n;
    if (s.tabs.alerts) s.tabs.alerts.setAttribute("aria-label", n ? "Alerts, " + plural(n, "active alert", "active alerts") : "Alerts");
    document.title = (n ? "(" + n + ") " : "") + "EpiAlert";
    patch(s.notice, me.user.suspended ? "s" : "", function () {
      return me.user.suspended ? h("div", null, callout("danger", "lock", [h("strong", { text: "Your account is suspended." }), h("span", { text: "Two of your reports were flagged as false by responders, so you cannot post new alerts. In an emergency, call 112 / 108." })], "callout-strong")) : null;
    });
  }

  function switchTab(id, userInitiated) {
    if (!views[id] || (id === "admin" && !(state.me && state.me.user.isAdmin))) id = "report";
    if (state.view && state.view.destroy) state.view.destroy();
    state.tab = id;
    sessionStorage.setItem("epialert_tab", id);
    var s = state.shell;
    Object.keys(s.tabs).forEach(function (k) {
      if (k === id) s.tabs[k].setAttribute("aria-current", "page"); else s.tabs[k].removeAttribute("aria-current");
    });
    var v = views[id]();
    state.view = v;
    s.main.className = "view" + (v.wide ? " wide" : "");
    s.notice.className = "shell-notice" + (v.wide ? " wide" : "");
    replaceKids(s.main, v.el);
    v.update(state.me);
    if (userInitiated) {
      window.scrollTo(0, 0);
      if (v.focus) v.focus.focus({ preventScroll: true });
    }
  }

  function render() {
    var root = document.getElementById("app");
    if (state.view && state.view.destroy) state.view.destroy();
    clear(root); state.view = null; state.shell = null;
    if (!state.token) { renderLogin(root); return; }
    if (!state.me) {
      root.appendChild(h("div", { class: "splash" }, h("div", { class: "splash-box" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("p", { class: "muted", role: "status", text: "Loading EpiAlert..." }))));
      return;
    }
    buildShell(root);
    switchTab(state.tab, false);
  }

  var inflight = null;
  function refresh() {
    if (!state.token) return Promise.resolve();
    if (inflight) return inflight.then(function () { return refresh(); });
    inflight = api("GET", "/api/me").then(function (me) {
      state.skew = me.now - Date.now();
      var prev = state.me;
      state.me = me;
      if (!prev || !state.shell || state.shell.isAdmin !== me.user.isAdmin) { render(); return; }
      updateShell(me);
      if (state.view) state.view.update(me);
    }).catch(function () {}).then(function () { inflight = null; });
    return inflight;
  }

  function connectEvents() {
    if (state.es) state.es.close();
    var es = new EventSource("/api/events?token=" + encodeURIComponent(state.token));
    state.es = es;
    es.addEventListener("open", function () { if (state.shell) state.shell.conn.hidden = true; });
    es.addEventListener("error", function () { if (state.shell && state.es === es) state.shell.conn.hidden = false; });
    es.addEventListener("notify", function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.kind === "incident_alert") openAlertOverlay(m);
      else if (m.kind === "no_ack") toast(m.text, "danger");
      else if (m.kind === "responder_coming") toast(m.text, "ok");
      else toast(m.text);
      refresh();
    });
  }

  // ---- live alert overlay ----------------------------------------------------------------------
  var overlay = { queue: [], el: null, prevFocus: null, countEl: null, onKey: null };
  function openAlertOverlay(m) {
    overlay.queue.push(m);
    if (navigator.vibrate) { try { navigator.vibrate([250, 120, 250]); } catch (e) { /* ignore */ } }
    if (overlay.el) { updateOverlayCount(); return; }
    showNextOverlay();
  }
  function updateOverlayCount() {
    if (!overlay.countEl) return;
    var n = overlay.queue.length;
    overlay.countEl.textContent = n ? plural(n, "more alert", "more alerts") + " waiting" : "";
    overlay.countEl.hidden = !n;
  }
  function showNextOverlay() {
    var m = overlay.queue.shift();
    if (!m) return;
    var p = problem(m.problemType);
    var err = errSlot();
    var d = splitDist(m.distanceM || 0);
    var accept = button("I'm coming", "btn-primary btn-xl btn-block", "nav");
    var details = button("View details", "btn-secondary btn-block", null);
    var dismiss = button("Dismiss", "btn-ghost btn-block", null);
    overlay.countEl = h("p", { class: "sheet-count", hidden: true });
    var sheet = h("div", { class: "sheet", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "ov-title", "aria-describedby": "ov-desc" },
      h("div", { class: "sheet-pulse", "aria-hidden": "true" }, icon(p.icon)),
      h("div", { class: "sheet-head" },
        h("span", { class: "eyebrow eyebrow-danger", text: "Medical alert nearby" }),
        h("h2", { class: "sheet-title", id: "ov-title", text: p.name }),
        h("div", { class: "distance" }, h("strong", { text: d[0] }), h("span", { text: d[1] })),
        m.matchesSpeciality ? pill("Matches your speciality", "ok", "check") : pill("General alert", "info")),
      callout("danger", "alert", h("strong", { id: "ov-desc", text: m.text }), "callout-strong"),
      accept, details, dismiss, overlay.countEl, err);
    var wrap = h("div", { class: "overlay" }, sheet);

    accept.addEventListener("click", function () {
      run(accept, err, function () {
        return api("POST", "/api/incidents/" + m.incidentId + "/respond").then(function () {
          toast("You are marked as coming. The reporter only sees your rounded distance.", "ok");
          closeOverlay();
          switchTab("alerts", true);
          return refresh();
        });
      });
    });
    details.addEventListener("click", function () { closeOverlay(); switchTab("alerts", true); });
    dismiss.addEventListener("click", function () { closeOverlay(); });
    wrap.addEventListener("click", function (e) { if (e.target === wrap) closeOverlay(); });

    overlay.onKey = function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeOverlay(); return; }
      if (e.key !== "Tab") return;
      var f = Array.prototype.filter.call(sheet.querySelectorAll("button, a[href]"), function (x) { return !x.disabled && !x.hidden; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", overlay.onKey);
    overlay.prevFocus = document.activeElement;
    overlay.el = wrap;
    document.getElementById("overlay-root").appendChild(wrap);
    document.body.classList.add("has-overlay");
    document.getElementById("app").setAttribute("inert", "");
    updateOverlayCount();
    accept.focus();
  }
  function closeOverlay(all) {
    if (all) overlay.queue = [];
    if (!overlay.el) return;
    overlay.el.remove(); overlay.el = null; overlay.countEl = null;
    document.removeEventListener("keydown", overlay.onKey);
    document.body.classList.remove("has-overlay");
    document.getElementById("app").removeAttribute("inert");
    var pf = overlay.prevFocus; overlay.prevFocus = null;
    if (overlay.queue.length) { showNextOverlay(); return; }
    if (pf && pf.isConnected && pf.focus) pf.focus({ preventScroll: true });
  }

  // ---- report tab ------------------------------------------------------------------------------
  function reportView() {
    var heading = h("h1", { class: "page-title", tabindex: "-1", text: "Report an emergency" });
    var lead = h("p", { class: "muted", text: "Alerts verified medical volunteers within 2 to 3 km. Keep calling 112 / 108 too." });
    var live = h("div", { class: "stack" });
    var past = h("div", { class: "section" });
    var err = errSlot();

    // problem tiles (radio group)
    var tiles = h("div", { class: "tiles" }, PROBLEM_ORDER.map(function (k) {
      var p = PROBLEMS[k];
      return h("label", { class: "tile" },
        h("input", { type: "radio", name: "problemType", value: k }),
        h("span", { class: "tile-body" },
          h("span", { class: "tile-icon", "aria-hidden": "true" }, icon(p.icon)),
          h("span", { class: "tile-text" }, h("span", { class: "tile-name", text: p.name }), h("span", { class: "tile-hint", text: p.hint }))));
    }));
    var typeSet = h("fieldset", { class: "group" }, h("legend", { class: "section-title", text: "What's happening?" }), tiles);
    function chosenType() { var c = tiles.querySelector("input:checked"); return c ? c.value : ""; }

    var loc = locationControl({ title: "Where is it?" });

    var note = h("textarea", { class: "textarea", maxlength: "280", placeholder: "e.g. Near the bus stop, man about 60, not breathing. No names please." });
    var counter = h("span", { class: "counter", "aria-live": "off", text: "0 / 280" });
    note.addEventListener("input", function () { counter.textContent = note.value.length + " / 280"; });
    var noteBox = disclosure("Add a short note", "Optional. Helps volunteers find the spot", "message", [field("Note for volunteers", note, "Do not include names or phone numbers."), counter]);

    var sendHint = h("p", { class: "hint", "aria-live": "polite" });
    var photo = photoControl(updateHint);
    function updateHint() {
      var st = photo.status();
      sendHint.textContent = st === "ready" ? "The blurred photo is sent right after the alert."
        : st === "open" ? "Photo not confirmed yet. The alert will go without it."
          : "Your location is shared once, with nearby volunteers only.";
    }
    updateHint();

    var post = button("Send alert", "btn-primary btn-xl btn-block", "send");
    post.addEventListener("click", function () {
      var type = chosenType();
      if (!type) {
        showErr(err, "Choose what's happening first.");
        var first = tiles.querySelector("input"); if (first) first.focus();
        return;
      }
      var willSendPhoto = photo.ready();
      var dataUrl = willSendPhoto ? photo.dataUrl() : null;
      var l = state.loc, newId = null;
      run(post, err, function () {
        return api("POST", "/api/incidents", { lat: l.lat, lng: l.lng, accuracyM: l.accuracyM, problemType: type, note: note.value, withPhoto: willSendPhoto })
          .then(function (r) {
            newId = r.id;
            // ADR-1: the alert has already gone out; the blurred photo follows and can fail without cancelling it.
            var p = willSendPhoto
              ? api("POST", "/api/incidents/" + r.id + "/photo", { data: dataUrl }).catch(function () {
                return api("POST", "/api/incidents/" + r.id + "/photo", { data: null }).catch(function () {});
              })
              : Promise.resolve();
            toast(r.deduped ? "Already reported nearby. You are linked to that alert." : "Alert sent to nearby volunteers.", "ok");
            note.value = ""; counter.textContent = "0 / 280"; photo.reset();
            var c = tiles.querySelector("input:checked"); if (c) c.checked = false;
            noteBox.open = false;
            return p;
          })
          .then(refresh)
          .then(function () {
            var card = newId && live.querySelector('[data-id="' + newId + '"]');
            if (card) {
              card.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
              var t = card.querySelector(".card-title"); if (t) t.focus({ preventScroll: true });
            }
          });
      });
    });

    var formBody = h("div", { class: "stack", id: "report-form" },
      typeSet,
      loc.el,
      noteBox,
      photo.el,
      h("div", { class: "send-bar" }, post, sendHint),
      err);
    var formTitle = h("h2", { class: "section-title", text: "Need to report something else?" });
    var toggle = button("Report another incident", "btn-secondary btn-sm", "plus", null, { "aria-expanded": "true", "aria-controls": "report-form" });
    var formHead = h("div", { class: "row-between", hidden: true }, formTitle, toggle);
    function setCollapsed(on) {
      formBody.hidden = on;
      toggle.setAttribute("aria-expanded", String(!on));
      setLabel(toggle, on ? "Report another incident" : "Hide form");
    }
    toggle.addEventListener("click", function () {
      setCollapsed(!formBody.hidden);
      if (!formBody.hidden) { var f = tiles.querySelector("input"); if (f) f.focus(); }
    });
    var formCard = h("section", { class: "card stack", "aria-label": "Report form" }, formHead, formBody);

    var hadActive = null;
    function update(me) {
      var mine = me.mine.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
      var active = mine.filter(function (i) { return isLive(i.status); });
      var closed = mine.filter(function (i) { return !isLive(i.status); });

      syncList(live, active, function (i) { return i.id; }, posterKey, posterCard);

      var hasActive = active.length > 0;
      if (hasActive !== hadActive && !isTyping(formCard)) {
        formHead.hidden = !hasActive;
        setCollapsed(hasActive);
        heading.textContent = hasActive ? "Your alert is live" : "Report an emergency";
        lead.textContent = hasActive ? "Keep this screen open. It updates by itself." : "Alerts verified medical volunteers within 2 to 3 km. Keep calling 112 / 108 too.";
        hadActive = hasActive;
      }

      post.disabled = !!me.user.suspended || post.classList.contains("is-busy");
      setLabel(post, me.user.suspended ? "Posting is suspended" : "Send alert");

      patch(past, closed.map(function (i) { return i.id + i.status; }).join("|"), function () {
        if (!closed.length) return null;
        return h("section", { class: "card stack-md" },
          h("h2", { class: "section-title", text: "Earlier reports" }),
          h("ul", { class: "list" }, closed.map(function (i) {
            var p = problem(i.problemType);
            return h("li", { class: "list-item" },
              h("span", { class: "li-icon" + (i.status === "RESOLVED" ? " tone-ok" : "") }, icon(p.icon)),
              h("div", { class: "li-body" }, h("p", { class: "li-title", text: p.name }), h("p", { class: "li-meta", text: "Reported " + fmtClock(i.createdAt) + ". Removed automatically 24 h after posting." })),
              pill(STATUS_LABEL[i.status] || i.status, i.status === "RESOLVED" ? "ok" : ""));
          })));
      });
    }

    return {
      el: h("div", { class: "stack" }, h("div", { class: "view-head" }, heading, lead), live, formCard, past),
      update: update,
      focus: heading,
      destroy: function () { photo.reset(); },
    };
  }

  function posterKey(i) {
    return [i.status, i.ackCount, i.alertedCount, i.radiusKm, i.reportCount, i.notice, i.photo.state, i.photo.data ? i.photo.data.length : 0,
      i.responders.map(function (r) { return r.distanceM; }).join(","), i.expireAt].join("|");
  }

  function posterCard(i) {
    var p = problem(i.problemType);
    var err = errSlot();
    var open = i.status === "OPEN", ack = i.status === "ACKNOWLEDGED";
    var statusPill = ack ? pill("Volunteer coming", "ok", "check") : open ? livePill("Live") : pill(STATUS_LABEL[i.status] || i.status);

    var steps = [];
    steps.push(step("done", "Alert sent", "At " + fmtClock(i.createdAt)));
    if (i.alertedCount > 0) steps.push(step("done", plural(i.alertedCount, "volunteer alerted", "volunteers alerted"), "Within " + fmtKm(i.radiusKm) + (i.radiusKm > 2 ? ", widened after 1 minute" : "")));
    else steps.push(step(open ? "current" : "todo", "Looking for on-duty volunteers", i.radiusKm >= 3 ? "Searching within 3 km." : "Searching within 2 km. Widens to 3 km after 1 minute."));
    if (i.ackCount > 0) {
      steps.push(step("done", i.ackCount === 1 ? "A volunteer is coming" : i.ackCount + " volunteers are coming",
        i.responders.length ? "About " + i.responders.map(function (r) { return fmtDist(r.distanceM); }).join(", ") + " away" : null));
    } else {
      steps.push(step(open && i.alertedCount > 0 ? "current" : "todo", open && i.alertedCount > 0 ? "Waiting for a volunteer to accept" : "Volunteer coming", null));
    }
    if (i.status === "RESOLVED") steps.push(step("done", "Resolved", null));
    else if (ack) steps.push(step("current", "Hand over and resolve", "Tap Resolved once an ambulance takes over or the person is safe."));
    else if (i.status === "CANCELLED") steps.push(step("fail", "Cancelled", null));
    else if (i.status === "FLAGGED") steps.push(step("fail", "Closed: flagged as a false report", null));
    else if (i.status === "EXPIRED") steps.push(step("fail", "Expired", null));
    else steps.push(step("todo", "Resolved", null));

    var photoBlock = null;
    if (i.photo.state === "ready" && i.photo.data) photoBlock = h("figure", { class: "photo-figure" }, h("img", { class: "media", src: i.photo.data, alt: "Blurred photo of the scene" }), h("figcaption", { text: "Faces were blurred on your device before upload." }));
    else if (i.photo.state === "pending") photoBlock = h("p", { class: "meta" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Photo uploading. The alert has already gone out.");
    else if (i.photo.state === "rejected") photoBlock = callout("info", "eyeoff", h("span", { text: "Photo was not sent because the blur could not be confirmed. The alert still stands." }));

    var actions = null;
    if (open || ack) {
      var cancel = button("Cancel alert", ack ? "btn-ghost" : "btn-danger-outline", "x", null, { "data-fk": "cancel" });
      confirmTap(cancel, "Tap again to cancel", function () { act(i.id, "cancel", cancel, err, "Alert cancelled."); });
      var resolve = ack ? button("Resolved / handed to ambulance", "btn-care btn-block", "check", function () { act(i.id, "resolve", resolve, err, "Marked as resolved. Thank you."); }, { "data-fk": "resolve" }) : null;
      actions = h("div", { class: "actions-stack" }, resolve, cancel);
    }

    var map = mapCanvas(incidentMapSpec(i.lat, i.lng, i.radiusKm), "Map: your incident with the current " + fmtKm(i.radiusKm) + " alert radius. Volunteer locations are never shown.");

    return h("article", { class: "card card-live", "data-id": i.id, "aria-label": "Your report: " + p.name },
      h("div", { class: "card-head" },
        pbadge(i.problemType),
        h("div", { class: "card-head-text" }, h("span", { class: "eyebrow eyebrow-danger", text: "Your report" }), h("h2", { class: "card-title", tabindex: "-1", text: p.name })),
        statusPill),
      i.notice ? h("div", { class: "callout callout-warn callout-escalation", role: "alert" },
        icon("alert", "callout-icon"),
        h("div", { class: "callout-body" }, h("strong", { text: i.notice }), h("span", { text: "Keep trying emergency services. EpiAlert will keep looking." }),
          h("div", { class: "actions" }, h("a", { class: "btn btn-primary btn-sm", href: "tel:108" }, icon("phone"), "Call 108"), h("a", { class: "btn btn-secondary btn-sm", href: "tel:112" }, icon("phone"), "Call 112")))) : null,
      h("ol", { class: "stepper", "aria-label": "Progress" }, steps),
      i.reportCount > 1 ? h("p", { class: "meta" }, icon("users"), plural(i.reportCount, "person", "people") + " reported this incident.") : null,
      i.note ? h("blockquote", { class: "note-quote" }, h("span", { class: "eyebrow", text: "Your note" }), h("span", { text: i.note })) : null,
      photoBlock,
      h("div", { class: "map-wrap" }, map, legend([["incident", "Incident"], ["ring", "Alert radius"], ["ref", "2 / 3 km rings"]])),
      h("div", { class: "row-between" },
        h("span", { class: "meta" }, icon("clock"), "Expires in ", countdown(i.expireAt)),
        h("span", { class: "meta" }, icon("lock"), "Volunteer names and locations stay private")),
      actions, err);
  }
  function step(kind, title, meta) {
    var dot = h("span", { class: "step-dot", "aria-hidden": "true" }, kind === "done" ? icon("check") : kind === "fail" ? icon("x") : null);
    var sr = { done: "Done: ", current: "In progress: ", todo: "Not yet: ", fail: "" }[kind];
    return h("li", { class: "step " + kind }, dot, h("div", { class: "step-body" }, h("p", { class: "step-title" }, h("span", { class: "sr-only", text: sr }), title), meta ? h("p", { class: "step-meta", text: meta }) : null));
  }
  function act(id, action, b, slot, okMsg) {
    return run(b, slot, function () {
      return api("POST", "/api/incidents/" + id + "/" + action).then(function () { if (okMsg) toast(okMsg, "ok"); return refresh(); });
    });
  }

  // ---- photo (camera only, blur on device, fail closed) -----------------------------------------
  function photoControl(onChange) {
    var hasDetector = "FaceDetector" in window;
    var status = h("p", { class: "photo-status", "aria-live": "polite" });
    var video = h("video", { class: "media", autoplay: true, playsinline: true, muted: true, hidden: true });
    var preview = h("img", { class: "media", alt: "Blurred preview of your photo", hidden: true });
    var confirm = h("input", { type: "checkbox" });
    var confirmRow = h("label", { class: "check", hidden: true }, confirm, h("span", { text: "I checked the preview: no identifiable faces are visible" }));
    var stream = null, result = null;

    function setStatus(text, tone) { status.textContent = text; status.className = "photo-status" + (tone ? " tone-" + tone : ""); }
    function changed() { if (onChange) onChange(); }
    function stop() { if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; } video.hidden = true; snap.hidden = true; }
    function reset() {
      stop(); result = null; preview.hidden = true; preview.removeAttribute("src");
      confirmRow.hidden = true; confirm.checked = false; setStatus(""); start.hidden = false; setLabel(start, "Open camera");
      if (box.open) box.open = false;
      changed();
    }

    var start = button("Open camera", "btn-secondary", "camera", function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setStatus("No camera available here. You can still send the alert without a photo.", "warn"); return; }
      result = null; preview.hidden = true; confirmRow.hidden = true; confirm.checked = false; changed();
      busy(start, true);
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(function (s) {
        busy(start, false);
        stream = s; video.srcObject = s; video.hidden = false; snap.hidden = false; start.hidden = true;
        setStatus("Camera only: photos cannot be picked from the gallery.");
        snap.focus();
      }).catch(function () { busy(start, false); setStatus("Camera permission denied. You can still send the alert without a photo.", "warn"); });
    }, { disabled: !hasDetector });
    var snap = button("Take photo", "btn-primary", "camera", function () {
      var w = video.videoWidth, hgt = video.videoHeight;
      if (!w) return;
      var canvas = document.createElement("canvas"); canvas.width = Math.min(w, 960); canvas.height = Math.round(canvas.width * hgt / w);
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      stop();
      setStatus("Blurring faces on this device...");
      processPhoto(canvas).then(function (r) {
        result = r;
        start.hidden = false; setLabel(start, "Retake photo");
        if (r.error) { setStatus(r.error + " The photo will not be sent, but the alert still can be.", "warn"); preview.hidden = true; confirmRow.hidden = true; changed(); return; }
        preview.src = r.dataUrl; preview.hidden = false; confirmRow.hidden = false; confirm.checked = false;
        setStatus(plural(r.faces, "face", "faces") + " blurred. Blur is best-effort: check the preview and retake if any face is visible. The original is never uploaded.");
        changed();
      });
    }, { hidden: true });
    confirm.addEventListener("change", function () {
      if (confirm.checked && result && !result.error) setStatus("Photo ready. It is sent right after the alert.", "ok");
      changed();
    });

    var body = [
      h("ol", { class: "photo-steps" }, h("li", { text: "1. Take a photo" }), h("li", { text: "2. Faces blurred here" }), h("li", { text: "3. You confirm" })),
      hasDetector ? null : callout("warn", "eyeoff", h("span", { text: "This browser cannot detect faces, so a photo cannot be made safe here. Send the alert without one." })),
      h("div", { class: "actions" }, start, snap),
      video, status,
      h("figure", { class: "photo-figure" }, preview),
      confirmRow,
    ];
    var box = disclosure("Add a photo", "Optional. Camera only, faces blurred on this device", "camera", body);
    box.addEventListener("toggle", function () { if (!box.open && (stream || result)) reset(); changed(); });

    return {
      el: box,
      ready: function () { return !!(box.open && result && !result.error && confirm.checked); },
      status: function () { return box.open && result && !result.error && confirm.checked ? "ready" : box.open && result ? "open" : "none"; },
      dataUrl: function () { return result.dataUrl; },
      reset: reset,
    };
  }

  /** Detect faces, pixelate them, re-encode (drops all EXIF). Fails closed: no detector or any error means no photo. */
  function processPhoto(canvas) {
    var timeout = new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, 8000); });
    var work = new Promise(function (resolve, reject) {
      if (!("FaceDetector" in window)) { reject(new Error("This browser cannot detect faces, so the photo cannot be made safe.")); return; }
      var det = new window.FaceDetector({ fastMode: false, maxDetectedFaces: 20 });
      det.detect(canvas).then(function (faces) {
        var ctx = canvas.getContext("2d"), w = canvas.width, hgt = canvas.height;
        var img = ctx.getImageData(0, 0, w, hgt);
        faces.forEach(function (f) {
          var box = window.Blur.padBox(f.boundingBox, w, hgt, 0.3);
          window.Blur.pixelateRegion(img.data, w, hgt, box, window.Blur.blockSizeFor(box));
        });
        ctx.putImageData(img, 0, 0);
        resolve({ faces: faces.length, dataUrl: canvas.toDataURL("image/jpeg", 0.8) });
      }).catch(reject);
    });
    return Promise.race([work, timeout]).catch(function (e) {
      return { error: e && e.message && e.message !== "timeout" ? e.message : "Face blur failed or timed out." };
    });
  }

  // ---- responder tab ---------------------------------------------------------------------------
  function chips(selected, onChange) {
    var buttons = {};
    var el = h("div", { class: "chips", role: "group", "aria-label": "Specialities" }, Object.keys(SPECS).map(function (k) {
      var b = h("button", { type: "button", class: "chip", "aria-pressed": String(selected.indexOf(k) >= 0) },
        icon(SPECS[k].icon, "chip-icon"), icon("check", "chip-check"), SPECS[k].name);
      b.addEventListener("click", function () { b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); if (onChange) onChange(); });
      buttons[k] = b;
      return b;
    }));
    return {
      el: el,
      values: function () { return Object.keys(buttons).filter(function (k) { return buttons[k].getAttribute("aria-pressed") === "true"; }); },
      set: function (list) { Object.keys(buttons).forEach(function (k) { buttons[k].setAttribute("aria-pressed", String(list.indexOf(k) >= 0)); }); },
    };
  }

  function responderView() {
    var heading = h("h1", { class: "page-title", tabindex: "-1", text: "Respond" });
    var lead = h("p", { class: "muted", text: "Doctors, nurses and trained first-aiders can volunteer to be alerted to emergencies nearby." });
    var statusSec = h("div", { class: "section" });
    var formSec = h("div", { class: "section" });
    var verifiedSec = h("div", { class: "stack" });
    var verifiedUi = null;

    function update(me) {
      var p = me.profile;
      patch(statusSec, p ? [p.status, p.reason, p.verifiedBy, p.qualification, p.council].join("|") : "none", function () { return p ? statusCard(p) : null; });
      var needForm = !p || p.status === "rejected" || p.status === "revoked";
      patch(formSec, needForm ? "form" : "", function () { return needForm ? registerCard(p) : null; });
      if (p && p.status === "verified") {
        if (!verifiedUi) { verifiedUi = verifiedPanel(me); replaceKids(verifiedSec, verifiedUi.el); }
        verifiedUi.update(me);
      } else if (verifiedUi) { verifiedUi = null; clear(verifiedSec); }
      heading.textContent = p && p.status === "verified" ? "Volunteer duty" : "Become a responder";
    }

    function statusCard(p) {
      var v = VERIFY[p.status] || VERIFY.pending;
      var extra = p.status === "needs_review" ? "A human reviewer will decide. You cannot go on duty until you are verified."
        : p.status === "rejected" || p.status === "revoked" ? "You can correct your details and resubmit below."
          : p.status === "verified" ? (p.verifiedBy === "manual" ? "Approved by a reviewer." : "Matched the medical council registry.") : "";
      return h("section", { class: "card status-card tone-" + v.tone, "aria-label": "Verification status" },
        h("div", { class: "status-icon", "aria-hidden": "true" }, icon(v.icon)),
        h("div", { class: "status-body" },
          h("div", { class: "row-between" }, h("h2", { class: "section-title", text: v.title }), pill(v.pill, v.tone === "bad" ? "bad" : v.tone)),
          p.reason ? h("p", { text: p.reason }) : null,
          extra ? h("p", { class: "muted", text: extra }) : null,
          h("p", { class: "hint", text: [p.qualification, p.council].filter(Boolean).join(" · ") })));
    }

    function registerCard(prev) {
      var err = errSlot();
      var name = h("input", { class: "input", type: "text", autocomplete: "name", required: true });
      var qual = h("input", { class: "input", type: "text", value: "MBBS", required: true });
      var reg = h("input", { class: "input", type: "text", inputmode: "numeric", required: true });
      var year = h("input", { class: "input", type: "number", value: "2015", min: "1950", max: "2100", inputmode: "numeric" });
      var council = h("select", { class: "select", required: true }, COUNCILS.map(function (c) { return h("option", { value: c, text: c }); }));
      var specs = chips(prev && prev.specialities ? prev.specialities : ["general"]);
      var proof = h("input", { class: "input", type: "file", accept: "image/*" });
      var submit = button(prev ? "Resubmit for verification" : "Submit for verification", "btn-primary btn-block", "shield", null, { type: "submit" });
      var form = h("form", { class: "stack", novalidate: true },
        h("fieldset", { class: "group" }, h("legend", { text: "About you" }),
          field("Full name", name, "Exactly as on your medical registration."),
          field("Qualification", qual, "e.g. MBBS, BSc Nursing, certified first-aider.")),
        h("fieldset", { class: "group" }, h("legend", { text: "Registration" }),
          h("div", { class: "grid-2" }, field("Registration number", reg), field("Registration year", year)),
          field("State Medical Council", council, "Required. The demo registry uses KMC."),
          field("Proof photo", proof, "Prototype: not uploaded or stored.")),
        h("fieldset", { class: "group" }, h("legend", { text: "What can you help with?" }),
          h("p", { class: "hint", text: "Alerts that match your specialities are sent to you first." }), specs.el),
        disclosure("Demo registry numbers", "For testing verification outcomes", "info",
          h("ul", { class: "demo-list" },
            h("li", null, h("code", { text: "12345" }), " Dr. Anita Desai: verifies automatically"),
            h("li", null, h("code", { text: "56789" }), " Kavya Shetty: partial name match, goes to review"),
            h("li", null, h("code", { text: "23456" }), " Rohit Sharma, ", h("code", { text: "34567" }), " inactive, ", h("code", { text: "45678" }), " blacklisted: rejected"),
            h("li", null, "Any other number goes to manual review. Council must be KMC.")), "subtle"),
        submit, err);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        run(submit, err, function () {
          return api("POST", "/api/responder/register", { fullName: name.value, qualification: qual.value, regNo: reg.value, council: council.value, regYear: Number(year.value), specialities: specs.values() })
            .then(function (r) {
              toast(r.status === "verified" ? "Verified. You can now go on duty." : r.status === "needs_review" ? "Sent to a human reviewer." : "Not verified. See the reason above.", r.status === "verified" ? "ok" : r.status === "rejected" ? "warn" : null);
              var a = document.activeElement; if (a && a.blur) a.blur();
              return refresh();
            });
        });
      });
      return h("section", { class: "card stack", "aria-label": "Responder registration" },
        h("div", { class: "stack-sm" },
          h("h2", { class: "card-title", text: prev ? "Resubmit your credentials" : "Register as a responder" }),
          h("p", { class: "muted", text: "Registry matches are verified automatically. Anything uncertain goes to a human reviewer." })),
        form);
    }

    return {
      el: h("div", { class: "stack" }, h("div", { class: "view-head" }, heading, lead), statusSec, verifiedSec, formSec),
      update: update,
      focus: heading,
    };
  }

  function verifiedPanel(me) {
    // specialities
    var specErr = errSlot();
    var dirty = false;
    var save = button("Save specialities", "btn-secondary", "check");
    save.disabled = true;
    var specs = chips(me.profile.specialities, function () { dirty = true; save.disabled = false; });
    save.addEventListener("click", function () {
      run(save, specErr, function () {
        return api("POST", "/api/responder/specialities", { specialities: specs.values() }).then(function () { dirty = false; toast("Specialities saved.", "ok"); return refresh(); });
      }).then(function () { save.disabled = !dirty; });
    });

    // duty
    var dutyErr = errSlot();
    var sw = h("button", { type: "button", class: "switch", role: "switch", "aria-checked": "false", "aria-labelledby": "duty-state", "aria-describedby": "duty-sub" });
    var dutyState = h("p", { class: "duty-state", id: "duty-state" });
    var dutySub = h("p", { class: "muted", id: "duty-sub" });
    var dutyRow = h("div", { class: "duty-row" }, h("div", { class: "duty-text" }, dutyState, dutySub), sw);
    var fresh = ticker(h("div", { class: "fresh" }), paintFresh);
    var loc = locationControl({ title: "Location to share", defaultText: "Demo default: Bangalore city centre. Use GPS to share where you really are." });
    var upd = button("Update my location", "btn-secondary btn-block", "refresh");
    var onDuty = !!me.onDuty;

    function sendDuty(on) {
      var l = state.loc;
      return api("POST", "/api/duty", { onDuty: on, lat: l.lat, lng: l.lng }).then(function () {
        if (on) { state.duty.loc = { lat: l.lat, lng: l.lng }; state.duty.sentAt = serverNow(); }
        else { state.duty.loc = null; state.duty.sentAt = 0; }
        paintFresh(fresh);
      });
    }
    sw.addEventListener("click", function () {
      var next = !onDuty;
      sw.classList.add("is-busy");
      run(sw, dutyErr, function () {
        return sendDuty(next).then(function () {
          toast(next ? "You are on duty. Keep this tab open to get alerts." : "You are off duty. Your location was deleted.", next ? "ok" : null);
          return refresh();
        });
      }).then(function () { sw.classList.remove("is-busy"); });
    });
    upd.addEventListener("click", function () {
      run(upd, dutyErr, function () { return sendDuty(true).then(function () { toast("Location updated.", "ok"); return refresh(); }); });
    });

    function paintFresh(el) {
      clear(el);
      if (!onDuty) return;
      var at = state.duty.sentAt;
      if (!at) { el.appendChild(callout("info", "info", h("span", { text: "Tap Update my location to make sure alerts can reach you." }))); return; }
      var age = serverNow() - at;
      if (age > FRESH_MS) el.appendChild(callout("warn", "alert", [h("strong", { text: "Alerts paused: your location is over 10 minutes old." }), h("span", { text: "Tap Update my location to keep receiving alerts." })]));
      else el.appendChild(callout("ok", "check", h("span", { text: "Location sent " + fmtAgo(age) + ". Alerts are active." })));
    }

    function update(m) {
      onDuty = !!m.onDuty;
      if (!dirty) specs.set(m.profile.specialities);
      sw.setAttribute("aria-checked", String(onDuty));
      dutyRow.classList.toggle("is-on", onDuty);
      dutyState.textContent = onDuty ? "On duty" : "Off duty";
      dutySub.textContent = onDuty ? "You can receive alerts for emergencies within 2 to 3 km." : "You will not receive alerts. Nothing about your location is stored.";
      upd.hidden = !onDuty;
      paintFresh(fresh);
    }

    var el = [
      h("section", { class: "card stack", "aria-label": "Duty" },
        h("div", { class: "stack-sm" }, h("h2", { class: "card-title", text: "Duty" }), h("p", { class: "muted", text: "Turn this on when you are free to help." })),
        dutyRow,
        fresh,
        callout("info", "lock", [
          h("strong", { text: "What is shared, and when" }),
          h("ul", null,
            h("li", { text: "Your location is sent only when you go on duty or tap Update my location. It is not tracked in the background." }),
            h("li", { text: "It is used only to find incidents near you. Other users never see it; a reporter only sees a rounded distance after you accept." }),
            h("li", { text: "Going off duty deletes it immediately." }),
            h("li", { text: "Alerts only reach you if your location was updated in the last 10 minutes." }))]),
        loc.el,
        upd,
        dutyErr),
      h("section", { class: "card stack", "aria-label": "Specialities" },
        h("div", { class: "stack-sm" }, h("h2", { class: "card-title", text: "Specialities" }), h("p", { class: "muted", text: "Matching alerts are sent to you first." })),
        specs.el,
        h("div", { class: "actions" }, save),
        specErr),
    ];
    return { el: el, update: update };
  }

  // ---- alerts tab -----------------------------------------------------------------------------
  function alertsView() {
    var heading = h("h1", { class: "page-title", tabindex: "-1", text: "Alerts" });
    var lead = h("p", { class: "muted" });
    var list = h("div", { class: "stack" });
    var empty = h("div", { class: "section" });
    var inbox = h("div", { class: "section" });

    function update(me) {
      var alerts = me.alerts.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
      lead.textContent = alerts.length ? plural(alerts.length, "person needs", "people need") + " help near you." : me.onDuty ? "You are on duty." : "Incoming emergencies near you appear here.";
      syncList(list, alerts, function (a) { return a.id; }, alertKey, alertCard);

      var p = me.profile, verified = p && p.status === "verified";
      var ek = alerts.length ? "" : !verified ? "unverified" : me.onDuty ? "quiet" : "off";
      patch(empty, ek, function () {
        if (ek === "unverified") return emptyState("shield", "Only verified responders get alerts", "Register your medical credentials in Respond. Once verified, go on duty to receive alerts.", button("Go to Respond", "btn-primary", null, function () { switchTab("responder", true); }));
        if (ek === "off") return emptyState("moon", "You are off duty", "Go on duty to receive alerts for emergencies within 2 to 3 km.", button("Go on duty", "btn-care", null, function () { switchTab("responder", true); }));
        if (ek === "quiet") return emptyState("check", "All quiet nearby", "You are on duty. New alerts pop up on screen and appear here.", null, "ok");
        return null;
      });

      var msgs = (me.inbox || []).slice().reverse();
      patch(inbox, msgs.map(function (m) { return m.at + m.kind; }).join("|"), function () {
        if (!msgs.length) return null;
        return h("section", { class: "card stack-md" },
          h("h2", { class: "section-title", text: "Recent notifications" }),
          h("ul", { class: "list" }, msgs.map(function (m) {
            var tone = m.kind === "incident_alert" ? "danger" : m.kind === "no_ack" ? "warn" : "ok";
            var ic = m.kind === "incident_alert" ? problem(m.problemType).icon : m.kind === "no_ack" ? "alert" : "check";
            var title = m.kind === "incident_alert" ? problem(m.problemType).name + ", " + fmtDist(m.distanceM || 0) + " away" : m.text;
            return h("li", { class: "list-item" }, h("span", { class: "li-icon tone-" + tone }, icon(ic)),
              h("div", { class: "li-body" }, h("p", { class: "li-title", text: title }), h("p", { class: "li-meta", text: fmtClock(m.at) })));
          })));
      });
    }
    return {
      el: h("div", { class: "stack" }, h("div", { class: "view-head" }, heading, lead), list, empty, inbox),
      update: update,
      focus: heading,
    };
  }
  function alertKey(a) {
    return [a.status, a.youResponded, a.matchesSpeciality, a.distanceM, a.note, a.photo.state, a.photo.data ? a.photo.data.length : 0, a.expireAt].join("|");
  }
  function alertCard(a) {
    var p = problem(a.problemType);
    var err = errSlot();
    var d = splitDist(a.distanceM);
    var nav = h("a", { class: "btn " + (a.youResponded ? "btn-care" : "btn-secondary"), href: mapsLink(a.lat, a.lng), target: "_blank", rel: "noopener noreferrer", "data-fk": "nav" },
      icon("nav"), "Navigate", h("span", { class: "sr-only", text: " (opens Google Maps)" }));
    var flag = button("Flag as false", "btn-ghost", "flag", null, { "data-fk": "flag" });
    confirmTap(flag, "Tap again to flag", function () { act(a.id, "flag", flag, err, "Flagged. Thanks for keeping alerts honest."); });

    var primary;
    if (!a.youResponded) {
      var coming = button("I'm coming", "btn-primary btn-xl btn-block", "nav", null, { "data-fk": "coming" });
      coming.addEventListener("click", function () { act(a.id, "respond", coming, err, "You are marked as coming. The reporter only sees your rounded distance."); });
      primary = h("div", { class: "actions-stack" },
        a.status === "ACKNOWLEDGED" ? h("p", { class: "hint", text: "Another volunteer has already accepted. More help is still welcome." }) : null,
        coming,
        h("div", { class: "inline-actions" }, nav, flag));
    } else {
      var resolve = button("Resolved / handed to ambulance", "btn-secondary", "check", null, { "data-fk": "resolve" });
      resolve.addEventListener("click", function () { act(a.id, "resolve", resolve, err, "Marked as resolved. Thank you for helping."); });
      primary = h("div", { class: "actions-stack" },
        callout("ok", "check", [h("strong", { text: "You are on your way." }), h("span", { text: "The reporter is told a volunteer is coming and sees only your rounded distance, never your name." })]),
        h("div", { class: "inline-actions" }, nav, resolve),
        flag);
    }

    var you = state.duty.loc ? [{ lat: state.duty.loc.lat, lng: state.duty.loc.lng, kind: "you", label: "You" }] : [];
    var alertSpec = { centre: { lat: a.lat, lng: a.lng }, rings: [{ km: 2, active: false }, { km: 3, active: false }], points: [{ lat: a.lat, lng: a.lng, kind: "incident", label: "Incident" }].concat(you) };
    var map = mapCanvas(alertSpec,
      "Map: the incident" + (you.length ? " and the location you last shared" : "") + ", " + fmtDist(a.distanceM) + " from you.");

    var photoBlock = null;
    if (a.photo.state === "ready" && a.photo.data) photoBlock = h("figure", { class: "photo-figure" }, h("img", { class: "media", src: a.photo.data, alt: "Blurred photo of the scene from the reporter" }), h("figcaption", { text: "Faces were blurred on the reporter's device." }));
    else if (a.photo.state === "pending") photoBlock = h("p", { class: "meta" }, h("span", { class: "spinner", "aria-hidden": "true" }), "A photo is still uploading.");

    return h("article", { class: "card card-urgent", "data-id": a.id, "aria-label": "Alert: " + p.name + ", " + fmtDist(a.distanceM) + " away" },
      h("div", { class: "card-head" },
        pbadge(a.problemType, "pbadge-lg"),
        h("div", { class: "card-head-text" },
          h("span", { class: "eyebrow eyebrow-danger" }, "Live alert · ", agoText(a.createdAt)),
          h("h2", { class: "card-title", tabindex: "-1", text: p.name }),
          h("div", { class: "row" }, a.matchesSpeciality ? pill("Matches your speciality", "ok", "check") : pill("General alert", "info"), a.status === "ACKNOWLEDGED" ? pill("Someone accepted", "") : null))),
      h("div", { class: "distance" }, h("strong", { text: d[0] }), h("span", { text: d[1] })),
      callout("danger", "alert", h("strong", { text: a.safety }), "callout-strong"),
      a.note ? h("blockquote", { class: "note-quote" }, h("span", { class: "eyebrow", text: "Note from the reporter" }), h("span", { text: a.note })) : null,
      photoBlock,
      h("div", { class: "map-wrap" }, map, legend([["incident", "Incident"]].concat(you.length ? [["you", "You (last shared)"]] : []).concat([["ref", "2 / 3 km"]]))),
      h("p", { class: "meta" }, icon("clock"), "Expires in ", countdown(a.expireAt)),
      primary, err);
  }

  // ---- admin tab ------------------------------------------------------------------------------
  function adminView() {
    var heading = h("h1", { class: "page-title", tabindex: "-1", text: "Admin" });
    var err = errSlot();
    var queueBody = h("div", { class: "stack-md" }, loadingRow("Loading review queue..."));
    var queueCount = pill("...", "");
    var offsetEl = h("strong", { class: "tabular", text: "..." });
    var stats = { duty: h("strong", { text: "-" }), live: h("strong", { text: "-" }), review: h("strong", { text: "-" }) };
    var auditBody = h("div", null, loadingRow("Loading audit log..."));
    var registryBody = h("div");
    var mapHolder = h("div", { class: "map-wrap" }, loadingRow("Loading live map..."));
    var canvas = null, mapKey = null;
    var loadingNow = false;

    var loc = locationControl({ title: "Seed point", defaultText: "Demo default: Bangalore city centre." });
    var seed = button("Seed 8 demo responders here", "btn-care btn-block", "userplus", function () {
      run(seed, err, function () {
        return api("POST", "/api/demo/seed", { lat: state.loc.lat, lng: state.loc.lng }).then(function () {
          toast("Seeding 8 demo responders around the seed point.", "ok");
          setTimeout(load, 400);
        });
      });
    });
    function skipBtn(label, desc, seconds) {
      var b = h("button", { type: "button", class: "skip-btn" }, h("strong", { text: label }), h("span", { text: desc }));
      b.addEventListener("click", function () {
        var all = skipGrid.querySelectorAll("button");
        Array.prototype.forEach.call(all, function (x) { x.disabled = true; });
        showErr(err, "");
        api("POST", "/api/demo/skip", { seconds: seconds }).then(function () {
          toast("Demo clock advanced " + label + ".", "ok");
          return refresh();
        }).then(load).catch(function (e) { showErr(err, e.message); }).then(function () {
          Array.prototype.forEach.call(all, function (x) { x.disabled = false; });
        });
      });
      return b;
    }
    var skipGrid = h("div", { class: "skip-grid" },
      skipBtn("+70 s", "Ring widens to 3 km", 70),
      skipBtn("+3 min", "No-accept warning", 180),
      skipBtn("+1 h", "Countdown check", 3600),
      skipBtn("+25 h", "Incidents expire", 25 * 3600));

    var controls = h("section", { class: "card stack", "aria-label": "Demo controls" },
      h("div", { class: "row-between" }, h("h2", { class: "card-title", text: "Demo controls" }), h("span", { class: "demo-tag" }, icon("info"), "Demo only")),
      h("p", { class: "muted", text: "Seed fake responders, then post an incident from another window. Advance the clock to see escalation and expiry." }),
      loc.el, seed,
      h("div", { class: "stack-sm" },
        h("div", { class: "row-between" }, h("h3", { class: "section-title", text: "Demo clock" }), h("span", { class: "meta" }, icon("clock"), "Offset ", offsetEl)),
        skipGrid),
      disclosure("Demo registry", "Records the mock verifier knows", "file", registryBody, "subtle"));

    var queueCard = h("section", { class: "card stack", "aria-label": "Verification review queue" },
      h("div", { class: "row-between" }, h("h2", { class: "card-title", text: "Review queue" }), queueCount),
      queueBody);

    var mapCard = h("section", { class: "card stack", "aria-label": "Live demo map" },
      h("div", { class: "row-between" }, h("h2", { class: "card-title", text: "Live map" }), h("span", { class: "demo-tag" }, icon("eyeoff"), "Demo-only god view")),
      h("div", { class: "stat-row" },
        h("div", { class: "stat" }, stats.duty, h("span", { text: "On duty" })),
        h("div", { class: "stat" }, stats.live, h("span", { text: "Live incidents" })),
        h("div", { class: "stat" }, stats.review, h("span", { text: "In review" }))),
      mapHolder,
      callout("warn", "lock", h("span", { text: "Admin demo view only. Ordinary users can never see responder locations; reporters only see rounded distances." })));

    var auditCard = h("section", { class: "card stack", "aria-label": "Anonymised audit log" },
      h("div", { class: "stack-sm" }, h("h2", { class: "card-title", text: "Anonymised audit log" }), h("p", { class: "muted", text: "One row per finished incident. No names, photos, ids or exact locations; area is a ~5 km geohash cell." })),
      auditBody);

    function load() {
      if (loadingNow) return;
      loadingNow = true;
      Promise.all([api("GET", "/api/admin/queue"), api("GET", "/api/demo/overview")])
        .then(function (r) { showErr(err, ""); drawQueue(r[0]); drawOverview(r[1]); })
        .catch(function (e) { showErr(err, e.message); })
        .then(function () { loadingNow = false; });
    }

    function drawQueue(q) {
      queueCount.textContent = q.length ? plural(q.length, "waiting", "waiting") : "Empty";
      queueCount.className = "pill" + (q.length ? " pill-warn" : " pill-ok");
      stats.review.textContent = String(q.length);
      patch(queueBody, q.map(function (p) { return p.uid + p.status; }).join("|"), function () {
        if (!q.length) return h("div", { class: "empty" }, h("div", { class: "empty-art tone-ok" }, icon("check")), h("p", { text: "Nothing waiting for review." }));
        return q.map(function (p) {
          var e2 = errSlot();
          var approve = button("Approve", "btn-care", "check");
          var reject = button("Reject", "btn-danger-outline", "x");
          function decide(b, ok) {
            run(b, e2, function () {
              approve.disabled = true; reject.disabled = true;
              return api("POST", "/api/admin/decide", ok ? { uid: p.uid, approve: true } : { uid: p.uid, approve: false, reason: "Rejected by reviewer." })
                .then(function () { toast((ok ? "Approved " : "Rejected ") + p.fullName + ".", ok ? "ok" : null); queueBody._key = undefined; load(); })
                .catch(function (e) { approve.disabled = false; reject.disabled = false; throw e; });
            });
          }
          approve.addEventListener("click", function () { decide(approve, true); });
          reject.addEventListener("click", function () { decide(reject, false); });
          return h("article", { class: "review-item" },
            h("div", { class: "row-between" }, h("strong", { text: p.fullName }), pill("Needs review", "warn")),
            h("dl", { class: "kv" },
              h("dt", { text: "Qualification" }), h("dd", { text: p.qualification }),
              h("dt", { text: "Council" }), h("dd", { text: p.council + " #" + p.regNo }),
              h("dt", { text: "Registered" }), h("dd", { text: String(p.regYear) }),
              h("dt", { text: "Specialities" }), h("dd", { text: (p.specialities || []).map(function (s) { return SPECS[s] ? SPECS[s].name : s; }).join(", ") || "none" }),
              h("dt", { text: "Why" }), h("dd", { text: p.reason })),
            h("div", { class: "actions" }, approve, reject), e2);
        });
      });
    }

    function drawOverview(o) {
      offsetEl.textContent = fmtOffset(o.offsetS || 0);
      var now = state.me ? serverNow() : Date.now();
      var liveInc = o.incidents.filter(function (i) { return isLive(i.status); });
      stats.duty.textContent = String(o.responders.length);
      stats.live.textContent = String(liveInc.length);

      var focusInc = liveInc[0] || o.incidents[0];
      var centre = focusInc ? { lat: focusInc.lat, lng: focusInc.lng } : { lat: state.loc.lat, lng: state.loc.lng };
      var pts = [];
      if (Number.isFinite(state.loc.lat) && Number.isFinite(state.loc.lng)) pts.push({ lat: state.loc.lat, lng: state.loc.lng, kind: "you", label: "Seed point" });
      o.responders.forEach(function (r) {
        pts.push({ lat: r.lat, lng: r.lng, kind: "responder", stale: now - r.updatedAt > FRESH_MS, label: String(r.name).replace("Demo Responder ", "R") });
      });
      o.incidents.forEach(function (i) {
        pts.push({ lat: i.lat, lng: i.lng, kind: "incident", muted: !isLive(i.status), label: problem(i.problemType).short + (isLive(i.status) ? " · " + i.ackCount + "/" + i.alertedCount : "") });
      });
      var rings = liveInc.map(function (i) { return { km: i.radiusKm, active: true, at: { lat: i.lat, lng: i.lng } }; });
      if (!liveInc.length) rings = [{ km: 2, active: false }, { km: 3, active: false }];
      var spec = { centre: centre, rings: rings, points: pts };
      var key = JSON.stringify(spec);
      var label = "Demo map: " + plural(o.responders.length, "on-duty responder", "on-duty responders") + " and " + plural(liveInc.length, "live incident", "live incidents") + ".";
      if (!canvas) {
        canvas = mapCanvas(spec, label, "map-lg");
        replaceKids(mapHolder, canvas, legend([["incident", "Live incident (accepted/alerted)"], ["incident-closed", "Closed incident"], ["responder", "On-duty responder"], ["stale", "Location older than 10 min"], ["ring", "Current alert radius"], ["you", "Seed point"]]));
        mapKey = key;
      } else if (key !== mapKey) { mapKey = key; setMapSpec(canvas, spec, label); }

      patch(auditBody, o.audit.length + ":" + (o.audit.length ? o.audit[o.audit.length - 1].ts : 0), function () {
        if (!o.audit.length) return h("p", { class: "hint", text: "Entries appear when an incident ends (resolved, cancelled, flagged or expired)." });
        var rows = o.audit.slice().reverse();
        return h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": "Audit log table" }, h("table", { class: "table" },
          h("thead", null, h("tr", null,
            h("th", { scope: "col", text: "Ended" }), h("th", { scope: "col", text: "Outcome" }), h("th", { scope: "col", text: "Problem" }), h("th", { scope: "col", text: "Area" }),
            h("th", { scope: "col", class: "num", text: "Alerted" }), h("th", { scope: "col", class: "num", text: "Accepted" }), h("th", { scope: "col", class: "num", text: "First accept" }))),
          h("tbody", null, rows.map(function (a) {
            var tone = a.outcome === "resolved" ? "ok" : a.outcome === "flagged" ? "bad" : a.outcome === "expired" ? "warn" : "";
            return h("tr", null,
              h("td", { text: fmtClock(a.ts) }),
              h("td", null, pill(a.outcome, tone)),
              h("td", { text: problem(a.problemType).short }),
              h("td", null, h("code", { class: "k", text: a.roughArea })),
              h("td", { class: "num", text: String(a.alertedCount) }),
              h("td", { class: "num", text: String(a.ackCount) }),
              h("td", { class: "num", text: a.timeToFirstAckS == null ? "none" : a.timeToFirstAckS + " s" }));
          }))));
      });

      patch(registryBody, String((o.registry || []).length), function () {
        return h("ul", { class: "demo-list" }, (o.registry || []).map(function (r) {
          return h("li", null, h("code", { text: r.council + " " + r.regNo }), " " + r.name + (r.blacklisted ? " (blacklisted)" : !r.active ? " (inactive)" : ""));
        }));
      });
    }

    load();
    return {
      el: h("div", { class: "stack" },
        h("div", { class: "view-head" }, heading, h("p", { class: "muted", text: "Review responders and run the demo." })),
        err,
        h("div", { class: "admin-grid" },
          h("div", { class: "admin-col" }, controls, queueCard),
          h("div", { class: "admin-col" }, mapCard, auditCard))),
      update: function () { load(); },
      focus: heading,
      wide: true,
    };
  }

  // ---- boot -------------------------------------------------------------------------------------
  function boot() {
    if (!state.token) { render(); return; }
    render(); // splash while loading
    api("GET", "/api/me").then(function (me) {
      state.skew = me.now - Date.now();
      state.me = me;
      render();
      connectEvents();
    }).catch(function (e) {
      if (!state.token) return; // 401 already logged out
      var root = document.getElementById("app");
      clear(root);
      var retry = button("Try again", "btn-primary", "refresh", boot);
      root.appendChild(h("div", { class: "splash" }, h("div", { class: "splash-box" },
        h("div", { class: "empty-art" }, icon("alert")),
        h("h1", { class: "section-title", text: "Could not reach EpiAlert" }),
        h("p", { class: "muted", text: (e && e.message) || "The server did not respond." }),
        retry,
        h("button", { type: "button", class: "link-btn", text: "Sign out", onclick: logout }))));
      retry.focus();
    });
  }
  setInterval(function () { if (state.token && state.me && !inflight) refresh(); }, 3000);
  window.addEventListener("beforeunload", function () { if (state.es) state.es.close(); });
  boot();
})();
