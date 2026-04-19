-- Create an explicit super_admin role checking function
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS $$
  -- We assume that an admin has their `role` field in the `profiles` table set to 'admin' or 'super_admin'
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (role = 'admin' OR role = 'super_admin')
  );
$$;

-- Add bypass policies for profiles
CREATE POLICY "Super admins can view all profiles" ON profiles
  FOR SELECT USING (public.is_super_admin());
CREATE POLICY "Super admins can update all profiles" ON profiles
  FOR UPDATE USING (public.is_super_admin());
CREATE POLICY "Super admins can delete profiles" ON profiles
  FOR DELETE USING (public.is_super_admin());

-- Add bypass policies for projects
CREATE POLICY "Super admins can view all projects" ON projects
  FOR SELECT USING (public.is_super_admin());
CREATE POLICY "Super admins can insert any project" ON projects
  FOR INSERT WITH CHECK (public.is_super_admin());
CREATE POLICY "Super admins can update any project" ON projects
  FOR UPDATE USING (public.is_super_admin());
CREATE POLICY "Super admins can delete any project" ON projects
  FOR DELETE USING (public.is_super_admin());

-- Add bypass policies for documents
CREATE POLICY "Super admins can access all documents" ON documents
  FOR ALL USING (public.is_super_admin());

-- Add bypass policies for contradictions
CREATE POLICY "Super admins can access all contradictions" ON contradictions
  FOR ALL USING (public.is_super_admin());

-- Add bypass policies for pricing_ledger
CREATE POLICY "Super admins can access all pricing_ledger entries" ON pricing_ledger
  FOR ALL USING (public.is_super_admin());
