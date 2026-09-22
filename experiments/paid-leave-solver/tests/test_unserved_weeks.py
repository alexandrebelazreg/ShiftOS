"""Ce qui n'a pas pu être servi — et qui vaut mieux qu'un refus.

La cible de chacun était une ÉGALITÉ nue : `Σ semaines accordées = demandé`.
Une campagne dont la couverture interdit de tout accorder n'avait donc aucune
solution, et le gérant recevait `infeasible` — rien du tout — là où « deux
semaines sur quatre » était la bonne réponse. Une heure de saisie des vœux pour
une phrase d'échec, sans aucune indication de ce qu'il fallait relâcher.

L'écart est maintenant une variable, minimisée avant tout le reste, puis répartie
pour qu'il ne retombe pas sur une seule personne. Deux propriétés en découlent,
et ce fichier les tient toutes les deux :

- une campagne qui passait rend EXACTEMENT le même résultat qu'avant ;
- `infeasible` ne désigne plus qu'une seule cause, et on peut enfin la nommer.
"""

from __future__ import annotations

import unittest

from paid_leave_solver import main

WEEKS = ["2026-W30", "2026-W31"]


def _payload(minimum: float, *, people: int = 4, target: int = 1) -> dict:
    """Quatre salariés à 35 h sur un rayon, deux semaines, chacun en veut une.

    La base du rayon vaut 140 h. Exiger 105 h de présence, c'est n'autoriser
    qu'un absent par semaine : deux attributions au total, et deux personnes qui
    repartent les mains vides. C'est une situation ORDINAIRE en juillet.
    """
    return {
        "campaignId": "test-manque",
        "timeoutSeconds": 20,
        "weeks": WEEKS,
        "sectors": [{"id": "drive", "name": "Drive"}],
        "employees": [
            {
                "id": f"e{index}",
                "name": f"Salarié {index}",
                "sectorId": "drive",
                "contractHours": 35.0,
                "targetWeeks": target,
                "linkedEmployeeId": None,
                "seniorityOrder": people - index,
                "firstChoiceHistory": 0,
                "plans": [{"rank": 1, "weekIds": list(WEEKS)}],
            }
            for index in range(people)
        ],
        "coverage": [
            {
                "sectorId": "drive",
                "weekId": week,
                "baseContractHours": 35.0 * people,
                "minimumHours": minimum,
                "toleratedDeficitHours": 0.0,
            }
            for week in WEEKS
        ],
        "reinforcementPools": [],
    }


def _granted(response: dict) -> int:
    return sum(len(weeks) for weeks in response["grants"].values())


class UnservedWeeks(unittest.TestCase):
    def test_une_campagne_trop_serree_repond_au_lieu_de_refuser(self) -> None:
        """105 h de présence exigées : un absent par semaine, donc deux servis."""
        response = main(_payload(minimum=105.0))
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(_granted(response), 2)
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 2.0)

    def test_aucun_conge_possible_se_dit_au_lieu_de_se_taire(self) -> None:
        """Présence totale exigée : la réponse est « personne », pas « erreur ».

        La distinction compte. Un échec envoie chercher une panne ; une
        attribution vide envoie regarder le minimum de couverture, qui est bien
        l'endroit où la décision se prend.
        """
        response = main(_payload(minimum=140.0))
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(_granted(response), 0)
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 4.0)

    def test_le_manque_se_repartit_au_lieu_de_tomber_sur_un_seul(self) -> None:
        """Deux personnes, deux semaines, une seule absence autorisée par semaine.

        Deux issues servent le même total : l'une donne ses deux semaines à une
        personne et rien à l'autre, l'autre en donne une à chacune. À total égal,
        c'est la seconde qu'un gérant peut défendre devant son équipe — et c'est
        ce que le second critère de l'étage impose.
        """
        response = main(_payload(minimum=35.0, people=2, target=2))
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(_granted(response), 2)
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 2.0)
        self.assertEqual(response["objectiveValues"]["worst_unserved_weeks"], 1.0)
        for weeks in response["grants"].values():
            self.assertEqual(len(weeks), 1)

    def test_une_campagne_qui_passait_ne_bouge_pas(self) -> None:
        """Rien à arbitrer : l'écart vaut zéro et le modèle est celui d'avant.

        La propriété qui autorise ce changement. Tant que tout peut être servi,
        la contrainte redevient l'égalité d'origine, et aucun étage suivant ne
        voit la différence.
        """
        response = main(_payload(minimum=0.0))
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(_granted(response), 4)
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 0.0)
        self.assertEqual(response["objectiveValues"]["worst_unserved_weeks"], 0.0)

    def test_infeasible_ne_designe_plus_que_la_couverture(self) -> None:
        """Un minimum au-dessus de ce que les contrats fournissent.

        C'est désormais la SEULE cause possible de refus, puisque n'accorder
        aucun congé est toujours une solution du côté des salariés. Le message
        peut donc la nommer au lieu de parler de « minimums et de leurs marges ».
        """
        response = main(_payload(minimum=175.0))
        self.assertEqual(response["status"], "infeasible")
        self.assertIn("hors d’atteinte", response["message"])

    def test_servir_le_plus_possible_prime_sur_le_rang_du_voeu(self) -> None:
        """Une semaine de rang 3 accordée vaut mieux qu'une personne non servie.

        L'ordre des étages le dit : l'écart se minimise AVANT les vœux. Sans
        cela, le solveur préférerait laisser quelqu'un les mains vides plutôt
        que de descendre d'un rang.
        """
        payload = _payload(minimum=105.0, people=2, target=1)
        payload["employees"][0]["plans"] = [{"rank": 1, "weekIds": ["2026-W30"]}]
        payload["employees"][1]["plans"] = [
            {"rank": 1, "weekIds": ["2026-W30"]},
            {"rank": 3, "weekIds": ["2026-W31"]},
        ]
        # 105 h exigées sur une base de 70 h : le minimum dépasse déjà la base,
        # donc on le ramène à ce qui autorise exactement un absent par semaine.
        for cell in payload["coverage"]:
            cell["minimumHours"] = 35.0

        response = main(payload)
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(_granted(response), 2)
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 0.0)
        self.assertEqual(response["grants"]["e1"], ["2026-W31"])


if __name__ == "__main__":
    unittest.main()
