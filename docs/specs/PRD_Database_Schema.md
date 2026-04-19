# PRD: Архитектура Базы Данных (Supabase PostgreSQL)
**Статус:** Черновик (Drafting)

## 1. Концепция
Система работает на базе **Supabase (PostgreSQL)**. Архитектура построена вокруг жесткой привязки к `project_id` для разграничения данных подрядчика (Row Level Security - RLS).

## 2. Ключевые Таблицы (Core Tables)

### 👥 Пользователи и Проекты
*   **`users`** (из Supabase Auth)
*   **`profiles`**: Расширение `users` (Роль, Имя, Название компании).
*   **`projects`**:
    *   `id` (uuid, PK)
    *   `name` (varchar) - Название проекта
    *   `contractor_id` (uuid, FK to profiles) - Владелец
    *   `status` (enum: ACTIVE, ARCHIVED)
    *   `created_at` (timestamp)

### 📁 Документооборот (מסמכי חוזה / עבודה)
*   **`documents`**:
    *   `id` (uuid, PK)
    *   `project_id` (uuid, FK)
    *   `title` (varchar)
    *   `category` (enum: CONTRACT, EXECUTION) - Жесткое разделение на Базу и Рабочие чертежи.
    *   `file_url` (varchar) - Ссылка на Supabase Storage.
    *   `version` (int) - Версионирование (для "Rev 1", "Rev 2").
    *   `ai_status` (enum: PENDING, SCANNED, ERROR) - Статус парсинга ИИ.
    *   `created_at` (timestamp)

### 🎯 Радар Противоречий (בקרת סתירות)
*   **`contradictions`**: (Только ИИ создает эти записи, пользователь может только менять статус).
    *   `id` (uuid, PK)
    *   `project_id` (uuid, FK)
    *   `title` (varchar) - Краткая суть
    *   `description` (text) - Детальное описание проблемы
    *   `strategy_advice` (text) - Коммерческий совет от ИИ
    *   `severity` (enum: HIGH, MEDIUM, LOW)
    *   `status` (enum: OPEN, IGNORED, MOVED_TO_PRICING, AUTO_RESOLVED)
    *   `source_execution_doc_id` (uuid, FK to documents) - Где нашли ошибку.
    *   `target_contract_doc_id` (uuid, FK to documents) - С чем конфликтует (правило).
    *   `related_contradiction_id` (uuid, FK) - Meta-awareness (Связь с другими карточками).

### 💰 Смета и Вариации (תמחור וחריגים - The Ledger)
*   **`pricing_ledger`**: (Главная таблица бюджета проекта).
    *   `id` (uuid, PK)
    *   `project_id` (uuid, FK)
    *   `type` (enum: BASE_CONTRACT, APPROVED_VO, PENDING_VO) - База или Хриг.
    *   `source` (enum: BOQ, DEKEL, CUSTOM_ANALYSIS) - Приоритетный источник цены.
    *   `item_code` (varchar) - Номер пункта в смете (Например: 04.2.1).
    *   `description` (text)
    *   `unit` (varchar) - Ед. изм. (м2, шт).
    *   `quantity` (decimal)
    *   `unit_price_excl_vat` (decimal) - Цена за единицу (לפני מע"מ).
    *   `total_price_excl_vat` (decimal) - Итого без НДС (quantity * unit_price_excl_vat).
    *   `vat_rate` (decimal) - Процент НДС (По умолчанию 0.18).
    *   `vat_amount` (decimal) - Сумма НДС (total_price_excl_vat * vat_rate).
    *   `total_price_incl_vat` (decimal) - Итого с НДС (כולל מע"מ).
    *   `markup_percentage` (decimal) - רווח קבלני (Процент накидки для Zero-Match).
    *   `contradiction_id` (uuid, FK, Nullable) - 1:1 Traceability: Ссылка на карточку Радара, из которой выросла эта цена.

## 3. Storage (Хранилище Файлов)
*   Баскет **`project-documents`** - оригиналы PDF, DWG, XLSX загруженные пользователем.
*   Баскет **`vo-evidence`** - сгенерированные PDF מכתבי דרישה, а также загруженные чеки/צעות מחיר для Zero-Match.

## 4. RLS (Row Level Security) Policies
*   Все CRUD операции фильтруются по `project_id`, проверяя, что `auth.uid()` принадлежит подрядчику (сопоставление через таблицу `profiles` или связь `users -> projects`).
