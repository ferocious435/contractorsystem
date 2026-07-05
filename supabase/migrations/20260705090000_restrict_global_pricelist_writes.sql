-- Restrict global pricelist writes to super admins while keeping global reads public to authenticated users.

DROP POLICY IF EXISTS "Users can insert their own pricelists" ON public.pricelists;
DROP POLICY IF EXISTS "Users can update their own pricelists" ON public.pricelists;
DROP POLICY IF EXISTS "Users can delete their own pricelists" ON public.pricelists;

CREATE POLICY "Users can insert their own pricelists"
ON public.pricelists
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_super_admin()
  OR (
    contractor_id = (SELECT auth.uid())
    AND is_global IS NOT TRUE
  )
);

CREATE POLICY "Users can update their own pricelists"
ON public.pricelists
FOR UPDATE
TO authenticated
USING (
  public.is_super_admin()
  OR (
    contractor_id = (SELECT auth.uid())
    AND is_global IS NOT TRUE
  )
)
WITH CHECK (
  public.is_super_admin()
  OR (
    contractor_id = (SELECT auth.uid())
    AND is_global IS NOT TRUE
  )
);

CREATE POLICY "Users can delete their own pricelists"
ON public.pricelists
FOR DELETE
TO authenticated
USING (
  public.is_super_admin()
  OR (
    contractor_id = (SELECT auth.uid())
    AND is_global IS NOT TRUE
  )
);

DROP POLICY IF EXISTS "Users can insert items into own pricelists" ON public.pricelist_items;
DROP POLICY IF EXISTS "Users can update items in own pricelists" ON public.pricelist_items;
DROP POLICY IF EXISTS "Users can delete items from own pricelists" ON public.pricelist_items;

CREATE POLICY "Users can insert items into own pricelists"
ON public.pricelist_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.pricelists
    WHERE pricelists.id = pricelist_items.pricelist_id
      AND (
        public.is_super_admin()
        OR (
          pricelists.contractor_id = (SELECT auth.uid())
          AND pricelists.is_global IS NOT TRUE
        )
      )
  )
);

CREATE POLICY "Users can update items in own pricelists"
ON public.pricelist_items
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pricelists
    WHERE pricelists.id = pricelist_items.pricelist_id
      AND (
        public.is_super_admin()
        OR (
          pricelists.contractor_id = (SELECT auth.uid())
          AND pricelists.is_global IS NOT TRUE
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.pricelists
    WHERE pricelists.id = pricelist_items.pricelist_id
      AND (
        public.is_super_admin()
        OR (
          pricelists.contractor_id = (SELECT auth.uid())
          AND pricelists.is_global IS NOT TRUE
        )
      )
  )
);

CREATE POLICY "Users can delete items from own pricelists"
ON public.pricelist_items
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pricelists
    WHERE pricelists.id = pricelist_items.pricelist_id
      AND (
        public.is_super_admin()
        OR (
          pricelists.contractor_id = (SELECT auth.uid())
          AND pricelists.is_global IS NOT TRUE
        )
      )
  )
);