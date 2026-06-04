---
date: 2026-04-29
topic: architect-firm-outreach-playbook
origin: docs/ideation/2026-04-29-architect-firm-outreach-ideation.md
---

# Architect-Firm Outreach Playbook — Tonight + Week of 2026-05-04

## Problem Frame

Founder (Colin Kim, Boston-based, MIT B.Arch) needs ≥3 Letters of Intent from Boston/NYC architecture firms by **2026-05-06** to support a near-term funding/partnership milestone. Cold-email-only outreach at 30–50 volume is insufficient for that timeline; the playbook combines 25 cold emails (Tue 2026-05-05 7am EST send) + 5 warm-network LinkedIn DMs + 5 in-person Boston firm drop-offs, all anchored on a "design partner" offer with a short non-binding LOI.

## Locked Decisions

- **Sender:** Personal Gmail / Google Workspace (no SES, no new domain)
- **Volume:** 30–50 hand-picked firms, pre-filtered for Rhino-fit ICP
- **Thesis hosting:** Link to `https://www.0studio.xyz/thesis` — no PDF attachment
- **Sender:** `founders@0studio.xyz` (Google Workspace), display name `Colin Kim · 0studio`
- **Send time:** Schedule for Tuesday 2026-05-05 7:00am EST (not tonight)
- **Hook:** Named design partner + first year free + 1-page non-binding LOI
- **Email format:** Plain text, 4 sentences, manually personalized first line per firm

## Open Inputs Needed From Founder Before Send

- [O1] **Resolved:** Founder credibility line = `Boston · MIT B.Arch · 0studio.xyz`
- [O2] List of 5 warm-network architects (LinkedIn URLs + relationship context)
- [O3] Confirmation `https://www.0studio.xyz/thesis` is live and has CTAs (LOI PDF download + Calendly) on the page itself. If consumer-toned, ship a `/architects` subpage tonight or tomorrow morning.
- [O4] **Resolved:** Calendly = `https://calendly.com/colinikkim/0studio-intro`
- [O5] **Resolved:** sender = Google Workspace `@0studio.xyz`, Workspace daily limit 2,000. Apply 5-min batch pacing + warmup + kill-switch from (d).
- [O6] **Resolved:** mailing address = `97 Bay State Rd, Boston, MA`
- [O7] SPF + DKIM + DMARC records configured on `0studio.xyz` in Workspace admin (Apps → Google Workspace → Gmail → Authenticate email). Verify before Tuesday.

---

## (a) The 1-Page LOI — Text + Signing Setup

### LOI text (drop into a Google Doc, export to PDF, attach to cold email)

```
LETTER OF INTENT — DESIGN PARTNER PROGRAM
Ostudio Inc. (d/b/a 0studio) · Version Control for Rhino and Revit Files
Date: ____________

To Ostudio Inc.,

I, _____________________ (Name), of _____________________ (Firm), express
non-binding interest in participating as a Design Partner for 0studio, a
desktop application provided by Ostudio Inc. that delivers version
control purpose-built for Rhino (.3dm) and Revit (.rvt) files. As a
Design Partner, our firm would:

  1. Have a direct channel to the Ostudio founder team during product
     development, with the opportunity to inform feature priorities
     through informal review sessions (cadence at our discretion).
  2. Be credited as a launch design partner in 0studio public materials,
     subject to Ostudio Inc.'s discretion regarding final form and timing.

This Letter of Intent is non-binding and does not create any obligation,
agreement, partnership, joint venture, or fiduciary relationship between
the parties. Neither party is required to enter into a future agreement,
exchange consideration, share confidential information, or take any
particular action. Either party may withdraw at any time without
liability or notice.

This LOI does not constitute an offer or sale of securities. Ostudio
Inc. makes no warranty regarding the development, availability, fitness
for purpose, or performance of any product. The signing party
acknowledges they have not relied on any representation outside this
document.

Signed: _____________________
Title:  _____________________
Firm:   _____________________
Date:   _____________________
```

### PDF generation + attachment workflow

PandaDoc and SignWell both paywall public-link signing. The simplest free path is: ship the LOI as a PDF attachment, recipient signs themselves in Preview/Adobe/Mail Markup, emails the signed PDF back. This also aligns with 0studio's "no SaaS lock-in" thesis voice.

1. In Google Doc → File → Download → **PDF Document (.pdf)**
2. Save as `0studio-design-partner-loi.pdf` (no underscores, no version markers, no "FINAL" — those are spam-filter triggers)
3. Verify file size **≤200KB**. Compress at `https://www.ilovepdf.com/compress_pdf` if larger
4. Don't password-protect or lock as read-only — that breaks Preview's signature tool on the recipient's end
5. Open the PDF yourself once → confirm Markup → Signature works on the Signed line

When a firm signs, they email the signed PDF back. File it into `~/0studio/loi-signed/{firm-slug}.pdf` and update the spreadsheet `pdf_received_at` column with the timestamp.

> Free alternative if you want one-click signing: **DocuSeal** (https://www.docuseal.co) — open-source with a free hosted tier including unlimited public signing links. ~5 min setup. Skip if you've committed to PDF-attach.

---

## (b) Source-List URLs + Per-Firm Vetting Checklist

### Primary source URLs

> **Reality check:** AIA + BSA + Architizer typically gate detailed principal contact info behind member or paid tiers. Use these directories for **firm names + URLs only**, then pull principal email from each firm's own website "Contact"/"Team" page or via Hunter.io.

| # | Source | URL | Pull |
|---|--------|-----|------|
| 1 | Boston Society of Architects (BSA) — Member Directory | `https://www.architects.org/directory` | Firm name + URL only (member login required for emails) |
| 2 | AIA New York — Find an Architect | `https://www.aiany.org/membership/find-an-architect/` | Firm name + URL only (member login required) |
| 3 | Architizer Firm Profiles | `https://architizer.com/firms/?location=Boston` and `/?location=New York` | Firm + URL + project signals (parametric/computational tags) |
| 4 | GSD Alumni — Recently Founded Firms | `https://www.gsd.harvard.edu/alumni/` + LinkedIn search `"GSD" "principal" "Boston" OR "New York"` | Founder names + firm + LinkedIn URL |
| 5 | GSAPP Alumni — Founded Firms | LinkedIn search `"GSAPP" "principal" "New York"` | Same |
| 6 | Firm websites — "Contact" or "Team" pages | Each firm's own URL from #1–5 | **Principal first/last name + email**. This is the real source for emails. |
| 7 | Hunter.io — Email Finder (free tier: 25/month) | `hunter.io/email-finder` | Use when firm website hides emails. Enter `{firm domain}` + `{principal name}` → gets the most likely pattern |

### Per-firm vetting checklist — drop a firm if any FAIL

- [ ] Primary office in Boston metro OR NYC metro (not just satellite)
- [ ] Firm size 5–50 (signal: "Team" or "Office" page count)
- [ ] Portfolio / recent project page **mentions or visibly uses Rhino** — keywords: *Rhino, Grasshopper, parametric, computational, generative, ruled surface, NURBS*. Geometric vocabulary like "double-curved facade" or twisting tower forms is a strong signal.
- [ ] Active website with a project published in the last 12 months
- [ ] Principal/Partner/Design Director name and email discoverable (via website "Contact" or Hunter.io)

If unsure, drop. Better 30 high-fit firms than 50 mixed.

### Spreadsheet schema

Google Sheet — `Architect Outreach 2026-W19`. Columns:

```
firm | url | metro | principal_name | first_name | email | recent_project
| project_observation | personalization_line | source | sent_at | opened_at
| replied_at | outcome | notes | pdf_received_at
```

`personalization_line` is the literal opener sentence (e.g. *"Saw Tower at PNC Plaza — the brise-soleil geometry is wild."*) — written by hand per firm. This is the unforgeable craft of the campaign.

---

## (c) Email Template + Personalization Slots

### Subject line

```
{firm_name} + Rhino versioning?
```

(Sender display name should read "Colin Kim · 0studio" — set in Gmail Settings → Accounts → Send mail as.)

### Body (plain text, no HTML, no logo, no signature image)

```
Hi {first_name} — {personalization_line}

Quick question: how does {firm_name} currently track .3dm versions
when you're iterating on a model? I'm building 0studio, a
version-control tool purpose-built for Rhino and Revit files —
finally a way to undo bad design decisions without "final_FINAL_v3.3dm"
chaos (architect-facing thesis: https://www.0studio.xyz/thesis).

We're signing 5 design-partner firms in Boston and NYC this week —
direct line to the founder team during product development, named
partner credit at launch, short non-binding LOI attached (sign in
Preview/Adobe and email back).

Would 15 min next week work? Calendly: {calendly_link}

— Colin
{founder_credibility_line}

Ostudio Inc. · 97 Bay State Rd, Boston, MA · Reply STOP if you'd
like me to remove you from this list.
```

### Slot definitions

| Slot | Source | Example |
|------|--------|---------|
| `{first_name}` | Spreadsheet col `first_name` | `Sarah` |
| `{firm_name}` | Spreadsheet col `firm` | `Höweler + Yoon` |
| `{personalization_line}` | Hand-written per firm | `saw the Sean Collier Memorial — that ruled-surface geometry holds up beautifully.` |
| `{calendly_link}` | Founder Calendly (resolved) | `https://calendly.com/colinikkim/0studio-intro` |
| `{founder_credibility_line}` | One-line bio (resolved) | `Boston · MIT B.Arch · 0studio.xyz` |

### Anti-spam rules — do all of these

- Plain text only (Gmail compose → ⋮ menu → "Plain text mode")
- No URLs in subject line; only 2 URLs in body (thesis + LOI + Calendly = 3, acceptable)
- No "free" / "guaranteed" / "limited time" wording
- Test the email against `mail-tester.com` — target 9.5/10 or higher before scheduling
- One email per recipient, sent 1:1 (GMass enforces this)
- **Open tracking ON** for this campaign — needed to segment Follow-up #1 by "didn't open." Click tracking OFF (rewriting URLs hurts deliverability more than open pixels). Accept ~5% deliverability hit on opens for the segmentation value at 40 volume.

---

## (d) Tooling Setup — Gmail + GMass + Streak

### Step-by-step (~30 minutes total)

1. **Google Sheet**
   - New Sheet, name `Architect Outreach 2026-W19`
   - Paste column headers from (b)
   - Freeze row 1, color-code `outcome` column

2. **GMass (Chrome extension)**
   - Install from Chrome Web Store: search "GMass"
   - Sign in with `founders@0studio.xyz` (Workspace)
   - Free trial covers tonight; subscribe ($25/mo) only if continuing past this campaign
   - Settings: turn **ON** open tracking, turn OFF click tracking (open pixel for segmentation; URL-rewrite hurts deliverability more than it helps)
   - Settings: enable "schedule send" + **set 5-minute delay between messages** (not 30-sec). 25 emails × 5 min = ~2 hours of trickle starting 7am EST, finishing ~9am — stays in the high-open window without tripping Google's anti-abuse heuristics.

3. **Streak (Chrome extension)**
   - Install from Chrome Web Store
   - Create a pipeline: `Architect Outreach`
   - Stages: `Sent → Opened → Replied → Call Booked → LOI Signed → Declined → No Response`
   - Streak auto-attaches to Gmail threads — no extra step needed

4. **Compose in GMass**
   - In Gmail, click the red GMass button (not "Compose")
   - Connect to Google Sheet → select `Architect Outreach 2026-W19`
   - Paste subject + body with `{first_name}` etc. — GMass substitutes from columns
   - Recipients: GMass auto-fills from `email` column
   - **Send: choose "Schedule" → 2026-05-05 7:00am EST**
   - Click Schedule, do not click Send

5. **QA before scheduling**
   - In GMass, click "Send to test address" → send to your personal Gmail
   - Open from a phone (architect-recipient inbox-rendering test) and from desktop
   - Run text against `mail-tester.com` once
   - Fix any rendering issues, re-test, then schedule

6. **Pre-warm the sending domain (Wed 2026-04-30 + Mon 2026-05-04)**
   - From the `@0studio.xyz` Workspace account, send 5–10 normal emails per day to friends, yourself, or existing customers Wed–Mon
   - Vary subject lines and body content (not the cold template)
   - Goal: keep the sender's behavioral pattern "warm" with non-bulk, non-templated traffic before Tuesday's batch

7. **Kill-switch protocol during the Tuesday send**
   - Monitor `@0studio.xyz` inbox for any "we noticed unusual activity" or "verify it's you" emails from Google during the 7–9am window
   - If one arrives: open GMass and **click Pause immediately**. Resolve the verification, wait 24 hours, resume at half-volume
   - If two warnings arrive: **abandon GMass for this campaign**, send the remaining emails manually 5/day from Gmail web interface
   - Keep recovery phone within reach in case of SMS verification challenge

8. **Verify domain authentication**
   - Sender domain (`0studio.xyz`) and thesis link domain (`www.0studio.xyz/thesis`) match — no phishing-look risk.
   - Verify `0studio.xyz` has SPF, DKIM, and DMARC records configured in Workspace admin before Tuesday (Workspace → Apps → Google Workspace → Gmail → Authenticate email). Without DMARC, ~30% of cold emails go to spam regardless of content.

---

## (e) Thesis Page (`0studio.xyz/thesis`) Audit + Build Checklist

Audit the existing thesis page. The cold email links here, so it must convert. CTAs should live on the thesis page itself — no separate `/architects-partner` route needed.

### Checklist

- [ ] Page loads on mobile (architects open email on iPhones in studio)
- [ ] First fold mentions "design partner program" within first 2 sentences
- [ ] CTA button: "Download 1-page LOI" → links to a hosted copy of `0studio-design-partner-loi.pdf` (drop in `public/` or upload to S3, link directly)
- [ ] Secondary CTA: "Book 15 min" → Calendly
- [ ] Social proof slot: "Currently signing 5 Boston/NYC design partners" (update to actual number once 1+ signs)
- [ ] One screenshot of the actual product (not a stock vector)
- [ ] One sentence on the technical thesis: why .3dm needs purpose-built version control (vs. Dropbox/Speckle/Frame.io)
- [ ] Founder name + photo + 1-line bio at the bottom
- [ ] No stripe-checkout or pricing page links (don't pre-empt the LOI conversation)

### If `0studio.xyz/thesis` doesn't exist or is consumer-toned tonight

Ship a minimal Notion doc and either (a) map a Notion custom domain to `0studio.xyz/thesis`, or (b) use the public Notion URL directly in the email template (replace `https://www.0studio.xyz/thesis` with the Notion URL — accept the domain mismatch as a one-time tradeoff).

> Defer the rebuild to tomorrow morning if the existing page is "good enough."

---

## (f) Hour-by-Hour Tonight — Starts 7:00pm 2026-04-29

**Volume target: 25 personalized cold emails** (revised down from 40 — quality of personalization is the only edge at this volume; better 25 well-personalized than 40 generic).

| Time | Block | Output |
|------|-------|--------|
| **7:00–7:30pm** | Confirm Ostudio Inc. status; verify SPF/DKIM/DMARC on 0studio.xyz; confirm `0studio.xyz/thesis` state; draft LOI in Google Doc | LOI drafted |
| **7:30–8:00pm** | Export LOI Google Doc → PDF; save as `0studio-design-partner-loi.pdf`; verify ≤200KB and Preview signature tool works | LOI PDF ready |
| **8:00–8:15pm** | Audit `0studio.xyz/thesis` (15-min cap; defer any rebuild to tomorrow morning) | Audit notes |
| **8:15–9:30pm** | **Source pass 1.** BSA + AIANY + Architizer Boston/NYC. Add ~50 raw rows to sheet. | ~50 raw rows |
| **9:30–10:00pm** | **Source pass 2.** GSAPP + GSD alumni firms via LinkedIn. Add ~10–15 more rows. | ~60–65 raw rows |
| **10:00–10:15pm** | **Hard cut.** Apply vetting checklist from (b). Drop to **25 high-fit firms**. | 25 vetted rows |
| **10:15pm–12:15am** | **Personalize.** For each of 25 firms: open site → find recent project → write `personalization_line`. Budget 4–5 min per firm. | 25 personalized rows |
| **12:15–12:45am** | **Tooling.** Install GMass + Streak. Configure pipeline. Compose email in GMass with substitution columns. | Email composed |
| **12:45–1:15am** | **QA + schedule.** Test send to self. Mail-tester score ≥9.5. Schedule for Tue 2026-05-05 7am EST. Save sheet. | Send scheduled |
| **1:15–1:45am** | **Warm-network DMs (5).** Draft 5 personalized LinkedIn DMs to warm contacts. Don't send yet — send Tuesday 9am. | 5 drafts ready |

> **Slip plan:** if behind by 11:00pm, cut to 20 firms. If behind by midnight, cut to 15 firms. Quality of personalization > volume — never compromise the opener line.

> **Parallelization tip:** if you have a second monitor/laptop, install GMass + Streak during source pass 1 (8:15–9:30pm) instead of waiting until 12:15am. Frees ~30 min at the end.

### Tomorrow morning (2026-04-30)

- 7:00–9:00am — Ship `0studio.xyz/thesis` page improvements identified in audit (add LOI CTA + Calendly + design-partner pitch on the page itself)
- 9:00–10:00am — Review scheduled email, last-minute fixes, send LinkedIn DMs to 5 warm contacts
- 10:00am+ — Plan 5 in-person Boston **drop-offs** for Wed 2026-05-06 + Thu 2026-05-07, 10am–2pm during office hours (use BSA list, pick 5 firms with offices in Back Bay / Fort Point / SoWa within 1 mile). **Reframe:** these are not cold drop-ins to "meet the principal" — they are deliveries of a printed LOI + 1-page thesis + a hand-written note to the front desk asking reception to pass to the named principal. ~5–15% convert to a follow-up email or call. Print the materials Wednesday morning before walking out.

---

## (g) Follow-up Cadence + Reply Triage

### Send-week timeline

| Date | Action |
|------|--------|
| Tue 2026-05-05 7am EST | Cold-email batch sends (40). Linkedin DMs to 5 warm contacts go out at 9am EST. |
| Tue 2026-05-05 throughout | Monitor Streak pipeline. Triage replies within 1 hour of arrival. |
| Wed 2026-05-06 | All "Tell me more" replies get a same-day response. Schedule LOI calls for Wed–Fri. |
| Wed 2026-05-06 | **Print and drop off** LOI + thesis + handwritten note at 3 Boston firms (10am–2pm). **Send Follow-up #1** to non-openers (different subject: `Re: {firm} + Rhino — quick follow-up`). |
| Thu 2026-05-07 | 2 more Boston firm drop-offs. Push for LOI signatures from soft-yes responders. |
| Fri 2026-05-08 | **Soft-yes nudge** to anyone who replied "interested" but hasn't signed yet (`{first_name} — re-attaching the LOI in case it got lost. Preview → Markup → Signature, takes 30 sec`). Re-attach `0studio-design-partner-loi.pdf`. |
| Sat–Sun 2026-05-09/10 | Triage residual replies. Personal nudges to soft-yes responders. |
| Mon 2026-05-11 | Original target was 2026-05-06 — extend by ~5 days if needed. **Send Follow-up #2** to non-repliers ("breakup email" — short, no CTA, signals you're moving on). |

### Reply triage rules

| Reply type | Response (within 1 hour during send week) |
|------------|------------------------------------------|
| "Yes, interested" | Reply within 30 min: re-attach `0studio-design-partner-loi.pdf` + Calendly link + 1-line "Open in Preview, Markup → Signature, email back. Takes 30 sec." Move to `Call Booked` in Streak. |
| "Tell me more" | One-paragraph elaboration on the thesis (re-link to 0studio.xyz/thesis). Re-attach the LOI PDF at bottom + Calendly. |
| "We use [Speckle / Dropbox / Frame.io]" | Acknowledge + 2-sentence differentiator (`.3dm-native`, `local-first`, `no SaaS lock-in for files`) + LOI offer. |
| "Not now / not a fit" | Short thank-you. Ask if you can follow up Q3 2026. Move to `Declined`. |
| "Wrong person" | Reply asking for intro to the right person. Move to `No Response` if no reply in 48h. |
| "You should talk to {Name} at {OtherFirm}" | Reply thanking them, ask if they'd be willing to make the intro by email (warm intro converts ~5× cold). Add `{OtherFirm}` to the spreadsheet as a new row tagged `referral`. |
| Auto-reply (OOO, etc.) | Mark in Streak; second touch when they're back. |
| Spam complaint / "stop emailing" | Remove immediately. Note in Streak. If 2+ complaints, **stop the campaign and review template**. |

### Follow-up email templates

**Follow-up #1 (Thursday, to non-openers)** — different subject increases re-deliverability

```
Subject: Re: {firm_name} + Rhino — quick follow-up

Hi {first_name} — wanted to bump this in case it got buried.

Three of {metro}'s parametric studios have asked about 0studio's design
partner program this week. Two have signed and returned the 1-page LOI
(re-attached here in case the original got buried).

Direct line to the founder team during development, named partner
credit, no commitment beyond expressing interest.

Worth a 15-min look? Calendly: {calendly_link}

— Colin
```

**Follow-up #2 (Monday, breakup email)** — short, low-pressure, often gets a final reply. Link to a concrete asset (90-second product Loom or a tweet thread), not the same landing page they already ignored.

```
Subject: Closing the loop on 0studio

Hi {first_name} — I'll stop bumping this thread. Last thing: a 90-second
walkthrough of how the version-control flow looks in Rhino: {loom_url}

If 0studio ever becomes relevant for {firm_name}, the door's open.

— Colin
```

> If you don't have a Loom recorded by Monday, link to a tweet thread, an architect-specific section of the landing page that's *different* from `/thesis`, or a screenshot annotated in Linear/Notion. The rule is: **a different asset from email #1**, not the same URL.

---

## Success Criteria

- **Primary:** ≥3 LOIs signed by 2026-05-11
- **Secondary:** ≥10 calls booked from 50 outreach touches (cold + warm + walk-in)
- **Health:** Mail-tester score ≥9.5/10 before send; <2 spam complaints across the campaign; no Gmail send-rate throttling

## Scope Boundaries

- No A/B testing of subject lines for this batch (volume too small to learn)
- No paid platforms (Apollo/Instantly/Smartlead) tonight
- No purchased contact lists
- No SES, no new sender domain, no PDF thesis attachment
- No public landing-page redesign — only `0studio.xyz/thesis` audit + minimal additions
- No Revit-track campaign tonight (queued for week of 2026-05-11 with separate template + sources)

## Outstanding Questions

### Resolve Before Send (Tuesday 7am EST cutoff)

- [O1, O2] Founder credibility line + warm-network list — **needed before warm DMs go out Tuesday 9am**
- [O3] Confirm `0studio.xyz/thesis` state + ship CTA additions (LOI PDF download, Calendly) to the page itself
- [O7] SPF + DKIM + DMARC verified on `0studio.xyz` — blocks deliverability if missing
- [O7] Verify SPF + DKIM + DMARC on `0studio.xyz` — blocks deliverability

### Deferred (handle during the week)

- LOI legal review by counsel — current text is conservative non-binding language with warranty/securities/reliance disclaimers, but founder may want lawyer to skim after the first 2 LOIs are signed
- Revit-track campaign next week (separate template + sources)
- Whether to expand to Chicago/LA in week 2 if Boston/NYC underperforms

## Next Steps

→ Execute (f) tonight. The playbook is the plan; no further `/ce:plan` step is needed for this operational work.
