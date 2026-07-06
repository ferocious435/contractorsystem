-- Align BOQ parser output with stored pricelist item types.

ALTER TYPE pricelist_item_type ADD VALUE IF NOT EXISTS 'NOTE';
