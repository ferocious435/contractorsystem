-- Keep Pricing Ledger as pre-VAT source data only.
-- VAT and gross totals are calculated in application helpers and VO letter rows,
-- not stored as generated columns on pricing_ledger.

ALTER TABLE public.pricing_ledger
  DROP COLUMN IF EXISTS vat_amount,
  DROP COLUMN IF EXISTS total_price_incl_vat;
