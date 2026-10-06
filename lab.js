/* Lab landing runtime.
   URL: ?t=<test_id>&v=<variant>  (no PII in URL, ever)
   ?owner=1 -> localStorage flag, Clarity and beacon are off on this browser; ?owner=0 clears it
   (the flag is written only for the owner; visitors get nothing stored).
   Clarity runs in no-consent mode for everyone (consentv2 denied): no cookies, one id per pageview.
   This keeps LSSI art.22.2 satisfied without a cookie banner. Do not add consent "granted" without a banner.
   Price button: log click first, then Stripe link (if set) or waitlist form. */
(function () {
  "use strict";
  var C = window.LAB || {};
  var qs = new URLSearchParams(location.search);

  // owner flag
  if (qs.get("owner") === "1") localStorage.setItem("lab_owner", "1");
  if (qs.get("owner") === "0") localStorage.removeItem("lab_owner");
  var OWNER = localStorage.getItem("lab_owner") === "1";

  // test id / variant (sanitised). Nothing is stored on the visitor's device (LSSI art.22.2):
  // thanks.html gets t/v via its URL.
  function clean(s, d) { s = (s || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32); return s || d; }
  var T = clean(qs.get("t"), C.test_id || "t000");
  var V = clean(qs.get("v"), "a");

  // keep only whitelisted params for tracking (utm + t + v)
  var UTM = {};
  ["utm_source", "utm_medium", "utm_campaign", "utm_content"].forEach(function (k) {
    var val = qs.get(k); if (val) UTM[k] = val.slice(0, 64);
  });

  // variant copy overrides: config.variants[v][key] -> [data-k=key]
  var ov = (C.variants || {})[V] || {};
  Object.keys(ov).forEach(function (k) {
    if (!ov[k] || /\{\{/.test(ov[k])) return;
    document.querySelectorAll('[data-k="' + k + '"]').forEach(function (el) { el.textContent = ov[k]; });
  });

  // Clarity
  if (!OWNER && C.clarity_id) {
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, "clarity", "script", C.clarity_id);
    window.clarity("consentv2", { ad_Storage: "denied", analytics_Storage: "denied" });
    window.clarity("set", "test_id", T);
    window.clarity("set", "variant", V);
  }

  // event log: Clarity custom event + optional beacon. Returns immediately.
  function track(e) {
    if (OWNER) { console.info("[lab owner] skip", e); return; }
    if (window.clarity) window.clarity("event", e);
    if (!C.beacon_url) return;
    var body = JSON.stringify({ e: e, t: T, v: V, utm: UTM, path: location.pathname, ts: Date.now() });
    try {
      if (!(navigator.sendBeacon && navigator.sendBeacon(C.beacon_url, new Blob([body], { type: "text/plain" })))) {
        fetch(C.beacon_url, { method: "POST", body: body, keepalive: true, mode: "no-cors" });
      }
    } catch (_) {}
  }

  if (OWNER) {
    var b = document.createElement("div"); b.className = "owner-badge"; b.textContent = "owner: tracking off";
    document.body.appendChild(b);
  }

  var page = document.body.getAttribute("data-page") || "index";
  track(page === "thanks" ? "thanks_view" : "view");
  if (page !== "index") return;

  // anchors to price
  document.querySelectorAll("[data-price-anchor]").forEach(function (a) {
    a.addEventListener("click", function () { track("cta_to_price"); });
  });

  // price button
  var wait = document.getElementById("waitlist");
  document.querySelectorAll("[data-price-btn]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      track("price_click");
      if (C.stripe_link) {
        var u = new URL(C.stripe_link);
        u.searchParams.set("client_reference_id", T + "_" + V);
        setTimeout(function () { location.href = u.toString(); }, 150);
        return;
      }
      if (C.tally_url) {
        var tu = new URL(C.tally_url);
        tu.searchParams.set("t", T); tu.searchParams.set("v", V);
        setTimeout(function () { location.href = tu.toString(); }, 150);
        return;
      }
      wait.hidden = false;
      wait.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(function () { document.getElementById("f-model").focus(); }, 400);
    });
  });

  // waitlist form: POST JSON to own endpoint; PII only in body, never in URL
  var form = document.getElementById("lab-form");
  var err = document.getElementById("f-err");
  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    err.textContent = "";
    var email = form.email.value.trim();
    if (!form.model.value) { err.textContent = "Please choose a model."; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = "Please enter a valid email."; return; }
    var buyer = (form.querySelector('input[name="buyer"]:checked') || {}).value;
    if (!buyer) { err.textContent = "Please tell us if you are buying for yourself or a business."; return; }
    if (!form.consent.checked) { err.textContent = "Please tick the box so we can email you."; return; }
    track("form_submit");
    var done = function () { location.href = "thanks.html?t=" + encodeURIComponent(T) + "&v=" + encodeURIComponent(V); };
    if (!C.form_endpoint) { console.warn("[lab] form_endpoint is empty, lead not stored"); done(); return; }
    var btn = form.querySelector("button"); btn.disabled = true;
    fetch(C.form_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, model: form.model.value, years: form.years.value.trim().slice(0, 60),
                             budget: form.budget.value.trim().slice(0, 40), condition: form.condition.value,
                             state: form.state.value.trim().slice(0, 60), timeline: form.timeline.value,
                             buyer: buyer, consent: true,
                             t: T, v: V, utm: UTM, owner: OWNER, ts: Date.now() })
    }).then(function (r) { if (!r.ok) throw new Error(r.status); done(); })
      .catch(function () { btn.disabled = false; err.textContent = "Something went wrong. Please try again or email us."; });
  });
})();
