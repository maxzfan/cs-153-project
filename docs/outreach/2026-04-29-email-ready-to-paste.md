# GMass-Ready Email — Copy/Paste

When you click the GMass red button in Gmail, paste these directly. The `{slot}` syntax matches your spreadsheet column headers exactly.

**Spreadsheet column headers GMass needs:** `first_name`, `firm_name`, `personalization_line`, `calendly_link`, `founder_credibility_line`. (Note: the spreadsheet currently has `firm` — rename it to `firm_name` to match the template, or change `{firm_name}` → `{firm}` in the template body.)

---

## Subject

```
{firm_name} + Rhino versioning?
```

## Body (plain text)

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
Boston · MIT B.Arch · 0studio.xyz

Ostudio Inc. · 97 Bay State Rd, Boston, MA · Reply STOP if you'd
like me to remove you from this list.
```

## PDF attachment

Attach `0studio-design-partner-loi.pdf` (≤200KB, generated per `2026-04-29-loi-text.md`) using the Gmail compose paperclip icon. GMass will broadcast the same PDF to all 25 recipients in personalized one-by-one mode.

Verify in GMass settings: **Attachments → "Attach the same file to all messages"** (default). Don't pick "Per-recipient attachments" — that requires a separate column in the spreadsheet.

## GMass settings to verify before scheduling

- **Send mode:** "Personalized one-by-one" (default — confirms each email is sent individually, not BCC)
- **Schedule:** Tue 2026-05-05, 7:00am EST
- **Throttle:** 5-minute delay between sends (GMass advanced settings → "Delay between emails")
- **Tracking:** Open ON, Click OFF (URL rewriting hurts deliverability more than it helps)
- **Reply detection:** ON (so signed-PDF replies surface in Streak's "Replied" pipeline stage)
- **Threading:** "Each email a new thread" (so replies don't merge incorrectly)
- **Attachments:** Attach `0studio-design-partner-loi.pdf` to all messages

## Pre-send QA checklist

- [ ] Test send to your personal Gmail using GMass "Test send to me" — verify rendering on phone + desktop
- [ ] Open the test on your phone — confirm the PDF attachment is openable in Mail Markup and the signature line is visible
- [ ] Open the test on Mac — confirm the PDF opens in Preview and `Markup → Signature` works on the signature line
- [ ] Click the Calendly link — confirm it loads and shows availability
- [ ] Click the thesis link — confirm `0studio.xyz/thesis` loads in browser AND the Gmail link preview shows the OG image (not a broken image)
- [ ] Run the email body (text only, no attachment) through `mail-tester.com` — target ≥9.5/10
- [ ] Run the email body **with attachment** through `mail-tester.com` separately — attachments lower the score; target ≥8.5/10. If below 7, troubleshoot before scheduling
- [ ] Spot-check 3 random spreadsheet rows for: correct first_name, firm_name with no typos, personalization_line that actually reads natural
- [ ] Confirm `{founder_credibility_line}` is filled in spreadsheet (same value for every row: `Boston · MIT B.Arch · 0studio.xyz`)
- [ ] Confirm `{calendly_link}` is filled in spreadsheet (same value for every row: `https://calendly.com/colinikkim/0studio-intro`)
