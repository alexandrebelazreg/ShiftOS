-- PREMIER MAGASIN ET PREMIER MANAGER
--
-- À exécuter UNE FOIS, après avoir créé son compte dans Supabase
-- (Authentication -> Add user -> Create new user).
--
-- Remplacer l'adresse ci-dessous par celle du compte créé, puis tout exécuter.

do $$
declare
  v_email    text := 'REMPLACER@PAR-VOTRE-ADRESSE.fr';   -- <<<<<< LA SEULE LIGNE À MODIFIER
  v_user_id  uuid;
  v_store_id uuid;
begin
  select id into v_user_id from auth.users where email = v_email;

  if v_user_id is null then
    raise exception
      'Aucun compte avec l''adresse %. Créez-le d''abord dans Authentication, puis relancez.',
      v_email;
  end if;

  if exists (select 1 from profiles where id = v_user_id) then
    raise notice 'Ce compte est déjà rattaché à un magasin. Rien à faire.';
    return;
  end if;

  insert into stores (name, address, city, postal_code, country, timezone)
  values ('Mon magasin', 'À compléter', 'À compléter', '00000', 'France', 'Europe/Paris')
  returning id into v_store_id;

  insert into profiles (id, store_id, role, email)
  values (v_user_id, v_store_id, 'manager', v_email);

  raise notice 'Magasin % créé et rattaché à %.', v_store_id, v_email;
end;
$$;

-- Vérification : doit rendre une ligne.
select p.email, p.role, s.name as magasin
from profiles p
join stores s on s.id = p.store_id;
