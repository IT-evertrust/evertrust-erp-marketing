// Hermes test console — talks to the LiteLLM gateway directly (it sends CORS allow-origin:*).
// Config (gateway url + key) comes from the gitignored config.local.js; if absent, the user is
// prompted to paste a key, stored in localStorage. Streaming via SSE for a live feel.

// ---- system context: the whole ERP/agents system, so hermes can reason about it -----------
const DEFAULT_SYSTEM = `You are "hermes", the local LLM behind EVERTRUST GmbH's marketing & sales automation platform. This is a developer test console — answer questions, help debug, and draft text. Be accurate and concise; say when you are unsure.

=== SYSTEM OVERVIEW ===
EVERTRUST is migrating its automation from n8n to a Python service mesh. It sells into German / EU public-sector TENDERS. A "campaign" targets a niche (e.g. "LED Container Rental") in a country (e.g. Poland); the system finds companies in that niche that could bid on or supply such tenders, then runs personalized outreach.

=== ARCHITECTURE (polyglot monorepo) ===
- mock-ui — vanilla JS control panel at http://localhost:5500. Runs agents per campaign in DRY-RUN (nothing is sent). This chat page lives here.
- erp-server — NestJS API at http://localhost:3001. The traffic director: campaigns, niches, prospects. Backed by Neon Postgres via Drizzle ORM.
- 9 FastAPI agent services (ports 8800–8808), each exposes POST /<pkg>/run:
  * 8800 reach (bazooka)   — cold email outreach via Gmail, with send-governance caps.
  * 8801 lead (satellite)  — keyless web LEAD SCRAPER: LLM buzzwords → SearXNG (language-biased) → site scrape for emails → company-type classification + relevance ranking. Returns 100+ ranked tender prospects.
  * 8802 reply (glock)     — triages and handles inbound email replies.
  * 8803 sleeper (grenade) — schedules follow-ups.
  * 8804 ammoforge         — generates cold / follow-up / final-push email templates + a "news intel" brief. Uses YOU (hermes).
  * 8805 crm (customer)    — CRM customer records.
  * 8806 rag               — drafts emails from context.
  * 8807 contractmaker     — drafts contracts from meeting notes.
  * 8808 sales             — sales-call coaching / scoring.
- ai-stack — runs on a Mac mini over Tailscale: LiteLLM gateway (serves YOU: "hermes", plus "deepseek", "hermes-mini"), SearXNG (keyless search, language-biased), Qdrant (vectors), Ollama (model backend).

=== THE PIPELINE ===
AIM (launch a campaign) → Ammo Forge (generate templates) → Reach (send outreach) → Lead Satellite (find leads) → Reply Glock (handle replies). Sleeper schedules follow-ups; Sales/Contract handle won deals.

=== STATUS / CONVENTIONS ===
- Lead Satellite leads store: company name, email, contactability status (verified / no-email / protected), company type, relevance score + 1..N ranking.
- CRM outreach statuses are only: Outreached, unsure, sure, temp, uninterested.
- Everything in the mock-ui is dry-run; live sends require explicit opt-in and Gmail OAuth.

Answer as a knowledgeable engineer on this exact system.`;

const LS = { key: "hermes_key", sys: "hermes_system_v1", model: "hermes_model", theme: "mockui_theme" };
const cfg = window.HERMES || {};
let GW_URL = (cfg.url || localStorage.getItem("hermes_url") || "https://mac-mini-ca-mac.tailc3d837.ts.net/v1").replace(/\/$/, "");
let GW_KEY = cfg.key || localStorage.getItem(LS.key) || "";
let MODEL = localStorage.getItem(LS.model) || cfg.model || "hermes";

const messages = [];   // {role, content} conversation (system prepended at send time)

// ---- helpers ---------------------------------------------------------------
function el(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m])); }
function getSystem() { return localStorage.getItem(LS.sys) || DEFAULT_SYSTEM; }
function scrollDown() { const t = el("transcript"); t.scrollTop = t.scrollHeight; }

function addBubble(role, text) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + role;
  wrap.innerHTML = `<div class="msg-role">${role === "user" ? "you" : "hermes"}</div><div class="msg-body"></div>`;
  wrap.querySelector(".msg-body").textContent = text || "";
  el("transcript").appendChild(wrap);
  scrollDown();
  return wrap.querySelector(".msg-body");
}

// ---- connection check + model list -----------------------------------------
async function checkConn() {
  const pill = el("conn");
  if (!GW_KEY) { pill.textContent = "no key"; pill.className = "conn-pill bad"; return; }
  try {
    const r = await fetch(GW_URL + "/models", { headers: { Authorization: "Bearer " + GW_KEY } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    const ids = (data.data || []).map(m => m.id).filter(id => !/embed/i.test(id));
    const sel = el("model-select");
    sel.innerHTML = ids.map(id => `<option value="${esc(id)}"${id === MODEL ? " selected" : ""}>${esc(id)}</option>`).join("");
    if (!ids.includes(MODEL) && ids.length) { MODEL = ids[0]; sel.value = MODEL; }
    pill.textContent = "connected"; pill.className = "conn-pill ok";
  } catch (e) {
    pill.textContent = "unreachable"; pill.className = "conn-pill bad";
    el("model-select").innerHTML = `<option>${esc(MODEL)}</option>`;
  }
}

// ---- send (streaming) ------------------------------------------------------
let BUSY = false;
async function send() {
  if (BUSY) return;
  const input = el("prompt");
  const text = input.value.trim();
  if (!text) return;
  if (!GW_KEY) { GW_KEY = promptForKey(); if (!GW_KEY) return; }
  input.value = "";
  messages.push({ role: "user", content: text });
  addBubble("user", text);

  BUSY = true;
  el("send").disabled = true; el("send").textContent = "…";
  const out = addBubble("assistant", "");
  out.classList.add("streaming");

  const body = {
    model: MODEL,
    messages: [{ role: "system", content: getSystem() }, ...messages],
    stream: true,
    temperature: 0.4,
  };
  let acc = "";
  try {
    const res = await fetch(GW_URL + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + GW_KEY },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("HTTP " + res.status + " — " + (await res.text()).slice(0, 200));
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const payload = s.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const delta = j.choices?.[0]?.delta?.content || "";
          if (delta) { acc += delta; out.textContent = acc; scrollDown(); }
        } catch (e) { /* keep partial SSE chunk */ }
      }
    }
    if (!acc) { acc = "(empty response)"; out.textContent = acc; }
    messages.push({ role: "assistant", content: acc });
  } catch (e) {
    out.classList.add("err");
    out.textContent = "" + (e.message || String(e)).slice(0, 300);
  } finally {
    out.classList.remove("streaming");
    BUSY = false;
    el("send").disabled = false; el("send").textContent = "Send";
    input.focus();
  }
}

function promptForKey() {
  const k = window.prompt("Paste the LiteLLM gateway key (sk-…). Stored locally only.", "");
  if (k) { GW_KEY = k.trim(); localStorage.setItem(LS.key, GW_KEY); checkConn(); }
  return GW_KEY;
}

// ---- theme (shared with the control panel) ---------------------------------
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem(LS.theme, t); } catch (e) { /* ignore */ }
  const b = el("theme-toggle"); if (b) b.textContent = t === "dark" ? "Light" : "Dark";
}

// ---- wire up ---------------------------------------------------------------
function init() {
  applyTheme(localStorage.getItem(LS.theme) || "light");
  el("system-prompt").value = getSystem();
  addBubble("assistant", "Hi — I'm hermes with full ERP system context loaded. Ask me anything to test the gateway, or click System context to see/edit what I know.");

  el("send").addEventListener("click", send);
  el("prompt").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  el("model-select").addEventListener("change", e => { MODEL = e.target.value; localStorage.setItem(LS.model, MODEL); });
  el("clear-chat").addEventListener("click", () => { messages.length = 0; el("transcript").innerHTML = ""; addBubble("assistant", "Cleared. Context still loaded."); });
  el("ctx-toggle").addEventListener("click", () => { el("ctx-panel").hidden = !el("ctx-panel").hidden; });
  el("ctx-save").addEventListener("click", () => { localStorage.setItem(LS.sys, el("system-prompt").value); el("ctx-panel").hidden = true; addBubble("assistant", "System context updated."); });
  el("ctx-reset").addEventListener("click", () => { localStorage.removeItem(LS.sys); el("system-prompt").value = DEFAULT_SYSTEM; });
  el("theme-toggle").addEventListener("click", () => applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"));

  checkConn();
  el("prompt").focus();
}
init();
