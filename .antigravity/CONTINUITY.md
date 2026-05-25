# Historical AntiGravity Continuity: ContractorSystem

> Historical note: this file came from the previous AntiGravity workflow.
> Current Codex work should follow root `CONTINUITY.md`, `GEMINI.md`, `AGENTS.md`, and `docs/specs/`.

## Текущая цель

Завершение системы Contradiction Radar и Pricing Ledger в строгом соответствии с PRD и финансовыми стандартами Израиля (VAT 18%, суммы без НДС в БД).

## Статус проекта

- **AI Models:** historical note was `gemini-2.5-flash`; current project standard is `gemini-3-flash-preview` via `src/lib/gemini.ts`.
- **UI:** Темная тема, Glassmorphism, RTL (Hebrew).
- **Architecture:** Next.js + Supabase.

## Mistakes & Learnings

- *Mistake:* Повторяющееся использование Gemini 1.5 Flash вопреки жалобам пользователя. Исправлено через централизацию в `src/lib/gemini.ts`.
- *Learning:* Всегда проверять актуальные модели через API, а не полагаться на старые доки.

## Активный Track: Финансовая точность и Радар

1. [ ] Аудит `PRD_Pricing_and_VO.md` vs Текущий код.
2. [ ] Проверка логики НДС (18%) во всех расчетах.
3. [ ] Реализация "Zero Match" стратегии (оценка ИИ при отсутствии данных в контракте).
4. [ ] Финализация Evidence Linkage (визуальные маркеры [1] и [2]).
