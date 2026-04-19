-- Исправление критической ошибки: НДС (מע"מ) по умолчанию должен быть 18% (0.18), а не 17% (0.17)
-- Источники: PRD_Database_Schema.md, PRD_Pricing_and_VO.md, business-logic-rules.md, project-rules.md
-- Все документы и правила единогласно указывают: НДС = 18% (ולא 17%)

-- 1. Изменяем значение по умолчанию для новых записей
ALTER TABLE pricing_ledger ALTER COLUMN vat_rate SET DEFAULT 0.18;

-- 2. Исправляем все существующие записи с ошибочным НДС 17%
-- GENERATED ALWAYS колонки (vat_amount, total_price_incl_vat) пересчитаются автоматически
UPDATE pricing_ledger SET vat_rate = 0.18 WHERE vat_rate = 0.17;
