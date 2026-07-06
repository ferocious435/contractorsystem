-- Allow variation-order pricing rows to explicitly trace Ministry of Housing pricelist prices.

ALTER TYPE ledger_item_source ADD VALUE IF NOT EXISTS 'HOUSING_MINISTRY';
