-- Run once per deployment, after enabling Supabase Cron and pg_net.
-- Store the HTTPS deployment origin and its CRON_SECRET in Vault using the
-- names below. The job definition contains only lookups, never the secret.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM vault.decrypted_secrets WHERE name = 'zcatchers_app_url'
      AND decrypted_secret ~ '^https://[^/[:space:]]+/?$')
     OR NOT EXISTS (SELECT FROM vault.decrypted_secrets WHERE name = 'zcatchers_cron_secret'
      AND length(trim(decrypted_secret)) > 0) THEN
    RAISE EXCEPTION 'Set zcatchers_app_url and zcatchers_cron_secret in Vault first.';
  END IF;
  PERFORM cron.schedule('zcatchers-dispatch', '* * * * *', $job$
  SELECT net.http_get(
    url := rtrim((SELECT decrypted_secret FROM vault.decrypted_secrets
                  WHERE name = 'zcatchers_app_url'), '/') || '/api/cron/dispatch-notifications',
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'zcatchers_cron_secret')),
    timeout_milliseconds := 55000
  );
  $job$);
END;
$$;
