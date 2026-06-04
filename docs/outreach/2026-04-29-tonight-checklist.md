# Tonight Checklist — 2026-04-29

Print or open in a separate window. Check off as you go. Slip plan: cut firm count if behind, never cut personalization quality.

## 7:00–7:30pm — LOI prep + DNS verification

- [x] Open `docs/outreach/2026-04-29-loi-text.md`, copy LOI text (including the "TO SIGN" instructions block) into a new Google Doc
- [x] Doc settings: US Letter, 1" margins, Times New Roman 11pt
- [x] Save Doc as "0studio Design Partner LOI 2026-05"
- [x] Verify SPF + DKIM + DMARC on `0studio.xyz`: open Google Workspace admin → Apps → Google Workspace → Gmail → Authenticate email — confirm all three are green. If not, fix tonight (15 min)
- [x] Verify Ostudio Inc. registration documents are accessible (will need entity name verification at signing)

## 7:30–8:00pm — PDF generation (replaces PandaDoc — both PandaDoc and SignWell paywall public-link signing)

- [ ] In Google Doc → File → Download → **PDF Document (.pdf)**
- [ ] Save to Desktop or `~/0studio/loi/` as `0studio-design-partner-loi.pdf` (this exact filename — no underscores, no version markers, spam-filter friendly)
- [ ] Verify file size ≤200KB (smaller PDFs trigger fewer spam filters). If over, compress at `https://www.ilovepdf.com/compress_pdf`
- [ ] Open the PDF in Preview yourself once. Confirm: signature/name/title/firm fields are blank lines clearly visible; Markup → Signature tool can place a signature on the Signed line; PDF is NOT password-protected or read-only
- [ ] Update spreadsheet: rename `loi_link` column header → `pdf_received_at` (already done in CSV, verify in Google Sheet too)

## 8:00–8:15pm — Thesis page audit (HARD STOP at 15 min)

- [x] Open `0studio.xyz/thesis` in private browser window — view as a stranger would
- [x] Visible architect-facing first-fold message? If no → write notes in `docs/outreach/thesis-fixes-needed.md`
- [x] Visible "design partner" CTA + LOI signing link on the page? If no → add to fix list
- [x] Visible Calendly link/booking? If no → add to fix list
- [ ] **CRITICAL:** Open Gmail/Slack and paste `https://www.0studio.xyz/thesis` — does the link preview show a real OG image or a broken/placeholder image? If broken → ship a 1200×630 OG image to `/og-image.png` in your morning block tomorrow
- [x] Don't fix tonight unless trivial — defer rebuild to 7am tomorrow

## 8:15–9:30pm — Source pass 1 (BSA + AIANY + Architizer)

- [ ] Open `docs/outreach/2026-04-29-source-list.csv` in Google Sheets (File → Import → drop CSV)
- [ ] Save as Google Sheet `Architect Outreach 2026-W19`. Freeze row 1.
- [ ] BSA member directory: `https://www.architects.org/directory` → add ~15 Boston firms (firm name + URL only — emails come later from firm websites)
- [ ] AIANY find-an-architect: `https://www.aiany.org/membership/find-an-architect/` → add ~15 NYC firms (firm name + URL only)
- [ ] Architizer Boston firms `https://architizer.com/firms/?location=Boston` → add ~10 with parametric/computational signal
- [ ] Architizer NYC firms `https://architizer.com/firms/?location=New York` → add ~10 with parametric/computational signal
- [ ] **Don't fill emails yet** — emails get pulled in the personalization pass from each firm's website Contact page

## 9:30–10:00pm — Source pass 2 (GSD + GSAPP + MIT alumni)

- [ ] LinkedIn search: `"GSD" "principal" "Boston" OR "New York"` → add 5–10 firms
- [ ] LinkedIn search: `"GSAPP" "principal" "New York"` → add 5–10 firms
- [ ] Optional: `"MIT" "B.Arch" "principal"` → 2–3 personal-network adjacencies
- [ ] Background research agent's results should also be in by now — append those rows

## 10:00–10:15pm — Hard cut to 25

- [ ] Apply vetting checklist from playbook section (b)
  - Office in Boston metro OR NYC metro
  - Firm size 5–50
  - Portfolio mentions Rhino/Grasshopper/parametric/computational signal
  - Active website with a 12-mo recent project
  - Principal name + email discoverable
- [ ] Drop rows that fail any check. **Target: exactly 25.** If you have 30+ that pass, drop the weakest 5 — narrow ICP wins.

## 10:15pm–12:15am — Personalize 25 rows (4–5 min each)

For each of 25 firms:

- [ ] Open firm website → Contact or Team page → grab principal name + email (or use Hunter.io if not visible)
- [ ] Open Projects page → identify ONE recent project (last 12–24 months preferred)
- [ ] Write `personalization_line` that's specific to that project. Examples (from your starter list):
  - `saw the Sean Collier Memorial — that ruled-surface granite assembly holds up beautifully years later.`
  - `appreciated the residential work in Roxbury — small-firm rigor on tight sites.`
- [ ] Avoid: "love your work", "saw your portfolio", "your projects are amazing", or anything you'd send to 5 firms unchanged

## 12:15–12:45am — GMass + Streak setup

- [ ] Install GMass extension from Chrome Web Store
- [ ] Sign in with `founders@0studio.xyz` (after Workspace admin trust step from gmass setup walkthrough)
- [ ] Settings: Open tracking ON, Click tracking OFF, 5-min delay between sends, Attachments = "Attach the same file to all messages"
- [ ] Install Streak extension; create pipeline `Architect Outreach`; stages: Sent → Opened → Replied → Call Booked → LOI Signed → Declined → No Response
- [ ] In Gmail, click red GMass button → connect to Sheet → paste subject + body from `docs/outreach/2026-04-29-email-ready-to-paste.md`
- [ ] Attach `0studio-design-partner-loi.pdf` via Gmail's standard paperclip icon

## 12:45–1:15am — QA + schedule

- [ ] GMass "Test send to me" → check on phone + desktop
- [ ] On phone: open PDF attachment → confirm Mail Markup signature tool works on the Signed line
- [ ] On Mac: open PDF in Preview → confirm Markup → Signature works on the Signed line
- [ ] Click Calendly link → confirm
- [ ] Click thesis link → confirm rendering + Gmail link preview shows real (not broken) OG image
- [ ] Mail-tester.com (text only): score ≥9.5/10
- [ ] Mail-tester.com (with PDF attachment): score ≥8.5/10 (attachments lower the score)
- [ ] Schedule send: Tue 2026-05-05, 7:00am EST
- [ ] Save spreadsheet, double-confirm scheduled time before closing GMass

## 1:15–1:45am — Warm-network DM drafts

- [ ] Open `docs/outreach/2026-04-29-warm-dm-template.md`
- [ ] Identify 5 warm-network architects (LinkedIn URLs)
- [ ] Draft 5 personalized DMs in a Google Doc (don't send yet — send Tuesday 9am EST after cold-email batch starts)

## Wake up Tuesday morning

- [ ] 6:55am EST: open Gmail, confirm GMass scheduled batch is queued
- [ ] 7:00–9:00am EST: monitor send. Watch inbox for any "unusual activity" warning from Google. If one appears → pause GMass immediately
- [ ] 9:00am EST: send 5 warm-network LinkedIn DMs (one at a time, ~5 min apart)
- [ ] 9:00–11:00am EST: triage replies as they come in (within 1 hour per playbook section g)

---

> Slip plan: at 11pm cut to 20 firms. At midnight cut to 15. **Quality of personalization > volume.**
