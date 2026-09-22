"""Combien de personnes à la fois, et plus seulement combien d'heures.

La couverture ne raisonnait qu'en HEURES. Deux temps partiels qui pèsent autant
qu'un temps plein ne le remplacent pourtant pas quand il s'agit de tenir un
comptoir, d'ouvrir ou de fermer — et « pas plus de deux en congé en même temps »
est la phrase que prononce un gérant, que le minimum d'heures ne sait pas dire.

`null` vaut « aucun plafond » : c'est le comportement d'avant ce champ, et celui
de toute campagne qui n'a pas réglé la case. Zéro est une valeur LÉGITIME et
distincte — elle ferme la semaine à tout le monde.
"""

from __future__ import annotations

import unittest

from paid_leave_solver import main

WEEKS = [f"2026-W{number:02d}" for number in range(26, 34)]
CONVOITEE = "2026-W30"


def _payload(plafond: int | None, *, nombre: int = 4, heures: float = 35.0) -> dict:
    """Quatre salariés d'un même rayon qui veulent tous la même semaine.

    Le minimum d'HEURES est à zéro partout : seul le plafond d'effectif peut
    donc limiter quoi que ce soit, et ce que le solveur rend ne vient que de lui.
    """
    employes = [
        {
            "id": f"e{index}",
            "name": f"Salarié {index}",
            "sectorId": "drive",
            "contractHours": heures,
            "targetWeeks": 1,
            "linkedEmployeeId": None,
            "seniorityOrder": nombre - index,
            "firstChoiceHistory": 0,
            "plans": [{"rank": 1, "weekIds": [CONVOITEE]}],
            "unavailableWeekIds": [],
        }
        for index in range(nombre)
    ]
    return {
        "campaignId": "test-effectif",
        "timeoutSeconds": 20,
        "weeks": WEEKS,
        "sectors": [{"id": "drive", "name": "Drive"}],
        "employees": employes,
        "coverage": [
            {
                "sectorId": "drive",
                "weekId": week,
                "baseContractHours": heures * nombre,
                "minimumHours": 0.0,
                "toleratedDeficitHours": 0.0,
                "maximumAbsent": plafond if week == CONVOITEE else None,
            }
            for week in WEEKS
        ],
        "reinforcementPools": [],
    }


def _absents(response: dict) -> int:
    return sum(len(weeks) for weeks in response["grants"].values())


class HeadcountCap(unittest.TestCase):
    def test_le_plafond_limite_le_nombre_de_partants(self) -> None:
        """Quatre demandeurs, deux places : deux partent.

        Aucun minimum d'heures ne joue ici. Sans le plafond, les quatre
        partiraient — c'est le cas de référence du test suivant.
        """
        response = main(_payload(2))
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(_absents(response), 2)
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 2.0)

    def test_sans_plafond_tout_le_monde_part(self) -> None:
        """`null` ne change rien : c'est le comportement d'avant ce champ."""
        response = main(_payload(None))
        self.assertEqual(_absents(response), 4)
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 0.0)

    def test_le_champ_absent_vaut_aucun_plafond(self) -> None:
        """Une charge utile antérieure au champ reste valide et inchangée."""
        payload = _payload(None)
        for cellule in payload["coverage"]:
            del cellule["maximumAbsent"]
        response = main(payload)
        self.assertEqual(_absents(response), 4)

    def test_un_plafond_a_zero_ferme_la_semaine(self) -> None:
        """Zéro n'est pas « pas de plafond » : c'est « personne ».

        La distinction est le seul piège de ce champ, et la seule raison pour
        laquelle il est `int | null` plutôt qu'un simple entier.
        """
        response = main(_payload(0))
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(_absents(response), 0)
        self.assertEqual(response["objectiveValues"]["unserved_weeks"], 4.0)

    def test_le_plafond_ne_rend_jamais_la_campagne_infaisable(self) -> None:
        """Même à zéro : n'accorder aucun congé respecte tout plafond.

        C'est ce qui autorise cette contrainte à être DURE du côté des salariés
        sans réintroduire le refus tout-ou-rien qu'on avait retiré. L'écart
        absorbe, et le gérant reçoit une proposition au lieu d'une phrase d'échec.
        """
        for plafond in (0, 1, 2, 3):
            with self.subTest(plafond=plafond):
                response = main(_payload(plafond))
                self.assertEqual(response["status"], "optimal")
                self.assertEqual(_absents(response), plafond)

    def test_les_heures_et_les_effectifs_se_cumulent(self) -> None:
        """Le plus contraignant des deux gagne, et c'est bien une conjonction.

        Deux places d'effectif, mais un minimum d'heures qui n'en autorise
        qu'une : une seule personne part. Ni l'un ni l'autre seul ne le dirait.
        """
        payload = _payload(2)
        for cellule in payload["coverage"]:
            if cellule["weekId"] == CONVOITEE:
                # 140 h de base, 105 h exigées : une seule absence de 35 h.
                cellule["minimumHours"] = 105.0
        response = main(payload)
        self.assertEqual(_absents(response), 1)

    def test_le_plafond_ne_vaut_que_pour_son_rayon(self) -> None:
        """Le comptoir d'à côté n'est pas concerné par le plafond du Drive."""
        payload = _payload(1)
        payload["sectors"].append({"id": "caisse", "name": "Caisse"})
        payload["employees"].append(
            {
                "id": "z0",
                "name": "Caissière",
                "sectorId": "caisse",
                "contractHours": 35.0,
                "targetWeeks": 1,
                "linkedEmployeeId": None,
                "seniorityOrder": 1,
                "firstChoiceHistory": 0,
                "plans": [{"rank": 1, "weekIds": [CONVOITEE]}],
                "unavailableWeekIds": [],
            }
        )
        payload["coverage"].extend(
            {
                "sectorId": "caisse",
                "weekId": week,
                "baseContractHours": 35.0,
                "minimumHours": 0.0,
                "toleratedDeficitHours": 0.0,
                "maximumAbsent": None,
            }
            for week in WEEKS
        )
        response = main(payload)
        # Une personne du Drive, plus la caissière que rien ne limite.
        self.assertEqual(_absents(response), 2)
        self.assertEqual(response["grants"]["z0"], [CONVOITEE])


if __name__ == "__main__":
    unittest.main()
