# Kunoch Command — Review & Recommendations
**Date:** 2026-08-15 · **Version reviewed:** V3.1 (commit 8138c62)

---

## Executive Summary

Kunoch Command is a sophisticated single-file advisory app that punches above its weight. The design system is cohesive, the agent architecture is well-thought-out, and the PDF export is investor-grade. After reviewing against design, functionality, user flow, and output quality, I've identified **12 improvements** — 4 quick wins, 4 medium lifts, and 4 strategic enhancements. None require backend work (all frontend).

---

## 1. DESIGN

### What's working
- Dark-gold palette is distinctive and on-brand for a family office
- Typography hierarchy (Playfair → DM Mono → DM Sans) is refined
- Agent color coding (cfo=emerald, legal=red, ma=purple, etc.) is instantly scannable
- PDF export has proper letterhead and print formatting

### Recommendations

| Priority | Issue | Fix |
|---|---|---|
| **Quick** | Sidebar scrollbar is 3px wide — invisible on some screens | Make it 5px with `--gold-dim` thumb |
| **Quick** | Agent cards have no hover lift — feel static | Add `translateY(-2px)` + subtle shadow on hover |
| **Quick** | The "PROCESSING..." spinner uses `◌` which is faint | Replace with a CSS spinner or pulse animation |
| **Medium** | No empty state illustration for first-time users | Add a warm onboarding panel ("Fredrick is ready...") when history is empty and no API key is set |
| **Medium** | Agent roster dots are 7px — hard to see status changes | Make them 9px with a pulse animation when active |
| **Medium** | The synthesis card gradient (`var(--gold-glow)`) is barely visible | Either deepen it or remove it — subtle is good, invisible is wasted |

---

## 2. FUNCTIONALITY

### What's working
- File upload handles 9 formats including images (impressive for a browser app)
- Retry per-agent is robust
- History with cap-8 and quota-safe writes is production-grade
- Export/import without API key leakage is correct

### Recommendations

| Priority | Issue | Fix |
|---|---|---|
| **Quick** | `⌘ + ENTER TO RUN` hint only shows on Mac — Windows users see a Mac symbol | Detect platform, show `Ctrl + Enter` on Windows/Linux |
| **Quick** | `confirm()` in `importData()` is a native browser dialog — breaks the dark theme spell | Replace with an in-app confirmation sheet (same pattern as the-post-room's ConfirmSheet) |
| **Medium** | No auto-save of the directive textarea — if the tab closes, the draft is lost | Save `kc_draft` to localStorage on input debounce (300ms) |
| **Medium** | The API key panel slides open but has no `Escape` to close | Add Escape key handler for the API panel and business menu |
| **Medium** | Business profile modal has no keyboard trap — Tab escapes to the background | Add focus trap + Escape close to the modal |
| **Strategic** | No offline indicator — if the user loses connection mid-run, there's no feedback | Add a small connection status dot in the sidebar that turns red when offline |

---

## 3. USER FLOW

### Current flow
1. Open app → see sidebar + empty main area
2. (First time) Set API key → hidden in sidebar footer
3. Select business from dropdown
4. Type directive → click RUN
5. Wait for Fredrick plan → agents run → outputs appear
6. Read synthesis → export PDF/copy

### Friction points

| Priority | Issue | Fix |
|---|---|---|
| **Quick** | First-run experience is cold — empty history, no directive, API key hidden | Show a "Get Started" state: "1. Set your API key → 2. Select a business → 3. Issue your first directive" with inline buttons |
| **Medium** | No progress indicator during the staggered dispatch (600ms apart) | Show a thin progress bar or step dots (Fredrick → 7 agents) so the user knows something is happening |
| **Medium** | After a run completes, the page is very long — no way to jump back to the directive | Add a "Back to top" floating button or sticky directive summary |
| **Strategic** | No way to compare runs side-by-side | Add a "Compare" mode in history that opens two runs in a split view |
| **Strategic** | The directive textarea is small for complex multi-paragraph directives | Add a "Fullscreen" expand button that opens the textarea in a focused overlay |

---

## 4. OUTPUTS

### What's working
- Markdown rendering is clean with proper hierarchy
- Agent briefs are collapsible (good for scanning)
- PDF export is genuinely board-ready — letterhead, date, business name, attachments list
- Synthesis is visually distinguished with gold accent

### Recommendations

| Priority | Issue | Fix |
|---|---|---|
| **Quick** | Agent outputs have no timestamp — when reviewing history, you can't tell when each agent finished | Add a "Completed at HH:MM" micro-text in each card footer |
| **Quick** | The synthesis doesn't show which agents contributed (only tags at bottom) | Add a "Contributing Agents" line at the top of the synthesis |
| **Medium** | PDF doesn't include the business profile/context that was injected | Add a "Context Injected" appendix page with the business snapshot |
| **Medium** | No word/token count visible — hard to gauge output length vs. API cost | Show a "~X words · ~Y tokens" micro-label on each agent card and the synthesis |
| **Strategic** | No way to flag/star specific outputs for follow-up | Add a star/flag button to each agent card that persists in history |

---

## Priority Matrix

### Phase A — Quick Wins (no new components, 1-2 lines each)
1. Platform-aware run hint (⌘ vs Ctrl)
2. Better processing spinner
3. Agent dot size + pulse
4. Synthesis gradient fix
5. Escape-to-close API panel & menu
6. Import confirm() → in-app sheet

### Phase B — Medium Lifts (new small components, localStorage)
7. Directive auto-save (kc_draft)
8. First-run onboarding state
9. Progress indicator during dispatch
10. Modal focus trap + keyboard
11. Agent completion timestamps
12. Contributing agents in synthesis

### Phase C — Strategic (new UX patterns)
13. Offline indicator
14. Run comparison mode
15. Fullscreen directive editor
16. PDF context appendix
17. Word/token counts
18. Star/flag outputs

---

## Recommendation

**Start with Phase A (quick wins) + Phase B items 7-10** — these remove the most friction without architectural changes. The app will feel significantly more polished. Then tackle Phase B items 11-12 and Phase C based on how you use it day-to-day.
