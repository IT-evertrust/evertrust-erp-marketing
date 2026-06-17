// ============================================================================
// ENGAGE PAGE — Reply Glock + RAG, embedded.
//   • Top: pick a campaign (selectable mini boxes).
//   • Bottom: a two-column review workspace —
//       left  = status filter bar + preview list of every drafted reply,
//       right = the full draft + Accept / Decline / Edit, plus a mini Hermes
//               AI-suggestion box that critiques the current draft.
// Reuses globals from app.js: CAMPAIGNS, AIM_API, fetchCampaigns, ensureLeads,
// CAMPAIGN_LEADS, leadKey, esc, toast. Hermes config from window.HERMES.
// ============================================================================

// Reply status (CRM) → the 5 engage buckets the user filters on.
const ENGAGE_STATUSES = [
  { key: "all",          label: "All" },
  { key: "interested",   label: "Interested" },
  { key: "unsure",       label: "Unsure" },
  { key: "temporary",    label: "Temporary" },
  { key: "cold",         label: "Cold outreached" },
  { key: "uninterested", label: "Uninterested" },
];
const ENGAGE_LABELS = Object.fromEntries(ENGAGE_STATUSES.map(s => [s.key, s.label]));

function engageStatusOf(lead) {
  switch (String(lead.status || "").toLowerCase()) {
    case "sure":         return "interested";
    case "unsure":       return "unsure";
    case "temp":         return "temporary";
    case "uninterested": return "uninterested";
    case "outreached":   return "cold";
    default:             return "cold";   // satellite raw statuses default to cold outreach
  }
}

// ---- engage state ----------------------------------------------------------
let ENGAGE_MOUNTED = false;
let ENGAGE_CID = null;
let ENGAGE_FILTER = "all";
let ENGAGE_SELKEY = null;
let ENGAGE_EDITING = false;
let ENGAGE_THREAD = false;   // is the client-response thread chain expanded?
let ENGAGE_RULES = false;    // is the active persona's rules panel open?

// ============================================================================
// PERSONAS — each salesperson has a writing style the model drafts in, plus
// per-status default rules (`defaultRules`) drafted from their real sent emails.
// "Hanna" is grounded in her actual replies: warm, empathetic, human; opens by
// acknowledging the person's situation; personalises; drives to a concrete
// CET meeting slot + calendar invite; a single 😊 where it fits.
// Add more salespeople by appending to PERSONAS (give each its own defaultRules).
// ============================================================================
const PERSONAS = [
  {
    id: "hanna",
    name: "Hanna",
    fullName: "Hanna Nguyen",
    handle: "hanna@evertrust-germany.de",
    blurb: "Warm, empathetic, human closer",
    greet: co => `Dear ${co} team,`,
    signoff: "Warm regards,\nHanna Nguyen",
    rules: [
      "Leads with empathy — opens by acknowledging the person's specific situation (if applicable) or what they said, before any logistics.",
      "Personalises every reply — references the exact details they shared (company, expertise, constraints, anything personal). Never generic.",
      "Validates feelings sincerely — if they mention being busy / overloaded / needing to reschedule, says something human like “I completely understand, I've been there myself.”",
      "Warm and human, never pushy or templated. A single 😊 where it fits naturally — never more than one.",
      "Salutation “Dear/Hi <First name>,” — never “Hello,”; never invents a name she doesn't have.",
      "Short one–two sentence paragraphs with blank lines between; easy to read on a phone.",
      "Always drives to a concrete next step: a specific date + time + CET, sends the calendar invite, asks them to accept to reserve — and offers an easy out to suggest another time.",
      "Closes warm and forward-looking; signs off “Warm regards / Kind regards, Hanna Nguyen.”",
    ],
    system:
`You are Hanna Nguyen, an account executive at EVERTRUST GmbH. You help companies win German / EU public tenders (and rent LED screens / modular containers). You write warm, human, genuinely empathetic email replies that make the recipient feel understood.

CORE VOICE:
- Lead with empathy. Open by acknowledging the specific thing they said or their situation BEFORE any logistics. Personalise — reference the exact details they shared (company, expertise, constraints, anything personal). Never generic or templated.
- If they mention being busy, overloaded, travelling, or needing to reschedule, validate it sincerely and humanly first — e.g. "I completely understand, I've been there myself." Go the extra mile to make them feel seen.
- Warm and confident, never pushy or robotic. A single 😊 is on-brand where it fits naturally — never more than one, never forced.

FORMAT:
- Salutation "Dear <First name>," or "Hi <First name>," — always their first name, never "Hello,". Never invent a name you don't have.
- Short paragraphs, one or two sentences each, with blank lines between them. Reads well on a phone.
- Use the knowledge base for any factual claim; never invent facts.

NEXT STEP (almost always a meeting):
- Propose a specific slot: weekday, full date, time + CET timezone (e.g. "Thursday, 18 June 2026 at 11:00 AM CET"), and the duration where relevant ("a 20-minute video call").
- Say you'll send the calendar invitation and ask them to accept it to reserve the spot. Where it helps, tentatively hold a slot for them.
- Always give an easy out: invite them to suggest another time if yours doesn't fit.

CLOSE warm and forward-looking ("Looking forward to connecting and reviewing the best opportunities together."). Sign off "Warm regards," or "Kind regards," then "Hanna Nguyen".`,
    // Per-status rules drafted from Hanna's real sent emails (stored as her persona).
    defaultRules: {
      overall:
`- Warm, human, genuinely empathetic — you sound like a real person who cares, not a template. Open by acknowledging the specific thing they said or their situation before anything else.
- Personalise: reference the exact details they shared (their company, expertise, constraints, anything personal). Never generic.
- Acknowledge their situation explicitly. If they mention being busy, overloaded, travelling, or needing to reschedule, validate it first in a human way — e.g. "I completely understand, I've been there myself." Go the extra mile to make them feel seen.
- Salutation "Dear/Hi <First name>," — always their first name, never "Hello,".
- Short paragraphs, mostly one or two sentences, with blank lines between. Easy to read on a phone.
- Always drive to a concrete next step: a specific date + time with the CET timezone (e.g. "Thursday, 18 June 2026 at 11:00 AM CET"); say you'll send the calendar invitation and ask them to accept it to reserve the spot.
- Always give an easy out — invite them to suggest another time if yours doesn't fit.
- A single warm 😊 where it fits naturally — never more than one, never forced.
- Close warm and forward-looking. Sign off "Warm regards," or "Kind regards," then "Hanna Nguyen".`,
      interested:
`- They're engaged — match their energy and move decisively to a qualification call.
- Open by thanking them and referencing the specific detail they shared (their expertise, their company, exactly what they're looking for).
- Propose ONE specific slot: weekday, full date, time + CET, and the duration (e.g. "a 20-minute video call"). Say you'll send the invitation and ask them to accept to reserve their spot.
- Add one sentence on WHY the call is worth it for THEM, framed around their goal (e.g. "the most efficient way to see which tenders are realistic for you and how to maximise your chances of success").
- Close looking forward to working through the best opportunities together.`,
      unsure:
`- Lighter, reassuring touch — they replied but aren't fully committed. Keep it short and low-pressure.
- Thank them warmly for getting back to you. If they raised a question or hesitation, acknowledge it and answer plainly first (use the knowledge base for facts; never guess).
- Offer ONE concrete first-available slot (date + time + CET). Frame it gently: "If this works for you, I'll send the invitation so you can accept and reserve the appointment."
- Keep the door open and the pressure off — make it feel easy to say yes. Close looking forward to speaking with them.`,
      temporary:
`- This is about timing — a missed meeting, a reschedule, or "not right now". Lead with genuine empathy and acknowledgement BEFORE logistics.
- If you missed each other or they couldn't make it, say so warmly and humanly ("Sorry I missed you today — it would have been lovely to meet you"). If they mentioned being busy or overloaded, validate it sincerely ("I completely understand, I've been there myself").
- Offer one or two specific alternative slots (date + time + CET). Tentatively hold one to reduce friction: "I'll tentatively lock you in for [slot] to reserve a time for you — please accept if this works!"
- Always give an easy out: "Otherwise, feel free to email me a better time that suits you." Keep it warm and no-pressure so the relationship stays open.`,
    },
  },
  {
    id: "house",
    name: "House style",
    fullName: "EVERTRUST",
    handle: "info@evertrust-germany.de",
    blurb: "Neutral, professional baseline",
    greet: co => `Hi ${co} team,`,
    signoff: "Best regards,\nEVERTRUST GmbH",
    rules: [
      "Clear, professional, neutral-friendly tone.",
      "Concise; no emojis.",
      "Greets with “Hi <Company> team,” and closes “Best regards, EVERTRUST GmbH”.",
    ],
    system:
`You write clear, professional B2B email replies for EVERTRUST GmbH (LED-screen & modular-container rental for EU tenders). Neutral-friendly tone, concise, no emojis. Greet with "Hi <Company> team,". Always end with a clear next step. Close with:
Best regards,
EVERTRUST GmbH`,
  },
];
// User-created personas live in localStorage; built-ins (Hanna, House) are coded above.
// A stored persona is just data {id,name,fullName,handle,blurb,signoff}; the function
// fields (greet/system) are synthesised on load so it behaves like a built-in. Its
// response rules live in ENGAGE_TRAIN.personaRules[id], authored via the Training panel.
const CUSTOM_PERSONAS_KEY = "evertrust_engage_personas_v1";
function slugifyId(s) { return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32); }
function hydratePersona(d) {
  const full = (d.fullName || d.name || "").trim();
  const signoff = d.signoff || `Kind regards,\n${full}`;
  return {
    id: d.id, name: d.name, fullName: full, handle: d.handle || "info@evertrust-germany.de",
    blurb: d.blurb || "Custom persona", custom: true,
    greet: co => `Dear ${co} team,`,
    signoff,
    rules: [],
    defaultRules: {},
    system: `You are ${full}, a salesperson at EVERTRUST GmbH writing warm, human, professional B2B email replies (helping companies win German / EU tenders; LED-screen & modular-container rental). Greet with "Dear/Hi <First name>,". Keep paragraphs short. Always end on a clear next step. Follow the team's response rules provided below. Close with "${signoff.replace(/\n/g, ", ")}".`,
  };
}
let CUSTOM_PERSONAS = (function () {
  try { return (JSON.parse(localStorage.getItem(CUSTOM_PERSONAS_KEY) || "[]") || []).map(hydratePersona); }
  catch (e) { return []; }
})();
function persistCustomPersonas() {
  try {
    const data = CUSTOM_PERSONAS.map(p => ({ id: p.id, name: p.name, fullName: p.fullName, handle: p.handle, blurb: p.blurb, signoff: p.signoff }));
    localStorage.setItem(CUSTOM_PERSONAS_KEY, JSON.stringify(data));
  } catch (e) { /* quota */ }
}
function allPersonas() { return PERSONAS.concat(CUSTOM_PERSONAS); }
function personaById(id) { return allPersonas().find(p => p.id === id) || PERSONAS[0]; }
function addPersona(name) {
  const base = slugifyId(name) || "persona";
  let id = base, n = 2;
  while (allPersonas().some(p => p.id === id)) { id = base + "-" + n; n++; }
  const p = hydratePersona({ id, name: name.trim(), fullName: name.trim() });
  CUSTOM_PERSONAS.push(p);
  persistCustomPersonas();
  return p;
}
function removePersona(id) {
  CUSTOM_PERSONAS = CUSTOM_PERSONAS.filter(p => p.id !== id);
  if (ENGAGE_TRAIN.personaRules) delete ENGAGE_TRAIN.personaRules[id];
  persistCustomPersonas(); persistTraining();
  if (ENGAGE_PERSONA === id) setActivePersona("hanna");
  if (typeof ENGAGE_RULES_PERSONA !== "undefined" && ENGAGE_RULES_PERSONA === id) ENGAGE_RULES_PERSONA = "hanna";
}

let ENGAGE_PERSONA = (function () {
  try { return localStorage.getItem("engage_persona") || "hanna"; } catch (e) { return "hanna"; }
})();
function activePersona() { return personaById(ENGAGE_PERSONA); }
function setActivePersona(id) {
  ENGAGE_PERSONA = id;
  try { localStorage.setItem("engage_persona", id); } catch (e) { /* ignore */ }
}

// Per-campaign, per-lead decision + edited text overrides. Survives reloads.
const ENGAGE_KEY = "evertrust_engage_v1";
let ENGAGE_STORE = (function () {
  try { return JSON.parse(localStorage.getItem(ENGAGE_KEY) || "{}"); } catch (e) { return {}; }
})();
function persistEngage() {
  try { localStorage.setItem(ENGAGE_KEY, JSON.stringify(ENGAGE_STORE)); } catch (e) { /* quota */ }
}
function engageOverride(cid, key) {
  return (ENGAGE_STORE[cid] && ENGAGE_STORE[cid][key]) || null;
}
function setEngageOverride(cid, key, patch) {
  ENGAGE_STORE[cid] = ENGAGE_STORE[cid] || {};
  ENGAGE_STORE[cid][key] = { ...(ENGAGE_STORE[cid][key] || {}), ...patch };
  persistEngage();
}

// ============================================================================
// TRAINING — the team teaches the "RAG": (1) a KNOWLEDGE BASE of uploaded
// documents Hermes drafts from, and (2) per-status RESPONSE RULES. Both persist
// in localStorage and are injected into every Hermes draft / redraft / feedback.
// ============================================================================
const ENGAGE_TRAIN_KEY = "evertrust_engage_training_v1";
let ENGAGE_TRAIN = (function () {
  try { return JSON.parse(localStorage.getItem(ENGAGE_TRAIN_KEY) || "null") || {}; }
  catch (e) { return {}; }
})();
ENGAGE_TRAIN.docs = ENGAGE_TRAIN.docs || [];   // [{id,name,size,chars,text,addedAt}]
ENGAGE_TRAIN.rules = ENGAGE_TRAIN.rules || {}; // legacy global rules (no longer used)
ENGAGE_TRAIN.personaRules = ENGAGE_TRAIN.personaRules || {}; // { personaId: { status: "rules" } } — user overrides
let ENGAGE_TRAIN_OPEN = false;
let ENGAGE_RULES_PERSONA = (function () {
  try { return localStorage.getItem("engage_persona") || "hanna"; } catch (e) { return "hanna"; }
})();

function persistTraining() {
  try { localStorage.setItem(ENGAGE_TRAIN_KEY, JSON.stringify(ENGAGE_TRAIN)); }
  catch (e) { toast("Couldn't save — browser storage is full (try smaller documents).", "warn", 7000); }
}
function addTrainingDoc(name, size, text) {
  ENGAGE_TRAIN.docs.push({
    id: "doc-" + Date.now() + "-" + ENGAGE_TRAIN.docs.length,
    name, size, chars: text.length, text, addedAt: new Date().toISOString(),
  });
  persistTraining();
}
function removeTrainingDoc(id) {
  ENGAGE_TRAIN.docs = ENGAGE_TRAIN.docs.filter(d => d.id !== id);
  persistTraining();
}
// Rules are persona-scoped: a persona's coded `defaultRules` are the baseline,
// overridden by anything the team edits in the Training panel (persisted per persona).
function ruleDefault(pid, status) {
  const p = personaById(pid);
  return (p && p.defaultRules && p.defaultRules[status]) ? String(p.defaultRules[status]) : "";
}
function getRuleFor(pid, status) {
  const ov = ENGAGE_TRAIN.personaRules && ENGAGE_TRAIN.personaRules[pid];
  const has = ov && Object.prototype.hasOwnProperty.call(ov, status);
  return String((has ? ov[status] : ruleDefault(pid, status)) || "").trim();
}
function setRuleFor(pid, status, text) {
  ENGAGE_TRAIN.personaRules = ENGAGE_TRAIN.personaRules || {};
  ENGAGE_TRAIN.personaRules[pid] = ENGAGE_TRAIN.personaRules[pid] || {};
  ENGAGE_TRAIN.personaRules[pid][status] = text;
  persistTraining();
}
// Drafting reads the ACTIVE persona's rules.
function rulesFor(status) { return getRuleFor(ENGAGE_PERSONA, status); }
function overallRule() { return getRuleFor(ENGAGE_PERSONA, "overall"); }
// The overall rule (every reply) + this status's adjustment, formatted for the model.
function rulesBlockFor(status) {
  const ov = overallRule();
  const st = rulesFor(status);
  return [
    ov ? `Overall rules (apply to every reply):\n${ov}` : "",
    st ? `Adjustments for "${ENGAGE_LABELS[status]}" replies:\n${st}` : "",
  ].filter(Boolean).join("\n\n");
}

// ---- deterministic formatting enforcement -------------------------------
// Some rules are formatting constraints a small model can't be trusted to obey
// (e.g. "don't use dashes"). We detect those and enforce them on the text directly,
// so the rule is honoured everywhere — baseline drafts, redrafts, and previews.
function noDashWanted(status) {
  const t = rulesBlockFor(status).toLowerCase();
  return /\bdash(es)?\b/.test(t) && /\b(no|not|n['’]t|without|avoid|never|do not|don['’]t|remove|stop)\b/.test(t);
}
function stripDashes(s) {
  return String(s == null ? "" : s)
    .replace(/\s*[—–]\s*/g, ", ")          // em / en dash → comma
    .replace(/(\S)\s+-\s+(\S)/g, "$1, $2")  // spaced hyphen used as a dash → comma
    .replace(/\s+,/g, ",")                   // tidy stray " ,"
    .replace(/,\s*,/g, ",");
}
// Apply every detected formatting rule for a status to a piece of text.
function enforceFormatting(text, status) {
  let t = text;
  if (noDashWanted(status)) t = stripDashes(t);
  return t;
}

// Concatenated knowledge for the model, capped so prompts stay reasonable.
function knowledgeContext(limit = 6000) {
  const docs = ENGAGE_TRAIN.docs || [];
  if (!docs.length) return "";
  let out = "";
  for (const d of docs) {
    out += `\n--- ${d.name} ---\n${d.text}\n`;
    if (out.length > limit) { out = out.slice(0, limit) + "\n…(truncated)"; break; }
  }
  return out.trim();
}

// ---- draft generation (deterministic, persona- + status-aware) -------------
// Deterministic baseline so the list is instant & works offline. The active
// persona's greeting + sign-off are applied; the model redraft (AI box) then
// rewrites in that persona's full voice on demand.
function engageDraft(lead, c, status) {
  const co = lead.companyName || "your team";
  const niche = c.nicheName || c.project || "our solution";
  const project = c.project || niche;
  const place = [lead.city, lead.country].filter(Boolean).join(", ") || c.country || "your region";
  const p = activePersona();
  const greet = p.greet(co);
  const sig = "\n\n" + p.signoff;
  switch (status) {
    case "interested":
      return {
        subject: `Re: ${niche} — happy to take the next step`,
        body:
`${greet}

Great to hear you're interested — thank you for getting back to us.

The simplest next step is a short call where we walk you through how ${project} would work for ${co}, including indicative pricing and timelines, and send a tailored quote straight after.

Would Tuesday or Thursday afternoon suit you? Reply with the day and we'll send an invite.${sig}`,
      };
    case "unsure":
      return {
        subject: `Re: your questions about ${niche}`,
        body:
`${greet}

Thank you for getting back to us — happy to give you the detail you need before deciding.

${project} is fully modular with no long-term lock-in, and we handle delivery, setup and on-site support across ${place}. Pricing scales with volume, so we'll put together a quick estimate based on your actual needs.

Would a one-page overview or a short call be more useful?${sig}`,
      };
    case "temporary":
      return {
        subject: `Re: ${niche} — circling back at a better time`,
        body:
`${greet}

Understood — thank you for letting us know the timing isn't right just yet.

We'll keep a tailored ${project} proposal on file for ${co} so we can move quickly whenever you're ready, and reconnect in a few weeks.

If anything changes sooner, just reply here and we'll pick it straight up.${sig}`,
      };
    case "uninterested":
      return {
        subject: `Re: ${niche} — understood, thank you`,
        body:
`${greet}

Thank you for the honest reply — we appreciate you taking the time to let us know.

We'll close this off for now. If your needs around ${niche} change down the line, you're always welcome to reach back out and we'll pick things up from there.

Wishing ${co} all the best.${sig}`,
      };
    case "cold":
    default:
      return {
        subject: `${niche} for ${co}`,
        body:
`${greet}

We're reaching out from EVERTRUST — we help companies across ${place} with ${project}, cutting costs and removing the delivery and support headaches that usually come with it.

Given what ${co} does, we think there's a strong fit. Would you be open to a brief call to see whether it's worth exploring?

Even a quick yes or no tells us whether to follow up.${sig}`,
      };
  }
}

// Assemble the reviewable draft list for a campaign: one entry per lead that has
// an email address, merged with any stored decision / edited text.
function engageDrafts(cid) {
  const c = (CAMPAIGNS || []).find(x => x.id === cid);
  if (!c) return [];
  ensureLeads(c);
  const leads = (CAMPAIGN_LEADS[cid] || []).filter(l => l.email);
  return leads.map(l => {
    const key = leadKey(l);
    const status = engageStatusOf(l);
    const gen = engageDraft(l, c, status);
    const ov = engageOverride(cid, key) || {};
    // Enforce deterministic formatting rules (e.g. "no dashes") on whatever is shown,
    // so the rule is honoured even for baseline templates that never hit the model.
    return {
      key, lead: l, status,
      subject: enforceFormatting(ov.subject != null ? ov.subject : gen.subject, status),
      body: enforceFormatting(ov.body != null ? ov.body : gen.body, status),
      genSubject: gen.subject, genBody: gen.body,
      decision: ov.decision || "pending",
      edited: !!ov.edited,
    };
  });
}

// ============================================================================
// EMAIL THREAD — reconstruct the conversation so the reviewer can see context:
//   our cold outreach  →  the client's reply  →  (the draft they're reviewing).
// Rendered as a Twitter-style reply chain.
// ============================================================================
function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts[1] ? parts[1][0] : "")).toUpperCase();
}
function fmtDay(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function addDays(iso, n) {
  const d = iso ? new Date(iso) : new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// The client's inbound reply that put this lead into its current status. Mocked,
// status-aware — this is what the Reply Glock / RAG agents would be replying to.
function clientResponse(lead, c, status) {
  const co = lead.companyName || "our company";
  const niche = c.nicheName || c.project || "this";
  switch (status) {
    case "interested":
      return `Hi Hanna,

Thanks for reaching out — your timing is good. We do rent LED walls and modular containers and reliability has genuinely been a headache for us.

Could you send pricing and set up a short call? Keen to understand how ${niche} would work for ${co}.`;
    case "unsure":
      return `Hello,

Thanks for the message. Before we look at anything seriously, a couple of questions:
- What does pricing actually look like for our volume?
- Is there a minimum term or commitment?

Not sure it's the right fit yet, but open to hearing more.`;
    case "temporary":
      return `Hi,

Appreciate you getting in touch. The timing isn't right for us this quarter — we're mid-season and can't take anything new on right now.

Maybe circle back in a few weeks?`;
    case "uninterested":
      return `Hello,

Thanks, but we already work with a supplier we're happy with and aren't looking to switch at the moment.

Please take us off your list for now.`;
    default:
      return "";
  }
}

// Build the ordered thread for a draft. Cold leads have no inbound reply yet.
function threadFor(d) {
  const c = (CAMPAIGNS || []).find(x => x.id === ENGAGE_CID) || {};
  const lead = d.lead;
  const sentDay = lead.dateSent || addDays(null, -8);
  const out = engageDraft(lead, c, "cold");   // what we originally sent
  const p = activePersona();
  const items = [{
    who: "us", name: `${p.fullName} · EVERTRUST`, handle: p.handle,
    av: initials(p.fullName), tag: "Outreach", when: fmtDay(sentDay), subject: out.subject, body: out.body,
  }];
  if (d.status !== "cold") {
    items.push({
      who: "them", name: lead.companyName || "Client", handle: lead.email || "",
      av: initials(lead.companyName), tag: "Their reply", when: fmtDay(addDays(sentDay, 2)),
      subject: "Re: " + out.subject, body: clientResponse(lead, c, d.status),
    });
  }
  return items;
}

function renderThreadChain(d) {
  const items = threadFor(d);
  return `<div class="thread-chain">
    ${items.map((t, i) => `
      <div class="tweet ${t.who}${i === items.length - 1 ? " last" : ""}">
        <div class="tweet-rail">
          <div class="avatar ${t.who}">${esc(t.av)}</div>
          <div class="tweet-line"></div>
        </div>
        <div class="tweet-main">
          <div class="tweet-head">
            <span class="tweet-name">${esc(t.name)}</span>
            <span class="tweet-handle">${esc(t.handle)}</span>
            ${t.when ? `<span class="tweet-when">· ${esc(t.when)}</span>` : ""}
            <span class="tweet-tag${t.who === "them" ? " in" : ""}">${esc(t.tag)}</span>
          </div>
          ${t.subject ? `<div class="tweet-subject">${esc(t.subject)}</div>` : ""}
          <div class="tweet-body">${esc(t.body)}</div>
        </div>
      </div>`).join("")}
    <div class="thread-foot">↓ Your drafted reply</div>
  </div>`;
}

// ============================================================================
// RENDER
// ============================================================================
function mountEngage(root) {
  if (!root) return;
  if (!ENGAGE_MOUNTED) {
    ENGAGE_MOUNTED = true;
    root.innerHTML = `
      <div class="engage-head">
        <div class="eh-row">
          <h1>Engage</h1>
          <button class="btn-edit eng-train-btn" id="eng-train-toggle" title="Train the RAG: knowledge documents + per-status response rules">Training &amp; rules</button>
        </div>
        <p class="sub">Review the model-drafted replies your <b>Reply Glock</b> + <b>RAG</b> agents produced for each lead. Accept, decline (then edit), or tweak any draft — and ask Hermes for feedback before it goes out. <b>Nothing is sent.</b></p>
      </div>
      <div id="eng-training"></div>
      <div class="engage-section-title">
        <span>Campaigns</span><span class="count" id="eng-cc"></span>
        <button id="eng-refresh" class="icon-btn" title="Refresh campaigns" style="margin-left:auto">⟳</button>
      </div>
      <div class="campaign-box"><div class="campaign-grid" id="eng-campaigns"></div></div>
      <div id="eng-workspace"></div>`;
    root.querySelector("#eng-refresh").addEventListener("click", async () => {
      await fetchCampaigns();
      renderEngageCampaigns();
    });
    root.querySelector("#eng-train-toggle").addEventListener("click", () => {
      ENGAGE_TRAIN_OPEN = !ENGAGE_TRAIN_OPEN;
      renderTraining();
    });
  }
  renderTraining();
  // Need campaigns; fetch if the overview hasn't populated them yet.
  if (!CAMPAIGNS || !CAMPAIGNS.length) {
    Promise.resolve(fetchCampaigns()).then(renderEngageCampaigns);
  }
  renderEngageCampaigns();
}

// ---- Training panel: knowledge documents + per-status response rules --------
let ENGAGE_RULES_EXPANDED = false;
const RULE_STATUSES = ["interested", "unsure", "temporary"];   // overall rule + these adjustments
function renderTraining() {
  const host = document.getElementById("eng-training");
  if (!host) return;
  const btn = document.getElementById("eng-train-toggle");
  if (btn) btn.classList.toggle("on", ENGAGE_TRAIN_OPEN);
  if (!ENGAGE_TRAIN_OPEN) { host.innerHTML = ""; return; }

  const docs = ENGAGE_TRAIN.docs || [];
  host.innerHTML = `
    <div class="train-panel">
      <div class="train-col">
        <div class="train-title">RAG knowledge base</div>
        <div class="train-cap">Documents Hermes drafts from — pricing, specs, past wins, FAQs. Text files (.txt .md .csv .json). Stored in your browser.</div>
        <label class="train-upload">
          <input type="file" id="train-file" multiple accept=".txt,.md,.markdown,.csv,.json,.html,.text" hidden>
          <span>+ Upload documents</span>
        </label>
        <div class="doc-list" id="train-docs">
          ${docs.length ? docs.map(d => `
            <div class="doc-item">
              <div class="doc-main"><span class="doc-name">${esc(d.name)}</span><span class="doc-meta">${(d.chars || 0).toLocaleString()} chars</span></div>
              <button class="doc-rm btn-edit" data-id="${esc(d.id)}" title="Remove">Remove</button>
            </div>`).join("") : `<div class="train-empty">No documents yet. Upload company knowledge for the model to ground its replies in.</div>`}
        </div>
      </div>
      <div class="train-col">
        <div class="train-title-row">
          <div class="train-title">Response rules</div>
          <span class="persona-pick" title="Whose persona these rules belong to">
            <span class="persona-lbl">for</span>
            <select class="persona-select" id="rules-persona">
              ${allPersonas().map(p => `<option value="${esc(p.id)}"${p.id === ENGAGE_RULES_PERSONA ? " selected" : ""}>${esc(p.name)}</option>`).join("")}
            </select>
            <button class="mini ghost" id="persona-new" type="button" title="Add a new salesperson persona">+ New</button>
            ${personaById(ENGAGE_RULES_PERSONA).custom ? `<button class="mini ghost" id="persona-del" type="button" title="Delete this persona">Delete</button>` : ""}
          </span>
        </div>
        <div class="persona-new-form" id="persona-new-form" hidden>
          <input class="ef-input" id="persona-new-name" placeholder="New persona name… e.g. Marcus" maxlength="40">
          <button class="mini" id="persona-create" type="button">Create</button>
          <button class="mini ghost" id="persona-cancel" type="button">Cancel</button>
        </div>
        <div class="train-cap">Stored as <b>${esc(personaById(ENGAGE_RULES_PERSONA).name || "")}</b>'s persona. The overall rule applies to every reply; expand <b>Per-status adjustments</b> to fine-tune. Hermes follows these when you Redraft. Saved automatically.</div>
        <div class="rule-block">
          <label class="rule-label">Overall response rule</label>
          <textarea class="rule-text" data-status="overall" rows="5" placeholder="Rules for ALL replies… tone, length, signature, do's and don'ts, the standard call-to-action.">${esc(getRuleFor(ENGAGE_RULES_PERSONA, "overall"))}</textarea>
          <div class="rule-foot"><button class="mini ghost rule-prev" data-status="overall">Preview sample response</button></div>
          <div class="rule-sample" id="rule-sample-overall" hidden></div>
        </div>
        <button class="rules-toggle${ENGAGE_RULES_EXPANDED ? " on" : ""}" id="rules-expand" type="button">
          <span class="rt-arrow"></span> Per-status adjustments
        </button>
        <div class="rules-editors" id="rules-editors"${ENGAGE_RULES_EXPANDED ? "" : " hidden"}>
          ${RULE_STATUSES.map(s => `
            <div class="rule-block">
              <label class="rule-label">${esc(ENGAGE_LABELS[s])}</label>
              <textarea class="rule-text" data-status="${s}" rows="4" placeholder="Extra rules just for ${esc(ENGAGE_LABELS[s].toLowerCase())} replies, layered on top of the overall rule.">${esc(getRuleFor(ENGAGE_RULES_PERSONA, s))}</textarea>
              <div class="rule-foot"><button class="mini ghost rule-prev" data-status="${s}">Preview sample response</button></div>
              <div class="rule-sample" id="rule-sample-${s}" hidden></div>
            </div>`).join("")}
        </div>
      </div>
    </div>`;

  const file = document.getElementById("train-file");
  if (file) file.addEventListener("change", e => {
    const files = [...e.target.files];
    if (!files.length) return;
    let pending = files.length;
    const done = () => { if (--pending === 0) { renderTraining(); refreshAiCtx(); toast(`${files.length} document${files.length > 1 ? "s" : ""} added to the knowledge base`, "ok"); } };
    files.forEach(f => {
      const r = new FileReader();
      r.onload = () => { addTrainingDoc(f.name, f.size, String(r.result || "").slice(0, 60000)); done(); };
      r.onerror = done;
      r.readAsText(f);
    });
    e.target.value = "";
  });
  host.querySelectorAll(".doc-rm").forEach(el => el.addEventListener("click", () => {
    removeTrainingDoc(el.dataset.id); renderTraining(); refreshAiCtx();
  }));
  host.querySelectorAll(".rule-text").forEach(el => {
    // Save on every keystroke so a Redraft always picks up the latest rules…
    el.addEventListener("input", () => { setRuleFor(ENGAGE_RULES_PERSONA, el.dataset.status, el.value); refreshAiCtx(); });
    // …and confirm on blur.
    el.addEventListener("change", () => {
      setRuleFor(ENGAGE_RULES_PERSONA, el.dataset.status, el.value);
      refreshAiCtx();
      // Auto-redraft the open reply if this rule applies to it; otherwise just confirm the save.
      if (!maybeAutoRedraft(el.dataset.status)) {
        const lbl = el.dataset.status === "overall" ? "Overall" : ENGAGE_LABELS[el.dataset.status];
        toast(`${lbl} rules saved for ${personaById(ENGAGE_RULES_PERSONA).name || ""}`, "ok");
      }
    });
  });
  host.querySelectorAll(".rule-prev").forEach(el => el.addEventListener("click", () => previewRuleSample(el.dataset.status)));
  const personaSel = document.getElementById("rules-persona");
  if (personaSel) personaSel.addEventListener("change", () => { ENGAGE_RULES_PERSONA = personaSel.value; renderTraining(); });
  // add / delete personas
  const newBtn = document.getElementById("persona-new");
  const form = document.getElementById("persona-new-form");
  const nameInput = document.getElementById("persona-new-name");
  if (newBtn && form) newBtn.addEventListener("click", () => {
    form.hidden = !form.hidden;
    if (!form.hidden && nameInput) nameInput.focus();
  });
  const createPersona = () => {
    const name = (nameInput.value || "").trim();
    if (!name) { toast("Enter a persona name", "warn"); return; }
    const p = addPersona(name);
    ENGAGE_RULES_PERSONA = p.id;
    toast(`Created persona “${p.name}” — author its rules below`, "ok");
    renderTraining();
    if (currentDraft()) renderRightPane();   // refresh the "Drafts as" dropdown
  };
  const createBtn = document.getElementById("persona-create");
  if (createBtn) createBtn.addEventListener("click", createPersona);
  if (nameInput) nameInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); createPersona(); } });
  const cancelBtn = document.getElementById("persona-cancel");
  if (cancelBtn && form) cancelBtn.addEventListener("click", () => { form.hidden = true; });
  const delBtn = document.getElementById("persona-del");
  if (delBtn) delBtn.addEventListener("click", () => {
    const p = personaById(ENGAGE_RULES_PERSONA);
    if (!p.custom) return;
    removePersona(p.id);
    toast(`Deleted persona “${p.name}”`, "warn");
    renderTraining();
    if (currentDraft()) renderRightPane();
  });
  const expandBtn = document.getElementById("rules-expand");
  if (expandBtn) expandBtn.addEventListener("click", () => {
    ENGAGE_RULES_EXPANDED = !ENGAGE_RULES_EXPANDED;
    const ed = document.getElementById("rules-editors");
    if (ed) ed.hidden = !ENGAGE_RULES_EXPANDED;
    expandBtn.classList.toggle("on", ENGAGE_RULES_EXPANDED);
  });
}

// A representative lead/campaign so a rule can be previewed without picking a draft.
function sampleContextFor(status) {
  const c = (CAMPAIGNS || []).find(x => x.id === ENGAGE_CID) || (CAMPAIGNS && CAMPAIGNS[0]) ||
    { project: "LED Container Rental — Poland", nicheName: "LED Container Rental", country: "Poland" };
  const rev = { interested: "sure", unsure: "unsure", temporary: "temp", uninterested: "uninterested", cold: "Outreached" };
  const lead = {
    companyName: "Sample Prospect Sp. z o.o.", email: "buyer@sample-prospect.pl",
    city: (c.country === "Germany" ? "Berlin" : "Warszawa"), country: c.country || "Poland", status: rev[status],
  };
  return { c, lead };
}

// Stream a Hermes-drafted email into an element (used by the rule preview).
// postProcess(text) optionally cleans the final output (e.g. enforce "no dashes").
async function streamHermesDraft(sys, usr, el, btn, maxTokens = 380, postProcess = null) {
  const cfg = hermesCfg();
  if (!cfg.key) { el.className = "rule-sample muted"; el.textContent = "No Hermes key configured (config.local.js)."; return; }
  el.className = "rule-sample";
  el.textContent = "Generating sample…";
  if (btn) { btn.disabled = true; btn.classList.add("running"); }
  let acc = "";
  try {
    const res = await fetch(cfg.url + "/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: "system", content: sys }, { role: "user", content: usr }], stream: true, temperature: 0.5, max_tokens: maxTokens }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const p = s.slice(5).trim();
        if (p === "[DONE]") continue;
        try { const j = JSON.parse(p); const dl = j.choices?.[0]?.delta?.content || ""; if (dl) { acc += dl; el.textContent = acc; } } catch (e) { /* partial */ }
      }
    }
    if (!acc) { el.className = "rule-sample muted"; el.textContent = "(empty response)"; }
    else if (postProcess) { el.textContent = postProcess(acc); }
  } catch (e) {
    el.className = "rule-sample muted";
    el.textContent = "Hermes unreachable — " + (e.message || String(e)).slice(0, 140);
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove("running"); }
  }
}

// Draft a sample reply for one status using the CURRENT (live) rule text +
// knowledge base, so the team can iterate on a rule and watch the output change.
function previewRuleSample(status) {
  // Read the CURRENT (even unsaved) text so the preview reflects live edits, and persist it
  // against the persona currently being edited.
  const pid = ENGAGE_RULES_PERSONA;
  const readTa = s => { const t = document.querySelector(`.rule-text[data-status="${s}"]`); return t ? t.value.trim() : getRuleFor(pid, s); };
  const overall = readTa("overall"); setRuleFor(pid, "overall", overall);
  // "overall" previews against a typical (interested) lead; a status previews overall + its adjustment.
  const sampleStatus = status === "overall" ? "interested" : status;
  let statusRule = "";
  if (status !== "overall") { statusRule = readTa(status); setRuleFor(pid, status, statusRule); }
  refreshAiCtx();

  const el = document.getElementById("rule-sample-" + status);
  const btn = document.querySelector(`.rule-prev[data-status="${status}"]`);
  if (!el) return;
  el.hidden = false;

  const { c, lead } = sampleContextFor(sampleStatus);
  const p = personaById(pid);
  const knowledge = knowledgeContext();
  const inbound = clientResponse(lead, c, sampleStatus);
  const label = status === "overall" ? "typical" : ENGAGE_LABELS[status];
  const ruleBlock = [
    overall ? `Overall rules (apply to every reply):\n${overall}` : "",
    statusRule ? `Adjustments for "${ENGAGE_LABELS[status]}" replies:\n${statusRule}` : "",
  ].filter(Boolean).join("\n\n");

  const sys = `${p.system}

=== MANDATORY RESPONSE RULES (these OVERRIDE your defaults — obey every one) ===
${ruleBlock || "(no rules set yet — use your default judgement.)"}
${knowledge ? `\n=== KNOWLEDGE BASE (use ONLY this for factual claims) ===\n${knowledge}\n` : ""}
Draft ONE sample email reply for a "${label}" lead to show what these rules produce. Re-read the rules above and make sure every one is reflected. If any rule conflicts with the persona description above, THE RULE WINS.
Output ONLY the email as:\nSUBJECT: <subject>\n\n<body>`;
  const usr = `Sample lead: ${lead.companyName} <${lead.email}> in ${lead.city}, ${lead.country}
Campaign: ${c.project || c.nicheName || ""}`
    + (inbound ? `\n\nTheir message:\n"""${inbound}"""` : "")
    + `\n\nDraft the reply.`;
  // Enforce detectable formatting rules (e.g. "no dashes") on the live-edited rule text.
  const rb = ruleBlock.toLowerCase();
  const noDash = /\bdash(es)?\b/.test(rb) && /\b(no|not|n['’]t|without|avoid|never|do not|don['’]t|remove|stop)\b/.test(rb);
  streamHermesDraft(sys, usr, el, btn, 380, noDash ? stripDashes : null);
}

// Keep the AI box's "active context" line current after training edits.
function refreshAiCtx() {
  const el = document.getElementById("ai-ctx");
  if (el && currentDraft()) el.innerHTML = aiCtxHtml(currentDraft());
}

// Auto-redraft: when a rule changes for the persona we're drafting as, immediately
// re-draft the currently-open reply so the effect is visible without a manual click.
// Only the open reply re-drafts (not all 28). Returns true if it fired.
function maybeAutoRedraft(editedStatus) {
  if (ENGAGE_RULES_PERSONA !== ENGAGE_PERSONA) return false;       // editing a different persona's rules
  const d = currentDraft();
  if (!d) return false;
  if (editedStatus !== "overall" && editedStatus !== d.status) return false;  // rule doesn't apply to this draft
  toast(`Re-drafting the open ${ENGAGE_LABELS[d.status]} reply with the new rules…`, "ok");
  redraftDraft(d, "");
  return true;
}

function renderEngageCampaigns() {
  const wrap = document.getElementById("eng-campaigns");
  const cc = document.getElementById("eng-cc");
  if (!wrap) return;
  const rows = CAMPAIGNS || [];
  if (cc) cc.textContent = rows.length ? `· ${rows.length}` : "";
  if (!rows.length) {
    wrap.innerHTML = `<div class="ew-empty" style="grid-column:1/-1">No campaigns found${typeof AIM_API !== "undefined" ? ` — is the ERP up at ${esc(AIM_API)}?` : ""}<br>Launch one from <b>Overview → Aim &amp; Launch</b>.</div>`;
    document.getElementById("eng-workspace").innerHTML = "";
    return;
  }
  // keep selection valid
  if (!ENGAGE_CID || !rows.some(c => c.id === ENGAGE_CID)) ENGAGE_CID = null;
  wrap.innerHTML = rows.map(c => {
    const drafts = engageDrafts(c.id);
    const pending = drafts.filter(d => d.decision === "pending").length;
    return `<div class="cmini${c.id === ENGAGE_CID ? " active" : ""}" data-id="${esc(c.id)}">
        <div class="cmini-top">
          <span class="cmini-name">${esc(c.project || c.name || "(untitled)")}</span>
          <span class="badge ${typeof lifecycleClass === "function" ? lifecycleClass(c.lifecycle) : "lc-draft"}">${esc(c.lifecycle || "DRAFT")}</span>
        </div>
        <div class="cmini-sub">${esc(c.nicheName || "—")}${c.country ? " · " + esc(c.country) : ""}</div>
        <div class="cmini-foot">${drafts.length} draft${drafts.length === 1 ? "" : "s"}${pending ? ` · ${pending} to review` : " · all reviewed"}</div>
      </div>`;
  }).join("");
  wrap.querySelectorAll(".cmini").forEach(el =>
    el.addEventListener("click", () => selectEngageCampaign(el.dataset.id)));
  renderWorkspace();
}

function selectEngageCampaign(cid) {
  ENGAGE_CID = cid;
  ENGAGE_SELKEY = null;
  ENGAGE_EDITING = false;
  ENGAGE_THREAD = false;
  ENGAGE_FILTER = "all";
  renderEngageCampaigns();
}

function filteredDrafts() {
  const all = ENGAGE_CID ? engageDrafts(ENGAGE_CID) : [];
  return ENGAGE_FILTER === "all" ? all : all.filter(d => d.status === ENGAGE_FILTER);
}

function renderWorkspace() {
  const ws = document.getElementById("eng-workspace");
  if (!ws) return;
  if (!ENGAGE_CID) {
    ws.innerHTML = `<div class="ew-empty">Select a campaign above to review its drafted replies.</div>`;
    return;
  }
  ws.innerHTML = `
    <div class="engage-workspace">
      <div class="ew-left">
        <div class="filter-bar" id="eng-filters"></div>
        <div class="email-list" id="eng-list"></div>
      </div>
      <div class="ew-right" id="eng-right"></div>
    </div>`;
  renderFilterBar();
  renderEmailList();
  renderRightPane();
}

function renderFilterBar() {
  const bar = document.getElementById("eng-filters");
  if (!bar) return;
  const all = engageDrafts(ENGAGE_CID);
  const counts = {};
  all.forEach(d => { counts[d.status] = (counts[d.status] || 0) + 1; });
  counts.all = all.length;
  bar.innerHTML = ENGAGE_STATUSES.map(s =>
    `<span class="fpill${ENGAGE_FILTER === s.key ? " active" : ""}" data-f="${s.key}">${esc(s.label)}<span class="fnum">${counts[s.key] || 0}</span></span>`
  ).join("");
  bar.querySelectorAll(".fpill").forEach(el => el.addEventListener("click", () => {
    ENGAGE_FILTER = el.dataset.f;
    ENGAGE_EDITING = false;
    ENGAGE_THREAD = false;
    renderFilterBar();
    renderEmailList();   // may re-point ENGAGE_SELKEY to the first card in the new filter
    renderRightPane();   // keep the right pane in sync with that selection
  }));
}

function decisionChip(d) {
  if (d.decision === "accepted") return `<span class="dchip accepted">Accepted</span>`;
  if (d.decision === "declined") return `<span class="dchip declined">Declined</span>`;
  if (d.edited) return `<span class="dchip edited">Edited</span>`;
  return "";
}

function renderEmailList() {
  const list = document.getElementById("eng-list");
  if (!list) return;
  const drafts = filteredDrafts();
  if (!drafts.length) {
    list.innerHTML = `<div class="elist-empty">No ${esc(ENGAGE_LABELS[ENGAGE_FILTER] || "").toLowerCase()} drafts in this campaign.</div>`;
    return;
  }
  // keep a valid selection within the current filter
  if (!drafts.some(d => d.key === ENGAGE_SELKEY)) { ENGAGE_SELKEY = drafts[0].key; ENGAGE_EDITING = false; ENGAGE_THREAD = false; }
  list.innerHTML = drafts.map(d => `
    <div class="ecard${d.key === ENGAGE_SELKEY ? " active" : ""}" data-key="${esc(d.key)}">
      <div class="ecard-top">
        <span class="ecard-co">${esc(d.lead.companyName || "—")}</span>
        <span class="spill s-${d.status}">${esc(ENGAGE_LABELS[d.status])}</span>
      </div>
      <div class="ecard-subj">${esc(d.subject)}</div>
      <div class="ecard-top">
        <span class="ecard-subj" style="font-size:11px">${esc(d.lead.email || "")}</span>
        ${decisionChip(d)}
      </div>
    </div>`).join("");
  list.querySelectorAll(".ecard").forEach(el => el.addEventListener("click", () => {
    ENGAGE_SELKEY = el.dataset.key;
    ENGAGE_EDITING = false;
    ENGAGE_THREAD = false;
    renderEmailList();
    renderRightPane();
  }));
}

function currentDraft() {
  return engageDrafts(ENGAGE_CID).find(d => d.key === ENGAGE_SELKEY) || null;
}

// Quick redraft instructions for the AI box (empty = draft fresh from scratch).
const REDRAFT_CHIPS = [
  { label: "More human", p: "Rewrite it warmer and more human — less mechanical and templated." },
  { label: "Shorter", p: "Make it noticeably shorter and more direct." },
  { label: "More confident", p: "Make it more confident and decisive, no hedging." },
  { label: "Add meeting slots", p: "End with a clear next step: offer two specific 30-minute Berlin-time slots and ask them to reply with the number." },
  { label: "Draft fresh", p: "" },
];

// Small line under the AI box showing what context the model will draft with.
function aiCtxHtml(d) {
  const nDocs = (ENGAGE_TRAIN.docs || []).length;
  const ov = !!overallRule();
  const st = !!rulesFor(d.status);
  const rulesLabel = ov && st ? `overall + <b>${esc(ENGAGE_LABELS[d.status])}</b> rules`
    : ov ? `overall rules`
    : st ? `<b>${esc(ENGAGE_LABELS[d.status])}</b> rules`
    : `no rules yet`;
  return `Drafting with <b>${esc(activePersona().name)}</b> · <b>${nDocs}</b> knowledge doc${nDocs === 1 ? "" : "s"} · ${rulesLabel}`;
}

function renderRightPane() {
  const right = document.getElementById("eng-right");
  if (!right) return;
  const d = currentDraft();
  if (!d) { right.innerHTML = `<div class="ew-empty">Pick a draft on the left to review it.</div>`; return; }

  const noteMap = { accepted: "Accepted — ready to send", declined: "Declined — edit below before reusing", pending: "Awaiting your review" };
  const persona = activePersona();

  // Persona rules panel (toggled from the Rules button on the action row).
  const rulesPanel = ENGAGE_RULES ? `<div class="persona-rules">
      <div class="pr-head">
        <span class="pr-name">${esc(persona.fullName)}</span>
        <span class="pr-blurb">${esc(persona.blurb)}</span>
        <button class="pr-close" id="ef-rules-close" title="Close"></button>
      </div>
      <div class="pr-cap">Rules &amp; patterns the model drafts by</div>
      <ul class="pr-list">${persona.rules.map(r => `<li>${esc(r)}</li>`).join("")}</ul>
    </div>` : "";

  // "View client's response" — toggles the Twitter-style thread chain. Cold leads
  // have no inbound reply yet, so the button is disabled for them.
  const isCold = d.status === "cold";
  const threadBtn = `<div class="thread-toggle">
      <button class="btn-edit" id="ef-thread"${isCold ? " disabled" : ""} title="${isCold ? "No reply yet — this is the first outreach" : "Show the full email conversation"}">
        ${isCold ? "First outreach — no reply yet" : (ENGAGE_THREAD ? "Hide conversation" : "View client's response")}
      </button>
    </div>`;
  const threadBlock = (ENGAGE_THREAD && !isCold) ? renderThreadChain(d) : "";

  const emailBox = ENGAGE_EDITING
    ? `<div class="email-full">
         <div class="ef-meta"><span class="ef-to">To: ${esc(d.lead.email)}</span><span>· ${esc(d.lead.companyName || "")}</span><span class="spill s-${d.status}">${esc(ENGAGE_LABELS[d.status])}</span></div>
         <input class="ef-input" id="ef-subject" value="${esc(d.subject)}">
         <textarea class="ef-textarea" id="ef-body">${esc(d.body)}</textarea>
       </div>
       <div class="email-actions">
         <button id="ef-save">Save changes</button>
         <button class="btn-edit" id="ef-cancel">Cancel</button>
         <span class="spacer"></span>
         <button class="btn-edit" id="ef-reset" title="Restore the original model draft">↺ Reset to AI draft</button>
       </div>`
    : `<div class="email-full">
         <div class="ef-meta"><span class="ef-to">To: ${esc(d.lead.email)}</span><span>· ${esc(d.lead.companyName || "")}</span><span class="spill s-${d.status}">${esc(ENGAGE_LABELS[d.status])}</span>${d.edited ? `<span class="dchip edited">Edited</span>` : ""}</div>
         <div class="ef-subject">${esc(d.subject)}</div>
         <pre class="ef-body">${esc(d.body)}</pre>
       </div>
       <div class="email-actions">
         <div class="ea-left">
           <button id="ef-accept">Accept</button>
           <button class="btn-decline" id="ef-decline">Decline</button>
           <button class="btn-edit" id="ef-edit">Edit</button>
           <span class="decision-note">${esc(noteMap[d.decision] || "")}</span>
         </div>
         <div class="ea-right">
           <span class="persona-pick" title="Whose voice the model drafts in">
             <span class="persona-lbl">Drafts as</span>
             <select class="persona-select" id="ef-persona">
               ${allPersonas().map(p => `<option value="${esc(p.id)}"${p.id === ENGAGE_PERSONA ? " selected" : ""}>${esc(p.name)}</option>`).join("")}
             </select>
           </span>
           <button class="btn-edit ef-rules-btn${ENGAGE_RULES ? " on" : ""}" id="ef-rules" title="View this persona's rules &amp; patterns">Rules</button>
         </div>
       </div>`;

  right.innerHTML = rulesPanel + threadBtn + threadBlock + emailBox + `
    <div class="ai-suggest">
      <div class="ai-head">
        <span class="ai-title"><span class="dot"></span> Hermes · drafting as ${esc(persona.name)}</span>
        <button class="mini" id="ai-go">Get feedback</button>
      </div>
      <div class="ai-ctx" id="ai-ctx">${aiCtxHtml(d)}</div>
      <div class="ai-body muted" id="ai-out">Critique this draft with <b>Get feedback</b>, or tell Hermes how to redraft it below — it rewrites in ${esc(persona.name)}'s voice.</div>
      <div class="ai-chips" id="ai-chips">
        ${REDRAFT_CHIPS.map((ch, i) => `<span class="aichip" data-i="${i}">${esc(ch.label)}</span>`).join("")}
      </div>
      <div class="ai-prompt-row">
        <input class="ai-prompt" id="ai-prompt" placeholder="Tell Hermes how to redraft this reply… e.g. make it more human">
        <button id="ai-apply">Redraft</button>
      </div>
    </div>`;

  // wire actions
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
  if (ENGAGE_EDITING) {
    on("ef-save", () => {
      const subject = document.getElementById("ef-subject").value;
      const body = document.getElementById("ef-body").value;
      const edited = subject !== d.genSubject || body !== d.genBody;
      setEngageOverride(ENGAGE_CID, d.key, { subject, body, edited });
      ENGAGE_EDITING = false;
      toast("Draft saved", "ok");
      renderEmailList(); renderRightPane(); renderEngageCampaigns();
    });
    on("ef-cancel", () => { ENGAGE_EDITING = false; renderRightPane(); });
    on("ef-reset", () => {
      document.getElementById("ef-subject").value = d.genSubject;
      document.getElementById("ef-body").value = d.genBody;
    });
  } else {
    on("ef-accept", () => {
      setEngageOverride(ENGAGE_CID, d.key, { decision: "accepted" });
      toast("Draft accepted", "ok");
      renderEmailList(); renderRightPane(); renderEngageCampaigns();
    });
    on("ef-decline", () => {
      // Decline drops straight into editing so the message can be fixed.
      setEngageOverride(ENGAGE_CID, d.key, { decision: "declined" });
      ENGAGE_EDITING = true;
      toast("Declined — edit the draft", "warn");
      renderEmailList(); renderRightPane(); renderEngageCampaigns();
    });
    on("ef-edit", () => { ENGAGE_EDITING = true; renderRightPane(); });
  }
  on("ef-thread", () => { ENGAGE_THREAD = !ENGAGE_THREAD; renderRightPane(); });
  on("ef-rules", () => { ENGAGE_RULES = !ENGAGE_RULES; renderRightPane(); });
  on("ef-rules-close", () => { ENGAGE_RULES = false; renderRightPane(); });

  // Persona dropdown — switch whose voice the model drafts in. Re-renders so
  // every non-edited baseline draft adopts the new greeting + sign-off.
  const sel = document.getElementById("ef-persona");
  if (sel) sel.addEventListener("change", () => {
    setActivePersona(sel.value);
    toast(`Drafting as ${activePersona().name}`, "ok");
    renderEmailList(); renderRightPane(); renderEngageCampaigns();
  });

  on("ai-go", () => aiSuggest(d));
  on("ai-apply", () => redraftDraft(d, (document.getElementById("ai-prompt") || {}).value || ""));
  const chips = document.getElementById("ai-chips");
  if (chips) chips.querySelectorAll(".aichip").forEach(el => el.addEventListener("click", () => {
    redraftDraft(d, REDRAFT_CHIPS[+el.dataset.i].p);
  }));
}

// ============================================================================
// HERMES — mini draft critique via the LiteLLM gateway (OpenAI-compatible, SSE).
// ============================================================================
function hermesCfg() {
  const c = (typeof window !== "undefined" && window.HERMES) || {};
  return {
    url: (c.url || localStorage.getItem("hermes_url") || "https://mac-mini-ca-mac.tailc3d837.ts.net/v1").replace(/\/$/, ""),
    key: c.key || localStorage.getItem("hermes_key") || "",
    model: localStorage.getItem("hermes_model") || c.model || "hermes",
  };
}

async function aiSuggest(d) {
  const out = document.getElementById("ai-out");
  const btn = document.getElementById("ai-go");
  if (!out) return;
  const cfg = hermesCfg();
  if (!cfg.key) {
    out.className = "ai-body muted";
    out.innerHTML = `No Hermes key configured. Add one in <code>config.local.js</code> (or open the <a href="chat.html">Hermes console</a>) to enable feedback.`;
    return;
  }
  const c = (CAMPAIGNS || []).find(x => x.id === ENGAGE_CID) || {};
  const rules = rulesBlockFor(d.status);
  const sys = `You are a sharp B2B outreach coach for EVERTRUST GmbH. Critique a single drafted email reply. Be concrete and brief: give 2–4 short bullet points on what to improve (tone, clarity, call-to-action, length), then one suggested subject line if it can be sharper. Do not rewrite the whole email. The recipient's current reply status is "${ENGAGE_LABELS[d.status]}".`
    + (rules ? `\n\nThe team's response rules are below — call out specifically where the draft does NOT follow them:\n${rules}` : "");
  const usr = `Campaign: ${c.project || c.nicheName || ""} (${c.country || ""})
Recipient: ${d.lead.companyName || ""} <${d.lead.email || ""}>
Status: ${ENGAGE_LABELS[d.status]}

SUBJECT: ${d.subject}

BODY:
${d.body}`;

  out.className = "ai-body streaming";
  out.textContent = "";
  if (btn) { btn.disabled = true; btn.classList.add("running"); btn.textContent = "Thinking…"; }
  let acc = "";
  try {
    const res = await fetch(cfg.url + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
        stream: true,
        temperature: 0.4,
        max_tokens: 320,
      }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status + " — " + (await res.text()).slice(0, 160));
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
          if (delta) { acc += delta; out.textContent = acc; }
        } catch (e) { /* partial chunk */ }
      }
    }
    if (!acc) { out.className = "ai-body muted"; out.textContent = "(empty response)"; }
    else out.className = "ai-body";
  } catch (e) {
    out.className = "ai-body muted";
    out.textContent = "Hermes unreachable — " + (e.message || String(e)).slice(0, 160);
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove("running"); btn.textContent = "Get feedback"; }
  }
}

// ---- redraft: the model REWRITES the current draft in the active persona's
// voice, applying a free-text instruction (e.g. "make it more human"). Empty
// instruction = draft fresh from scratch. The result replaces the draft.
function parseEmail(text, fallbackSubject) {
  let t = String(text || "").trim().replace(/^```[a-z]*\s*|\s*```$/gi, "");
  const m = t.match(/^\s*subject\s*:\s*(.+?)\s*(?:\n|$)/i);
  if (m) {
    const subject = m[1].trim();
    const body = t.slice(m.index + m[0].length).replace(/^\s*\n/, "").trim();
    return { subject, body: body || t };
  }
  return { subject: fallbackSubject, body: t };
}

async function redraftDraft(d, instruction) {
  const out = document.getElementById("ai-out");
  const apply = document.getElementById("ai-apply");
  const input = document.getElementById("ai-prompt");
  if (!out) return;
  const cfg = hermesCfg();
  if (!cfg.key) {
    out.className = "ai-body muted";
    out.innerHTML = `No Hermes key configured. Add one in <code>config.local.js</code> to enable model redrafting.`;
    return;
  }
  const p = activePersona();
  const c = (CAMPAIGNS || []).find(x => x.id === ENGAGE_CID) || {};
  const fresh = !String(instruction || "").trim();
  // Include the client's inbound reply (if any) so the rewrite addresses it.
  const inbound = d.status !== "cold" ? clientResponse(d.lead, c, d.status) : "";
  // The team's trained context: per-status response rules + uploaded knowledge.
  const rules = rulesBlockFor(d.status);
  const knowledge = knowledgeContext();

  const sys = `${p.system}

=== MANDATORY RESPONSE RULES (these OVERRIDE your defaults — every reply MUST obey every one) ===
${rules || "(no extra rules provided — use the persona voice above.)"}
${knowledge ? `\n=== KNOWLEDGE BASE (use ONLY this for any factual claim — pricing, specs, references; never invent) ===\n${knowledge}\n` : ""}
You are ${p.fullName}, writing ONE email reply to a lead whose current status is "${ENGAGE_LABELS[d.status]}".
Before you write, re-read the MANDATORY RULES above and make sure every single one is reflected in your reply. If any rule conflicts with the persona description above, THE RULE WINS.
Output ONLY the email, in exactly this format and nothing else (no commentary, no markdown, no preamble):
SUBJECT: <subject line>

<body, with real line breaks between paragraphs>`;
  const usr = `Lead: ${d.lead.companyName || ""} <${d.lead.email || ""}> — ${c.project || c.nicheName || ""}${c.country ? ", " + c.country : ""}
${inbound ? `\nTheir message:\n"""${inbound}"""\n` : ""}`
    + (fresh
      ? `\nWrite a brand-new reply from scratch that obeys EVERY mandatory rule above. Treat the current draft only as background — do NOT copy it; rewrite it fully so it follows the rules.\n\nCurrent draft (background only):\nSUBJECT: ${d.subject}\n\n${d.body}`
      : `\nApply this change, while still obeying EVERY mandatory rule above: "${instruction}"\n\nCurrent draft to revise:\nSUBJECT: ${d.subject}\n\n${d.body}`);

  out.className = "ai-body streaming";
  out.textContent = fresh ? `Drafting fresh as ${p.name}…` : `Redrafting as ${p.name}: ${instruction}`;
  if (apply) { apply.disabled = true; apply.classList.add("running"); apply.textContent = "…"; }
  try {
    const res = await fetch(cfg.url + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
        stream: false,
        temperature: 0.5,
        max_tokens: 500,
      }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status + " — " + (await res.text()).slice(0, 160));
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    if (!content.trim()) throw new Error("empty response");
    let { subject, body } = parseEmail(content, d.subject);
    subject = enforceFormatting(subject, d.status);
    body = enforceFormatting(body, d.status);
    setEngageOverride(ENGAGE_CID, d.key, { subject, body, edited: true });
    if (input) input.value = "";
    toast(fresh ? `Redrafted fresh as ${p.name}` : `Redrafted: ${instruction}`, "ok");
    renderEmailList(); renderRightPane(); renderEngageCampaigns();
    const newOut = document.getElementById("ai-out");
    if (newOut) { newOut.className = "ai-body"; newOut.textContent = `${fresh ? "Drafted fresh" : "Redrafted"} in ${p.name}'s voice. Review it above — Accept, Edit, or redraft again.`; }
  } catch (e) {
    out.className = "ai-body muted";
    out.textContent = "Hermes couldn't redraft — " + (e.message || String(e)).slice(0, 160);
    if (apply) { apply.disabled = false; apply.classList.remove("running"); apply.textContent = "Redraft"; }
  }
}
