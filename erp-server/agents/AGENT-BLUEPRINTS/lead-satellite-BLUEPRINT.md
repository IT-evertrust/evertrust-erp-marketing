# LEAD SATELLITE — Migration Blueprint

Source of truth: n8n workflow `wKMX2cvDKlAc7p0N` — **"EVERTRUST - LEAD SATELLITE V2 (Real Search + Local AI)"**
(inactive, draft version 5, updated 2026-06-11). Secondary: `5LcUx5jHULe679CR` — **"WF-03 Segment Worker
(SEAR v3)"** (ARCHIVED) for its agent/parser setup. The old `fvilklqj7XAOLlLL` was NOT needed — V2 contains
the complete Cloudflare cfemail decode inline.

Workflow self-description (V2): *"V3: multi-engine real search (DDG/Mojeek/SearXNG rotation + per-query
retry) -> fetch real sites -> local AI copy-only extract (ID-join anti-fabrication) -> email-recovery
search for NO_EMAIL. Triggers: webhook + Drive poll + manual. Loud failures."*

---

## 1. Flow (node-by-node, V2)

### Trigger fan-in
```
Webhook V2 (AIM calls)          ─┐
Manual Test → Test Input (edit me) ─┼→ Parse Input
On New Folder (Drive Poll) → Inspect Drive Item ─┘
```

### Gatekeeping
```
Parse Input
  → Valid Payload? (IF $json.isValid == true)
      true  → Find Existing Leads Sheet (Drive search "leads" in campaign folder, limit 10, alwaysOutputData)
      false → Invalid Payload Note  [END: {skipped:true, reason:'missing campaignFolderId'}]
  → Decide Hunt (hasFile if any file whose name starts with "leads"; shouldHunt = force || !hasFile)
  → Should Hunt? (IF $json.shouldHunt == true)
      true  → Find config.json
      false → Skip Note  [END: {skipped:true, decision:'SKIP_HAS_LEADS', existingFileName}]
```

### Config + profiler + plan
```
Find config.json (Drive search "config.json" in folder, limit 1)
  → Download config.json
  → Extract Config (extractFromFile, fromJson → key "cfg")
  → Build Profiler Prompt
  → Country Profiler (Local)   [LLM call #1 — onError continue, so plan still builds if it fails]
  → Build Search Plan          [emits 1 item per (city × queriesPerCity) query]
```

### Search round 1 + per-query engine retry
```
Build Search Plan
  → Search Web (Real URLs)     [HTTP GET per query item]
  → Parse Search Results       [emits mixed items: _kind:'retry' for failed queries + _kind:'cand' candidates]
  → Split Retry? (IF $json._kind == 'retry')
      true  → Search Web Retry → Parse Retry Results → All Candidates (input 0)
      false → ───────────────────────────────────────→ All Candidates (input 1)
  → All Candidates (Merge, mode append)
  → Gate Candidates            [domain dedup, sort by hits desc, cap maxCandidates, loud-fail if 0]
```

### Fetch + email harvest
```
Gate Candidates
  → Fetch Homepage
  → Prep Candidates            [drop dead domains, extract title/meta/text/emails/contactUrl, cf decode]
  → Needs Contact Page? (IF emails.length == 0 AND contactUrl notEmpty AND alive == true)
      true  → Fetch Contact Page → Mine Contact Emails → Rejoin Candidates (input 0)
      false → ────────────────────────────────────────→ Rejoin Candidates (input 1)
  → Rejoin Candidates (Merge, mode append)
```

### LLM extraction + validation
```
Rejoin Candidates
  → Chunk For Extract          [chunks of extractBatchSize, builds system+user prompts]
  → Extract Companies (Local AI)   [LLM call #2 — hermes via LiteLLM gateway]
  → Merge & Validate Leads     [ID-join back to candidates, anti-fabrication, dedup, tiering, loud-fail if 0]
```

### Email recovery second pass
```
Merge & Validate Leads
  → Collect Missing Emails     [builds recovery search queries for rows without Email; cap 150]
  → Search Missing Emails      [HTTP GET per recovery query]
  → Apply Recovered Emails     [regex-mine SERP body, match to domain/name, patch rows]
```

### Output
```
Apply Recovered Emails
  → Create Leads Sheet (Google Sheets, spreadsheet:create title "leads", executeOnce: true)
  → Move Leads Sheet To Folder (Drive move to campaignFolderId)
  → Build Sheet Rows (passthrough: re-pulls $('Apply Recovered Emails').all())
  → Append Leads Rows (Sheets append, autoMapInputData)
  → Run Summary (logs {ok, project, niche, country, leads, withEmail, emailCoveragePct, tiers, runId})
```

---

## 2. Triggers

1. **Webhook** `POST /webhook/wf03-lead-research-v2` (node "Webhook V2 (AIM calls)", responseMode
   `onReceived`, replies `"received"` immediately — fire-and-forget). Payload (read from `$json.body`):
   ```json
   { "campaignFolderId": "<Drive folder id>", "force": true|false|"true", "project": "optional name" }
   ```
   `folderId` accepted as alias of `campaignFolderId`. Deliberately a different path than old WF-03
   (`wf03-lead-research`) so both can run in parallel.
2. **Google Drive poll** ("On New Folder (Drive Poll)"): every 15 minutes, event `folderCreated` on
   specific folder `1Keop0NUWo3dX7LsaqTwhJcZlAFGP7wId` (the campaigns root). "Inspect Drive Item" maps it to
   `{campaignFolderId: item.id, project: item.name, source:'drive', force:false, runId:'wf3v2-drv-'+Date.now()}`.
3. **Manual**: Manual Trigger → "Test Input (edit me)" Code node hardcodes
   `{ campaignFolderId: '1-XzkAL1q4p33Vc6xiUH_VHy4FXZo3hA3', force: false }`.

Parse Input normalizes all three: `runId = 'wf3v2-' + Date.now()`, `force` coerced from bool or string
"true", `isValid = !!campaignFolderId`, `source` ∈ webhook|manual|drive.

**Re-hunt guard:** Drive folder is searched for a file whose name *starts with* `leads` (lowercase compare).
If found and `force` is false → entire run skipped (`SKIP_HAS_LEADS`). `force:true` → `FORCE_REHUNT`
(creates a NEW sheet next to the old one; it never deletes or overwrites).

## 3. Config consumed (config.json in the campaign folder)

| Field | Default | Use |
|---|---|---|
| `niche` | required | Uppercased; normalized (`[^A-Z0-9]` stripped) to key `NICHE_KEYWORDS`; raw form keys `LOCAL_NICHES[cc]`; passed verbatim into the extraction prompt as "Target niche"; loud-fail if empty |
| `country` | required-ish | Resolved via alias map (`de/germany/deutschland/german/ger → DE`, `pl/poland/polska/polish/pol → PL`; fallback prefix match `pol*→PL`, `ger*/deu*→DE`). Non-PL/DE → country comes from the LLM Country Profiler. Drives `countryName`, `langCode`, DDG `kl` region param, city lists |
| `region` (fallback `cities`, then `city`) | required | Comma/semicolon/newline-split list. Each entry resolved as: `anywhere` → ALL cities of all regions (PL ~81 / DE ~78) or profiler cities; zone (`north/south/east/west/nearborder`) → hardcoded `ZONE_CITIES[cc][zone]` or all profiler cities; voivodeship/Bundesland key → `REGION_CITIES[key]` (diacritics-folded, e.g. `dolnoslaskie`, `nordrheinwestfalen`, also `niederschlesien`/`lowersilesia` aliases); anything else → treated as a literal city name |
| `project` | `'Unknown Campaign'` | Carried into summary; from cfg or Drive folder name |
| `queriesPerCity` | 2 (clamped 1..4) | Number of search queries per city; query *i* uses keyword `kwArr[i % kwArr.length]` |
| `maxSearchQueries` | 600 | Hard cap on total queries (sticky note says 200 — code wins: 600) |
| `maxNationwideCities` | 0 = unlimited | Truncates the city list after expansion |
| `maxCandidates` | 1000 | Cap after domain dedup in Gate Candidates (sticky says 300 — code wins: 1000) |
| `searchUrl` | '' | SearXNG base URL; if set, engine rotation becomes `['searxng','searxng','ddg','mojeek']` (searxng weighted 2×), else `['ddg','mojeek']` |
| `extractModel` | `'hermes'` | Model id sent to the LiteLLM gateway for BOTH profiler and extractor |
| `extractBatchSize` | 8 (clamped 3..15) | Candidates per LLM extraction call |
| `sender` | `'info'` | `'hanna'` → Send From `hanna@evertrust-germany.de`, else `info@evertrust-germany.de` |
| `force` | — | NOT read from config; comes from the trigger payload only |

Loud failure if `!niche || !cities.length`:
`'V2 CONFIG ERROR: niche=... cities=... (config.json needs niche + country + region/cities)'`.

## 4. Search logic

### 4.1 Keyword sources (Build Search Plan)

Hardcoded English seeds — `NICHE_KEYWORDS` (key = niche uppercased, non-alnum stripped):
```js
const NICHE_KEYWORDS = {
  'AIPLATFORM': 'AI software, Machine Learning, Chatbot, Data Platform, Computer Vision, AI solution provider',
  'CYBERSECURITY': 'Cybersecurity, SOC, SIEM, Penetration Testing, IT security, cloud security',
  'CLOUDINFRASTRUCTURE': 'Cloud Hosting, Data Center, Managed Services, IaaS, cloud provider, MSP, colocation',
  'LIGHTINGELECTRICAL': 'LED lighting, lighting manufacturer, electrical contractor',
  'MODULARRENTAL': 'modular building, container rental, portable buildings',
  'SOLARENERGY': 'solar EPC, battery storage, PV installer',
  'SOFTWAREDEVELOPMENT': 'software house, software development company, IT services, custom software',
  'LED': 'LED lighting, lighting supplier',
  'CONTAINER': 'modular building, container rental',
  'PVBESSTRAFO': 'PV installer, battery storage, transformer station',
  'CHARGINGPORT': 'EV charging, charging infrastructure, wallbox',
  'CLEANINGSERVICE': 'cleaning service, facility cleaning',
  'WAERMEPUMPE': 'heat pump installer, heating',
  'DGUVV3INSPECTION': 'electrical inspection, electrical safety testing'
};
```

Hardcoded local-language seeds — `LOCAL_NICHES` (key = raw uppercased niche, with space variant fallback):
```js
const LOCAL_NICHES = {
  DE: { 'LED': 'LED Beleuchtung Hersteller Anbieter, Lichttechnik', 'PV/BESS/TRAFO': 'Photovoltaik Batteriespeicher Anbieter, PV-Anlage Installateur', 'CONTAINER': 'Container Modulbau Anbieter, Mietcontainer Buerocontainer', 'CLEANING SERVICE': 'Gebaeudereinigung Reinigungsfirma, Unterhaltsreinigung', 'CHARGING PORT': 'Ladestation Wallbox Anbieter, Ladeinfrastruktur', 'DGUV V3 INSPECTION': 'DGUV V3 Pruefung Elektropruefung', 'WAERMEPUMPE': 'Waermepumpe Installateur SHK, Heizung', 'SOFTWARE DEVELOPMENT': 'Softwareentwicklung, Software Agentur, IT Dienstleister', 'CYBERSECURITY': 'IT-Sicherheit, Cybersicherheit Anbieter', 'CLOUD INFRASTRUCTURE': 'Cloud Anbieter, Rechenzentrum, Managed Services', 'SOLAR ENERGY': 'Photovoltaik Anbieter, Solaranlage Installateur', 'AI PLATFORM': 'KI Software, Kuenstliche Intelligenz Anbieter' },
  PL: { 'LED': 'oswietlenie LED producent dostawca, oprawy LED', 'PV/BESS/TRAFO': 'fotowoltaika magazyn energii instalator, stacja transformatorowa', 'CONTAINER': 'kontenery modulowe producent, kontenery biurowe', 'CLEANING SERVICE': 'firma sprzatajaca uslugi, sprzatanie biur', 'CHARGING PORT': 'stacja ladowania EV wallbox, ladowarki samochodowe', 'DGUV V3 INSPECTION': 'pomiary elektryczne SEP, przeglady instalacji', 'WAERMEPUMPE': 'pompa ciepla instalator, pompy ciepla montaz', 'SOFTWARE DEVELOPMENT': 'software house, tworzenie oprogramowania, firma programistyczna', 'CYBERSECURITY': 'cyberbezpieczenstwo, bezpieczenstwo IT firma', 'CLOUD INFRASTRUCTURE': 'chmura obliczeniowa dostawca, kolokacja serwerownia, uslugi IT', 'SOLAR ENERGY': 'fotowoltaika instalator, panele sloneczne firma', 'AI PLATFORM': 'sztuczna inteligencja firma, oprogramowanie AI' }
};
```

Keyword merge — local-first interleave, dedup case-insensitive, profiler keywords appended to each pool:
```js
const splitKw = (s) => String(s || '').split(/[,;]+/).map(x => x.trim()).filter(Boolean);
const localArr = splitKw(localKw).concat(splitKw(profKw));   // LOCAL_NICHES + profiler nicheKeywordsLocal
const seedArr = splitKw(seedKw).concat(splitKw(profEn));     // NICHE_KEYWORDS + profiler nicheKeywordsEnglish
let kwArr = [];
const seenKw = {};
const pushKw = (k) => { const kk = k.toLowerCase(); if (!seenKw[kk]) { seenKw[kk] = 1; kwArr.push(k); } };
const maxL = Math.max(localArr.length, seedArr.length);
for (let i = 0; i < maxL; i++) { if (localArr[i]) pushKw(localArr[i]); if (seedArr[i]) pushKw(seedArr[i]); }
if (!kwArr.length) kwArr = [niche.toLowerCase() + ' company', niche.toLowerCase() + ' services provider'];
```

### 4.2 City normalization (diacritics fold)
```js
const FOLD = { 'ł':'l','ą':'a','ć':'c','ę':'e','ń':'n','ó':'o','ś':'s','ź':'z','ż':'z','ä':'a','ö':'o','ü':'u','ß':'ss','é':'e','è':'e','á':'a','í':'i' };
const normCity = (s) => { let t = String(s == null ? '' : s).toLowerCase().trim(); let r = ''; for (const ch of t) { r += (FOLD[ch] !== undefined ? FOLD[ch] : ch); } return r.replace(/[^a-z0-9]/g, ''); };
```
City tables (port wholesale): `REGION_CITIES` — all 16 PL voivodeships and 16 DE Länder, 1–8 major cities
each (full literal lists are in the Build Search Plan node; e.g. `'mazowieckie': ['Warszawa','Radom','Płock','Siedlce','Pruszków','Ostrołęka']`,
`'nordrheinwestfalen': ['Köln','Düsseldorf','Dortmund','Essen','Duisburg','Bochum','Wuppertal','Bonn']`).
`ZONE_CITIES` — DE/PL × {north, south, east, west, nearborder} (nearborder = German-Polish border towns:
DE `['Frankfurt (Oder)','Görlitz','Cottbus','Guben','Bautzen','Zittau']`,
PL `['Szczecin','Zielona Góra','Gorzów Wielkopolski','Słubice','Zgorzelec','Jelenia Góra','Świnoujście']`).
`NATION_REGIONS` lists region keys per country for the `anywhere` expansion.

### 4.3 Query construction + engine rotation (verbatim)
```js
const qPerCity = Math.max(1, Math.min(4, toInt(cfg.queriesPerCity, 2)));
const maxQueries = toInt(cfg.maxSearchQueries, 600);
const sxBase = String(cfg.searchUrl || '').replace(/\/+$/, '');
const engines = sxBase ? ['searxng','searxng','ddg','mojeek'] : ['ddg','mojeek'];
const buildUrl = (engine, q) => {
  if (engine === 'searxng' && sxBase) { return sxBase + '/search?format=json&q=' + encodeURIComponent(q) + '&language=' + langCode; }
  if (engine === 'mojeek') { return 'https://www.mojeek.com/search?q=' + encodeURIComponent(q); }
  return 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q) + '&kl=' + ddgKl;
};
const out = [];
let qIdx = 0;
for (const city of cities) {
  for (let qi = 0; qi < qPerCity; qi++) {
    if (out.length >= maxQueries) break;
    const kw = kwArr[qi % kwArr.length];
    const q = kw + ' ' + city;                     // <-- the query: "<keyword> <city>"
    const engine = engines[qIdx % engines.length]; // round-robin across ALL queries
    out.push({ json: { query: q, requestUrl: buildUrl(engine, q), engine, ... } });
    qIdx++;
  }
}
```
- `ddgKl`: `pl-pl` / `de-de` for builtin countries, else `iso2.toLowerCase()+'-'+langCode` from profiler, else `wt-wt`.
- **No pagination** — one SERP page per query, ever.
- **Engine retry rule** (Parse Search Results): if a query produced 0 kept results (error OR empty), re-issue
  the SAME query on the NEXT engine in the rotation list (`engList[(curIdx + 1) % engList.length]`), once.
  Retry results are parsed by "Parse Retry Results" which **dedups against round-1 domains** (`prior[dom]`).
- Loud failure if round 1 yields 0 candidates AND 0 retries:
  `'V2 SEARCH FAILED: all N queries returned nothing and no retry possible'`.
- HTTP: User-Agent `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36`,
  `Accept-Language: pl,de;q=0.9,en;q=0.8`, timeout 15 s, **1 request per 2.2 s** (n8n batching), node-level
  retryOnFail (2 tries, 3 s apart), onError → continue. Retry node: 1 per 2.5 s, no node retry.

### 4.4 SERP parsing per engine (verbatim, identical in Parse Search Results / Parse Retry Results)
```js
const parseSerp = (body, engine) => {
  const out = [];
  if (!body) return out;
  if (engine === 'searxng') { try { const px = JSON.parse(body); for (const r of (px.results || [])) out.push({ url: r.url || '', title: String(r.title || ''), snip: String(r.content || '').slice(0, 250) }); } catch (e) {} return out; }
  if (engine === 'mojeek') { const blocks = body.split('<!--rs-->').slice(1); for (const blk of blocks) { const hm = blk.match(/class="title"[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/); if (!hm) continue; const sm = blk.match(/<p class="s">([\s\S]*?)<\/p>/); out.push({ url: hm[1], title: hm[2], snip: sm ? sm[1].slice(0, 250) : '' }); } return out; }
  // DuckDuckGo html.duckduckgo.com:
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(body)) !== null) { let href = m[1]; const um = href.match(/uddg=([^&"]+)/); if (um) { try { href = decodeURIComponent(um[1]); } catch (e) {} } out.push({ url: href, title: m[2], snip: '' }); }
  return out;
};
```

### 4.5 Result filtering & dedup (verbatim lists)

Domain blocklist (substring match against domain) — `JUNK`:
```js
['google.', 'duckduckgo.', 'mojeek.', 'facebook.', 'instagram.', 'youtube.', 'linkedin.', 'wikipedia.',
 'twitter.', 'x.com', 'pinterest.', 'allegro.', 'olx.', 'amazon.', 'booking.', 'tripadvisor.', 'yelp.',
 'panoramafirm.pl', 'pkt.pl', 'aleo.com', 'rejestr.io', 'gelbeseiten.de', '11880.com', 'dastelefonbuch.de',
 'wlw.de', 'kompass.com', 'europages.', 'pracuj.pl', 'indeed.', 'glassdoor.', 'kununu.', 'gowork.',
 'money.pl', 'bankier.', 'onet.', 'wp.pl', 'interia.', 'gazeta.', 'olx.pl', 'ceneo.', 'oferteo.', 'fixly.',
 'firmy.net', 'baza-firm', 'krs-online', 'nip24', 'mapa.', 'jobs.', 'praca.', '.gov', 'gov.pl', 'edu.pl',
 'bip.', 'sejm.', 'nfz.', 'clutch.co', 'goodfirms', 'sortlist', 'designrush', 'themanifest', 'justjoin.it',
 'nofluffjobs', 'bulldogjob', 'rocketjobs', 'wykop.', 'reddit.', 'medium.', 'github.', 'behance.',
 'dribbble.', 'theorg.com', 'freelancermap', 'railsgirls', 'upwork.', 'fiverr.']
```
Title+domain keyword blocklist — `NICHE_BLOCK` (search stage; the retry/validate stages use slightly
shorter variants of the same list):
```js
['uzdrowisko','sanatorium','health resort','hotel','hostel','pensjonat','restauracja','restaurant',
 'szpital','hospital','klinika','muzeum','museum','biblioteka','przedszkole','uniwersytet','university',
 'hochschule','kosciol','parafia','urzad','starostwo','nieruchomosci','real estate','biuro podrozy',
 'kancelaria','apteka','pharmacy','instytut','institut','fundacja','foundation','stowarzyszenie',
 'politechnika','akademia','uczelnia','wikipedia','blog','aktualnosci','news','ranking','top 10','lista',
 'non-profit','nonprofit','volunteer','community','marketplace','job portal','portal pracy']
```
Candidate construction & domain dedup:
```js
const normalizeDomain = (u) => { let d = String(u || '').trim().toLowerCase(); if (d.indexOf('://') >= 0) d = d.split('://')[1]; if (d.indexOf('www.') === 0) d = d.slice(4); return d.split('/')[0].split('?')[0]; };
// per result: skip non-http, skip domains without '.', skip JUNK, skip NICHE_BLOCK in (title+domain)
// first sighting => candidate:
cands[dom] = { _kind: 'cand', id: 'c' + order, domain: dom, url: 'https://' + dom + '/',
  nameGuess: title.split(/[|–—-]/)[0].trim().slice(0, 80), city: pmeta.city, country: pmeta.country,
  snippet: stripTags(r.snip).slice(0, 280), hits: 1 };
// repeat sighting => hits++ and snippet append (max 250 chars)
```
Note: candidate URL is always rewritten to `https://<domain>/` (homepage), regardless of the deep link found.
Retry-round candidates get ids starting at `c100001`. **Gate Candidates** then merges both rounds, dedups by
domain again (summing hits), sorts by hits desc, caps at `maxCandidates`, and loud-fails:
`'V2 SEARCH FAILED: 0 candidates after engine retry round - all engines blocked or keywords too narrow'`.

## 5. Fetch logic (candidate sites)

- **Fetch Homepage**: GET `https://<domain>/`, timeout **10 s**, n8n batching 2 requests / 700 ms,
  headers: Chrome-124 UA + `Accept-Language: pl,de;q=0.9,en;q=0.8`, `onError: continueRegularOutput`
  (failed item flows through with `.error`). No redirect/SSL special-casing.
- **Prep Candidates** (per fetched site, joined back to Gate Candidates by item index):
  - **Dead-domain drop**: if no HTML and error matches `/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|CERT_|ERR_TLS|getaddrinfo/i`
    → candidate removed entirely. Other failures (403, timeout) keep the candidate with `alive:false`
    (snippet becomes its pageText).
  - Extracts: `pageTitle` (<title>, 150 ch), `metaDesc` (meta description, 250 ch), `pageText`
    (HTML stripped of script/style/tags/entities, whitespace collapsed, **first 2200 chars**),
    `cfProtected = /cfemail|email-protection/i.test(html)`, `emails` (see §8 harvest), `contactUrl` —
    first `href` matching `/href="([^"]*(?:kontakt|contact|impressum|o-nas|about)[^"]*)"/i`, resolved
    absolute/protocol-relative/root-relative/relative, `#fragment` stripped.
  - Loud-fail if every candidate died: `'V2 PREP EMPTY: every candidate domain was dead - search results were junk'`.
- **Fetch Contact Page** (only if 0 emails AND contactUrl AND alive): GET contactUrl, timeout **8 s**
  (this is the contact-scrape time cap), batching 2/700 ms, UA header only, onError continue.
  "Mine Contact Emails" re-harvests (cfemail + mailto + plain regex, dedup, top 3) and re-flags cfProtected.
  Both branches re-merge via append.

## 6. Extraction logic (LLM)

### 6.1 Chunking (Chunk For Extract)
Chunks of `extractBatchSize` (default 8, clamp 3..15). Each candidate is reduced to:
`{ id, domain, nameGuess, searchCity, snippet, pageTitle, metaDesc, pageText: pageText.slice(0,1300), emails }`.

### 6.2 SYSTEM PROMPT — VERBATIM (lines joined with `\n`)
```
You are a strict data-extraction engine for B2B lead research. You receive a JSON array of WEBSITE CANDIDATES - real pages that were already fetched from the web.
For EACH candidate decide if it is a real COMPANY whose main business matches the target niche, and extract fields.
COPY-ONLY RULE: every value you output must be copied from the candidate data provided (pageTitle, pageText, metaDesc, snippet, emails). NEVER invent, guess or use outside knowledge. If a value is not present in the data, output an empty string.
Respond with a SINGLE valid JSON object and NOTHING ELSE. No markdown fences, no prose.
JSON shape: {"companies":[{"id":"","isCompany":true,"nicheMatch":true,"nicheEvidence":"","name":"","companyType":"","city":"","foundedYear":"","employeeCount":"","email":""}]}
Rules:
- id MUST be one of the provided candidate ids. NEVER create entries that were not in the input.
- isCompany=false for directories, marketplaces, job portals, news sites, blogs, government, schools - AND for non-profits, volunteer communities, foundations and associations.
- nicheMatch=true ONLY if the main business matches the niche. Consider ALL related sub-services and company types of the niche (solutions provider, service provider, consulting, integrator, agency whose core offer IS the niche). A generic web/marketing agency is NOT a software house unless software development is its core offer.
- nicheEvidence: short phrase copied from the page text proving the match.
- name: the official company name as written in pageTitle or pageText.
- companyType: manufacturer / service provider / solutions provider / installer / distributor etc., judged from the page text.
- city: only if a city appears in the page text, else empty.
- foundedYear: only if a founding year is stated in the text.
- employeeCount: only if an employee number is stated in the text.
- email: MUST be one of the candidate emails array values, else empty. Never construct an address.
```

### 6.3 USER PROMPT — VERBATIM template
```
Target niche: {meta.niche}
Country: {meta.country}
Candidates JSON:
{JSON.stringify(chunk)}
```

### 6.4 Model call
Node "Extract Companies (Local AI)" (`@n8n/n8n-nodes-langchain.openAi`, OpenAI-compatible chat):
- modelId: `{{ $json.extractModel }}` → default **`hermes`** (= hermes3:3b/8B on the mac-mini; config can
  swap to `qwen` once the gateway has the alias).
- Credential: **`LiteLLM Gateway (mac-mini)`** (openAiApi, id `2YgDmy9NuLHvOgzJ`).
- Options: `maxTokens: 4000`, `temperature: 0.1`.
- Node: retryOnFail (2 tries, 5 s apart), onError continue (failed chunk counted as `failedChunks`).

### 6.5 ID-join anti-fabrication scheme
Candidates are numbered `c1, c2, …` at SERP-parse time (`c100001+` for retry-round finds). The model must
echo `id` per company. "Merge & Validate Leads" builds `byId` from the REAL candidate set
(`$('Gate Candidates')`); any returned company whose id isn't in `byId` is discarded and counted as
`fabricated`. All trusted fields (domain, website URL, email pool, hit count, fallback city/name) come
from the candidate record, NOT from the model. The model's `email` is accepted **only if it is literally
in the candidate's harvested `emails` array**; otherwise `emails[0]` is used; otherwise empty.

### 6.6 Output parsing + validation (Merge & Validate Leads)
LLM output parsing — tolerant brace-slice JSON extraction:
```js
const stripParse = (raw) => {
  const tryTxt = (s) => { if (typeof s !== 'string') return null; let t = s.trim(); const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b <= a) return null; try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; } };
  if (raw && Array.isArray(raw.output)) { for (const o of raw.output) { if (o && Array.isArray(o.content)) { for (const c of o.content) { const p = tryTxt(c && c.text); if (p) return p; } } } }
  for (const k of ['text', 'output_text', 'content', 'message', 'response']) { const p = tryTxt(raw && raw[k]); if (p) return p; }
  if (raw && typeof raw === 'object' && Array.isArray(raw.companies)) return raw;
  return null;
};
```
Per-company filter chain (in order): unknown id → fabricated++; duplicate domain → skip;
`isCompany === false` → drop; `nicheMatch !== true` → drop; empty name (after fallback to nameGuess) → drop;
duplicate normalized name (`[^a-z0-9]` stripped) → skip; name+companyType hits NICHE_BLOCK → drop;
**stated employee count < 20 → drop (`DROP_TIER_C`)** (unstated = keep).
```js
const parseEmpMax = (v) => { if (typeof v === 'number') return v; const m = String(v || '').match(/[0-9]+/g); if (m && m.length) { let mx = 0; for (const x of m) { const n = parseInt(x, 10); if (n > mx) mx = n; } return mx; } return 0; };
const parseFY = (v) => { const m = String(v || '').match(/(1[6789][0-9][0-9])|(20[0-9][0-9])/); if (m) { const y = parseInt(m[0], 10); if (y > 1500 && y <= CUR_YEAR) return y; } return 0; };
const sizeTier = (n) => { if (n >= 350) return 'AAA'; if (n >= 75) return 'A'; if (n >= 20) return 'B'; return ''; };
// tier = best of sizeTier(employees) and (companyAge >= 12 years ? 'B' : '')
const score = (TIER_RANK[tier] || 0) * 100 + (email ? 10 : 0) + (cand.hits || 0);  // rows sorted by score desc
```
Loud failure: `'V2 ZERO LEADS: N candidates -> 0 kept (parsedChunks=.. failedChunks=.. dropNiche=..). Gateway down or niche filter too strict.'`

## 7. Email recovery (NO_EMAIL second pass)

**Collect Missing Emails** — for each validated row with empty Email (cap **150** queries):
```js
const dom = String(r['Website'] || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
const q = '"' + name + '" ' + dom + ' email';            // e.g. "Acme Sp. z o.o." acme.pl email
// engine: round-robin over the same engines list; same buildUrl as §4.3
```
If zero targets, emits a dummy item (`mojeek.com/search?q=evertrust`) purely to keep the n8n pipeline
flowing (skip in port). **Search Missing Emails**: same HTTP settings as round 1 (15 s, 1/2.2 s, onError continue).

**Apply Recovered Emails** — pure regex over the raw SERP HTML body (NO LLM, no page fetch):
```js
for (const m of (body.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || [])) { const e = cleanEmail(m); if (e && found.indexOf(e) < 0) found.push(e); }
const domKey = String(q.dom || '').split('.')[0];
const nameKey = String(q.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
let pick = '';
for (const e of found) { const ed = e.split('@')[1] || ''; if (domKey && ed.indexOf(domKey) >= 0) { pick = e; break; } }
if (!pick && nameKey.length >= 4) { for (const e of found) { const ed = (e.split('@')[1] || '').replace(/[^a-z0-9]/g, ''); if (ed.indexOf(nameKey) >= 0) { pick = e; break; } } }
if (pick && rows[q.rowIndex]) { rows[q.rowIndex]['Email'] = pick; rows[q.rowIndex]['Status'] = ''; recovered++; }
```
i.e. accept an email only if its domain contains the company's domain stem, or (fallback) the first 8
alphanumeric chars of the company name (min 4). `cleanEmail` here adds `'mojeek','duckduckgo'` to the bad list.

## 8. Cloudflare cfemail decode + email harvesting

**XOR decode — VERBATIM** (identical in Prep Candidates and Mine Contact Emails):
```js
const decodeCf = (hex) => { try { if (!hex || hex.length < 6 || (hex.length % 2)) return ''; const key = parseInt(hex.substr(0, 2), 16); let out = ''; for (let i = 2; i < hex.length; i += 2) { const c = parseInt(hex.substr(i, 2), 16) ^ key; if (c < 9 || c > 126) return ''; out += String.fromCharCode(c); } return out; } catch (e) { return ''; } };
```
Hex blobs found via: `/(?:data-cfemail="|\/cdn-cgi\/l\/email-protection#)([0-9a-fA-F]{6,})/g`, then
`m.replace(/^.*(?:cfemail="|#)/, '')` to isolate the hex.

**Full harvest + ranking — VERBATIM** (Prep Candidates):
```js
const cleanEmail = (e) => { if (!e) return ''; e = ('' + e).trim().replace(/^mailto:/i, '').split('?')[0].trim(); e = e.replace(/^[\["'<(]+/, '').replace(/[\]"')>.,;:]+$/, ''); if (!/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(e)) return ''; const low = e.toLowerCase(); const bad = ['example.', 'sentry', 'wixpress', 'no-reply', 'noreply', 'domain.com', '.png', '.jpg', '.gif', '.svg', '@2x', 'protected', 'your-email', 'email@']; for (const b of bad) if (low.indexOf(b) >= 0) return ''; return e; };
const harvestEmails = (html, dom) => { const found = []; const cf = html.match(/(?:data-cfemail="|\/cdn-cgi\/l\/email-protection#)([0-9a-fA-F]{6,})/g) || []; for (const m of cf) { const hex = m.replace(/^.*(?:cfemail="|#)/, ''); const e = cleanEmail(decodeCf(hex)); if (e) found.push(e); } const mt = html.match(/mailto:[^"'>\s?]+/gi) || []; for (const m of mt) { const e = cleanEmail(m); if (e) found.push(e); } const tx = html.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || []; for (const m of tx) { const e = cleanEmail(m); if (e) found.push(e); } const uniq = []; for (const e of found) if (uniq.indexOf(e) < 0) uniq.push(e); const key = (dom || '').split('.')[0]; uniq.sort((a, b) => { const sc = (x) => (key && x.split('@')[1] && x.split('@')[1].indexOf(key) >= 0 ? -3 : 0) + (/^[a-z]+[._-][a-z]+@/i.test(x) ? -1.5 : 0) + (/^(office|info|kontakt|contact|sales|hello|biuro|vertrieb|sekretariat)@/i.test(x) ? -1 : 0); return sc(a) - sc(b); }); return uniq.slice(0, 3); };
```
Ranking (lower = better): −3 email domain contains site-domain stem, −1.5 looks like firstname.lastname,
−1 generic prefix (office|info|kontakt|contact|sales|hello|biuro|vertrieb|sekretariat). Keep top 3.
Contact-page scrape: only when homepage yielded 0 emails AND a contact-ish link exists AND site is alive;
GET with **8 s timeout** (the time cap), then identical harvest without ranking (insertion-ordered top 3).

## 9. Output (Google Sheet)

- New spreadsheet titled **`leads`** created per run (executeOnce), moved into the campaign folder.
  FORCE_REHUNT creates a second "leads" file; nothing is deleted/overwritten.
- Rows appended with `autoMapInputData`. Exact columns / row shape:

| Column | Value |
|---|---|
| `Company Name` | model `name` (fallback `nameGuess`), max 120 ch |
| `Company Type` | model `companyType`, max 80 ch |
| `Email` | harvested/recovered (never model-invented) |
| `Status` | `''` (has email) \| `'PROTECTED'` (cfemail seen, none decoded) \| `'NO_EMAIL'`; recovery pass resets to `''` on success |
| `Date Sent` | always `''` (placeholder for the sender workflow) |
| `Website` | `https://<domain>/` |
| `City` | model `city` → fallback search city, max 60 ch |
| `Country` | `meta.country` (English country name) |
| `Tier` | `''`/`B`/`A`/`AAA` (B: ≥20 emp or ≥12 y old; A: ≥75; AAA: ≥350; <20 stated emp = dropped) |
| `Send From` | `hanna@evertrust-germany.de` if `cfg.sender==='hanna'` else `info@evertrust-germany.de` |

- **Dedup before writing**: by domain (across both search rounds AND in validation), and by normalized
  company name. Rows sorted by `score = tierRank*100 + (hasEmail?10:0) + hits` descending.
- Run Summary (log only, not written anywhere): `{ok, project, niche, country, leads, withEmail, emailCoveragePct, tiers, runId}`.

## 10. Profiler ("Country Profiler (Local)")

Purpose: for countries other than PL/DE (which are fully hardcoded), get city list + localized niche
keywords; also tops up PL/DE keyword pools. Output feeds Build Search Plan (`prof.cities`,
`prof.iso2`, `prof.countryName`, `prof.langCode`, `prof.nicheKeywordsLocal`, `prof.nicheKeywordsEnglish`).
Parsed with the same brace-slice tolerance; on failure `prof = null` and PL/DE built-ins carry the run —
non-builtin country + failed profiler = loud `V2 PROFILE ERROR`.

**SYSTEM — VERBATIM:**
```
You are a geography and B2B market research assistant. Respond with ONE valid JSON object and NOTHING ELSE. No markdown fences, no prose. Use only well-known factual knowledge.
```
**USER — VERBATIM template:**
```
Country: {country}
Niche: {niche}
Return JSON exactly in this shape: {"countryName":"English country name","iso2":"two-letter country code","language":"main business language (English name)","langCode":"ISO 639-1 language code","cities":["city1","city2"],"nicheKeywordsLocal":"10-14 comma-separated keywords","nicheKeywordsEnglish":"10-14 comma-separated keywords"}
Rules:
- cities = the 60 to 90 largest cities and significant business towns of this country, ordered largest first, written in their LOCAL spelling. Do not include cities of other countries.
- BOTH keyword lists must EXPAND the niche: include synonyms, ALL related sub-services, product categories and company types that a company in this niche would use to describe itself (e.g. for "{niche}": manufacturers, suppliers, installers, service providers, solutions, related technologies). The goal is to surface as MANY companies of this niche as possible.
- nicheKeywordsEnglish: in English.
- nicheKeywordsLocal: in the LOCAL language of {country}, NOT English and NOT transliterated - exactly the way local companies describe themselves on their own websites. Native script if the language uses one (e.g. Cyrillic for Bulgarian). If the local business language is English, repeat the English list.
```
Call: modelId `{{ $json.extractModel }}` (default `hermes`), `maxTokens: 3000`, `temperature: 0.2`,
retry 2×/5 s, onError continue. **WARNING:** despite the "(Local)" name this node uses credential
**"OpenAI account"** (id `ypzvmVMNjOUfzDUg`), NOT the LiteLLM gateway — either a misconfiguration or
that credential's base URL points at the gateway. Verify before porting; the model id `hermes` would not
exist on real OpenAI.

## 11. Error handling & guards

Loud-failure throws (workflow errors instead of silent empty success):
1. Build Search Plan: `V2 PROFILE ERROR` (non-builtin country, no profiler cities; two variants),
   `V2 CONFIG ERROR: niche=... cities=...`.
2. Parse Search Results: `V2 SEARCH FAILED: all N queries returned nothing and no retry possible`.
3. Gate Candidates: `V2 SEARCH FAILED: 0 candidates after engine retry round - all engines blocked or keywords too narrow`.
4. Prep Candidates: `V2 PREP EMPTY: every candidate domain was dead - search results were junk`.
5. Merge & Validate Leads: `V2 ZERO LEADS: ...`.

Per-node settings:

| Node | retryOnFail | onError |
|---|---|---|
| Search Web (Real URLs) | 2 tries / 3 s | continueRegularOutput |
| Search Web Retry | no | continueRegularOutput |
| Fetch Homepage / Fetch Contact Page / Search Missing Emails | no | continueRegularOutput |
| Country Profiler (Local) | 2 tries / 5 s | continueRegularOutput |
| Extract Companies (Local AI) | 2 tries / 5 s | continueRegularOutput |
| Find Existing Leads Sheet | — | alwaysOutputData: true |
| All Sheets/Drive write nodes | none (default fail) | default |

Webhook responds immediately (`onReceived`) — caller never sees errors; failures are visible only in
execution log / console.log breadcrumbs (`[V2 Plan] [V2 Search R1] [V2 Retry] [V2 Gate] [V2 Prep]
[V2 Contact] [V2 Chunk] [V2 Validate] [V2 EmailSearch] [V2 Summary]` — keep these as Python log lines).

## 12. Credentials used

| Credential | Type | Used by |
|---|---|---|
| Google Drive OAuth2 API (`7ntqqDsIDCgae66w`) | googleDriveOAuth2Api | Find Existing Leads Sheet, Find/Download config.json, Move Leads Sheet, Drive Poll trigger |
| Google Sheets OAuth2 API (`nVxTVzA6qeIhESvH`) | googleSheetsOAuth2Api | Create Leads Sheet, Append Leads Rows |
| LiteLLM Gateway (mac-mini) (`2YgDmy9NuLHvOgzJ`) | openAiApi (OpenAI-compatible) | Extract Companies (Local AI); also the SEAR worker's chat model |
| OpenAI account (`ypzvmVMNjOUfzDUg`) | openAiApi | Country Profiler (Local) — see §10 warning |
| Header Auth account 3 (`NYfSrSw1pUmsYjPL`) | httpHeaderAuth | SEAR worker's `web_search` SearXNG tool only |

Search engines (DDG/Mojeek/SearXNG) and candidate-site fetches are unauthenticated.

## 13. n8n artifacts NOT worth porting

- **HTTP batching options** (`batchSize/batchInterval` on every HTTP node): n8n's rate limiter. In Python
  use a semaphore + sleep — keep the effective rates (SERP ≈1 req/2.2 s, site fetch ≈2/0.7 s).
- **Index-alignment joins**: Prep Candidates ↔ Gate Candidates, Mine Contact Emails ↔ Needs Contact Page?,
  Apply Recovered Emails ↔ Collect Missing Emails all pair `$input.all()[i]` with `$('OtherNode').all()[i]`
  by position. Fragile n8n idiom — in Python just carry one candidate dict through the pipeline.
- **Merge nodes** ("Rejoin Candidates", "All Candidates", append mode) and the **Split Retry? IF** that
  multiplexes retry-requests and candidates through one stream via `_kind` tags — pure plumbing; a plain
  function call / list concat replaces them.
- **"Build Sheet Rows"** — literally `return $('Apply Recovered Emails').all()...`; exists only to re-inject
  rows after the single-item Create/Move sheet nodes. Skip.
- **`executeOnce: true` on Create Leads Sheet** — n8n multi-item guard. Skip.
- **Dummy query** in Collect Missing Emails (`q=evertrust` on Mojeek when 0 targets) — keeps the n8n branch
  alive. Skip.
- **Skip Note / Invalid Payload Note** code nodes — log-and-end stubs. Replace with early returns.
- **The triple-source `Extract Config` re-parse boilerplate** (`_ec.cfg` object/string/`_ec.data`) — quirk
  of n8n's extractFromFile. In Python: `json.load(open(config))`.
- **Sticky notes** (3, Vietnamese) — documentation only; their stated defaults (maxSearchQueries 200,
  maxCandidates 300) are stale — code says 600/1000.
- **LangChain OpenAI node response unwrapping** (`raw.output[].content[].text` walk in stripParse) —
  with a direct OpenAI client you read `choices[0].message.content`; keep only the brace-slice JSON rescue.

---

## Appendix: WF-03 Segment Worker (SEAR v3) — `5LcUx5jHULe679CR` (ARCHIVED)

A different, agentic architecture (fan-out child): Webhook `POST /wf03-segment-worker` → Explode Segments
→ **AI Agent "Search Companies (Web)"** → Parse Segment Leads → insert into Data Table `wf3_segment_results`
(`WCl6m01M1RXxe1q8`) as `{runId, segmentIndex, leadsJson, status:'done'}`.

**IMPORTANT: the agent's prompts are NOT stored in this workflow.** The agent uses
`text: {{ $json.userContent }}` and `systemMessage: {{ $json.systemContent }}` — both arrive inside each
segment object of the webhook payload (`{runId, segments:[{systemContent, userContent, maxToolsIterations,
segmentIndex, ...}]}`), built by the (also archived) fan-out parent. What IS stored:

- **Agent**: `@n8n/n8n-nodes-langchain.agent` v3.1, `maxIterations: {{ $json.maxToolsIterations || 200 }}`,
  streaming off, hasOutputParser, retryOnFail 2×/5 s, onError continue. autoFix **disabled** on the parser
  by design: *"fail-fast, no retry storms on the 8B model"*.
- **Model**: `lmChatOpenAi` → model **`hermes`** via **LiteLLM Gateway (mac-mini)**, temperature 0.2,
  maxTokens 8000, timeout 180 s, maxRetries 2.
- **Tool `web_search`**: httpRequestTool GET `https://mac-mini-ca-mac.tailc3d837.ts.net:10000/search`
  (SearXNG, header-auth), `q={{ $fromAI('query', 'The web search query') }}`, `format=json`, response
  optimized to fields `title,url,content` from `results`, 30 s timeout. Tool description: *"Web search.
  Call with a search query string; returns JSON results with title, url and content snippet for each hit.
  Write queries in the local language of the target country when possible."*
- **Structured output schema** (fromJson example — the lead shape this lineage targeted):
```json
{"leads":[{"name":"Firma Sp. z o.o.","type":"installer","nicheMatch":true,"nicheEvidence":"offers SOC services","email":"info@firma.pl","phone":"+48 22 123 45 67","website":"https://firma.pl","guessedEmails":"","street":"ul. Prosta 1","zip":"00-001","city":"Warszawa","country":"Poland","description":"Cyber security services provider.","source":"web-search","sourceURL":"https://panoramafirm.pl/firma","confidence":0.8,"legalForm":"sp. z o.o.","tier":"B","employeeCount":"50-100","employeeCountSource":"LinkedIn","foundedYear":"2008","reputationScore":0.7,"targetFit":0.9,"annualRevenueEUR":"","revenueTier":"small"}],"searchSummary":"queries run","lowestConfidence":0.6}
```
- Parse Segment Leads: same brace-slice JSON rescue, pairs results to segments by index, always emits
  `status:'done'` (even for empty/failed parses — silent-empty, unlike V2's loud failures).

For the Python port, V2 is the canonical pipeline; SEAR v3 contributes the richer lead schema idea and the
SearXNG tool endpoint, nothing else.
