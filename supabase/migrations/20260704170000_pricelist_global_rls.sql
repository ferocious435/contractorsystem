-- Allow all authenticated users to read global pricelists and their items.
-- Owner-only write policies are kept separate from global read policies.

ALTER TABLE public.pricelists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricelist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can access their own pricelists" ON public.pricelists;
DROP POLICY IF EXISTS "Users can select own and global pricelists" ON public.pricelists;
DROP POLICY IF EXISTS "Users can insert their own pricelists" ON public.pricelists;
DROP POLICY IF EXISTS "Users can update their own pricelists" ON public.pricelists;
DROP POLICY IF EXISTS "Users can delete their own pricelists" ON public.pricelists;

CREATE POLICY "Users can select own and global pricelists"
ON public.pricelists
FOR SELECT
TO authenticated
USING (
  contractor_id = (SELECT auth.uid())
  OR is_global = true
  OR public.is_super_admin()
);

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

DROP POLICY IF EXISTS "Users can access items of their own pricelists" ON public.pricelist_items;
DROP POLICY IF EXISTS "Users can select own and global pricelist items" ON public.pricelist_items;
DROP POLICY IF EXISTS "Users can insert items into own pricelists" ON public.pricelist_items;
DROP POLICY IF EXISTS "Users can update items in own pricelists" ON public.pricelist_items;
DROP POLICY IF EXISTS "Users can delete items from own pricelists" ON public.pricelist_items;

CREATE POLICY "Users can select own and global pricelist items"
ON public.pricelist_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pricelists
    WHERE pricelists.id = pricelist_items.pricelist_id
      AND (
        pricelists.contractor_id = (SELECT auth.uid())
        OR pricelists.is_global = true
        OR public.is_super_admin()
      )
  )
);

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
