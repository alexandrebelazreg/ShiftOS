# Audit Planiteo — 24 août 2026

État des lieux après la session du 23–24 août. Remplace les audits précédents,
qui ne vivaient que dans les échanges.

---

## Où en est le produit

**Environ 80 %.** Le produit est en ligne, sous son nom définitif, avec ses
comptes, sa base et son solveur. Ce qui reste n'est plus de la construction mais
de l'affinage — à une exception près, décrite plus bas.

| | État |
|---|---|
| Hébergement | Hetzner CX23, Coolify, un conteneur Node + Python |
| Domaine | **planiteo.com** et **www.planiteo.com**, HTTPS Let's Encrypt |
| Authentification | Supabase, comptes propres, cloisonnement par `store_id` |
| Données | Postgres, dix tables, quatorze écrans débranchés du navigateur |
| Solveur | `v3-highs-fast`, Python/SciPy, appelé par sous-processus |
| Tests | 1643 TypeScript + 112 Python |
| Lint | 8 signalements, tous antérieurs à cette session |

---

## Livré et vérifié en ligne le 23 août

**Le parcours de mise en route.** L'étape 6 était inatteignable sans qu'on
puisse savoir pourquoi : le verdict fondait deux causes distinctes en une phrase
vague, jetait le détail précis que le validateur produisait, n'offrait aucun
lien vers l'écran à corriger, et annonçait six étapes dont deux ne se validaient
jamais. Chaque manque porte désormais sa cause, son détail et son chemin.

**Les suppressions.** Employés et secteurs peuvent être effacés — mais seulement
quand rien ne les cite. La vérification est applicative et non déléguée à la
base, parce que `absences.employee_id` porte `on delete cascade` et emporterait
les absences sans un mot, et parce que plannings et permanences vivent en JSON,
invisibles à la base.

**Le renommage d'un secteur.** Il détachait silencieusement tous ses salariés :
le rattachement est une chaîne, pas une clé. Le renommage est maintenant
répercuté sur les fiches, et les noms périmés sont visibles et retirables.

**Trois lectures de l'équipe** — cartes, liste, par secteur.

**L'enregistrement d'une fiche.** Il ne produisait aucun signe : ni retour à la
liste, ni message d'échec. Les deux sont là.

**La suppression d'une campagne de congés**, avec la campagne validée protégée —
la feuille de permanence lit sa colonne « CP » dedans.

**Le renommage en Planiteo**, `shiftos.com` étant occupé par une société active
qui vend le même genre d'outil au secteur de la santé.

---

## Le point ouvert : l'équité des fermetures

C'est le seul chantier non refermé, et il a occupé la moitié de la session.

### Ce qui a été corrigé, et qui tient

1. **Elle n'avait jamais fonctionné.** Le champ `savedPlannings` était optionnel
   et aucun appelant ne le remplissait : l'historique sortait toujours vide. Le
   champ est devenu obligatoire, le tableau vide signifiant « aucune semaine ».
2. **La mesure était fausse.** La charge se calculait en *jours* — six fermetures
   sur dix-huit jours et deux sur six donnaient le même rapport. Elle se mesure
   désormais **à la semaine**, avec une part `min(5, jours au contrat)`.
3. **Elle était invisible.** Le validateur produisait un rapport détaillé que
   nul écran ne lisait. Il est dans le tiroir technique, avec le détail jour par
   jour : qui a fermé, qui pouvait, et pourquoi les autres non.
4. **Un rééquilibrage après placement** échange des journées entre salariés sans
   toucher à la couverture ni aux contrats, chaque échange étant soumis au
   validateur.

### Ce qui résiste

Sur le magasin réel, **la répartition ne bouge pas** : Dylan et Arthur prennent
2 fermetures chacun — leur plafond — et Luca, le plus léger, n'en reçoit aucune
alors qu'il pouvait fermer cinq jours sur six.

Deux causes identifiées, non encore levées :

- **Structurelle.** Luca travaille cinq jours (repos fixe mercredi), Dylan six.
  Leurs totaux hebdomadaires sont égaux mais répartis différemment : aucun
  groupe de jours ne fait coïncider leurs durées sans inclure le mercredi, et
  inclure le mercredi donnerait à Luca un service sur son repos fixe. **Aucun
  échange entre eux n'est possible.**
- **Dans la recherche.** Elle s'arrête à la plus petite taille de groupe qui
  produit des candidats ; si tous échouent à la validation, les groupes plus
  grands ne sont jamais essayés.

### Tranché sur données réelles (24 août)

Le problème réel a été exporté (`PLANNING_V3_DUMP_DIR`), rejoué localement, et
chaque échange d'une journée soumis au validateur. **Tous sont refusés, et pour
des raisons légitimes :**

    09-11  Dylan <-> Valentin   Dylan commencerait à 06:00, borne de début 08:00
    09-11  Dylan <-> Luca       Luca : 600 min de repos avant le 12, minimum 720
    09-12  Dylan <-> Valentin   même borne, et repos insuffisant
    09-09  Arthur <-> Valentin  repos de 600 min entre le 9 et le 10
    09-07  Valentin <-> Dylan   Dylan atteindrait 3 fermetures pour un plafond de 2

Le rééquilibrage fonctionne ; ce sont les contraintes qui ne laissent aucune
place. Les créneaux n'ont pas les mêmes horaires, donc échanger deux personnes
leur fait hériter des heures de l'autre — ce qui viole leur **borne de début
personnelle** et le **repos de douze heures**. S'y ajoute que deux salariés
travaillant un nombre de jours différent (cinq contre six) ne peuvent jamais
s'échanger sans toucher un repos fixe.

**L'option A est donc épuisée.** Corriger APRÈS le placement ne peut pas
fonctionner sur cette équipe : la décision « qui ferme » se prend en même temps
que « à quelle heure chacun travaille », et elle ne se rattrape pas ensuite.

### Ce qu'il reste

**Option B — l'équité dans le placement.** Le moteur choisirait qui ferme
pendant qu'il décide les horaires, au lieu d'être corrigé après. C'est le seul
chemin qui reste, et le projet a déjà payé pour savoir qu'alourdir ce MILP se
paie cher.

**Le levier qui marche aujourd'hui, et qui n'est plus un pis-aller.** Le plafond
de fermetures est une contrainte DURE, respectée pendant le placement — donc au
seul moment où la décision se prend. Passer les deux plus chargés à une
fermeture par semaine force la répartition vers les autres, dès la génération
suivante. Au vu de ce qui précède, c'est l'outil correct, pas un contournement.

### Ce qu'il a fallu pour en arriver là

Cinq diagnostics déduits du code se sont révélés faux — zone marché, tourniquet
par secteur, ordre du score, contrats inégaux, critère de décision — et chacun a
coûté un déploiement. Le sixième, tiré du problème réel en dix minutes, a été le
bon. **Exporter les données réelles aurait dû être le premier geste, pas le
dernier.**

---

## Missions, par ordre d'importance

1. **L'équité dans le placement (option B)** — la seule voie restante, l'option A
   étant démontrée impuissante sur cette équipe. En attendant, le plafond de
   fermetures produit le résultat voulu.
2. **Le renommage d'un secteur par identifiant plutôt que par nom.** Le
   rattachement reste une chaîne ; la cascade répare le symptôme, pas la cause,
   et rien dans le typage ne peut signaler la prochaine casse.
3. **Les sauvegardes** — l'exercice de restauration décrit dans
   `supabase/SAUVEGARDES.md` n'a jamais été fait. Une sauvegarde jamais
   restaurée n'est pas une sauvegarde.
4. **Le déploiement automatique.** Coolify affiche `is_auto_deploy_enabled` mais
   aucune poussée ne déclenche rien : la source est branchée en « Public
   Repository », donc GitHub n'envoie aucun webhook. Chaque mise en ligne est
   manuelle, et l'oublier a déjà coûté une soirée.
5. **Le multi-magasin**, préparé dans le schéma et jamais activé.

---

## Ce que cette session a appris sur la méthode

Deux moitiés testées ne font pas un joint testé : l'équité avait vingt tests de
chaque côté et rien au milieu, parce que les tests fabriquaient à la main la
valeur que le code réel ne transmettait jamais.

Un réglage dit ce qui est censé se produire ; l'historique dit ce qui s'est
produit. Vérifier ce qui est **réellement enregistré** — en base, dans l'image
déployée, dans le build servi — a tranché plus de questions que toute lecture de
code.
