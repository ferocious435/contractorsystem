# Codex Continuity: ContractorSystem

## Current Operating Mode

ContractorSystem is now maintained from Codex in this repository folder. AntiGravity files are treated as historical context unless they conflict with `GEMINI.md`, `AGENTS.md`, or the PRD files in `docs/specs/`.

## Active Product Standard

- Chat with the user: Russian.
- UI language: Hebrew only, RTL.
- Financial storage: base amounts are stored without VAT.
- VAT: 18%.
- AI model standard: all Gemini calls go through `src/lib/gemini.ts` and use `gemini-3-flash-preview` unless a newer project standard explicitly replaces it.

## Current Completion Focus

1. Pricing Ledger: keep calculations pre-VAT in storage, show VAT separately, preserve evidence and AI rationale.
2. Contradiction Radar: produce practical contradiction cards with source-backed evidence markers.
3. Evidence Linkage: no confident claim without a source link or an explicit "requires verification" state.
4. Zero Match: explain missing matches, provide editable analysis, confidence, and needed evidence without inventing certainty.

## Known Transition Notes

- `.antigravity/CONTINUITY.md` still mentions `gemini-2.5-flash`; that is historical and superseded by `GEMINI.md`.
- The root `skills` reparse-point file cannot be indexed by Git on this Windows workspace and should be handled separately if a future task cleans AntiGravity artifacts.
