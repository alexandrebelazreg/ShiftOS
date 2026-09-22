"""Le prix de chaque concession.

Le solveur rendait un VERDICT : voici la meilleure campagne, prouvée. Il ne
répondait pas à la question que le gérant pose ensuite, qui est toujours la
même : « et si j'acceptais de lâcher quelque chose ? ». Sans réponse, il
desserre un minimum au hasard, relance, compare à l'œil, recommence.

L'ordre lexicographique dit exactement où chercher. Servir un premier vœu de
plus est impossible sans dégrader un étage PLUS HAUT — c'est la définition même
de l'ordre. On relance donc la hiérarchie avec cet étage desserré d'une unité,
et on lit ce que l'équité y gagne.

Le budget le permet : la campagne est prouvée en quelques secondes sur les
soixante allouées.
"""

from __future__ import annotations

import unittest

from paid_leave_solver import main

WEEKS = [f"2026-W{number:02d}" for number in range(28, 34)]


def _employe(identifiant: str, plan_un: list[str]) -> dict:
    return {
        "id": identifiant,
        "name": identifiant.capitalize(),
        "sectorId": "drive",
        "contractHours": 35.0,
        "targetWeeks": len(plan_un),
        "linkedEmployeeId": None,
        "seniorityOrder": 1,
        "firstChoiceHistory": 0,
        "plans": [{"rank": 1, "weekIds": plan_un}],
        "unavailableWeekIds": [],
    }


def _payload(employes: list[dict], *, plafond: int | None) -> dict:
    return {
        "campaignId": "test-concessions",
        "timeoutSeconds": 30,
        "weeks": WEEKS,
        "closureWeekIds": [],
        "sectors": [{"id": "drive", "name": "Drive"}],
        "employees": employes,
        "coverage": [
            {
                "sectorId": "drive",
                "weekId": week,
                "baseContractHours": 35.0 * len(employes),
                "minimumHours": 0.0,
                "toleratedDeficitHours": 0.0,
                "maximumAbsent": plafond,
            }
            for week in WEEKS
        ],
        "reinforcementPools": [],
    }


def _levier(response: dict, key: str) -> dict | None:
    return next(
        (entry for entry in response["concessions"] if entry["lever"] == key), None
    )


class ConcessionsTests(unittest.TestCase):
    """Trois personnes, deux places, et un arbitrage que le modèle s'interdit.

    Alice et Bob veulent chacun S30 ET S31. Chloé ne veut que S30. Une seule
    personne peut s'absenter par semaine : il y a donc DEUX places pour CINQ
    semaines demandées.

    La meilleure campagne donne une semaine à Alice et une à Bob : trois
    semaines perdues, et personne n'en perd plus d'une. Mais alors PERSONNE
    n'est servi entièrement — deux demi-congés, et Chloé dehors.

    L'arbitrage que le modèle s'interdit : donner S30 à Chloé, qui est alors
    servie EN ENTIER. Il ne coûte pas une semaine de plus au total ; il coûte
    qu'une personne — Bob — perde ses deux semaines au lieu d'une. C'est
    exactement ce qu'un gérant veut qu'on lui propose, et ce qu'aucun réglage
    de minimum ne lui aurait fait découvrir.
    """

    def _campagne(self) -> dict:
        return _payload(
            [
                _employe("alice", ["2026-W30", "2026-W31"]),
                _employe("bob", ["2026-W30", "2026-W31"]),
                _employe("chloe", ["2026-W30"]),
            ],
            plafond=1,
        )

    def test_la_meilleure_campagne_ne_sert_personne_entierement(self) -> None:
        response = main(self._campagne())

        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 3.0)
        self.assertEqual(response["objectiveValues"]["worst_unserved_weeks"], 1.0)
        self.assertEqual(response["firstChoiceEmployeeIds"], [])

    def test_concentrer_la_perte_sert_quelqu_un_entierement(self) -> None:
        # LE test de cette fonctionnalité. La concession ne coûte aucune semaine
        # de plus : elle déplace la perte. Et elle transforme deux demi-congés
        # en un congé entier.
        levier = _levier(main(self._campagne()), "unserved_worst")

        self.assertIsNotNone(levier)
        assert levier is not None
        self.assertEqual(levier["firstChoiceServed"], 1)
        self.assertEqual(levier["employeeIds"], ["chloe"])

    def test_accorder_une_semaine_de_moins_n_apporte_rien_ici(self) -> None:
        # ET C'EST LA RÉPONSE LA PLUS UTILE DES QUATRE. Perdre une semaine de
        # plus, répartie comme avant, ne sert personne davantage : le gérant
        # peut cesser de chercher de ce côté-là. Un levier n'a pas besoin de
        # rapporter pour mériter d'être mesuré.
        levier = _levier(main(self._campagne()), "unserved_total")

        self.assertIsNotNone(levier)
        assert levier is not None
        self.assertEqual(levier["firstChoiceServed"], 0)
        self.assertEqual(levier["employeeIds"], [])

    def test_les_deux_leviers_sont_distincts(self) -> None:
        # Le même étage fusionné, deux questions. Les mélanger rendrait un
        # nombre dont personne ne saurait dire ce qu'il a coûté.
        response = main(self._campagne())
        keys = [entry["lever"] for entry in response["concessions"]]

        self.assertIn("unserved_total", keys)
        self.assertIn("unserved_worst", keys)
        self.assertEqual(len(keys), len(set(keys)))


class SansConcessionTests(unittest.TestCase):
    def test_une_campagne_qui_sert_tout_le_monde_n_a_rien_a_vendre(self) -> None:
        # Aucune tension : chacun a son premier vœu. Tous ceux qui POUVAIENT
        # l'avoir l'ont, donc aucune concession ne peut rien améliorer — c'est un
        # plafond, pas une estimation. On ne sonde même pas : proposer quatre
        # arbitrages à zéro gain ferait lire quatre lignes pour rien, et coûterait
        # des résolutions sur la campagne la plus banale qui soit.
        response = main(
            _payload(
                [
                    _employe("alice", ["2026-W30", "2026-W31"]),
                    _employe("bob", ["2026-W32", "2026-W33"]),
                ],
                plafond=None,
            )
        )

        self.assertEqual(response["objectiveValues"]["first_choice_served"], 2.0)
        self.assertEqual(response["concessions"], [])

    def test_les_couples_et_le_panachage_ne_sont_pas_mesures_sans_objet(self) -> None:
        # Aucun couple déclaré, aucun second plan : les étages correspondants
        # sont vides, donc sans épinglage à desserrer. Les proposer quand même
        # ferait croire à un arbitrage possible là où il n'y a rien.
        #
        # La campagne est ici sous tension — deux personnes pour une place — pour
        # que le plafond « tout le monde est déjà servi » ne coupe pas la mesure
        # avant d'avoir pu observer quels leviers sont proposés.
        response = main(
            _payload(
                [
                    _employe("alice", ["2026-W30"]),
                    _employe("bob", ["2026-W30"]),
                ],
                plafond=1,
            )
        )
        keys = [entry["lever"] for entry in response["concessions"]]

        self.assertNotIn("couples", keys)
        self.assertNotIn("mixed_plans", keys)

    def test_une_campagne_vide_ne_propose_aucune_concession(self) -> None:
        response = main(_payload([], plafond=None))

        self.assertEqual(response["concessions"], [])


if __name__ == "__main__":
    unittest.main()
