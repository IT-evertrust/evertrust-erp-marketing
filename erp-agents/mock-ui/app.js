// Shared registry + run/render/history helpers for the EVERTRUST agent control panel.
// History is kept per-agent in localStorage so each detail page shows its own run log.

const AGENTS = [
  { key: "reach",        name: "Reach",        pkg: "bazooka",       url: "http://localhost:8800/reach/run",         body: { live: false, useLlm: false }, ready: true  },
  { key: "lead",         name: "Lead",         pkg: "satellite",     url: "http://localhost:8801/satellite/run",     body: { live: false, persist: true, useLlm: false }, ready: true,  needsCampaign: true },
  { key: "reply",        name: "Reply",        pkg: "glock",         url: "http://localhost:8802/glock/run",         body: { live: false, useLlm: false, fixture: "demo_replies.json" }, ready: true  },
  { key: "sleeper",      name: "Sleeper",      pkg: "sleeper",       url: "http://localhost:8803/sleeper/run",       body: { live: false, useLlm: false, limit: 100 }, ready: true  },
  { key: "ammoforge",    name: "Ammo Forge",   pkg: "ammoforge",     url: "http://localhost:8804/ammoforge/run",     body: { live: false, persist: true, useLlm: false }, ready: true,  needsCampaign: true },
  { key: "crm",          name: "CRM",          pkg: "crm",           url: "http://localhost:8805/crm/run",           body: { live: false, useLlm: false }, ready: true  },
  { key: "rag",          name: "RAG",          pkg: "rag",           url: "http://localhost:8806/rag/run",           body: { live: false, useLlm: false, limit: 50 }, ready: true  },
  // contractmaker + sales take content inputs — ship a demo payload so a click exercises real logic (dry, offline).
  { key: "contractmaker",name: "Contract",     pkg: "contractmaker", url: "http://localhost:8807/contractmaker/run", body: { live: false, useLlm: false, meeting: { meetingId: "demo-1", title: "Acme Logistics — LED rental", text: "Met with Acme Logistics GmbH in Berlin, Germany about LED container rental. They confirmed they want to proceed and sign the contract this week. Contact: jan@acme-logistics.de" } }, ready: true  },
  { key: "sales",        name: "Sales",        pkg: "sales",         url: "http://localhost:8808/sales/run",         body: { live: false, useLlm: false, source: "erp", persona: "Alex Hormozi", transcript: "Rep: Thanks for hopping on the call today. I'd love to understand how your team currently handles LED screen and container rental for your events business, and where the biggest pain points are right now.\nProspect: Sure. We rent LED walls and modular containers for outdoor events across the region. The main problems are that costs keep climbing every season, delivery is often late, and support after setup is basically non-existent when something breaks on site.\nRep: That makes sense, and those are exactly the issues we hear most. If you could fix the reliability and the after-hours support, what would that actually be worth to your business over a year?\nProspect: Honestly, if we stopped losing events to equipment failures and late deliveries, it would easily be worth fifty thousand euros a year, maybe more once you factor in the reputation damage we take with clients.\nRep: Got it, so this is a fifty thousand euro problem at minimum. If I put together a proposal that guarantees on-time delivery and twenty-four seven on-site support, would you review it with your partner this week?\nProspect: Yes, definitely. Send me the proposal and the pricing breakdown and I will loop in my business partner so we can decide quickly. We are motivated to switch before the autumn season starts." }, ready: true  },
];
const AGENT_MAP = Object.fromEntries(AGENTS.map(a => [a.key, a]));

// ---- history (localStorage, per agent) -------------------------------------
const HKEY = k => "evertrust_hist_" + k;
function loadHist(k) { try { return JSON.parse(localStorage.getItem(HKEY(k)) || "[]"); } catch { return []; } }
function saveHist(k, arr) { localStorage.setItem(HKEY(k), JSON.stringify(arr.slice(0, 50))); }
function clearHist(k) { localStorage.removeItem(HKEY(k)); }
function pushHist(k, rec) { const a = loadHist(k); a.unshift(rec); saveHist(k, a); }

// ---- run -------------------------------------------------------------------
async function runAgent(a) {
  const t0 = performance.now();
  let rec;
  // Scope the run to the SELECTED campaign. needsCampaign agents (satellite, ammoforge)
  // REQUIRE one; the others get campaignId merged best-effort (agents that don't read it
  // ignore the extra field). Reach takes the campaign NAME as its filter.
  const c = SELECTED_CAMPAIGN || (a.needsCampaign ? await resolveCampaign() : null);
  if (a.needsCampaign && !c) {
    rec = { ts: new Date().toISOString(), ms: 0, ok: false,
      error: "No campaign selected — pick one in the sidebar (or “Aim & Launch”)." };
    pushHist(a.key, rec);
    return rec;
  }
  const body = { ...a.body };
  if (c) {
    body.campaignId = c.id;
    if (a.key === "reach") body.campaign = c.name || c.project;
  }
  // Global LLM toggle: when ON, ask agents to use the LiteLLM gateway instead of the
  // offline stub. The toggle is the single source of truth: it sets useLlm on EVERY
  // agent body that carries the field (both directions — on AND off).
  if ("useLlm" in body) body.useLlm = USE_LLM;
  try {
    const res = await fetch(a.url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) throw new Error("HTTP " + res.status + " " + (await res.text()).slice(0, 300));
    const data = await res.json();
    rec = { ts: new Date().toISOString(), ms, ok: true, mode: data.mode, counts: data.counts, emailsSent: data.emailsSent, data };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const msg = (e.message || "").includes("Failed to fetch")
      ? "Could not reach " + a.url + " — is its service running?"
      : (e.message || String(e));
    rec = { ts: new Date().toISOString(), ms, ok: false, error: msg };
  }
  pushHist(a.key, rec);
  return rec;
}

// ---- render ----------------------------------------------------------------
function escapeJson(o) { return JSON.stringify(o, null, 2).replace(/</g, "&lt;"); }

function countsChips(data) {
  let html = '<div class="chips">';
  if (data.counts) for (const [k, v] of Object.entries(data.counts)) html += `<span class="chip">${k}: ${v}</span>`;
  if (typeof data.emailsSent !== "undefined") html += `<span class="chip">emailsSent: ${data.emailsSent}</span>`;
  html += `<span class="chip">mode: ${data.mode || "?"}</span></div>`;
  return html;
}

function plannedMails(data) {
  const planned = (data.campaigns || []).flatMap(c => (c.planned || []).map(p => ({ ...p, _c: c.name })));
  return planned.map(p => `<div class="mail">
      <div class="to">${p.email || "(no email)"} <span style="color:#9aa0a6;font-weight:400">· ${p._c || ""}</span></div>
      <div class="meta">action: ${p.action || p.status || "?"} · from: ${p.sender || "?"} · status: ${p.status || "?"}</div>
      ${p.subject ? `<div class="body"><b>${p.subject}</b></div>` : ""}
      ${p.body ? `<div class="body">${p.body}</div>` : ""}
    </div>`).join("");
}

// Full output block for a successful run (counts + planned mails + raw json).
function renderResult(data) {
  return countsChips(data) + plannedMails(data) +
    `<details style="margin-top:14px"><summary class="status">raw JSON response</summary><pre>${escapeJson(data)}</pre></details>`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString();
}

// ============================================================================
// AIM "Lock & Load" — ported from the erp-client AimLaunchDialog.
// Collects the campaign target and POSTs CreateCampaignDto to the ERP server,
// which persists the campaign AND fires the AIM webhook server-side. The
// returned row's lifecycle (ACTIVE / DRAFT / FAILED) reflects the deploy.
// ============================================================================

// ERP server base (the erp-client default is http://localhost:3001). Override
// in the browser console with `localStorage.setItem('aim_api', 'http://host:port')`.
const AIM_API = (localStorage.getItem("aim_api") || "http://localhost:3001").replace(/\/$/, "");

// Sender aliases BAZOOKA can send from (mirror of shared CAMPAIGN_SENDER_LABELS).
const CAMPAIGN_SENDERS = [
  { value: "info",  label: "info@evertrust-germany.de" },
  { value: "hanna", label: "hanna@evertrust-germany.de" },
];

// Keep only letters/digits in a label token: "Near Border" -> "NearBorder".
function slugToken(s) { return (s || "").trim().replace(/[^a-zA-Z0-9]+/g, ""); }

// shared slugify() equivalent — lowercase, non-alphanumerics collapsed to "-".
function slugify(s) {
  return (s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Auto-build the Gmail label from the AIM inputs: niche-country-zone-year
// (e.g. "LED-Germany-North-2026"). Empty until a niche is entered; the generic
// "Anywhere" zone is omitted.
function deriveGmailLabel(form) {
  const niche = slugToken(form.nicheName);
  if (!niche) return "";
  const country = slugToken(form.country);
  const zone = form.region && form.region !== "Anywhere" ? slugToken(form.region) : "";
  const year = String(new Date().getFullYear());
  return [niche, country, zone, year].filter(Boolean).join("-");
}

// ---- toasts ----------------------------------------------------------------
function toast(msg, kind = "ok", ms = 5000) {
  let wrap = document.getElementById("toast-wrap");
  if (!wrap) { wrap = document.createElement("div"); wrap.id = "toast-wrap"; wrap.className = "toast-wrap"; document.body.appendChild(wrap); }
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// Best-effort niche autocomplete: the erp-client powers a datalist from
// GET /niches. If the server isn't up we just skip it (autocomplete is optional).
async function loadNiches(datalistEl) {
  try {
    const res = await fetch(`${AIM_API}/niches`, { headers: { Accept: "application/json" } });
    if (!res.ok) return;
    const rows = await res.json();
    datalistEl.innerHTML = (Array.isArray(rows) ? rows : [])
      .map(n => {
        const group = n.industryName ? n.industryName : "Unassigned";
        return `<option value="${(n.name || "").replace(/"/g, "&quot;")}" label="${group} ▸ ${(n.name || "").replace(/"/g, "&quot;")}"></option>`;
      })
      .join("");
    datalistEl._niches = rows;
  } catch { /* server down — no autocomplete, form still works */ }
}

// ---- submit ----------------------------------------------------------------
// Required free-text fields (region + sender come from controls that only emit
// valid values). Mirrors REQUIRED_TEXT in the React dialog.
const AIM_REQUIRED = [
  ["nicheName", "Niche"], ["country", "Country"], ["region", "Region"],
  ["project", "Project"], ["gmailLabel", "Gmail label"], ["whatsappNumber", "WhatsApp number"],
];

async function submitAim(form, submitBtn, opts = {}) {
  const missing = AIM_REQUIRED.filter(([k]) => !String(form[k] || "").trim()).map(([, label]) => label);
  if (missing.length) { toast("Missing: " + missing.join(", "), "warn"); return; }

  const body = {
    nicheName: form.nicheName.trim(),
    country: form.country.trim(),
    region: form.region.trim(),
    project: form.project.trim(),
    gmailLabel: form.gmailLabel.trim(),
    // Calendar is pinned to info@ in Reply Glock (no picker), as in the client.
    salesCalendarId: "info@evertrust-germany.de",
    whatsappNumber: form.whatsappNumber.trim(),
    sender: form.sender || "info",
    ...(form.name.trim() ? { name: form.name.trim() } : {}),
  };

  submitBtn.disabled = true;
  const orig = submitBtn.textContent;
  submitBtn.textContent = "Launching…";
  const t0 = performance.now();
  try {
    const res = await fetch(`${AIM_API}/campaigns`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) throw new Error("HTTP " + res.status + " " + (await res.text()).slice(0, 300));
    const c = await res.json();
    LAST_CAMPAIGN = c; // remember for campaignId-requiring agents + the pipeline
    SELECTED_CAMPAIGN = c;
    pushHist("aim", { ts: new Date().toISOString(), ms, ok: true, lifecycle: c.lifecycle, project: c.project, data: c });
    fetchCampaigns();        // refresh the sidebar so the new campaign appears + highlights
    renderCampaignInfo(c);
    renderGridScope();
    closeAim();
    if (opts.pipeline) {
      // Hand off to the full-pipeline runner (it owns the result panel from here).
      await runPipeline(c);
      return;
    }
    toast(
      c.lifecycle === "DRAFT"
        ? `Saved as draft: ${c.project}`
        : `Launched (${c.lifecycle || "ACTIVE"}): ${c.project}`,
      c.lifecycle === "DRAFT" ? "warn" : "ok",
    );
    renderAimResult(c);
  } catch (e) {
    const msg = (e.message || "").includes("Failed to fetch")
      ? `Could not reach ${AIM_API}/campaigns — is the ERP server running?`
      : (e.message || String(e));
    pushHist("aim", { ts: new Date().toISOString(), ms: Math.round(performance.now() - t0), ok: false, error: msg });
    toast(msg, "err", 8000);
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = orig;
  }
}

// Show the launched campaign in the existing result panel (if present on the page).
function renderAimResult(c) {
  const panel = document.getElementById("panel");
  const title = document.getElementById("panel-title");
  const bodyEl = document.getElementById("panel-body");
  if (!panel || !title || !bodyEl) return;
  panel.style.display = "block";
  title.textContent = `AIM launch · ${c.project || "campaign"}`;
  bodyEl.innerHTML =
    `<div class="chips">` +
    `<span class="chip">lifecycle: ${c.lifecycle || "?"}</span>` +
    (c.nicheName ? `<span class="chip">niche: ${c.nicheName}</span>` : "") +
    (c.country ? `<span class="chip">country: ${c.country}</span>` : "") +
    (c.region ? `<span class="chip">region: ${c.region}</span>` : "") +
    (c.gmailLabel ? `<span class="chip">label: ${c.gmailLabel}</span>` : "") +
    `</div>` +
    `<details style="margin-top:14px"><summary class="status">raw JSON response</summary><pre>${escapeJson(c)}</pre></details>`;
}

// ---- dialog ----------------------------------------------------------------
function closeAim() { const b = document.getElementById("aim-backdrop"); if (b) b.hidden = true; }

// Build the launch button + dialog and wire all behavior. Call once on a page
// that has a mount point (#aim-mount). Idempotent.
function mountAim(mountEl) {
  if (!mountEl || mountEl._aimMounted) return;
  mountEl._aimMounted = true;

  const btn = document.createElement("button");
  btn.className = "aim";
  btn.innerHTML = `<span class="xhair">◎</span>&nbsp; Aim &amp; Launch`;
  mountEl.appendChild(btn);

  const pbtn = document.createElement("button");
  pbtn.className = "pipeline";
  pbtn.innerHTML = `▶&nbsp; Run full pipeline`;
  mountEl.appendChild(pbtn);

  const backdrop = document.createElement("div");
  backdrop.id = "aim-backdrop";
  backdrop.className = "modal-backdrop";
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="aim-title">
      <h2 id="aim-title">AIM — Lock &amp; Load</h2>
      <p class="desc">Aim a campaign at a niche &amp; region, then launch. Persists the campaign and fires the AIM webhook.</p>

      <div class="field">
        <label for="aim-name">Campaign name <span class="opt">(optional)</span></label>
        <input id="aim-name" maxlength="60" placeholder="Auto-named from niche &amp; region if blank">
      </div>
      <div class="field">
        <label for="aim-niche">Niche</label>
        <input id="aim-niche" list="aim-niche-options" maxlength="120" autocomplete="off" placeholder="e.g. LED retrofit">
        <datalist id="aim-niche-options"></datalist>
        <p class="hint" id="aim-niche-hint">Pick an existing niche or type a new name.</p>
      </div>
      <div class="field">
        <label for="aim-country">Country</label>
        <input id="aim-country" maxlength="120" placeholder="e.g. Poland">
      </div>
      <div class="field">
        <label for="aim-region">Region</label>
        <input id="aim-region" maxlength="120" placeholder="e.g. Mazowieckie, or Warszawa, Kraków">
      </div>
      <div class="field">
        <label for="aim-project">Project</label>
        <input id="aim-project" maxlength="200" placeholder="What this campaign is selling / the offer">
      </div>
      <div class="field">
        <label for="aim-gmailLabel">Gmail label</label>
        <input id="aim-gmailLabel" maxlength="120" placeholder="LED-Poland-Mazowieckie-2026">
        <p class="hint" id="aim-gmail-hint">Auto-derived from niche · country · region · year until you edit it.</p>
      </div>
      <div class="field">
        <label for="aim-whatsapp">WhatsApp number</label>
        <input id="aim-whatsapp" maxlength="40" placeholder="+48 …">
      </div>
      <div class="field">
        <label for="aim-sender">Sender</label>
        <select id="aim-sender">
          ${CAMPAIGN_SENDERS.map(s => `<option value="${s.value}">${s.label}</option>`).join("")}
        </select>
        <p class="hint">Which Gmail identity BAZOOKA sends this campaign's outreach from.</p>
      </div>

      <div class="dialog-footer">
        <button class="ghost" id="aim-cancel">Cancel</button>
        <button id="aim-submit">Lock &amp; Load</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const $ = id => backdrop.querySelector("#" + id);
  const fields = {
    name: $("aim-name"), nicheName: $("aim-niche"), country: $("aim-country"),
    region: $("aim-region"), project: $("aim-project"), gmailLabel: $("aim-gmailLabel"),
    whatsappNumber: $("aim-whatsapp"), sender: $("aim-sender"),
  };
  const nicheHint = $("aim-niche-hint");
  const gmailHint = $("aim-gmail-hint");
  let labelEdited = false;

  const formState = () => ({
    name: fields.name.value, nicheName: fields.nicheName.value, country: fields.country.value,
    region: fields.region.value, project: fields.project.value, gmailLabel: fields.gmailLabel.value,
    whatsappNumber: fields.whatsappNumber.value, sender: fields.sender.value,
  });

  // Keep the Gmail label synced with niche/country/region until the user edits it.
  function syncLabel() {
    if (labelEdited) return;
    fields.gmailLabel.value = deriveGmailLabel(formState());
  }
  ["nicheName", "country", "region"].forEach(k =>
    fields[k].addEventListener("input", () => { syncLabel(); if (k === "nicheName") updateNicheHint(); }));
  fields.gmailLabel.addEventListener("input", () => { labelEdited = true; gmailHint.style.display = "none"; });

  // "new niche" hint: does the typed niche already exist (slug-insensitive)?
  function updateNicheHint() {
    const rows = $("aim-niche-options")._niches || [];
    const slug = slugify(fields.nicheName.value);
    const isNew = slug && !rows.some(n => slugify(n.name) === slug);
    nicheHint.textContent = isNew ? "New niche — it will be created on launch." : "Pick an existing niche or type a new name.";
    nicheHint.className = "hint" + (isNew ? " new" : "");
  }

  let pipelineMode = false;
  const titleEl = $("aim-title");
  const descEl = backdrop.querySelector(".desc");
  const submitBtn = $("aim-submit");

  function open(opts = {}) {
    pipelineMode = !!opts.pipeline;
    // reset
    Object.values(fields).forEach(el => { if (el.tagName === "SELECT") el.value = "info"; else el.value = ""; });
    labelEdited = false; gmailHint.style.display = "";
    updateNicheHint();
    titleEl.textContent = pipelineMode ? "Run full pipeline" : "AIM — Lock & Load";
    descEl.textContent = pipelineMode
      ? "Aim a campaign, then auto-run Ammo Forge → Reach → Lead Satellite → Reply Glock against it (all dry-run)."
      : "Aim a campaign at a niche & region, then launch. Persists the campaign and fires the AIM webhook.";
    submitBtn.textContent = pipelineMode ? "Launch & run pipeline" : "Lock & Load";
    backdrop.hidden = false;
    loadNiches($("aim-niche-options")).then(updateNicheHint);
    fields.nicheName.focus();
  }

  btn.addEventListener("click", () => open({ pipeline: false }));
  pbtn.addEventListener("click", () => open({ pipeline: true }));
  $("aim-cancel").addEventListener("click", closeAim);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) closeAim(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !backdrop.hidden) closeAim(); });
  submitBtn.addEventListener("click", () => submitAim(formState(), submitBtn, { pipeline: pipelineMode }));
}

// ============================================================================
// FULL PIPELINE — AIM → Ammo Forge → Reach → Lead Satellite → Reply Glock.
// Every stage is a dry-run (live:false). The AIM-created campaign is threaded by
// id into the stages that need it; Reach only fires on ACTIVE campaigns, so the
// campaign is activated (DRAFT→ACTIVE) first — exactly what the AIM webhook does.
// ============================================================================

let LAST_CAMPAIGN = null; // most recent AIM launch (its id is threaded downstream)

// The ordered stages after AIM. Each builds its body from the campaign.
const PIPELINE_STEPS = [
  // Order matters: Ammo Forge persists templates and Satellite persists prospects to the ERP
  // FIRST, so Reach can read both (templates from campaign config, prospects from the send list)
  // and draft personalized outreach. persist:true writes to the dev DB; live:false sends nothing.
  { key: "ammoforge", name: "Ammo Forge",      url: "http://localhost:8804/ammoforge/run", body: c => ({ campaignId: c.id, live: false, persist: true, useLlm: USE_LLM }) },
  { key: "satellite", name: "Lead Satellite",  url: "http://localhost:8801/satellite/run", body: c => ({ campaignId: c.id, live: false, persist: true, useLlm: USE_LLM }) },
  { key: "reach",     name: "Reach (Bazooka)", url: "http://localhost:8800/reach/run",     body: c => ({ live: false, useLlm: USE_LLM, campaign: c.name || c.project }) },
  { key: "glock",     name: "Reply Glock",     url: "http://localhost:8802/glock/run",     body: () => ({ live: false, useLlm: USE_LLM, fixture: "demo_replies.json" }) },
];

// Resolve a campaign for campaignId-requiring agents: the last AIM launch, else
// the newest campaign in the ERP. Returns null if none exists.
async function resolveCampaign() {
  if (LAST_CAMPAIGN) return LAST_CAMPAIGN;
  try {
    const res = await fetch(`${AIM_API}/campaigns`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    return rows.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
  } catch { return null; }
}

// Generic POST returning a normalized record (mirrors runAgent's shape).
async function postJson(url, body, method = "POST") {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) return { ok: false, ms, error: "HTTP " + res.status + " " + (await res.text()).slice(0, 250) };
    return { ok: true, ms, data: await res.json() };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const offline = (e.message || "").includes("Failed to fetch");
    return { ok: false, ms, offline, error: offline ? "service offline at " + url : (e.message || String(e)) };
  }
}

// Flip the campaign to ACTIVE so Reach will process it (DRAFT→ACTIVE is legal).
function activateCampaign(id) {
  // The ERP lifecycle route is PATCH /campaigns/:id/lifecycle (not POST) — Reach only
  // processes ACTIVE campaigns, so this must succeed for the pipeline to send.
  return postJson(`${AIM_API}/campaigns/${id}/lifecycle`, { lifecycle: "ACTIVE" }, "PATCH");
}

// ---- stepper UI (rendered into the shared #panel) --------------------------
function stepRow(key, label) {
  return `<div class="step" id="step-${key}">
      <span class="step-dot" id="stepdot-${key}"></span>
      <div class="step-main">
        <div class="step-name">${label}</div>
        <div class="step-status" id="stepst-${key}">pending</div>
        <div class="step-out" id="stepout-${key}"></div>
      </div>
    </div>`;
}
function setStep(key, state, status, outHtml) {
  const dot = document.getElementById("stepdot-" + key);
  const st = document.getElementById("stepst-" + key);
  if (dot && state) dot.className = "step-dot " + state;
  if (st && status != null) st.textContent = status;
  if (outHtml != null) { const o = document.getElementById("stepout-" + key); if (o) o.innerHTML = outHtml; }
}

// Run the whole chain against a freshly-created (or chosen) campaign.
async function runPipeline(campaign) {
  LAST_CAMPAIGN = campaign;
  const panel = document.getElementById("panel");
  const title = document.getElementById("panel-title");
  const bodyEl = document.getElementById("panel-body");
  if (!panel || !title || !bodyEl) return;
  panel.style.display = "block";
  title.textContent = `Full pipeline · ${campaign.project || campaign.name || campaign.id}`;
  const numerals = ["③", "④", "⑤", "⑥"];
  bodyEl.innerHTML = `<div class="stepper">` +
    stepRow("aim", "① AIM — Lock & Load") +
    stepRow("activate", "② Activate campaign (DRAFT→ACTIVE)") +
    PIPELINE_STEPS.map((s, i) => stepRow(s.key, `${numerals[i]} ${s.name}`)).join("") +
    `</div>`;

  // ① AIM already done by the time we get here.
  setStep("aim", "ok", `created ${campaign.lifecycle || "DRAFT"} · id ${String(campaign.id).slice(0, 8)}…`);

  // ② activate (so Reach picks it up).
  setStep("activate", "run", "activating…");
  const act = await activateCampaign(campaign.id);
  if (act.ok) { campaign.lifecycle = "ACTIVE"; setStep("activate", "ok", `ACTIVE (${act.ms}ms)`); }
  else setStep("activate", "err", act.error);

  // ③–⑥ the agent stages, in order.
  for (const s of PIPELINE_STEPS) {
    setStep(s.key, "run", "running…");
    if (s.key === "satellite") startProgress("🛰️ Lead Satellite — searching & scraping (SearXNG)", 190000);
    const r = await postJson(s.url, s.body(campaign));
    if (s.key === "satellite") finishProgress();
    if (r.ok) {
      captureAgentOutput(s.key, r.data);   // leads -> sidebar, ammoforge -> template doc
      setStep(s.key, "ok", `ok (${r.ms}ms)`, renderResult(r.data));
    } else if (r.offline) {
      setStep(s.key, "skip", "service offline",
        `<div class="err-box">${s.name} isn't running. Start the agents: <code>erp-agents/scripts/run-pipeline-agents.sh</code></div>`);
      notifyAgentError(s.key, "service offline");
    } else {
      setStep(s.key, "err", "failed", `<div class="err-box">⚠ ${r.error}</div>`);
      notifyAgentError(s.key, r.error);
    }
  }
  toast("Pipeline finished", "ok");
}

// ============================================================================
// CAMPAIGN SIDEBAR — pick a campaign once; the 9 packages then run scoped to it
// (no need to relaunch a campaign each time).
// ============================================================================

let SELECTED_CAMPAIGN = null;
let CAMPAIGNS = [];

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, m =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}
function lifecycleClass(lc) { return "lc-" + String(lc || "draft").toLowerCase(); }

// Load the campaign list from the ERP and render the sidebar.
async function fetchCampaigns() {
  const list = document.getElementById("campaign-list");
  if (list && !CAMPAIGNS.length) list.innerHTML = '<div class="muted">loading…</div>';
  try {
    const res = await fetch(`${AIM_API}/campaigns`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    CAMPAIGNS = await res.json();
  } catch (e) {
    if (list) list.innerHTML = `<div class="err-box">Couldn't load campaigns — is the ERP up at ${AIM_API}?</div>`;
    return;
  }
  renderSidebar();
}

function renderSidebar() {
  const list = document.getElementById("campaign-list");
  if (!list) return;
  if (!CAMPAIGNS.length) {
    list.innerHTML = '<div class="muted">No campaigns yet.<br>Use “Aim &amp; Launch”.</div>';
    return;
  }
  list.innerHTML = CAMPAIGNS.map(c => `
    <div class="campaign-item${SELECTED_CAMPAIGN && SELECTED_CAMPAIGN.id === c.id ? " active" : ""}" data-id="${esc(c.id)}">
      <div class="ci-top">
        <span class="ci-name">${esc(c.project || c.name || "(untitled)")}</span>
        <span class="badge ${lifecycleClass(c.lifecycle)}">${esc(c.lifecycle || "DRAFT")}</span>
      </div>
      <div class="ci-sub">${esc(c.nicheName || "—")}${c.country ? " · " + esc(c.country) : ""}</div>
    </div>`).join("");
  list.querySelectorAll(".campaign-item").forEach(el =>
    el.addEventListener("click", () => {
      const c = CAMPAIGNS.find(x => x.id === el.dataset.id);
      if (c) selectCampaign(c);
    }));
}

// Make a campaign the active scope: highlight it, show its info, update the cards.
function selectCampaign(c) {
  SELECTED_CAMPAIGN = c;
  LAST_CAMPAIGN = c;            // so resolveCampaign() + needsCampaign agents use it too
  renderSidebar();
  renderCampaignInfo(c);
  renderGridScope();
  ensureLeads(c);                        // 30-lead sample folder (seeded), or prior Satellite leads
  renderLeadsSidebar(CAMPAIGN_LEADS[c.id]);
  renderCampaignView(c);                 // template doc (if forged) above the excel leads sheet
}

function renderCampaignInfo(c) {
  const box = document.getElementById("campaign-info");
  if (!box || !c) return;
  box.style.display = "block";
  const chips = [
    ["niche", c.nicheName], ["country", c.country], ["region", c.region],
    ["sender", c.sender], ["gmail label", c.gmailLabel], ["whatsapp", c.whatsappNumber],
  ].filter(([, v]) => v);
  box.innerHTML = `
    <div class="ci-head">
      <span class="ci-title">${esc(c.project || c.name || "campaign")}</span>
      <span class="badge ${lifecycleClass(c.lifecycle)}">${esc(c.lifecycle || "DRAFT")}</span>
    </div>
    <div class="chips">${chips.map(([k, v]) => `<span class="chip">${esc(k)}: ${esc(v)}</span>`).join("")}</div>
    ${outputsStripHtml(c)}
    <div class="ci-foot">Packages below run scoped to this campaign · <span class="muted">id ${esc(c.id)}</span></div>`;
  // Persistent output badges are clickable shortcuts to the saved artifacts.
  box.querySelectorAll("[data-act]").forEach(el => el.addEventListener("click", () => {
    const act = el.dataset.act;
    if (act === "openDoc" && CAMPAIGN_TEMPLATES[c.id]) renderAmmoDoc(CAMPAIGN_TEMPLATES[c.id]);
    else if (act === "openSheet") renderCampaignView(c);
    else if (act === "openDrafts" && CAMPAIGN_TEMPLATES[c.id]) renderDrafts(CAMPAIGN_LEADS[c.id] || [], CAMPAIGN_TEMPLATES[c.id]);
    else if (act === "openSent") renderSentLog(c);
  }));
}

// A compact, persistent row of "what each agent produced for this campaign" badges.
// Restored from CAMPAIGN_OUTPUTS on every campaign select, so the data never feels lost.
function outputsStripHtml(c) {
  const o = CAMPAIGN_OUTPUTS[c.id] || {};
  const leadN = (CAMPAIGN_LEADS[c.id] || []).length;
  const sentN = (CAMPAIGN_SENT[c.id] || []).length;
  const chips = [];
  chips.push(o.ammoAt
    ? { cls: "done", t: "📄 Ammo doc ✓", act: "openDoc" }
    : { cls: "todo", t: "📄 Ammo doc" });
  chips.push((o.satelliteAt || leadN)
    ? { cls: "done", t: `🛰️ ${o.satelliteCount || leadN} leads`, act: "openSheet" }
    : { cls: "todo", t: "🛰️ leads" });
  if (o.ammoAt && leadN) chips.push({ cls: "done", t: "✉️ drafts", act: "openDrafts" });
  if (o.ragAt != null) chips.push({ cls: o.ragDrafts ? "done" : "warn", t: `✉️ ${o.ragDrafts || 0} RAG drafted` });
  if (o.glockAt != null) chips.push({ cls: o.glockSent ? "done" : "warn", t: `📤 ${o.glockSent || 0} sent (Glock)` });
  if (sentN) chips.push({ cls: "done", t: `📧 ${sentN} test sent`, act: "openSent" });
  return `<div class="out-strip">${chips.map(i =>
    `<span class="out-chip ${i.cls}"${i.act ? ` data-act="${i.act}" role="button" tabindex="0"` : ""}>${i.t}</span>`).join("")}</div>`;
}

// Persistent test-send log view (re-openable from the badge).
function renderSentLog(c) {
  const panel = document.getElementById("panel");
  const title = document.getElementById("panel-title");
  const body = document.getElementById("panel-body");
  if (!panel || !body) return;
  const rows = CAMPAIGN_SENT[c.id] || [];
  panel.style.display = "block";
  if (title) title.textContent = `Test sends · ${c.project || c.name || "campaign"} (${rows.length})`;
  body.innerHTML = `<div class="muted" style="margin-bottom:10px">All test emails recorded for <b>${esc(c.project || c.name || "")}</b> — scoped to this campaign only.</div>` +
    (rows.length ? `<div class="sendlog">${rows.map(r =>
      `<div class="send-row"><span class="send-ok">✓ sent</span> <span class="send-to">${esc(r.to)}</span> <span class="send-subj">[${esc(r.subject)}]</span> <span class="muted">— for ${esc(r.company)} · ${esc(fmtTime(r.ts))}</span></div>`).join("")}</div>`
      : '<div class="muted">No test sends recorded yet.</div>');
}

// ---- agent grid (moved here from index.html so it can reflect the scope) ----

function mountGrid(container) {
  if (!container || container._mounted) return;
  container._mounted = true;
  container.innerHTML = AGENTS.map(a => `
    <div class="card${a.ready ? "" : " disabled"}" id="card-${a.key}">
      <div class="name">Run ${a.name}</div>
      <div class="pkg">${a.pkg}</div>
      <div class="row">
        <button data-key="${a.key}">Run</button>
        <span class="dot" id="dot-${a.key}"></span>
        <span class="status" id="st-${a.key}">${a.ready ? "ready" : "wire next"}</span>
      </div>
      <div class="row"><a href="agent.html?key=${a.key}">output &amp; history →</a></div>
    </div>`).join("");
  AGENTS.forEach(a => {
    const btn = container.querySelector(`button[data-key="${a.key}"]`);
    if (btn) btn.addEventListener("click", () => quickRun(a));
  });
  renderGridScope();
}

// needsCampaign cards are disabled until a campaign is selected.
function renderGridScope() {
  AGENTS.forEach(a => {
    const st = document.getElementById("st-" + a.key);
    const btn = document.querySelector(`#card-${a.key} button`);
    const card = document.getElementById("card-" + a.key);
    if (!st || !btn || !card) return;
    if (RUNNING.has(a.key)) { btn.disabled = true; return; }   // keep running buttons locked
    if (a.needsCampaign && !SELECTED_CAMPAIGN) {
      btn.disabled = true; card.classList.add("disabled");
      st.textContent = "select a campaign";
    } else if (a.ready) {
      btn.disabled = false; card.classList.remove("disabled");
      if (st.textContent === "select a campaign") st.textContent = "ready";
    }
  });
}

// ---- run lock: while an agent is running, its Run button is disabled so it can't
// be re-triggered (double-click / impatient re-run). Tracked per agent key.
const RUNNING = new Set();
function lockRunButton(key) {
  RUNNING.add(key);
  const btn = document.querySelector(`#card-${key} button`);
  if (btn) { btn.disabled = true; btn.classList.add("running"); btn.dataset.label = btn.textContent; btn.textContent = "Running…"; }
}
function unlockRunButton(key) {
  RUNNING.delete(key);
  const btn = document.querySelector(`#card-${key} button`);
  if (btn) { btn.disabled = false; btn.classList.remove("running"); btn.textContent = btn.dataset.label || "Run"; }
  renderGridScope();   // restore needsCampaign disabled states
}

async function quickRun(a) {
  if (RUNNING.has(a.key)) return;   // already running — ignore re-clicks
  lockRunButton(a.key);
  const dot = document.getElementById("dot-" + a.key);
  const st = document.getElementById("st-" + a.key);
  const panel = document.getElementById("panel");
  const panelTitle = document.getElementById("panel-title");
  const panelBody = document.getElementById("panel-body");
  if (dot) dot.className = "dot run";
  if (st) st.textContent = "running…";
  if (panel) panel.style.display = "block";
  const scope = SELECTED_CAMPAIGN ? ` · ${esc(SELECTED_CAMPAIGN.project || SELECTED_CAMPAIGN.name || "")}` : "";
  if (panelTitle) panelTitle.innerHTML =
    `Run ${esc(a.name)} · ${esc(a.pkg)}${scope} &nbsp; <a style="font-size:13px" href="agent.html?key=${a.key}">open page →</a>`;
  if (panelBody) panelBody.innerHTML = '<div class="status">waiting for ' + esc(a.url) + ' …</div>';
  if (a.key === "lead") startProgress("🛰️ Lead Satellite — searching & scraping (SearXNG)", 190000);
  try {
    const rec = await runAgent(a);
    if (a.key === "lead") finishProgress();
    if (rec.ok) {
      if (dot) dot.className = "dot ok";
      if (st) st.textContent = "ok (" + rec.ms + "ms)";
      captureAgentOutput(a.key, rec.data);
      // ammoforge + lead render the persistent campaign view (doc above sheet) via capture;
      // everything else shows its raw run result in the panel.
      if (a.key === "ammoforge" || a.key === "lead") { /* campaign view handled by captureAgentOutput */ }
      else if (panelBody) panelBody.innerHTML = renderResult(rec.data);
    } else {
      if (dot) dot.className = "dot err";
      if (st) st.textContent = "failed";
      if (panelBody) panelBody.innerHTML = `<div class="err-box">⚠ ${esc(rec.error)}</div>`;
      notifyAgentError(a.key, rec.error);
    }
  } finally {
    if (a.key === "lead") finishProgress();   // belt-and-suspenders if runAgent threw
    unlockRunButton(a.key);
  }
}

// ============================================================================
// LEADS SIDEBAR + "DRAFT EVERYTHING" — after Satellite runs, list its leads; combine
// them with Ammo Forge's template to preview the Gmail DRAFTS (nothing is sent) and
// render the template as a Google-Docs page. All client-side; no Gmail/Docs writes.
// ============================================================================

let CAMPAIGN_LEADS = {};      // campaignId -> [lead]
let CAMPAIGN_TEMPLATES = {};  // campaignId -> templates {coldEmail, newsBrief}
let CAMPAIGN_SENT = {};       // campaignId -> [{to, subject, company, ts}] — isolated per campaign
let CAMPAIGN_OUTPUTS = {};    // campaignId -> {ammoAt, satelliteAt, satelliteCount, ragDrafts, ragAt, glockSent, glockAt}

// Everything an agent produces for a campaign is persisted to localStorage so it survives
// page reloads and switching between campaigns — the user should always be able to see what
// each agent produced (the doc, the leads, the drafts, the sends), not lose it on navigation.
const CSTATE_KEY = "evertrust_cstate_v1";
function persistCampaignState() {
  try {
    localStorage.setItem(CSTATE_KEY, JSON.stringify({
      leads: CAMPAIGN_LEADS, templates: CAMPAIGN_TEMPLATES,
      sent: CAMPAIGN_SENT, outputs: CAMPAIGN_OUTPUTS,
    }));
  } catch (e) { /* storage quota — ignore */ }
}
function restoreCampaignState() {
  try {
    const s = JSON.parse(localStorage.getItem(CSTATE_KEY) || "{}");
    CAMPAIGN_LEADS = s.leads || {};
    CAMPAIGN_TEMPLATES = s.templates || {};
    CAMPAIGN_SENT = s.sent || {};
    CAMPAIGN_OUTPUTS = s.outputs || {};
  } catch (e) { /* corrupt — start fresh */ }
}
restoreCampaignState();

function currentCid() { return SELECTED_CAMPAIGN ? SELECTED_CAMPAIGN.id : "none"; }

// Best-effort count extraction from varied agent response shapes.
function ragDraftCount(data) {
  if (!data) return 0;
  if (Array.isArray(data.drafts)) return data.drafts.length;
  if (Array.isArray(data.emails)) return data.emails.length;
  if (data.counts) for (const k of ["drafted", "drafts", "emails", "replies"])
    if (typeof data.counts[k] === "number") return data.counts[k];
  if (typeof data.drafted === "number") return data.drafted;
  return 0;
}
function glockSentCount(data) {
  if (!data) return 0;
  if (typeof data.emailsSent === "number") return data.emailsSent;
  if (Array.isArray(data.sent)) return data.sent.length;
  if (Array.isArray(data.replies)) return data.replies.length;
  if (data.counts) for (const k of ["sent", "replied", "replies", "emailsSent"])
    if (typeof data.counts[k] === "number") return data.counts[k];
  return 0;
}

// Capture per-agent output that feeds the leads sidebar / drafts / doc.
function captureAgentOutput(key, data) {
  if (!data) return;
  const cid = currentCid();
  const out = (CAMPAIGN_OUTPUTS[cid] = CAMPAIGN_OUTPUTS[cid] || {});
  const now = new Date().toISOString();

  if (key === "lead" || key === "satellite") {
    if (Array.isArray(data.leads) && data.leads.length) {
      // Normalize each run's raw output into the Excel-sheet shape, then ACCUMULATE
      // across runs (dedup by email/website) so the table reflects every run's leads.
      const incoming = data.leads.map(l => normalizeLead(l, SELECTED_CAMPAIGN));
      const hadRealRun = !!out.satelliteAt && Array.isArray(CAMPAIGN_LEADS[cid]);
      let merged;
      if (hadRealRun) {
        const byKey = new Map(CAMPAIGN_LEADS[cid].map(l => [leadKey(l), l]));
        incoming.forEach(l => byKey.set(leadKey(l), l));   // newest run wins / extends
        merged = Array.from(byKey.values());
      } else {
        merged = incoming;   // first real run replaces the 30-lead sample folder
      }
      CAMPAIGN_LEADS[cid] = merged;
      out.satelliteAt = now;
      out.satelliteCount = merged.length;
      out.satelliteRuns = (out.satelliteRuns || 0) + 1;
      out.satelliteVerified = merged.filter(l => l.emailVerified && l.email).length;
      renderLeadsSidebar(merged);
      if (SELECTED_CAMPAIGN) renderCampaignView(SELECTED_CAMPAIGN);   // refresh the Excel table
      toast(`🛰️ Lead Satellite — +${incoming.length} this run · ${merged.length} in table`, "ok");
    } else {
      // Satellite ran but returned no leads — usually the search backend is down.
      const list = document.getElementById("leads-list");
      const cnt = document.getElementById("leads-count");
      if (cnt) cnt.textContent = "";
      if (list) {
        const why = data.status === "search_unavailable"
          ? "Search backend unavailable (SearXNG down / DuckDuckGo rate-limited)."
          : (data.error || "No leads returned.");
        list.innerHTML = `<div class="err-box">🛰️ Satellite ran (status: <b>${esc(data.status || "?")}</b>, ${data.queriesRun ?? 0} queries) but found <b>0 leads</b>.<br>${esc(why)}</div>`;
      }
      toast(`🛰️ Satellite found 0 leads (${esc(data.status || "?")})`, "warn");
    }
  }

  if (key === "ammoforge" && data.templates) {
    CAMPAIGN_TEMPLATES[cid] = data.templates;
    out.ammoAt = now;
    renderLeadsActions();
    // The forged doc now persists for this campaign — show it right above the leads sheet.
    if (SELECTED_CAMPAIGN) renderCampaignView(SELECTED_CAMPAIGN);
    toast("📄 Ammo Forge — outreach doc ready (click the 📄 badge to reopen)", "ok");
  }

  if (key === "rag") {
    const n = ragDraftCount(data);
    out.ragDrafts = n; out.ragAt = now;
    toast(n ? `✉️ RAG — ${n} email${n > 1 ? "s" : ""} drafted (nothing sent)`
            : "✉️ RAG ran — no drafts produced", n ? "ok" : "warn");
  }

  if (key === "reply" || key === "glock") {
    const n = glockSentCount(data);
    const real = typeof data.emailsSent === "number" && data.emailsSent > 0;  // live send vs dry handle
    out.glockSent = n; out.glockAt = now;
    const verb = real ? "sent" : "handled (dry-run)";
    toast(n ? `📤 Reply Glock — ${n} repl${n > 1 ? "ies" : "y"} ${verb}`
            : "📤 Reply Glock ran — nothing to send", n ? "ok" : "warn");
  }

  persistCampaignState();
  if (SELECTED_CAMPAIGN) renderCampaignInfo(SELECTED_CAMPAIGN);   // refresh the persistent output badges
}

// Error-path notification, called by the run drivers when a run fails.
function notifyAgentError(key, error) {
  const a = AGENT_MAP[key];
  toast(`⚠️ ${a ? a.name : key} failed — ${String(error || "error").slice(0, 80)}`, "warn", 7000);
}

function renderLeadsSidebar(leads) {
  leads = leads || [];
  const list = document.getElementById("leads-list");
  const count = document.getElementById("leads-count");
  if (!list) return;
  if (count) count.textContent = leads.length ? String(leads.length) : "";
  if (!leads.length) {
    list.innerHTML = '<div class="muted">Run <b>Lead Satellite</b> on a campaign to populate leads here.</div>';
  } else {
    list.innerHTML = leads.map(l => `
      <div class="lead-item">
        <div class="lead-name">${esc(l.companyName || "—")}</div>
        <div class="lead-sub">${l.emailVerified && l.email
          ? '<span class="lead-email">' + esc(l.email) + '</span>'
          : '<span class="muted">no email</span>'}</div>
        <div class="lead-sub muted">${esc([l.city, l.country].filter(Boolean).join(", "))}${
          l.website ? " · " + esc(String(l.website).replace(/^https?:\/\//, "")) : ""}</div>
      </div>`).join("");
  }
  renderLeadsActions();
}

// Action buttons in the leads sidebar header area (depend on what's available).
function renderLeadsActions() {
  const actions = document.getElementById("leads-actions");
  if (!actions) return;
  const cid = currentCid();
  const leads = CAMPAIGN_LEADS[cid] || [];
  const tpl = CAMPAIGN_TEMPLATES[cid];
  const sentCount = (CAMPAIGN_SENT[cid] || []).length;
  let html = "";
  if (leads.length) html += `<button class="ghost mini" id="btn-sheet">📄 Leads sheet</button>`;
  if (tpl) html += `<button class="ghost mini" id="btn-doc">📄 Template Doc</button>`;
  if (leads.length && tpl) html += `<button class="mini" id="btn-draft">✉️ Draft outreach (${leads.filter(l => l.emailVerified && l.email).length})</button>`;
  else if (leads.length && !tpl) html += `<div class="muted" style="font-size:11px">Run <b>Ammo Forge</b> to draft emails from these leads.</div>`;
  if (leads.length) html += `<button class="mini" id="btn-testsend">📧 Test send (${leads.length})</button>`;
  if (sentCount) html += `<div class="sent-chip">✉ ${sentCount} test email${sentCount > 1 ? "s" : ""} sent · this campaign only</div>`;
  actions.innerHTML = html;
  const sh = document.getElementById("btn-sheet"); if (sh) sh.onclick = () => renderCampaignView(SELECTED_CAMPAIGN);
  const d = document.getElementById("btn-doc"); if (d) d.onclick = () => renderAmmoDoc(tpl);
  const e = document.getElementById("btn-draft"); if (e) e.onclick = () => renderDrafts(leads, tpl);
  const ts = document.getElementById("btn-testsend"); if (ts) ts.onclick = () => simulateTestSend(leads, SELECTED_CAMPAIGN);
}

// ---- template parsing + filling -------------------------------------------

// Split a forged coldEmail string into its [COLD]/[FOLLOWUP]/[FINALPUSH]/... blocks.
function parseTemplateBlocks(coldEmail) {
  const blocks = [];
  const re = /\[([A-Z][A-Z\- ]*)\]\s*([\s\S]*?)(?=\n\[[A-Z][A-Z\- ]*\]|$)/g;
  let m;
  while ((m = re.exec(String(coldEmail || "")))) blocks.push({ name: m[1].trim(), body: m[2].trim() });
  return blocks;
}

function fillTemplate(text, lead) {
  const c = SELECTED_CAMPAIGN || {};
  return String(text || "")
    .replace(/\{\{\s*company ?name\s*\}\}/gi, lead.companyName || "there")
    .replace(/\{\{\s*country\s*\}\}/gi, lead.country || c.country || "")
    .replace(/\{\{\s*project\s*\}\}/gi, c.project || "")
    .replace(/\{\{\s*city\s*\}\}/gi, lead.city || "");
}

// Pull Subject + Body out of the [COLD] block (the first outreach email).
function coldBlock(templates) {
  const blocks = parseTemplateBlocks(templates && templates.coldEmail);
  const cold = blocks.find(b => b.name === "COLD") || blocks[0];
  if (!cold) return { subject: "", body: "" };
  const sm = cold.body.match(/Subject:\s*(.*)/i);
  const subject = sm ? sm[1].trim() : "";
  let body = cold.body;
  if (/Body:/i.test(body)) body = body.replace(/^[\s\S]*?Body:\s*/i, "");
  else body = body.replace(/Subject:.*\n?/i, "");
  return { subject, body: body.trim() };
}

// ---- Google-Docs-style template page (rendered in the panel) ---------------
const _BLOCK_LABELS = { COLD: "Cold email", FOLLOWUP: "Follow-up", FINALPUSH: "Final push" };
function _docEmailCard(b) {
  const sm = b.body.match(/Subject:\s*(.*)/i);
  const subject = sm ? sm[1].trim() : "";
  let bd = b.body;
  if (/Body:/i.test(bd)) bd = bd.replace(/^[\s\S]*?Body:\s*/i, "");
  else bd = bd.replace(/Subject:.*\n?/i, "");
  const label = _BLOCK_LABELS[b.name.replace(/[^A-Z]/g, "")] || b.name;
  return `<div class="doc-email">
      <div class="doc-email-tag">${esc(label)}</div>
      ${subject ? `<div class="doc-subject"><span class="muted">Subject:</span> ${esc(subject)}</div>` : ""}
      <div class="doc-emailbody">${esc(bd.trim())}</div>
    </div>`;
}
function ammoDocHtml(templates) {
  if (!templates) return "";
  const blocks = parseTemplateBlocks(templates.coldEmail);
  const news = templates.newsBrief || "";
  return `<div class="gdoc">
      <div class="gdoc-bar">📄 Outreach Templates — ${esc(SELECTED_CAMPAIGN ? (SELECTED_CAMPAIGN.project || "") : "")}
        <span class="muted">· Google Docs preview (not created in Drive)</span></div>
      <div class="gdoc-page">
        <h1>Outreach Templates</h1>
        ${blocks.length
          ? blocks.map(_docEmailCard).join("")
          : `<div class="gdoc-block">${esc(String(templates.coldEmail || "").trim())}</div>`}
        ${news ? `<h2>News Intel</h2><pre class="doc-news">${esc(news)}</pre>` : ""}
      </div>
    </div>`;
}
function renderAmmoDoc(templates) {
  if (!templates) return;
  const panel = document.getElementById("panel");
  const title = document.getElementById("panel-title");
  const body = document.getElementById("panel-body");
  if (!panel || !body) return;
  panel.style.display = "block";
  if (title) title.textContent = "Ammo Forge — Template Doc";
  body.innerHTML = ammoDocHtml(templates);
}

// ---- Gmail drafts (rendered in the panel; nothing is sent) -----------------
function renderDrafts(leads, templates) {
  const panel = document.getElementById("panel");
  const title = document.getElementById("panel-title");
  const body = document.getElementById("panel-body");
  if (!panel || !body) return;
  panel.style.display = "block";
  const withEmail = (leads || []).filter(l => l.emailVerified && l.email);
  if (title) title.textContent = `Gmail drafts — ${withEmail.length} (DRAFT · nothing sent)`;
  const cb = coldBlock(templates);
  body.innerHTML =
    `<div class="muted" style="margin-bottom:12px">Local previews of the cold email that would be drafted per lead — <b>nothing is sent</b>.</div>` +
    (withEmail.map(l => {
      const subj = fillTemplate(cb.subject, l) || "(no subject)";
      const bd = fillTemplate(cb.body, l);
      return `<div class="gmail-draft">
        <div class="gd-head"><span class="gd-badge">DRAFT</span><span class="gd-to">To: ${esc(l.email)}</span><span class="muted"> · ${esc(l.companyName)}</span></div>
        <div class="gd-subject">${esc(subj)}</div>
        <pre class="gd-body">${esc(bd)}</pre>
      </div>`;
    }).join("") || '<div class="muted">No leads with verified emails to draft yet.</div>');
}

// ============================================================================
// LLM TOGGLE — header switch, the single source of truth for useLlm on EVERY agent.
// ON (default now): agents call the LiteLLM gateway (hermes) on the tailnet. OFF:
// agents run their offline stubs. Persisted across reloads.
// ============================================================================
let USE_LLM = (function () {
  try { const v = localStorage.getItem("mockui_use_llm"); return v == null ? true : v === "1"; }
  catch (e) { return true; }
})();
function mountLlmToggle() {
  const btn = document.getElementById("llm-toggle");
  if (!btn) return;
  const sync = () => {
    btn.textContent = "🧠 LLM: " + (USE_LLM ? "on" : "off");
    btn.classList.toggle("on", USE_LLM);
    try { localStorage.setItem("mockui_use_llm", USE_LLM ? "1" : "0"); } catch (e) { /* ignore */ }
  };
  btn.addEventListener("click", () => {
    USE_LLM = !USE_LLM;
    sync();
    toast(USE_LLM ? "🧠 LLM ON — all agents call the hermes gateway (slower, real output)"
                  : "LLM OFF — all agents use offline stubs (fast)", USE_LLM ? "ok" : "warn");
  });
  sync();
}

// ============================================================================
// SAMPLE LEAD FOLDER (30/campaign) · excel-sheet view · simulated test-send.
// Leads follow the old v_leads_sheet columns exactly:
//   Company Name · Company Type · Email · Status · Date Sent · Website · City ·
//   Country · Tier · Send From · Notes
// ============================================================================

// Deterministic per-campaign PRNG so each campaign's 30 leads are stable.
function seededRng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  return function () {
    h += 0x6D2B79F5; let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _CITIES = {
  Poland: ["Warszawa", "Kraków", "Wrocław", "Poznań", "Gdańsk", "Łódź", "Katowice", "Szczecin", "Lublin", "Bydgoszcz"],
  Germany: ["Berlin", "München", "Hamburg", "Köln", "Frankfurt", "Stuttgart", "Düsseldorf", "Leipzig", "Dortmund", "Essen"],
  Hungary: ["Budapest", "Debrecen", "Szeged", "Miskolc", "Pécs", "Győr"],
  _default: ["Capital", "Riverside", "Lakeside", "Hilltop", "Old Town", "Harborview"],
};
const _SUFFIX = { Poland: "Sp. z o.o.", Germany: "GmbH", Hungary: "Kft.", _default: "Ltd" };
const _TLD = { Poland: "pl", Germany: "de", Hungary: "hu", _default: "com" };
const _ROOTS = ["Nordic", "Vertex", "Prime", "Apex", "Metro", "Euro", "Stellar", "Brightline", "Pulse",
  "Vanguard", "Summit", "Atlas", "Orbit", "Lumen", "Forge", "Quantum", "Vista", "Crown", "Pioneer",
  "Beacon", "Helix", "Zenith", "Cobalt", "Granite", "Falcon", "Harbor", "Ironwood", "Maple", "Solis",
  "Terra", "Aurora", "Delta", "Magna", "Nova"];
const _TYPES = ["Manufacturer", "Distributor", "Rental", "Integrator", "Reseller", "Wholesaler", "Installer", "Agency"];
const _ROLES = ["info", "biuro", "kontakt", "office", "sales", "hello", "contact"];
// The only valid lead statuses.
const _STATUSES = ["Outreached", "Outreached", "Outreached", "Outreached", "unsure", "unsure",
  "sure", "sure", "temp", "uninterested", "uninterested"];
const _TIERS = ["A", "B", "B", "C", "C", "C"];
const _SENDERS = ["info", "info", "hanna"];

function _isoDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
function _nicheToken(niche) { const t = String(niche || "Leads").replace(/[^a-zA-Z]/g, ""); return t ? t.slice(0, 12) : "Leads"; }

// 30 deterministic leads for a campaign, in the v_leads_sheet shape.
function sampleLeads(c) {
  const rng = seededRng("leadfolder:" + c.id);
  const country = c.country || "Poland";
  const cities = _CITIES[country] || _CITIES._default;
  const suffix = _SUFFIX[country] || _SUFFIX._default;
  const tld = _TLD[country] || _TLD._default;
  const niche = _nicheToken(c.nicheName || c.project);
  const pick = a => a[Math.floor(rng() * a.length)];
  const used = new Set();
  const out = [];
  for (let i = 0; i < 30; i++) {
    const root = _ROOTS[(Math.floor(rng() * _ROOTS.length) + i) % _ROOTS.length];
    const name = `${root} ${niche} ${suffix}`;
    let slug = (root + niche).toLowerCase().replace(/[^a-z0-9]/g, "");
    while (used.has(slug)) slug += (1 + Math.floor(rng() * 9));
    used.add(slug);
    const domain = `${slug}.${tld}`;
    const status = pick(_STATUSES);
    const verified = rng() > 0.12;
    const sent = ["Outreached", "sure", "unsure", "uninterested"].includes(status);  // contacted -> has a Date Sent
    out.push({
      companyName: name,
      companyType: pick(_TYPES),
      email: verified ? `${pick(_ROLES)}@${domain}` : "",
      emailVerified: verified,
      status,
      dateSent: sent ? _isoDaysAgo(1 + Math.floor(rng() * 14)) : "",
      website: `https://www.${domain}`,
      city: pick(cities),
      country,
      tier: pick(_TIERS),
      sendFrom: pick(_SENDERS),
      notes: status === "sure" ? "Replied — ready to proceed" :
             status === "unsure" ? "Asked for pricing" :
             status === "uninterested" ? "Declined" :
             status === "temp" ? "Hold / revisit" : "",
    });
  }
  return out;
}

// Each campaign's leads: the 30-lead sample folder by default (a real Satellite run replaces it).
function ensureLeads(c) {
  if (!CAMPAIGN_LEADS[c.id]) CAMPAIGN_LEADS[c.id] = sampleLeads(c);
  return CAMPAIGN_LEADS[c.id];
}

// ---- excel-sheet table (v_leads_sheet columns) ----------------------------
const _SHEET_COLS = [
  ["Rank", "ranking"], ["Score", "score"], ["Company Name", "companyName"], ["Company Type", "companyType"],
  ["Email", "email"], ["Status", "status"], ["Date Sent", "dateSent"], ["Website", "website"],
  ["City", "city"], ["Country", "country"], ["Tier", "tier"], ["Send From", "sendFrom"], ["Notes", "notes"],
];
function statusClass(s) {
  s = String(s || "").toLowerCase();
  if (s === "sure") return "ok";            // green — converting
  if (s === "uninterested") return "fail";  // red — lost
  return "";                                // Outreached / unsure / temp — neutral
}

// Map a raw agent/satellite lead into the exact v_leads_sheet (Excel) column shape.
// Real Satellite output has {email, companyName, website, city, country, sourceUrl,
// emailVerified} — the rest of the columns are derived sensibly for a fresh scrape.
function scoreTier(s) {
  s = Number(s);
  if (!isFinite(s)) return "";
  if (s >= 75) return "A";
  if (s >= 55) return "B";
  if (s >= 40) return "C";
  return "D";
}
function normalizeLead(l, c) {
  c = c || SELECTED_CAMPAIGN || {};
  const verified = !!(l.emailVerified && l.email);
  const srcHost = String(l.sourceUrl || l.website || "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  const hasScore = l.score != null && l.score !== "";
  return {
    ranking: l.ranking != null ? l.ranking : "",   // 1..N relevance rank from Satellite
    score: hasScore ? l.score : "",
    companyName: l.companyName || l.company || "—",
    companyType: l.companyType || "",
    email: l.email || "",
    emailVerified: verified,
    status: l.status || "",                       // satellite: verified / no-email / protected
    dateSent: l.dateSent || "",
    website: l.website || l.sourceUrl || "",
    city: (l.city && l.city !== "Anywhere") ? l.city : "",
    country: l.country || c.country || "",
    tier: l.tier || (hasScore ? scoreTier(l.score) : ""),
    sendFrom: l.sendFrom || c.sender || "",
    notes: l.notes || (srcHost ? "src: " + srcHost : ""),
  };
}
// Dedup key — prefer email, fall back to website/company.
function leadKey(l) {
  return (l.email || "").toLowerCase() || (l.website || "").toLowerCase() || (l.companyName || "").toLowerCase();
}

// ---- CSV export (opens directly in Excel/Sheets) ---------------------------
function leadsToCsv(leads) {
  const cell = v => { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const head = _SHEET_COLS.map(([h]) => cell(h)).join(",");
  const rows = (leads || []).map(l => _SHEET_COLS.map(([, k]) => cell(l[k])).join(","));
  return [head, ...rows].join("\r\n");
}
function downloadLeadsCsv(c) {
  const leads = CAMPAIGN_LEADS[c.id] || [];
  const blob = new Blob(["﻿" + leadsToCsv(leads)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `leads_${slugify(c.project || c.name || "campaign")}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`⬇ Exported ${leads.length} leads to CSV`, "ok");
}

function leadSheetHtml(c, leads) {
  const o = CAMPAIGN_OUTPUTS[c.id] || {};
  const verified = leads.filter(l => l.emailVerified && l.email).length;
  const runMeta = o.satelliteRuns
    ? ` · from ${o.satelliteRuns} run${o.satelliteRuns > 1 ? "s" : ""}${o.satelliteAt ? " · last " + esc(fmtTime(o.satelliteAt)) : ""}`
    : " · sample folder";
  return `<div class="sheet-head">
      <span class="sheet-cap">📄 Leads sheet · ${esc(c.project || c.name || "campaign")} · ${leads.length} leads · ${verified} with email${runMeta}</span>
      <span class="sheet-actions">
        <button class="ghost mini" id="btn-csv">⬇ CSV</button>
        <button class="ghost mini" id="btn-expand">${SHEET_EXPANDED ? "⤡ Collapse" : "⤢ Expand"}</button>
      </span>
    </div>
    <div class="sheet-wrap"><table class="sheet">
    <thead><tr>${_SHEET_COLS.map(([h]) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${leads.map(l => `<tr>${_SHEET_COLS.map(([h, k]) => {
      if (k === "status") return `<td><span class="st-pill ${statusClass(l.status)}">${esc(l.status || "")}</span></td>`;
      if (k === "email") return `<td>${l.email
        ? esc(l.email) + (l.emailVerified ? ' <span class="email-ok" title="verified">✓</span>' : '')
        : '<span class="muted">—</span>'}</td>`;
      if (k === "website") return `<td class="muted">${esc(String(l.website || "").replace(/^https?:\/\/(www\.)?/, ""))}</td>`;
      const v = l[k]; return `<td>${v != null && v !== "" ? esc(v) : '<span class="muted">·</span>'}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>`;
}

// Whether the leads sheet is expanded (full width, no height cap).
let SHEET_EXPANDED = false;

// The canonical campaign panel: the Ammo Forge template doc (if forged for this
// campaign) directly above the leads sheet. Persists across re-selects because the
// templates live in CAMPAIGN_TEMPLATES keyed by campaign id.
function renderCampaignView(c) {
  if (!c) return;
  const leads = CAMPAIGN_LEADS[c.id] || ensureLeads(c);
  const tpl = CAMPAIGN_TEMPLATES[c.id];
  const panel = document.getElementById("panel");
  const title = document.getElementById("panel-title");
  const body = document.getElementById("panel-body");
  if (!panel || !title || !body) return;
  panel.style.display = "block";
  panel.classList.toggle("wide", SHEET_EXPANDED);
  title.textContent = `${c.project || c.name || "campaign"} — leads (${leads.length})`;
  body.innerHTML = (tpl ? ammoDocHtml(tpl) + '<div class="view-sep"></div>' : "") + leadSheetHtml(c, leads);
  const exp = document.getElementById("btn-expand");
  if (exp) exp.onclick = () => { SHEET_EXPANDED = !SHEET_EXPANDED; renderCampaignView(c); };
  const csv = document.getElementById("btn-csv");
  if (csv) csv.onclick = () => downloadLeadsCsv(c);
}

// Back-compat alias — older callers asked for "the leads sheet"; now it's the full view.
function renderLeadSheet(c) { renderCampaignView(c); }

// ---- simulated test-send (repeatable) -------------------------------------
const TEST_TO = "info@evertrust-germany.de";
const TEST_SUBJECT = "TESTING";
async function simulateTestSend(leads, campaign) {
  leads = leads || [];
  campaign = campaign || SELECTED_CAMPAIGN;
  const cid = campaign ? campaign.id : "none";
  const cname = campaign ? (campaign.project || campaign.name || campaign.id) : "campaign";
  const panel = document.getElementById("panel");
  const title = document.getElementById("panel-title");
  const body = document.getElementById("panel-body");
  if (!panel) return;
  panel.style.display = "block";
  if (title) title.textContent = `Test send · ${cname} → ${TEST_TO}`;
  body.innerHTML = `<div class="muted" style="margin-bottom:10px">Scoped to <b>${esc(cname)}</b> only — every email is addressed to <b>${esc(TEST_TO)}</b> with subject <b>"${esc(TEST_SUBJECT)}"</b>. Recorded against this campaign so sends never leak across campaigns. <i>(Simulation — nothing actually leaves until OAuth is wired.)</i></div><div class="sendlog" id="sendlog"></div>`;
  const log = document.getElementById("sendlog");
  CAMPAIGN_SENT[cid] = CAMPAIGN_SENT[cid] || [];
  let n = 0;
  for (const l of leads) {
    n++;
    CAMPAIGN_SENT[cid].push({ to: TEST_TO, subject: TEST_SUBJECT, company: l.companyName || "lead", ts: new Date().toISOString() });
    const row = document.createElement("div");
    row.className = "send-row";
    row.innerHTML = `<span class="send-ok">✓ sent</span> <span class="send-to">${esc(TEST_TO)}</span> <span class="send-subj">[${esc(TEST_SUBJECT)}]</span> <span class="muted">— for ${esc(l.companyName || "lead")}</span>`;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    await new Promise(r => setTimeout(r, 45));
  }
  const total = CAMPAIGN_SENT[cid].length;
  const done = document.createElement("div");
  done.className = "send-done";
  done.textContent = `Done — ${n} test emails to ${TEST_TO} (subject "${TEST_SUBJECT}") for ${cname}. Campaign total: ${total}. Nothing was actually sent.`;
  log.appendChild(done);
  persistCampaignState();   // sends survive reloads, scoped to this campaign
  renderLeadsActions();     // refresh the per-campaign sent count
  if (SELECTED_CAMPAIGN) renderCampaignInfo(SELECTED_CAMPAIGN);  // refresh the persistent badges
  toast(`${n} test emails → ${TEST_TO} (${cname})`, "ok");
}

// ---- top-of-page progress bar + ETA (for Lead Satellite) -------------------
let _progTimer = null;
function startProgress(label, estMs) {
  const wrap = document.getElementById("top-progress");
  const bar = document.getElementById("tp-bar");
  const lab = document.getElementById("tp-label");
  if (!wrap || !bar || !lab) return;
  wrap.hidden = false;
  const start = performance.now();
  clearInterval(_progTimer);
  const tick = () => {
    const el = performance.now() - start;
    const pct = Math.min(95, (el / estMs) * 100);
    bar.style.width = pct.toFixed(1) + "%";
    const remain = Math.max(0, (estMs - el) / 1000);
    lab.textContent = `${label} — ${remain > 0.5 ? "~" + Math.ceil(remain) + "s remaining" : "almost done…"}`;
  };
  tick();
  _progTimer = setInterval(tick, 200);
}
function finishProgress() {
  const wrap = document.getElementById("top-progress");
  const bar = document.getElementById("tp-bar");
  const lab = document.getElementById("tp-label");
  clearInterval(_progTimer);
  if (!wrap || !bar || !lab) return;
  bar.style.width = "100%";
  lab.textContent = "done";
  setTimeout(() => { wrap.hidden = true; bar.style.width = "0%"; }, 700);
}

// ---- light / dark theme toggle (persisted) ---------------------------------
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("mockui_theme", t); } catch (e) { /* ignore */ }
  const b = document.getElementById("theme-toggle");
  if (b) b.textContent = t === "dark" ? "☀️ Light" : "🌙 Dark";
}
function mountThemeToggle() {
  let t = "light";
  try { t = localStorage.getItem("mockui_theme") || "light"; } catch (e) { /* ignore */ }
  applyTheme(t);
  const b = document.getElementById("theme-toggle");
  if (b) b.addEventListener("click", () =>
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"));
}
