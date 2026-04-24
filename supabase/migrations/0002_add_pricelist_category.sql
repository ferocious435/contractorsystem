-- Migration: 0002_add_pricelist_category
-- Description: Adds PRICELIST to document_category enum

ALTER TYPE document_category ADD VALUE 'PRICELIST';
