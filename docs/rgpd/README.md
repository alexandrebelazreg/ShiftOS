# Données personnelles — ce qui a été décidé, et ce qui reste ouvert

Planiteo enregistre des arrêts maladie et des heures de délégation, rattachés à
des personnes nommées, dans un magasin où ces personnes n'ont pas de compte et
ne voient donc rien de ce qui les concerne. C'est ce qui fait de ce dossier
autre chose qu'une formalité de lancement.

Trois documents, un mécanisme, et quatre questions non tranchées.

| Fichier | Ce que c'est | Qui le lit |
|---|---|---|
| [REGISTRE.md](REGISTRE.md) | l'entrée de registre de l'article 30, remplie depuis le schéma réel | un contrôle, un DPO, le prochain développeur |
| [INFORMATION_DES_SALARIES.md](INFORMATION_DES_SALARIES.md) | la note de l'article 13, à remettre et à afficher | les salariés |
| `/confidentialite` dans l'application | la même chose en plus court, atteignable sans compte | qui tombe sur l'écran de connexion |
| `supabase/migrations/0006_conservation.sql` | la durée de conservation et la purge | la base |

## Pourquoi la durée de conservation est une table

Elle aurait pu être une constante dans le code de la purge. Elle est une ligne
de `retention_policies`, lisible par un `select`, avec sa justification écrite à
côté du nombre.

La raison est qu'un contrôle ne lit pas le code, et qu'une durée de conservation
qui ne se prouve qu'en ouvrant un fichier TypeScript n'est pas opposable. Le
jour où la convention collective impose cinq ans plutôt que trois, on modifie
une ligne et `updated_at` garde la trace du changement. Aucune migration,
aucun déploiement.

## Pourquoi la purge ne se lance pas toute seule

Deux fonctions, et l'une ne détruit rien.

```sql
select * from retention_preview();
```

annonce ce qui partirait, par table, avec la date de la plus ancienne ligne
concernée. Elle se lit avant, et elle se relit.

```sql
select * from retention_purge();
```

supprime, et rend le compte de ce qu'elle a supprimé.

Aucune des deux n'est joignable depuis l'application. `security definer`
traverse RLS par construction : ces fonctions voient tous les magasins, et la
migration 0001 accorde `execute on all functions` au rôle `authenticated`. Sans
le retrait explicite qui clôt la migration 0006, n'importe quelle session
authentifiée aurait pu vider la base du voisin.

Rien n'est programmé. `pg_cron` ferait tourner la purge chaque nuit, et c'est
sans doute la bonne fin de l'histoire, mais pas avant qu'une exécution manuelle
ait montré des chiffres crédibles sur des données réelles. Une purge automatique
posée sur une politique jamais éprouvée est une perte de données qui attend son
heure.

## Ce que la purge ne touche pas, et pourquoi

`employees` n'est dans aucune politique de conservation.

Un planning enregistré cite ses salariés par identifiant, dans tout son état.
La migration 0005 a même figé ces identifiants pour cette raison précise :
« les plannings enregistrés citent le salarié par ce nom-là ». Supprimer une
fiche laisserait chaque semaine passée pleine de références mortes, et le
tableau afficherait des créneaux appartenant à personne.

Le départ d'un salarié se traite par son `status`. Son effacement définitif se
décide à la main, quand les plannings qui le citent sont eux-mêmes partis.

## Les quatre questions non tranchées

**La région Supabase.** Elle se lit dans le tableau de bord et se vérifie en
deux minutes. Si le projet n'est pas dans l'Union, tout le reste de ce dossier
est bancal, et la correction demande une migration de projet.

**Le rôle de consultation.** `app_role` n'a qu'une valeur, `manager`, et
`session.role` n'est utilisé nulle part pour autoriser. Tout compte du magasin
voit tous les arrêts maladie et tous les mandats. Un seul compte par magasin
rend la conséquence nulle aujourd'hui ; un second compte en fait un défaut de
minimisation. Le socle avait prévu le type pour ce jour-là, il reste à s'en
servir.

**Les motifs sensibles dans les absences anciennes.** Une absence de trois ans
n'a plus besoin de dire *pourquoi*, seulement *combien de jours*. Remplacer le
motif par une valeur neutre au bout d'un an garderait le décompte du temps de
travail en effaçant la donnée de santé. Ce serait la bonne minimisation, et ce
n'est pas fait : le motif commande le traitement des heures, maintenues ou
déduites, et le neutraliser changerait rétroactivement des calculs passés. À
concevoir sérieusement, pas à improviser dans une purge.

**Le droit d'accès.** Un salarié qui demande ce que le logiciel sait de lui n'a
aujourd'hui aucune réponse possible en moins d'une heure de SQL manuel. Le délai
légal est d'un mois, il est donc tenable, mais un export par salarié est le
genre d'écran qui manque tant que personne ne l'a demandé.

## Ce qui était déjà juste

Le dossier n'est pas parti de rien, et trois choses méritent d'être notées pour
ne pas être défaites par distraction.

Les polices sont chargées par `next/font/google`, qui les télécharge à la
compilation et les sert depuis le domaine du magasin. Aucune requête vers
Google, donc aucune adresse IP de salarié transmise à un tiers. Un `<link>` vers
`fonts.googleapis.com` annulerait cette propriété sans que rien ne change à
l'écran.

Aucune mesure d'audience, aucun traceur, aucun cookie hors celui de session.
C'est ce qui dispense l'application de bandeau cookies, et la première brique
d'analytics posée un jour de curiosité fera entrer ce sujet par la fenêtre.

`PLANNING_V3_DUMP_DIR` produit des fichiers contenant noms, contrats et
disponibilités. La variable n'est pas définie en production, `.gitignore` et
`.dockerignore` écartent déjà les fichiers, et `DEPLOY.md` dit de ne l'activer
que le temps d'un diagnostic. C'est une porte volontairement laissée fermée.
