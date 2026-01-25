-- Allow admins to view all profiles
CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Allow admins to view all prompt logs
CREATE POLICY "Admins can view all prompt_logs"
ON public.prompt_logs
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));