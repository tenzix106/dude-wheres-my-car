create or replace function public.patch_lobby_state(
  p_lobby_id text,
  p_patches jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  lobby_state jsonb;
  patch jsonb;
  patch_path text[];
begin
  if jsonb_typeof(p_patches) <> 'array' then
    raise exception 'p_patches must be a JSON array';
  end if;

  select state
    into lobby_state
    from public.lobbies
   where id = p_lobby_id
     for update;

  if lobby_state is null then
    raise exception 'Lobby % not found', p_lobby_id;
  end if;

  for patch in select value from jsonb_array_elements(p_patches)
  loop
    select array_agg(value order by ordinality)
      into patch_path
      from jsonb_array_elements_text(patch -> 'path')
           with ordinality as path_part(value, ordinality);

    if patch_path is null or array_length(patch_path, 1) = 0 then
      raise exception 'Each patch requires a non-empty path';
    end if;

    lobby_state := jsonb_set(
      lobby_state,
      patch_path,
      coalesce(patch -> 'value', 'null'::jsonb),
      true
    );
  end loop;

  update public.lobbies
     set state = lobby_state,
         updated_at = now()
   where id = p_lobby_id;
end;
$$;

revoke all on function public.patch_lobby_state(text, jsonb) from public;
revoke all on function public.patch_lobby_state(text, jsonb) from anon;
revoke all on function public.patch_lobby_state(text, jsonb) from authenticated;
grant execute on function public.patch_lobby_state(text, jsonb) to service_role;

notify pgrst, 'reload schema';
