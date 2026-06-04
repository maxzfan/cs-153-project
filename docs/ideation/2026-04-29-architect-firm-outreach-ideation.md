---
date: 2026-04-29
topic: architect-firm-outreach
focus: Source Boston/NYC architecture firms and secure Letters of Intent within one week; emails ready tonight
---

# Ideation: Boston + NYC Architect-Firm Outreach for LOIs This Week

## Codebase / Product Context

- **Product**: 0studio — desktop Electron app, version control for Rhino `.3dm` files. ICP is parametric/computational architects who iterate on `.3dm` files (Rhino + Grasshopper users).
- **Architect-facing thesis**: Hosted as a section on the 0studio website (link, not attachment).
- **Email infrastructure**: Backend uses Amazon SES for transactional emails (project invites, weekly founder digest). SES sandbox cap = 200/day. **Cold outreach from product domain `0studio.com` would risk transactional sender reputation** — so user is sending from personal Gmail/Google Workspace instead.
- **Sending decision (locked)**: Gmail/Google Workspace, 30–50 hand-picked firms, thesis hosted on website (link).
- **Constraint**: LOIs needed within one week; user wants emails ready by tonight.
- **Founder network signal (inferred)**: Boston-based, likely with ties to GSD/MIT/peer architecture-school networks based on product positioning.

## Ranked Ideas

### 1. Reframe to a 40/5/5 Outreach Mix (Cold + Warm + In-Person)
**Description:** Don't run a single 50-cold-email motion. Instead split the week's outreach: 40 cold emails (Gmail + GMass), 5 warm LinkedIn DMs to founder's MIT/GSD/Harvard/peer network, 5 in-person Boston walk-ins or coffee asks Thursday/Friday.
**Rationale:** Cold-email reply rate to architects is 1–3% — 50 emails alone yields ~0.5–1.5 replies, ~0–1 LOIs. Adding 5 warm-network DMs (10–30% reply) and 5 in-person walk-ins (high LOI conversion when geography matches) shifts expected LOIs from ~1 to ~3+. User is in Boston — in-person leverage is free.
**Downsides:** Splits tonight's focus across three motions. Demands the founder have a real warm list ready.
**Confidence:** 90%
**Complexity:** Low
**Status:** Explored

### 2. Source from BSA + AIANY + Architizer + GSAPP/GSD Alumni — Pre-filtered by "Uses Rhino"
**Description:** Skip generic LinkedIn Sales Navigator and Apollo scrapes. Use four sources: Boston Society of Architects (AIA Boston) member directory, AIA New York directory, Architizer firm profiles tagged Boston/NYC + parametric/computational, and GSAPP+GSD alumni who founded firms (5–50 person size). Pre-filter every candidate firm by checking their portfolio site for Grasshopper/parametric/computational/Rhino mentions; drop those without that signal.
**Rationale:** ICP is "architects who keep `.3dm` files and iterate on them" — i.e., parametric/computational practices and small-mid Rhino-native studios. Pre-filtering shrinks the list from "200 mediocre fits" to "30–50 perfect fits" with 5–10× the reply rate.
**Downsides:** ~1.5 hours of manual vetting tonight.
**Confidence:** 85%
**Complexity:** Low
**Status:** Explored

### 3. 4-Sentence Plain-Text Email with Named-Design-Partner Hook
**Description:** Subject: `{FirmName} + Rhino versioning?`. Body in 4 sentences plain text:
> Hi {Name} — saw {SpecificProjectFromTheirSite}, beautiful work.
>
> Quick question: how does {FirmName} currently track .3dm versions when you're iterating on a model? I'm building 0studio, a version-control tool purpose-built for Rhino files (architect-facing thesis: 0studio.com/architects).
>
> We're signing 5 design-partner firms in Boston/NYC this week — first year free, named partner credit at launch, 1-page non-binding LOI.
>
> Would 15 min next week work? — Inky

**Rationale:** Plain text > HTML for deliverability. 4 sentences read in 10 seconds. Named-design-partner status + free-year is the only hook strong enough to make a stranger sign an LOI for an unbuilt product. The opener referencing a real project separates this from spam.
**Downsides:** Manual project-line lookup per firm (~2 min × 50 = ~90 min).
**Confidence:** 85%
**Complexity:** Low
**Status:** Explored

### 4. Pre-write 1-Page LOI PDF + Self-Serve Signing Link Before Sourcing
**Description:** Half-page non-binding LOI: "I, {Name} of {Firm}, express interest in being a design partner for 0studio (3D version control for Rhino) at no cost for year 1, with named-partner credit at launch." Sign line at the bottom. Drop into PandaDoc/HelloSign free tier with a self-serve link. Build before any scraping starts tonight.
**Rationale:** Without this asset ready, every "yes" reply hits friction — "send me a doc" → 3-day delay → cold. With it ready, the CTA on a positive reply becomes "sign here, 30 seconds." This is what gets LOIs *this* week vs. next month.
**Downsides:** ~45 min to draft + set up. Easy to skip in the rush; costs the week if skipped.
**Confidence:** 95%
**Complexity:** Low
**Status:** Explored

### 5. Schedule Send for Tuesday 7am EST — Not Tonight
**Description:** Use Gmail's "Schedule send" → Tuesday 2026-05-05 7am EST for all 40 cold emails. Use tonight to source + write personalizations + draft LOI + set up tooling.
**Rationale:** Tuesday 7–9am EST has roughly 2× the B2B open rate of late evening sends. Sending at 11pm tonight buries the email under their morning-inbox flood. The "tonight" deadline in the original prompt was about *getting it ready*, not making inboxes ping. This single tweak roughly doubles reply count for free.
**Downsides:** None material. If anything, an extra day to refine personalization lines.
**Confidence:** 95%
**Complexity:** Trivial
**Status:** Explored

### 6. Tooling Stack Tonight: Google Sheet + GMass + Streak
**Description:** Google Sheet with columns: `firm`, `name`, `email`, `recent_project`, `personalization_line`, `sent`, `opened`, `replied`, `outcome`. GMass Gmail extension ($25/mo, free trial works tonight) for templated mail merge with `{personalization_line}` substitution. Streak CRM (free Gmail extension) for reply tracking + simple pipeline view.
**Rationale:** Total setup ~30 min, total cost <$30. GMass sends from your Gmail one-by-one (looks 1:1, not bulk), respects Gmail's daily limits, substitutes per-row personalization. Streak gives "did they reply?" pipeline visibility without a separate CRM.
**Downsides:** GMass adds tracking pixel by default — turn off for deliverability, accept lower visibility, OR keep on and accept marginal deliverability hit.
**Confidence:** 80%
**Complexity:** Low
**Status:** Explored

### 7. Audit/Add a Design-Partner CTA on `0studio.com/architects` Tonight
**Description:** Audit the architect-facing landing section. Confirm it has a single visible CTA for "become a design partner" with Calendly link + LOI signing link. If not, ship that tonight (Vite/React stack supports a quick subpage like `/architects-partner` if the main `/architects` page is consumer-toned).
**Rationale:** The email links to this URL. If recipients hit a generic product page they bounce. If they hit a page explicitly addressed to Boston/NYC architects with the design-partner offer + signing flow, conversion-to-LOI rises sharply.
**Downsides:** ~1 hour of work tonight. Sequence as last priority — only after sourcing + LOI + email template + tooling are ready.
**Confidence:** 75%
**Complexity:** Low–Medium
**Status:** Explored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Buy a fresh cold-outreach domain tonight | Moot — sender is Gmail, not custom domain |
| 2 | SES blast from `0studio.com` | Burns transactional reputation; SES sandbox cap; user picked Gmail |
| 3 | 500+ firm mass blast | User picked 30–50; deliverability tonight would be poor regardless |
| 4 | Attach thesis as PDF | Hosted on website; linking is better deliverability + analytics |
| 5 | Apollo/Lusha/Hunter purchased lists | Lower reply rate than hand-sourced ICP-fit list; setup tax tonight |
| 6 | Public license board scrapes (NY State Ed Dept, MA Board) | Yields names but no Rhino-fit signal; subsumed by #2 |
| 7 | LinkedIn Sales Navigator generic search | Lower fit than BSA/AIANY/Architizer pre-filtered list |
| 8 | Loom/voice-memo personalization in first email | Doesn't scale to 40 tonight; reserve for replies |
| 9 | Full LLM-generated email body | Reads as slop; hand-craft first line wins |
| 10 | Two-email sequence (question email first, pitch second) | Eats the week — incompatible with LOI-in-5-days goal |
| 11 | Twitter/IG DMs to Rhino-posting architects | Good idea but small volume; secondary motion only |
| 12 | Phone calls to AIA chapter offices | Slow, not parallelizable tonight |
| 13 | Paid platforms (Instantly, Smartlead, Mailshake, Lemlist) | Overkill at 50 volume + setup tax tonight |
| 14 | GitHub stargazers of rhino3dm | Engineer-fit, not architect-fit |
| 15 | Houzz / Yelp small firms | Residential-heavy, not Rhino-native ICP |
| 16 | Building permit data scrapes | Names architect-of-record but slow + low fit |

## Critical Reframes

Two of the surviving ideas push back on the original 3-step plan as worded:

- **#1 reframes step 1** ("source 50 firms"): Pure cold blast at this volume is unlikely to produce LOIs in a week. Add warm DMs + in-person walk-ins.
- **#5 reframes step 3** ("send tonight"): Use tonight to *prepare*, not to *send*. Schedule for Tuesday 2026-05-05 7am EST — roughly doubles open rate at zero cost.

## Session Log
- 2026-04-29: Initial ideation — 35+ raw ideas across 4 frames (sourcing, email template, send mechanics, adversarial reframe), 7 survived adversarial filtering. All 7 marked Explored as the user opted to brainstorm a full execution playbook combining the survivors.
