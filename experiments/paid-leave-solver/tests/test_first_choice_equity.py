"""L'équité entre campagnes : qui obtient son premier plan, et pourquoi.

`firstChoiceHistory` compte des PERSONNES intégralement servies au premier vœu,
une par campagne validée. L'objectif qui devait s'en servir pondérait pourtant
des SEMAINES de rang 1 — autre unité, autre chose optimisée. Il récompensait donc
la TAILLE de la demande : quelqu'un réclamant quatre semaines pesait quatre fois
celui qui en réclamait une.

Et il vivait sous le classement des rangs, qui avait déjà tranché QUI obtenait
son premier plan — en comptant des semaines, lui aussi. Mesuré le 3 septembre
2026 : l'étage ne changeait STRICTEMENT RIEN, taux de service identiques qu'il
tourne ou non, pour le prix d'une résolution MILP.

Remonté au-dessus de ce classement et recompté par personne, l'écart entre
« jamais eu son premier vœu » et « l'a déjà eu » passe de +4 à +12 points sur dix
campagnes, sans servir une seule personne de moins.
"""

from __future__ import annotations

import unittest

from paid_leave_solver import main, pin_tolerance

WEEKS = [f"2026-W{number:02d}" for number in range(26, 40)]
CONVOITEES = ["2026-W30", "2026-W31", "2026-W32", "2026-W33"]


def _employe(
    identifiant: str,
    *,
    plan_un: list[str],
    historique: int,
    repli: list[str] | None = None,
) -> dict:
    plans = [{"rank": 1, "weekIds": plan_un}]
    if repli:
        plans.append({"rank": 2, "weekIds": repli})
    return {
        "id": identifiant,
        "name": identifiant.capitalize(),
        "sectorId": "drive",
        "contractHours": 35.0,
        "targetWeeks": len(plan_un),
        "linkedEmployeeId": None,
        "seniorityOrder": 1,
        "firstChoiceHistory": historique,
        "plans": plans,
    }


def _payload(employes: list[dict], *, minimum_convoitees: float) -> dict:
    """Un rayon, et un minimum qui ne mord que sur les semaines convoitées."""
    base = sum(employe["contractHours"] for employe in employes)
    return {
        "campaignId": "test-equite",
        "timeoutSeconds": 30,
        "weeks": WEEKS,
        "sectors": [{"id": "drive", "name": "Drive"}],
        "employees": employes,
        "coverage": [
            {
                "sectorId": "drive",
                "weekId": week,
                "baseContractHours": base,
                "minimumHours": minimum_convoitees if week in CONVOITEES else 0.0,
                "toleratedDeficitHours": 0.0,
            }
            for week in WEEKS
        ],
        "reinforcementPools": [],
    }


def _entierement_au_plan_un(payload: dict, response: dict, identifiant: str) -> bool:
    """La même règle que `grantIsEntirelyFirstChoice` côté application."""
    employe = next(e for e in payload["employees"] if e["id"] == identifiant)
    plan_un = set(next(p["weekIds"] for p in employe["plans"] if p["rank"] == 1))
    accorde = set(response["grants"].get(identifiant, []))
    return (
        employe["targetWeeks"] > 0
        and len(accorde) == employe["targetWeeks"]
        and accorde <= plan_un
    )


class FirstChoiceEquity(unittest.TestCase):
    def test_celui_qui_na_jamais_eu_son_premier_voeu_passe_devant(self) -> None:
        """Deux semaines pour celui qui attend, contre quatre pour celui qui a déjà eu.

        LE test de ce fichier, et l'injustice exacte que l'historique existe pour
        corriger. Les deux issues servent tout le monde — chacun sur son plan de
        repli quand il perd — et se valent donc partout sauf sur deux points :
        le classement des rangs préfère Alice, qui apporte quatre semaines de
        premier rang contre les deux de Bob, et l'équité préfère Bob, qui n'a
        jamais rien eu.

        C'est ce désaccord qui prouve le déplacement de l'étage. Sous ce
        classement, Alice gagnait — campagne après campagne, puisque rien ne remettait jamais
        son avantage en cause.
        """
        payload = _payload(
            [
                _employe(
                    "alice",
                    plan_un=CONVOITEES,
                    historique=2,
                    repli=["2026-W36", "2026-W37", "2026-W38", "2026-W39"],
                ),
                _employe(
                    "bob",
                    plan_un=["2026-W30", "2026-W31"],
                    historique=0,
                    repli=["2026-W36", "2026-W37"],
                ),
            ],
            # 35 h exigées sur 70 h de base : un seul absent par semaine convoitée.
            minimum_convoitees=35.0,
        )

        response = main(payload)
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 0.0)
        self.assertTrue(_entierement_au_plan_un(payload, response, "bob"))
        self.assertFalse(_entierement_au_plan_un(payload, response, "alice"))
        self.assertEqual(response["objectiveValues"]["first_choice_backlog_served"], 1.0)

    def test_le_nombre_de_servis_prime_sur_lanciennete_de_lattente(self) -> None:
        """Jamais moins de personnes servies pour en favoriser une qui attend.

        Le garde-fou du premier critère de l'étage. Alice n'a jamais eu son
        premier vœu et pèse donc le plus lourd ; la servir empêche pourtant Bob
        ET Chloé d'avoir le leur. Une pondération seule aurait choisi Alice —
        un poids de deux contre deux poids de zéro — et le gérant aurait vu une
        personne servie au lieu de deux.

        Le compte passe devant, l'ancienneté ne départage qu'à compte égal.
        """
        payload = _payload(
            [
                _employe(
                    "alice",
                    plan_un=["2026-W30", "2026-W31"],
                    historique=0,
                    repli=["2026-W38", "2026-W39"],
                ),
                _employe("bob", plan_un=["2026-W30"], historique=2, repli=["2026-W36"]),
                _employe("chloe", plan_un=["2026-W31"], historique=2, repli=["2026-W37"]),
            ],
            # 70 h exigées sur 105 h de base : un seul absent par semaine convoitée.
            minimum_convoitees=70.0,
        )

        response = main(payload)
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 0.0)
        self.assertEqual(response["objectiveValues"]["first_choice_served"], 2.0)
        self.assertTrue(_entierement_au_plan_un(payload, response, "bob"))
        self.assertTrue(_entierement_au_plan_un(payload, response, "chloe"))
        self.assertFalse(_entierement_au_plan_un(payload, response, "alice"))

    def test_servir_quelquun_a_moitie_ne_coute_pas_plus_que_le_laisser_dehors(self) -> None:
        """Le défaut qu'a révélé la première écriture de ces tests.

        L'étage des plans minimisait leur TOTAL. Or quelqu'un qui repart les
        mains vides n'en utilise aucun : à écart égal, le modèle préférait donc
        laisser une personne dehors plutôt que de lui accorder la moitié de son
        plan — l'exact contraire de ce que l'étage de l'écart venait d'établir.
        Le coût porte désormais sur le DÉBORDEMENT, et servir à moitié est
        gratuit.
        """
        payload = _payload(
            [
                _employe("alice", plan_un=CONVOITEES, historique=0),
                _employe("bob", plan_un=["2026-W30", "2026-W31"], historique=0),
            ],
            minimum_convoitees=35.0,
        )

        response = main(payload)
        self.assertEqual(response["status"], "optimal")
        # Quatre attributions se placent, quelle que soit la répartition. Ce qui
        # compte est que PERSONNE ne reparte à vide pour économiser un plan.
        self.assertEqual(sum(len(w) for w in response["grants"].values()), 4)
        for weeks in response["grants"].values():
            self.assertGreater(len(weeks), 0)
        self.assertEqual(response["objectiveValues"]["extra_plans"], 0.0)

    def test_un_plan_un_plus_court_que_la_cible_ne_compte_jamais(self) -> None:
        """La définition reste celle de l'application, à la lettre.

        `grantIsEntirelyFirstChoice` exige que le nombre accordé ÉGALE la cible.
        Quand le premier plan est plus court que le second — une saisie inachevée,
        que l'écran signale déjà — la personne ne peut donc jamais être comptée
        « entièrement au premier vœu ». Fabriquer la variable quand même ferait
        diverger les deux définitions, et l'historique compterait des campagnes
        que la validation, elle, n'a jamais enregistrées.
        """
        payload = _payload(
            [
                _employe(
                    "eve",
                    plan_un=["2026-W30"],
                    historique=0,
                    repli=["2026-W37", "2026-W38"],
                ),
            ],
            minimum_convoitees=0.0,
        )
        # La cible suit le plus grand plan : deux semaines, alors que le premier
        # plan n'en porte qu'une.
        payload["employees"][0]["targetWeeks"] = 2

        response = main(payload)
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["objectiveValues"]["first_choice_served"], 0.0)

    def test_la_bande_depinglage_suit_la_sensibilite_de_lobjectif(self) -> None:
        """La tolérance tient compte du POIDS de l'objectif, pas que de sa valeur.

        La cause est dans HiGHS, et elle est légitime : le point qu'il rend est
        faisable à sa propre tolérance près, de l'ordre de 1e-7 par contrainte.
        La valeur calculée dessus peut donc être très légèrement meilleure que
        tout ce que l'ensemble exactement faisable contient, et l'y épingler rend
        l'étage suivant infaisable — sur un problème qui ne l'est pas.

        L'erreur transportée est bornée par la somme des valeurs absolues des
        coefficients : cent termes amplifient cent fois le jeu de chaque
        variable. Une tolérance seulement relative à la VALEUR ne suffisait donc
        pas — `priority_seniority` vaut 135 mais pèse 500 en coefficients, et la
        bande calculée sur 135 était quatre fois trop étroite.

        Éprouvé sans faire tourner de MILP : le défaut tient au chemin numérique
        du solveur, pas à la forme du problème, et aucune reproduction
        déterministe n'a pu être construite.
        """
        # Plancher : une petite valeur et un petit poids gardent l'origine.
        self.assertEqual(pin_tolerance(0.0, integral=True), 1e-7)
        self.assertEqual(pin_tolerance(1.0, integral=False), 1e-6)
        # La valeur élargit la bande...
        self.assertAlmostEqual(pin_tolerance(-1000.0, integral=False), 1e-3)
        # ... et le poids de l'objectif l'élargit AUSSI, même à petite valeur.
        # C'est le cas que la version précédente manquait.
        self.assertAlmostEqual(
            pin_tolerance(135.0, integral=False, sensitivity=500.0), 5e-4
        )
        self.assertGreater(
            pin_tolerance(135.0, integral=False, sensitivity=500.0),
            pin_tolerance(135.0, integral=False),
        )
        # Et elle reste très inférieure à 1, le plus petit écart qui ait un sens
        # sur un objectif entier.
        self.assertLess(
            pin_tolerance(10_000.0, integral=False, sensitivity=10_000.0), 1.0
        )

class ListeDesServisTests(unittest.TestCase):
    """La liste NOMME qui a été compté, et elle doit coller au décompte.

    Le même prédicat — « tout son premier plan, et rien d'autre » — est écrit
    une seconde fois côté application, où la validation le fige et le transporte
    d'une campagne à l'autre. Le doublon est nécessaire : l'application doit
    savoir juger des attributions retouchées à la main, que le solveur n'a jamais
    vues. C'est son SILENCE qui ne l'était pas — d'où cette liste, que l'écran
    confronte à sa propre lecture sur de vraies données, à chaque calcul.
    """

    def test_la_liste_a_exactement_autant_de_noms_que_le_decompte(self) -> None:
        # Deux personnes servables sur leur premier plan, une troisième qui ne
        # peut pas l'être : le nombre et les noms doivent dire la même chose.
        response = main(
            _payload(
                [
                    _employe("alice", plan_un=["2026-W30", "2026-W31"], historique=0),
                    _employe("bob", plan_un=["2026-W35", "2026-W36"], historique=0),
                    _employe(
                        "chloe",
                        plan_un=["2026-W30", "2026-W31"],
                        historique=2,
                        repli=["2026-W37", "2026-W38"],
                    ),
                ],
                minimum_convoitees=70.0,
            )
        )

        self.assertEqual(response["status"], "optimal")
        self.assertEqual(
            len(response["firstChoiceEmployeeIds"]),
            int(response["objectiveValues"]["first_choice_served"]),
        )

    def test_elle_nomme_celui_qui_a_tout_son_premier_plan(self) -> None:
        # Sans concurrence, les deux obtiennent leur premier plan : les deux
        # figurent dans la liste, et personne d'autre.
        response = main(
            _payload(
                [
                    _employe("alice", plan_un=["2026-W30", "2026-W31"], historique=0),
                    _employe("bob", plan_un=["2026-W35", "2026-W36"], historique=0),
                ],
                minimum_convoitees=0.0,
            )
        )

        self.assertEqual(response["firstChoiceEmployeeIds"], ["alice", "bob"])

    def test_elle_exclut_celui_qui_est_servi_sur_son_repli(self) -> None:
        # Chloé ne peut pas avoir les semaines convoitées et repart sur son
        # second plan. Elle est bien servie — mais pas au premier vœu, et la
        # liste ne doit pas la nommer : c'est cette liste qui décidera des
        # priorités de la campagne suivante.
        response = main(
            _payload(
                [
                    _employe("alice", plan_un=["2026-W30", "2026-W31"], historique=0),
                    _employe(
                        "chloe",
                        plan_un=["2026-W30", "2026-W31"],
                        historique=2,
                        repli=["2026-W37", "2026-W38"],
                    ),
                ],
                minimum_convoitees=35.0,
            )
        )

        self.assertEqual(response["status"], "optimal")
        self.assertIn("alice", response["firstChoiceEmployeeIds"])
        self.assertNotIn("chloe", response["firstChoiceEmployeeIds"])
        self.assertEqual(response["grants"]["chloe"], ["2026-W37", "2026-W38"])

    def test_elle_est_vide_et_non_absente_quand_personne_n_est_servi(self) -> None:
        # Une clé qui apparaît et disparaît selon les données oblige chaque
        # lecteur à se demander si « rien » veut dire « aucun » ou « pas
        # calculé ». L'écran, lui, en tire « rien à comparer ».
        response = main(_payload([], minimum_convoitees=0.0))

        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["firstChoiceEmployeeIds"], [])


if __name__ == "__main__":
    unittest.main()
