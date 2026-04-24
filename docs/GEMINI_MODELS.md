# Стандарт моделей Gemini API для проекта ContractorSystem

> **КРИТИЧЕСКОЕ ПРАВИЛО:** Перед изменением модели — ОБЯЗАТЕЛЬНО проверить через API,
> а не угадывать. Скрипт проверки: `scratch/list_all_models.ts`

## Текущая конфигурация (Апрель 2026)

| Назначение | Модель API | Отображение в UI |
|---|---|---|
| Все задачи (Radar, Chat, Parse, Letter, OCR) | `gemini-2.5-flash` | Gemini 2.5 Flash |

**Централизованный конфиг:** `src/lib/gemini.ts` → `GEMINI_CONFIG.STABLE_FLASH`

## Модели, ВЫВЕДЕННЫЕ из использования (НЕ ИСПОЛЬЗОВАТЬ!)

| Модель | Статус | Дата проверки |
|---|---|---|
| `gemini-1.5-pro` | ❌ 404 Not Found | 2026-04-24 |
| `gemini-1.5-flash` | ❌ 404 Not Found | 2026-04-24 |
| `gemini-2.0-flash` | ❌ Выведен из использования (יצא משימוש) | 2026-04-24 |
| `gemini-2.0-flash-lite` | ❌ Выведен из использования | 2026-04-24 |
| `gemini-2.0-flash-exp` | ❌ 404 Not Found | 2026-04-24 |

## Доступные стабильные модели (по данным API)

| Модель | Описание |
|---|---|
| `gemini-2.5-flash` | ✅ Стабильная, до 1M токенов |
| `gemini-2.5-pro` | ✅ Стабильная, для сложных задач |
| `gemini-2.5-flash-lite` | ✅ Легкая версия |
| `gemini-3-flash-preview` | 🔶 Preview |
| `gemini-3-pro-preview` | 🔶 Preview |
| `gemini-3.1-pro-preview` | 🔶 Preview |

## Правила обновления модели

1. **НЕ УГАДЫВАТЬ** — всегда запускать `npx tsx scratch/list_all_models.ts`
2. Обновлять **ТОЛЬКО** `GEMINI_CONFIG.STABLE_FLASH` в `src/lib/gemini.ts`
3. Обновлять UI-бейджи во всех компонентах (`grep -r "Powered by Gemini"`)
4. Обновлять этот файл (`docs/GEMINI_MODELS.md`)
