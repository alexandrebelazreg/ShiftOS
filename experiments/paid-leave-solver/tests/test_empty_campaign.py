"""Une campagne où personne n'a rien demandé.

Ce n'est pas un cas limite : c'est l'état de TOUTE campagne le jour où on la
crée. Il suffit d'y cliquer « Générer » une fois trop tôt — avant d'avoir saisi
le moindre vœu, avant d'avoir réglé la moindre marge de déficit, avant d'avoir
budgété la moindre enveloppe de renfort.

Le modèle ne porte alors aucune variable, et HiGHS refuse un objectif vide :
« `c` must be a one-dimensional array of finite numbers with at least one
element ». Le solveur levait, la route rendait une erreur technique, et le
gérant lisait un message de panne là où l'application sait déjà dire « aucune
semaine n'était demandée : le calcul n'avait rien à attribuer ».

Cette phrase existait depuis le début dans `describePaidLeaveOutcome`. Elle
n'avait simplement jamais l'occasion de s'afficher.

Trouvé en écrivant un test sur tout autre chose — la liste des servis au premier
vœu — et c'est la troisième fois dans ce module qu'une fixture trouve un défaut
que la lecture du code n'avait pas vu.
"""

from __future__ import annotations

import unittest

from paid_leave_solver import main

WEEKS = [f"2026-W{number:02d}" for number in range(28, 34)]


def _payload(
    *,
    employees: list[dict] | None = None,
    tolerated: float = 0.0,
    pools: list[dict] | None = None,
) -> dict:
    return {
        "campaignId": "test-vide",
        "timeoutSeconds": 20,
        "weeks": WEEKS,
        "closureWeekIds": [],
        "sectors": [{"id": "drive", "name": "Drive"}],
        "employees": employees or [],
        "coverage": [
            {
                "sectorId": "drive",
                "weekId": week,
                "baseContractHours": 35.0,
                "minimumHours": 0.0,
                "toleratedDeficitHours": tolerated,
                "maximumAbsent": None,
            }
            for week in WEEKS
        ],
        "reinforcementPools": pools or [],
    }


def _sans_voeu(identifiant: str) -> dict:
    """Une fiche complète, mais aucun plan : la personne n'a rien demandé."""
    return {
        "id": identifiant,
        "name": identifiant.capitalize(),
        "sectorId": "drive",
        "contractHours": 35.0,
        "targetWeeks": 0,
        "linkedEmployeeId": None,
        "seniorityOrder": 1,
        "firstChoiceHistory": 0,
        "plans": [],
        "unavailableWeekIds": [],
    }


class CampagneVideTests(unittest.TestCase):
    def test_une_equipe_qui_n_a_rien_demande_recoit_une_reponse(self) -> None:
        """Le cas réel : des salariés, des fiches, et pas encore un seul vœu."""
        response = main(_payload(employees=[_sans_voeu("alice"), _sans_voeu("bob")]))

        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["grants"], {"alice": [], "bob": []})

    def test_une_campagne_sans_personne_ne_leve_pas_non_plus(self) -> None:
        """Le magasin dont aucun salarié n'est encore actif."""
        response = main(_payload())

        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["grants"], {})

    def test_elle_rend_les_memes_cles_que_n_importe_quelle_autre(self) -> None:
        # Une clé qui apparaît et disparaît selon les données oblige chaque
        # lecteur à se demander si « rien » veut dire « aucun » ou « pas
        # calculé ». C'est l'écran qui en dépend : il compare la liste des
        # servis au premier vœu à sa propre lecture, et l'absence de clé lui
        # dirait « aucun » au lieu de « rien à comparer ».
        response = main(_payload(employees=[_sans_voeu("alice")]))

        self.assertEqual(response["firstChoiceEmployeeIds"], [])
        self.assertEqual(response["reinforcementAllocations"], [])
        self.assertEqual(response["objectiveValues"]["first_choice_served"], 0.0)
        self.assertEqual(response["objectiveValues"]["plans_used"], 0.0)

    def test_une_seule_variable_suffit_a_reprendre_le_chemin_normal(self) -> None:
        # La garde ne doit pas se déclencher dès que le modèle est PETIT, mais
        # seulement quand il est VIDE. Une marge de déficit réglée crée une
        # variable, et le solveur reprend sa route habituelle.
        response = main(_payload(employees=[_sans_voeu("alice")], tolerated=5.0))

        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["grants"], {"alice": []})
        self.assertEqual(response["objectiveValues"]["coverage_deficit"], 0.0)


if __name__ == "__main__":
    unittest.main()
