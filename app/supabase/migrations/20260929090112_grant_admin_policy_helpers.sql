grant usage on schema private to authenticated;
grant execute on function private.current_user_admin_role() to authenticated;
grant execute on function private.current_user_is_admin() to authenticated;
grant execute on function private.current_user_is_super_admin() to authenticated;
