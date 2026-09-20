SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='conversations' ORDER BY ordinal_position;
SELECT u.email, u.created_at::date AS created, count(c.id) AS convs,
       count(*) FILTER (WHERE c.is_favorite) AS favs,
       max(c.updated_at)::timestamp(0) AS last_activity
FROM auth.users u
LEFT JOIN public.conversations c ON c.user_id = u.id
GROUP BY u.id, u.email, u.created_at
ORDER BY convs DESC, last_activity DESC NULLS LAST;
