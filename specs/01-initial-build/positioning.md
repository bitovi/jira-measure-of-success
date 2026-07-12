# Positioning — Measure of Success

Status: **Draft** · Source: Atlassian Marketplace scan (2026-07-11), build brief §1–§2.

How we position "Measure of Success" against the existing Jira KPI/OKR landscape, and the naming/messaging decisions that follow.

---

## 1. The market splits into two camps

A scan of the Atlassian Marketplace (68 results for "OKR", 165 for "KPI" under Jira) shows two distinct, non-overlapping categories — and a gap between them that we occupy.

### Camp 1 — OKR / strategy-layer apps
Goals/objectives modeled as a **separate object** that Jira issues *link to*.

| App | Vendor | Rating | Installs | Platform | Model |
|---|---|---|---|---|---|
| **OKR Board: Strategy, Goals & KPIs** | Oboard | 4.8★ (110) | **3.1k** | Connect | "Strategy execution hub"; the category bestseller |
| **OKR for Jira** | Appfire | 4.5★ (42) | 1.2k | Connect (Cloud Fortified) | Straightforward standalone OKRs |
| **OKR and Goals for Jira & Confluence** | BOJA | 4.4★ (20) | 1.1k | **Runs on Atlassian** | Goals + Gantt roadmap |
| WorkBoard OKRs | WorkBoard | 3.3★ (8) | 189 | Connect | Enterprise OKR |
| Tability: OKRs and KPIs | Tability | — | 12 (new) | Connect | OKRs/KPIs "next to" issues |
| Profit.co, Koan, UpRaise, Dragonboat, Kendis, Neura Labs, Bazz-OKR | various | mixed | 2–685 | mixed | OKR layer / HR / PPM / AI |

**Common trait:** every one keeps objectives in a parallel model. Issues are *aligned/linked* to goals, not the goals living on the issues. This is exactly what the brief rejects (Brief §1).

### Camp 2 — KPI dashboard / chart gadgets
Metrics computed from JQL/issue data, rendered on dashboards.

| App | Vendor | Installs | Model |
|---|---|---|---|
| Great Gadgets (Agile Charts/Reports/KPIs) | StonikByte | 3.8k | Dashboard gadgets |
| Agile Charts & Gadgets | Broken Build | 1.2k | Dashboard charts |
| **ESU – Sum Up KPI & Budget** | APTIS | 1.8k | **Rolls up (sums) values as progress bars for any hierarchy** |
| Plugio Metric Cards, JQL counters, Executive KPI Reporting | various | 10–1.1k | JQL metric cards |

**Common trait:** reporting/visualization of existing metrics. No target-setting, no inheritance. Notably **ESU sums values up the hierarchy** — the double-counting the brief explicitly avoids (§2.2).

---

## 2. The gap = our wedge

No app occupies **"KPI targets that live *on the issue itself*, across the native parent hierarchy."** That is our defensible white space:

1. **Hierarchy-native — no separate object model.** KPI targets are entity properties **on the issues themselves** (Outcome→Initiative→Increment→Epic→Story), not a parallel OKR tree you link issues to and keep in sync. *(Differentiates from all of Camp 1.)*
2. **Targets authored where the work lives.** Each issue's owner sets that issue's own KPI targets in context, on the native hierarchy — no separate planning surface, no duplication. *(Camp 1 makes you leave the issue for a goals app.)*
3. **Rolled-up / relative target dates.** Target dates resolve from a configurable per-level due-date rollup (the Timeline engine, extensible to sprint dates). *(Nobody in either camp does this.)*

> **Explored but NOT adopted:** value *inheritance* (children copying a parent's target) and *contribution/coverage* (summing children toward a parent). Both were prototyped ([coverage.html](../00-mocks/coverage.html), [kpi-timeline-v3.html](../00-mocks/kpi-timeline-v3.html)) and set aside — inheriting the same number down overstates the child, and summing across issues breaks on **distinct metrics + unit mismatches** (e.g. departmental revenue). See requirements §8-Q11.

## 3. Platform / trust advantage

We build on **Forge → "Runs on Atlassian"** (data never leaves Atlassian; path to **Cloud Fortified**). The category bestseller, **Oboard, is a Connect app**. Enterprises increasingly filter the Marketplace for "Runs on Atlassian" / data-residency guarantees — a concrete trust badge the category leader can't claim. Lead with it.

## 4. Naming & messaging

- **The "OKR" keyword is saturated** — high search volume, but entering as the 20th "OKR for Jira" invites a feature-parity fight against Oboard/Appfire on their turf (breadth), which we'd lose.
- Our wedge is **hierarchy-native KPIs/metrics on issues**, not objectives. Branding around **"KPI"** is less contested and truthful to what we do. It also fits the product name **"Measure of Success."**
- **Decision (resolves requirements §8-Q1):** user-facing term is **"KPI"**, not "Measurement." Keep internal identifiers `kpi*` (already the case in code/storage); no presentation mapping needed. Update the mocks' "Measurement" wording to "KPI." *(If jargon becomes a concern, "Metric" is the fallback — never "Measurement," which collides with the recorded values users take.)*
- **Discoverability:** still include "OKR", "goals", "strategy", "measurement" in the listing description/keywords for search, while the headline and UI say KPI.

### Positioning statement (draft)
> **Measure of Success** puts KPI targets **directly on your Jira issues**, across your existing hierarchy — no separate OKR object to maintain, no linking. Runs entirely on Atlassian.

## 5. Risks to weigh

- **The core idea is subtle to explain** in a listing ("KPI targets on the issue, across the hierarchy"). The **timeline visualization is the hook** — lead the listing with it.
- **Premium-hierarchy dependency.** The custom Outcome/Initiative/Increment levels need Jira Premium (Advanced Roadmaps), narrowing the market to portfolio-scale Jira customers. Frame as a deliberate segment ("built for portfolio-scale Jira"), not a limitation.
- **Crowded category optics.** Many 0-install newcomers; differentiation messaging (the wedge points above) must be crisp and up front.

## 6. Sources
Atlassian Marketplace searches (Jira): [OKR](https://marketplace.atlassian.com/search?query=OKR&product=jira) · [KPI](https://marketplace.atlassian.com/search?query=KPI&product=jira). Install/rating figures as of 2026-07-11; treat as directional.
