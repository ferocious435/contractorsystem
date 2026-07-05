# Codex Continuity: ContractorSystem

## Current Operating Mode

ContractorSystem is now maintained from Codex in this repository folder. Old AntiGravity files are not an active source of project rules.

## Active Product Standard

- Chat with the user: Russian.
- UI language: Hebrew only, RTL.
- Financial storage: base amounts are stored without VAT.
- VAT: 18%.
- AI model standard: all Gemini calls go through `src/lib/gemini.ts` and use `gemini-3.5-flash`; lightweight tasks may use `gemini-3.1-flash-lite`, with `gemini-2.5-flash` as fallback.

## Current Completion Focus

1. Pricing Ledger: keep calculations pre-VAT in storage, show VAT separately, preserve evidence and AI rationale.
2. Contradiction Radar: produce practical contradiction cards with source-backed evidence markers.
3. Evidence Linkage: no confident claim without a source link or an explicit "requires verification" state.
4. Zero Match: explain missing matches, provide editable analysis, confidence, and needed evidence without inventing certainty.

## Known Transition Notes

- Old AntiGravity artifacts and the root `skills` reparse point are not part of the active project rules.
- Active agent guidance is kept in `AGENTS.md`; active product standards are kept in `GEMINI.md` and `docs/specs/`.
