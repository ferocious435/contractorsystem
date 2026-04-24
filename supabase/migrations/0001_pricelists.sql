-- Migration: 0001_pricelists
-- Description: Adds tables for storing pricelists (e.g. Dekel) and their items.

CREATE TYPE pricelist_item_type AS ENUM ('CHAPTER', 'SUBCHAPTER', 'ITEM');

CREATE TABLE pricelists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contractor_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE, -- If null, applies to all projects for the contractor
  name VARCHAR NOT NULL,
  description TEXT,
  is_global BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE pricelist_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pricelist_id UUID REFERENCES pricelists(id) ON DELETE CASCADE NOT NULL,
  item_type pricelist_item_type DEFAULT 'ITEM',
  item_code VARCHAR NOT NULL,
  description TEXT NOT NULL,
  unit VARCHAR,
  quantity DECIMAL(12, 2) DEFAULT 0,
  rate DECIMAL(15, 2) DEFAULT 0,
  service_type VARCHAR,
  activity_number VARCHAR,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE pricelists ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricelist_items ENABLE ROW LEVEL SECURITY;

-- Policies for pricelists
CREATE POLICY "Users can access their own pricelists" ON pricelists
  FOR ALL USING (
    contractor_id = auth.uid()
  );

-- Policies for pricelist_items
CREATE POLICY "Users can access items of their own pricelists" ON pricelist_items
  FOR ALL USING (
    pricelist_id IN (SELECT id FROM pricelists WHERE contractor_id = auth.uid())
  );

-- Indexes for performance
CREATE INDEX idx_pricelists_contractor_id ON pricelists(contractor_id);
CREATE INDEX idx_pricelists_project_id ON pricelists(project_id);
CREATE INDEX idx_pricelist_items_pricelist_id ON pricelist_items(pricelist_id);
CREATE INDEX idx_pricelist_items_item_code ON pricelist_items(item_code);
