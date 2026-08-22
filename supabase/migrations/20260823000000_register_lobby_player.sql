create or replace function public.register_lobby_player(
  p_lobby_id text,
  p_player_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  lobby_state jsonb;
  player_ids jsonb;
  player_count integer;
  legacy_count integer;
  legacy_index integer;
begin
  if p_player_id is null
     or length(trim(p_player_id)) = 0
     or length(p_player_id) > 120 then
    raise exception 'A valid player ID is required';
  end if;

  select state
    into lobby_state
    from public.lobbies
   where id = p_lobby_id
     for update;

  if lobby_state is null then
    return null;
  end if;

  if jsonb_typeof(lobby_state -> 'playerIds') = 'array' then
    player_ids := lobby_state -> 'playerIds';
  else
    player_ids := '[]'::jsonb;
  end if;

  legacy_count := greatest(
    coalesce((lobby_state ->> 'players')::integer, 0),
    jsonb_array_length(player_ids)
  );
  if jsonb_array_length(player_ids) = 0 and legacy_count > 0 then
    for legacy_index in 1..legacy_count loop
      player_ids := player_ids || jsonb_build_array('legacy-' || legacy_index);
    end loop;
  end if;

  if not player_ids @> jsonb_build_array(trim(p_player_id)) then
    player_ids := player_ids || jsonb_build_array(trim(p_player_id));
  end if;
  player_count := jsonb_array_length(player_ids);

  update public.lobbies
     set state = jsonb_set(
       jsonb_set(lobby_state, '{playerIds}', player_ids, true),
       '{players}',
       to_jsonb(player_count),
       true
     ),
         updated_at = now()
   where id = p_lobby_id;

  return player_count;
end;
$$;

revoke all on function public.register_lobby_player(text, text) from public;
revoke all on function public.register_lobby_player(text, text) from anon;
revoke all on function public.register_lobby_player(text, text) from authenticated;
grant execute on function public.register_lobby_player(text, text) to service_role;

notify pgrst, 'reload schema';
