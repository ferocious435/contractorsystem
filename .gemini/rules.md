# AI MODEL CONFIGURATION & ROUTING TABLE

## 1. Актуальные модели
- **Основная модель (Default/Fast):** `gemini-3-flash-preview`
- **Модель для сложной аналитики (Deep Analysis):** `gemini-3-flash-preview` (оптимизирована для Lawyer Mode и защиты интересов подрядчика).
- **OCR и парсинг документов:** `gemini-3-flash-preview`

## 2. Routing Table
- **Scan/OCR:** -> `gemini-3-flash-preview`
- **Contradiction Analysis:** -> `gemini-3-flash-preview`
- **Pricing Estimation:** -> `gemini-3-flash-preview`
- **PDF/Letter Generation:** -> `gemini-3-flash-preview`

## 3. Инструкции для Агентов
- ЗАПРЕЩЕНО упоминать названия и версии моделей в ответах пользователю, если это не касается исправления ошибок конфигурации.
- Агенты должны использовать эти модели "под капотом" автоматически.
- Все системные промпты должны быть настроены на высокую производительность и экономию токенов через Flash.
