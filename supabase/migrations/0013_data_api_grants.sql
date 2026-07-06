-- Explicit Data API grants for new Supabase projects.
-- RLS remains the authority for tenant isolation.

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.profiles,
  public.projects,
  public.documents,
  public.contradictions,
  public.pricing_ledger,
  public.pricelists,
  public.pricelist_items,
  public.vo_letters,
  public.vo_letter_items,
  public.document_scan_state
TO authenticated;

GRANT ALL PRIVILEGES ON TABLE
  public.profiles,
  public.projects,
  public.documents,
  public.contradictions,
  public.pricing_ledger,
  public.pricelists,
  public.pricelist_items,
  public.vo_letters,
  public.vo_letter_items,
  public.document_scan_state
TO service_role;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;
