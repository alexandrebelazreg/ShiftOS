-- REMISE À ZÉRO — à n'exécuter que sur une base sans données réelles.
--
-- Ce fichier n'est pas une migration : il ne s'applique jamais tout seul, et il
-- n'a sa place que dans une main humaine. Il efface les dix tables du socle et
-- tout ce qui en dépend.
--
-- À quoi il sert : une migration interrompue à mi-chemin laisse la base dans un
-- état bâtard — quelques tables créées, les autres non — et la relancer meurt
-- sur la première qui existe déjà. Repartir de zéro est alors plus sûr que de
-- deviner où elle s'est arrêtée.
--
-- Le jour où cette base portera de vraies données, ce fichier devient une arme.
-- C'est pourquoi il vit ici et non dans `migrations/`.

drop table if exists paid_leave_campaigns cascade;
drop table if exists permanences cascade;
drop table if exists plannings cascade;
drop table if exists holidays cascade;
drop table if exists absence_rules cascade;
drop table if exists absences cascade;
drop table if exists employees cascade;
drop table if exists sectors cascade;
drop table if exists profiles cascade;
drop table if exists stores cascade;

drop function if exists current_store_id() cascade;
drop function if exists touch_updated_at() cascade;

drop type if exists app_role cascade;
