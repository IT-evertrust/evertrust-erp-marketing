# Evertrust Growth — User Guide

A plain-language guide to using the Evertrust Growth platform. **No technical knowledge needed.**
If you can use Gmail, you can use this.

> This guide is for the people who use the app every day (sales, outreach, management).
> For the developer/setup documentation, see [README.md](README.md) instead.

---

## What is this app?

Evertrust Growth is your **outreach cockpit**. It finds potential customers, emails them for you,
helps you reply to the ones who answer, books the meetings, and tracks every deal until it's won.

The whole app is built around four stages that a customer moves through, left to right. We call it
the **R.E.A.N.** sequence:

| Stage | What it does | In one sentence |
|-------|--------------|-----------------|
| **1. Reach** | Find companies and email them | "Get our message in front of the right people." |
| **2. Engage** | Handle the replies | "Answer everyone who responds, with AI help." |
| **3. Activate** | Book and prepare for meetings | "Turn interested replies into calls." |
| **4. Nurture** | Manage deals to the finish | "Move each deal from interested to signed." |

There's also an **Overview** dashboard that shows how everything is performing at a glance.

You'll find all five in the menu on the left side of the screen.

---

## Getting started

### 1. Signing in

1. Go to the app's web address (ask your admin for the link).
2. You'll see the **Evertrust ERP** login screen with one button: **"Continue with Google"**.
3. Click it, choose your **company Google account**, and approve.
4. That's it — you're in.

**Important:**
- You must use your **company** Google account. Personal Gmail/Outlook accounts are rejected
  ("Please use your company Google account, not a personal one.").
- There is **no password** to remember — sign-in is always through Google.
- If you ever land back on the login screen unexpectedly, your session simply timed out. Just sign
  in again.

### 2. Connecting your Gmail & Calendar

To send emails, read replies, and book meetings, the app needs permission to use your Google
account. You do this once:

1. Click your **initials/avatar** in the top-right corner → **"Settings"**.
2. Scroll to **"Connected accounts"**.
3. Click **"Connect account"**.
4. A Google window appears asking permission to **send and read email** and **read and create
   calendar events**. Click **Allow**.
5. You'll see a green **"Google account connected."** message, and your email now shows as
   **"Connected"**.

**Good to know:**
- You can connect **more than one** Google account (for example a shared `info@` mailbox and a
  personal work address). Each appears in the list.
- One account is marked the **"Default mailbox"** — that's the one used for sending unless a campaign
  says otherwise.
- Removing an account signs that person out and revokes access — they'd need to reconnect.

---

## Finding your way around

The **menu on the left** is always there:

- **Overview** — your dashboard
- **Reach** (01) — find & email prospects
- **Engage** (02) — handle replies
- **Activate** (03) — meetings & research
- **Nurture** (04) — your deal pipeline
- **Settings** — your account, sender identity, and integrations

Your name, organization, and a **Log out** option live at the bottom of the menu (or under your
avatar, top-right).

---

## The Overview dashboard

This is your home screen. It shows, live:

- **Engine Activity** — a running feed of what the system is doing right now (scraping, sending,
  sorting replies, booking meetings).
- **The R.E.A.N. funnel** — how many prospects are at each stage.
- **Key numbers** — new leads, contacted, reply rate, interested, meetings, and pipeline value.

You don't *do* anything here — it's your "how are we doing?" screen. Hover over a module in the
diagram to filter the activity feed to just that part of the system.

---

## Stage 1 — Reach: find prospects and email them

Reach has three tabs: **Lead Scraper**, **Email Generator**, and **Sequence Sender**.

### Step 1: Create a campaign (an "Aim")

A **campaign** (also called an **Aim**) is one targeted outreach effort — for example "LED lighting
suppliers in Bavaria."

1. On the **Lead Scraper** tab, click **"+ Campaign"**.
2. Fill in the **"New Reach Aim"** form:
   - **Campaign Name** — e.g. *"Housing Co-ops ≥ 500 units · Bavaria"*
   - **Niche** — the type of business you're targeting, e.g. *"Property Management"*
   - **Country** and **Region** (e.g. Germany / North)
   - Optional extras: Segment, Industry Focus, sender Gmail, Calendar
3. Click **"Start Aim"**. Your campaign appears in the list.

### Step 2: Run the Lead Scraper ("Lead Satellite")

The Lead Scraper automatically hunts the web for real companies that match your campaign, and
collects their **company name, contact person, phone, website, and email**.

1. Select your campaign in the campaigns table.
2. The scrape starts and shows a **countdown timer** and progress bar ("Lead Satellite is scraping
   leads…").
3. You can leave the page — it keeps working in the background.
4. When it's done you'll see **"Scrape complete — *X* companies found."**

The found companies appear in a table with **Company, Contact, Location, Source, and Status**.

> **Note:** The contact person and phone come from each company's official "Impressum"/contact page.
> For German/Austrian/Swiss companies this is usually complete; for other countries you may see a
> phone but not always a named person.

### Step 3: Prepare your emails (Email Generator)

Each campaign sends a **3-email sequence**:

- **Cold Outreach** (Round 1) — the first email
- **Follow Up** (Round 2)
- **Final Push** (Round 3)

On the **Email Generator** tab you can review and edit the **Subject** and **Body** of each round,
and see how each is performing (Sent, Opened, Clicked, Replied, Meetings). You can **"Save as
default"** to reuse a template across campaigns.

### Step 4: Send (Sequence Sender)

The **Sequence Sender** tab controls actual sending:

- Each campaign shows its current round, **next send time**, and results.
- Turn **Auto-send** on to let the system send on schedule (e.g. "Tomorrow 09:00").
- Or click **"Run Bazooka"** to send everything that's due right now.
- A chart shows **emails sent per day**, past and projected.

> **Glossary:** *"Bazooka"* is just the nickname for the email-sending engine. *"Lead Satellite"*
> is the nickname for the lead scraper.

---

## Stage 2 — Engage: handle the replies

When prospects reply, Engage reads your mailbox and sorts the replies into **Interested**,
**Unsure**, and **Not interested** — then helps you respond.

### Step 1: Pick a mailbox and scan

1. At the top, choose a **Google account** (or "All accounts").
2. Pick a campaign from the list.
3. Click **"Scan"** to pull in new replies (it also scans automatically every hour).

### Step 2: Read a reply

Click any reply in the left-hand list. On the right you'll see:

- The company, the contact, and the full **email conversation**.
- A coloured label showing the AI's verdict (**Interested / Unsure / Not interested**).
- An **AI-drafted reply**, ready for you to edit.

### Step 3: Polish the reply with AI

- **Persona** — choose a "voice" for the draft (e.g. a friendly tone, or a specific colleague's
  style). You can **create or edit personas** with the **+** and pencil icons.
- **Re-draft** — regenerate the suggestion in the chosen persona.
- **Teach the AI** — below the draft you can either:
  - **Write & Fix:** type an instruction like *"Make it shorter"* → **Apply**.
  - **Train · Feedback:** type a lasting rule like *"Always mention ROI in follow-ups"* →
    **Save feedback** (the AI remembers this for the campaign).

### Step 4: Offer meeting times and send

- Click **"Propose times"** to pull free slots from your calendar; click a slot to add it to the
  reply.
- Edit the subject/body as you like.
- Click **"Approve & send"** (or **Send**). If the reply is *Interested* and you added a slot, the
  app also creates the **calendar invite** automatically.
- Prefer one-click? On an *Interested* reply, **"Book meeting"** opens a small dialog to schedule the
  call (with a Google Meet link) directly.

---

## Stage 3 — Activate: meetings & research

Activate is about turning interest into well-prepared calls. It has tabs for **Meeting Booker**,
**Company Research**, and **After-sales Analysis**.

### Meeting Booker

- Shows your **upcoming meetings** and your **free slots** from Google Calendar.
- Click **"Book"** on a slot to schedule a meeting; click **"Join"** on a meeting to open its link.
- If you see **"Connect a Google Calendar,"** connect your account in Settings first (see
  [Connecting your Gmail & Calendar](#2-connecting-your-gmail--calendar)).
- If several Google accounts are connected, meetings are colour-coded per account and you can view
  them all together.

### Company Research (pre-meeting dossier)

Open an upcoming meeting to get an **auto-generated dossier** about the company and the person you're
meeting — company profile, recent signals, suggested talking points, and a communication-style read.
You can **download it as a PDF** or **attach it to the calendar event** so it's there before the
call.

### After-sales Analysis

Post-call summaries (key moments, sentiment, next steps). This area is **coming soon**.

---

## Stage 4 — Nurture: your deal pipeline

Nurture is a **drag-and-drop board** of every deal, plus a **Contract Assist** tab.

### The pipeline board

Deals move left to right through six columns:

**Interest → Intent → Consideration → Decision → Won → Lost**

Each column shows how many deals it holds and the **total euro value**.

Each **deal card** shows the company, contact person, phone, a niche tag, and the deal value.

**What you can do:**

- **Move a deal** — drag its card to another column (e.g. from *Consideration* to *Decision*).
- **Edit details** — click the company name, contact, phone, or **€ value** right on the card, type,
  and press **Enter**.
- **Add a deal** — click **"+ Add deal"** at the bottom of a column.
- **Remove a deal** — hover the card and click the **✕**, then confirm.
- **Find a deal** — use the search box ("Search company or email…") and the niche/date filters;
  **"Clear"** resets them.

### Contract Assist

- Click **"New"** to start a contract row (company, deadline, type).
- **"Generate"** drafts the contract; **"Download draft"** saves it.
- Click a company name under **Company Analysis** to see its latest call analysis and key agreed
  terms.

---

## Settings — make it yours

Open **Settings** from your avatar (top-right). The most useful sections:

- **Sender Identity** — the **name, email, and signature** (including a signature image) shown on
  your outgoing emails.
- **Sending Parameters** — your **daily send limit**, **sending hours**, and how many days between
  follow-up rounds.
- **Integrations** — switch Gmail, Google Calendar, Read AI, and Google Sheets on or off.
- **Engine Mode** — choose whether drafts need **approval before sending**, enable **auto-send**, or
  a **weekly report** email.
- **Connected accounts** — add or remove the Google accounts used for mail and calendar.
- **Appearance / Display / Language** — theme (Light/Dark), default landing page, density, and
  English/Deutsch. These are personal to you.

Most settings save automatically; you'll see a brief **"Settings saved."** confirmation.

---

## Quick glossary

| Term | What it means |
|------|---------------|
| **Aim / Campaign** | One targeted outreach effort (a niche in a place). |
| **Lead Satellite** | The lead scraper that finds matching companies on the web. |
| **Bazooka** | The engine that sends your campaign emails. |
| **Lead / Prospect** | A company you might do business with. |
| **Persona** | A reusable "voice" the AI uses to draft replies. |
| **Pipeline / Stage** | Where a deal sits on its way to Won (Interest → … → Won/Lost). |
| **Dossier** | An auto-generated briefing about a company before a meeting. |

---

## Troubleshooting & FAQ

**I clicked "Continue with Google" and got an error about a personal account.**
Use your **company** Google account, not a personal Gmail.

**I was suddenly sent back to the login page.**
Your session timed out — just sign in again. Nothing is lost.

**Activate says "Connect a Google Calendar."**
Go to **Settings → Connected accounts → Connect account** and approve calendar access.

**Emails aren't going out / it says "Delivery pending OAuth."**
Your Google account may not be connected (or its permission lapsed). Reconnect it in Settings.

**The scraped contact person is empty for some companies.**
That information isn't published on every company's site — it's strongest for German, Austrian, and
Swiss companies. A phone or generic email is usually still captured.

**Can two of us use it at once with different mailboxes?**
Yes. Connect each Google account in Settings; in Engage you can switch between mailboxes or view
"All accounts."

**Something looks broken or a feature says "coming soon."**
Parts of the app are still being built. Contact your admin if a core feature isn't working.

---

*Need help beyond this guide? Contact your Evertrust admin.*
