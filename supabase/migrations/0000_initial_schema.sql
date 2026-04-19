-- Create custom types (enums)
CREATE TYPE project_status AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE document_category AS ENUM ('CONTRACT', 'EXECUTION');
CREATE TYPE ai_parsing_status AS ENUM ('PENDING', 'SCANNED', 'ERROR');
CREATE TYPE contradiction_severity AS ENUM ('HIGH', 'MEDIUM', 'LOW');
CREATE TYPE contradiction_status AS ENUM ('OPEN', 'IGNORED', 'MOVED_TO_PRICING', 'AUTO_RESOLVED');
CREATE TYPE ledger_item_type AS ENUM ('BASE_CONTRACT', 'APPROVED_VO', 'PENDING_VO');
CREATE TYPE ledger_item_source AS ENUM ('BOQ', 'DEKEL', 'CUSTOM_ANALYSIS');

-- Profiles Table (Extension of auth.users)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name VARCHAR,
  company_name VARCHAR,
  role VARCHAR DEFAULT 'contractor',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Projects Table
CREATE TABLE projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR NOT NULL,
  contractor_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  status project_status DEFAULT 'ACTIVE',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Documents Table
CREATE TABLE documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  title VARCHAR NOT NULL,
  category document_category NOT NULL,
  file_url VARCHAR,
  version INT DEFAULT 1,
  ai_status ai_parsing_status DEFAULT 'PENDING',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Contradictions Table (Radar)
CREATE TABLE contradictions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  title VARCHAR NOT NULL,
  description TEXT,
  strategy_advice TEXT,
  severity contradiction_severity DEFAULT 'MEDIUM',
  status contradiction_status DEFAULT 'OPEN',
  source_execution_doc_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  target_contract_doc_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  related_contradiction_id UUID REFERENCES contradictions(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pricing Ledger Table (Смета / Вариации)
CREATE TABLE pricing_ledger (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  type ledger_item_type DEFAULT 'BASE_CONTRACT',
  source ledger_item_source DEFAULT 'BOQ',
  item_code VARCHAR,
  description TEXT,
  unit VARCHAR,
  quantity DECIMAL(12, 2) DEFAULT 0,
  unit_price_excl_vat DECIMAL(15, 2) DEFAULT 0,
  total_price_excl_vat DECIMAL(15, 2) GENERATED ALWAYS AS (quantity * unit_price_excl_vat) STORED,
  vat_rate DECIMAL(5, 4) DEFAULT 0.18, -- 18% מע"מ
  vat_amount DECIMAL(15, 2) GENERATED ALWAYS AS ((quantity * unit_price_excl_vat) * vat_rate) STORED,
  total_price_incl_vat DECIMAL(15, 2) GENERATED ALWAYS AS ((quantity * unit_price_excl_vat) * (1 + vat_rate)) STORED,
  markup_percentage DECIMAL(5, 4) DEFAULT 0,
  contradiction_id UUID REFERENCES contradictions(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Setup Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE contradictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_ledger ENABLE ROW LEVEL SECURITY;

-- Policies for profiles
CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Policies for projects
CREATE POLICY "Users can view their own projects" ON projects
  FOR SELECT USING (auth.uid() = contractor_id);
CREATE POLICY "Users can insert their own projects" ON projects
  FOR INSERT WITH CHECK (auth.uid() = contractor_id);
CREATE POLICY "Users can update their own projects" ON projects
  FOR UPDATE USING (auth.uid() = contractor_id);
CREATE POLICY "Users can delete their own projects" ON projects
  FOR DELETE USING (auth.uid() = contractor_id);

-- Policies for documents
CREATE POLICY "Users can access documents for their projects" ON documents
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE contractor_id = auth.uid())
  );

-- Policies for contradictions
CREATE POLICY "Users can access contradictions for their projects" ON contradictions
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE contractor_id = auth.uid())
  );

-- Policies for pricing_ledger
CREATE POLICY "Users can access pricing_ledger for their projects" ON pricing_ledger
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE contractor_id = auth.uid())
  );

-- trigger mechanism for new users to automatically populate profile
CREATE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, company_name, role)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'company_name',
    'contractor'
  );
  RETURN new;
END;
$$;

-- trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Performance Indexes (Senior Architect skill)
CREATE INDEX idx_projects_contractor_id ON projects(contractor_id);
CREATE INDEX idx_documents_project_id ON documents(project_id);
CREATE INDEX idx_contradictions_project_id ON contradictions(project_id);
CREATE INDEX idx_pricing_ledger_project_id ON pricing_ledger(project_id);
