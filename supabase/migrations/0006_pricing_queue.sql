DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pricing_item_status') THEN
        CREATE TYPE pricing_item_status AS ENUM ('PENDING', 'PRICED', 'REJECTED');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contradictions' AND column_name = 'pricing_status') THEN
        ALTER TABLE contradictions ADD COLUMN pricing_status pricing_item_status DEFAULT 'PENDING';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pricing_ledger' AND column_name = 'contradiction_id') THEN
        ALTER TABLE pricing_ledger ADD COLUMN contradiction_id UUID REFERENCES contradictions(id) ON DELETE SET NULL;
    END IF;
END
$$;
