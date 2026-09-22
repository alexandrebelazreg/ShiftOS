"""Exact lexicographic MILP for Planiteo paid-leave campaigns.

Reads one JSON request on stdin and writes one JSON response on stdout. SciPy's
HiGHS backend must prove every lexicographic stage optimal; a feasible incumbent
is never returned as an applicable answer.

A campaign that cannot grant every requested week is answered, not refused: the
first stage minimises the weeks left unserved, then the worst individual loss.
`infeasible` therefore means one thing only — the coverage minimums exceed what
the sector's contracts can supply, with or without any leave at all.
"""

from __future__ import annotations

import json
import math
import sys
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import csr_matrix


@dataclass
class Variable:
    name: str
    lower: float
    upper: float
    integral: int


class Model:
    def __init__(self) -> None:
        self.variables: list[Variable] = []
        self.rows: list[dict[int, float]] = []
        self.lower: list[float] = []
        self.upper: list[float] = []

    def variable(self, name: str, lower: float = 0.0, upper: float = math.inf, integral: int = 0) -> int:
        index = len(self.variables)
        self.variables.append(Variable(name, lower, upper, integral))
        return index

    def constraint(self, coefficients: dict[int, float], lower: float = -math.inf, upper: float = math.inf) -> None:
        self.rows.append({index: value for index, value in coefficients.items() if abs(value) > 1e-12})
        self.lower.append(lower)
        self.upper.append(upper)

    def solve(self, objective: dict[int, float], time_limit: float):
        count = len(self.variables)
        data: list[float] = []
        row_indices: list[int] = []
        column_indices: list[int] = []
        for row_index, row in enumerate(self.rows):
            for column_index, coefficient in row.items():
                row_indices.append(row_index)
                column_indices.append(column_index)
                data.append(coefficient)
        matrix = csr_matrix((data, (row_indices, column_indices)), shape=(len(self.rows), count))
        c = np.zeros(count)
        for index, coefficient in objective.items():
            c[index] = coefficient
        return milp(
            c=c,
            integrality=np.array([variable.integral for variable in self.variables]),
            bounds=Bounds(
                np.array([variable.lower for variable in self.variables]),
                np.array([variable.upper for variable in self.variables]),
            ),
            constraints=LinearConstraint(matrix, np.array(self.lower), np.array(self.upper)),
            options={"time_limit": max(0.1, time_limit), "presolve": True},
        ), c


def add_to(row: dict[int, float], index: int, value: float) -> None:
    row[index] = row.get(index, 0.0) + value


def pin_tolerance(value: float, integral: bool, sensitivity: float = 1.0) -> float:
    """La largeur de la bande qui fige un objectif déjà résolu.

    ELLE SUIT LA SENSIBILITÉ DE L'OBJECTIF, pas seulement sa valeur.

    La cause est dans HiGHS, et elle est légitime : le point qu'il rend est
    faisable À SA PROPRE TOLÉRANCE près, de l'ordre de 1e-7 par contrainte. La
    valeur `c . x` calculée dessus peut donc être très légèrement MEILLEURE que
    tout ce que l'ensemble exactement faisable contient. L'épingler à cette
    valeur rend l'étage suivant infaisable — sur un problème qui ne l'est pas.

    L'erreur ainsi transportée est bornée par la somme des valeurs absolues des
    coefficients : un objectif qui additionne cent termes amplifie cent fois le
    jeu de chaque variable. C'est cette somme qui fixe la bande, et c'est
    pourquoi une tolérance simplement RELATIVE À LA VALEUR ne suffisait pas —
    `priority_seniority` vaut 135 mais pèse 500 en coefficients, et la bande
    calculée sur 135 était quatre fois trop étroite.

    Constaté le 3 septembre 2026 : une campagne sur dix rendait un faux
    `infeasible`, avec le message qui accuse les minimums de couverture —
    c'est-à-dire précisément celui qu'on venait de rendre fiable. Aucune
    reproduction déterministe n'a pu en être construite, le défaut tenant au
    chemin numérique du solveur et non à la forme du problème ; d'où cette
    fonction nommée, dont l'invariant se vérifie sans faire tourner de MILP.

    La bande reste très inférieure à 1 — le plus petit écart qui ait un sens sur
    un objectif entier — tant que les coefficients restent raisonnables, ce que
    la séparation des étages pondérés garantit par ailleurs.

    Elle ne suffit pas à elle seule sur un objectif CONTINU : là, c'est
    l'encadrement lui-même qu'il faut ouvrir d'un côté, quelle que soit sa
    largeur. Voir la boucle d'épinglage.
    """
    base = 1e-7 if integral else 1e-6
    return base * max(1.0, abs(value), sensitivity)


TIE_BREAK_STAGES = frozenset({"calendar_position", "tie_break"})


def carries_quality(stage: str) -> bool:
    """Cet étage change-t-il la QUALITÉ de la campagne, ou seulement sa forme ?

    Les deux derniers départagent ce que tous les autres ont laissé équivalent :
    à eux deux, ils ne touchent ni le nombre de semaines servies, ni les rangs de
    vœux, ni la couverture, ni l'équité. Ils rendent la réponse REPRODUCTIBLE, et
    c'est tout — ce qui est précieux, mais ne vaut pas de jeter une campagne
    entièrement prouvée par ailleurs.

    Mesuré le 20 septembre 2026 : avec un plafond d'effectif sur soixante
    salariés, ces deux étages coûtent à eux seuls dix-neuf secondes sur quarante.
    C'est le cas où le temps peut manquer, et c'est justement celui où l'on
    préfère une réponse optimale mais arbitraire à pas de réponse du tout.

    Une fonction plutôt qu'un test d'appartenance en ligne : la branche qu'elle
    commande ne se déclenche que sur une campagne assez lourde pour épuiser son
    budget, ce qu'aucun test unitaire ne peut provoquer sans devenir instable.
    Nommée, la règle s'éprouve sans MILP.
    """
    return stage not in TIE_BREAK_STAGES


# LES CONCESSIONS SONT UN SUPPLÉMENT, LA CAMPAGNE PROUVÉE EST LE PRODUIT.
#
# Mesuré le 21 septembre 2026 : les sondes font passer le pire cas de 8,4 s à
# 18,0 s sur soixante. Le budget le permet largement, mais pas à n'importe quel
# prix : une campagne qui a déjà consommé l'essentiel du sien n'a pas à dépenser
# ce qui lui reste en informations d'appoint. D'où une réserve PROPORTIONNELLE :
# en deçà du quart du budget restant, on ne sonde plus rien.
CONCESSION_RESERVE_RATIO = 0.25
CONCESSION_RESERVE_FLOOR = 2.0


@dataclass
class Lever:
    """Une concession qu'on accepte, et de combien exactement.

    `key` est ce que l'écran nomme ; `stage` est l'étage qu'il faut desserrer
    pour l'obtenir. Les DEUX ne coïncident pas, et c'est tout l'intérêt.

    `unit` ajouté à la borne haute de l'épinglage suffit quand l'étage ne porte
    qu'un seul critère : un couple de moins vaut 1, un panachage de plus vaut 1.

    `unit = None` LIBÈRE l'épinglage et le remplace par `rows`. C'est ce qu'il
    faut pour un étage FUSIONNÉ, où « un cran de plus » ne veut rien dire tout
    seul. `unserved_weeks` vaut `poids x total + pire écart` : l'élargir d'une
    unité autorise le PIRE ÉCART à grandir, l'élargir d'un poids autorise le
    TOTAL à grandir — et aussi le pire, du même coup. Deux questions distinctes
    y dorment, et un seul levier les mélangerait :

      — « j'accorde une semaine de moins AU TOTAL, répartie comme avant »
      — « j'accepte qu'UNE PERSONNE perde une semaine de plus que les autres »

    La seconde ne coûte rien au total et peut pourtant tout changer : libérer
    deux demi-congés pour en servir un entier est exactement le genre d'arbitrage
    qu'un gérant veut voir proposé, et que le modèle s'interdit tout seul.
    """

    key: str
    stage: str
    unit: float | None
    rows: list[tuple[dict[int, float], float, float]]


def unserved_levers(
    shortfalls: list[int],
    worst_shortfall: int | None,
    objective_values: dict[str, float],
) -> list[Lever]:
    """Les deux questions que l'étage fusionné des semaines non servies contient.

    Chacune fixe l'un des deux critères à sa valeur prouvée et desserre l'autre
    d'exactement un. C'est la seule façon d'obtenir des réponses qu'on puisse
    LIRE : desserrer la somme pondérée rendrait un nombre dont personne ne
    saurait dire ce qu'il a coûté.
    """
    if not shortfalls or worst_shortfall is None:
        return []
    total = objective_values.get("unserved_weeks", 0.0)
    worst = objective_values.get("worst_unserved_weeks", 0.0)
    somme = {index: 1.0 for index in shortfalls}
    pire = {worst_shortfall: 1.0}
    return [
        Lever("unserved_total", "unserved_weeks", None, [
            (somme, -math.inf, total + 1.0),
            (pire, -math.inf, worst),
        ]),
        Lever("unserved_worst", "unserved_weeks", None, [
            (somme, -math.inf, total),
            (pire, -math.inf, worst + 1.0),
        ]),
    ]


def measure_concessions(
    model: "Model",
    objectives: list[tuple[str, dict[int, float]]],
    pin_rows: dict[str, int],
    levers: list[Lever],
    owner_of: dict[int, str],
    deadline: float,
    reserve: float,
    ceiling: int,
    base: int,
) -> list[dict[str, Any]]:
    """LE PRIX DE CHAQUE CONCESSION — ce que le budget inutilisé peut acheter.

    Le solveur rendait un VERDICT : voici la meilleure campagne, prouvée. Il ne
    répondait pas à la question que le gérant pose ensuite, qui est toujours la
    même : « et si j'acceptais de lâcher quelque chose ? ». Sans réponse, il
    desserre un minimum au hasard, relance, compare à l'œil, recommence.

    L'ordre lexicographique dit exactement où chercher. « Servir un premier vœu
    de plus » est impossible sans dégrader un étage PLUS HAUT — c'est la
    définition même de l'ordre. Il n'y en a que trois qui soient des décisions
    humaines : une semaine non servie de plus, un couple non réuni, un vœu
    panaché de plus. On relance donc la hiérarchie avec CET étage desserré d'une
    unité, et on lit ce que l'équité y gagne.

    CE QU'ON NE SONDE PAS, ET POURQUOI. La marge de couverture (`coverage_deficit`)
    arrive APRÈS l'équité : les étages du dessus en disposent déjà librement, et
    la desserrer ne peut rien libérer de plus. C'est une réponse en soi, et elle
    évite au gérant d'aller baisser des minimums pour rien.

    UN GAIN NUL EST LA RÉPONSE LA PLUS UTILE DES TROIS. « Renoncer à réunir un
    couple n'apporterait rien » ferme une question au lieu de l'ouvrir.

    Jamais au prix de la réponse : chaque sonde vérifie qu'il reste du budget,
    et la première qui n'aboutit pas arrête la série. Les concessions sont un
    supplément, la campagne prouvée est le produit.
    """
    names = [name for name, _ in objectives]
    if "first_choice_served" not in names:
        return []
    target = names.index("first_choice_served")
    if not objectives[target][1]:
        return []

    # RIEN À ACHETER, DONC RIEN À MESURER. Quand tout le monde qui POUVAIT être
    # servi entièrement au premier vœu l'est déjà, aucune concession ne peut
    # l'améliorer — c'est un plafond, pas une estimation. Le contrôle est exact et
    # gratuit, et il écarte d'un coup toutes les campagnes tranquilles.
    if base >= ceiling:
        return []

    measured: list[dict[str, Any]] = []
    base_rows = len(model.rows)

    for lever in levers:
        row = pin_rows.get(lever.stage)
        if row is None or names.index(lever.stage) >= target:
            continue
        if deadline - time.monotonic() < reserve:
            break

        # LES ÉPINGLAGES DU DESSOUS SONT LIBÉRÉS, et c'est le cœur de la mécanique.
        #
        # Ils ont été calculés sous l'étage qu'on vient de desserrer ; les garder
        # interdirait précisément l'amélioration qu'on cherche à mesurer. Ceux du
        # DESSUS restent : une concession sur un étage ne s'autorise pas à en
        # dégrader un plus important au passage.
        saved = {index: (model.lower[index], model.upper[index]) for index in pin_rows.values()}
        level = names.index(lever.stage)
        for name, pinned in pin_rows.items():
            if names.index(name) > level:
                model.lower[pinned], model.upper[pinned] = -math.inf, math.inf
        if lever.unit is None:
            model.lower[row], model.upper[row] = -math.inf, math.inf
            for coefficients, low, high in lever.rows:
                model.constraint(coefficients, low, high)
        else:
            model.upper[row] = saved[row][1] + lever.unit

        gained: list[str] | None = None
        count: int | None = None
        for step in range(level + 1, target + 1):
            step_name, step_objective = objectives[step]
            if not step_objective:
                continue
            remaining = deadline - time.monotonic()
            if remaining < reserve:
                break
            result, vector = model.solve(step_objective, remaining)
            if result.status != 0 or result.x is None:
                break
            value = float(np.dot(vector, result.x))
            if step == target:
                count = int(round(-value))
                gained = sorted(
                    owner_of[index]
                    for index in step_objective
                    if index in owner_of and float(result.x[index]) > 0.5
                )
                break
            entier = all(model.variables[index].integral for index in step_objective)
            tolerance = pin_tolerance(
                value, entier, sum(abs(coefficient) for coefficient in step_objective.values())
            )
            if entier:
                model.constraint(step_objective, value - tolerance, value + tolerance)
            else:
                model.constraint(step_objective, upper=value + tolerance)

        del model.rows[base_rows:]
        del model.lower[base_rows:]
        del model.upper[base_rows:]
        for index, (low, high) in saved.items():
            model.lower[index], model.upper[index] = low, high

        if count is None or gained is None:
            # Une sonde qui n'aboutit pas arrête la série : les suivantes sont
            # plus chères, pas moins, et une liste à trous ferait croire qu'une
            # concession n'apporte rien alors qu'elle n'a pas été mesurée.
            break
        measured.append(
            {"lever": lever.key, "firstChoiceServed": count, "employeeIds": gained}
        )

    return measured


def main(payload: dict[str, Any]) -> dict[str, Any]:
    started = time.monotonic()
    deadline = started + float(payload.get("timeoutSeconds", 60))
    model = Model()
    employees = {employee["id"]: employee for employee in payload["employees"]}
    choices: dict[tuple[str, str], int] = {}

    # LE MAGASIN FERME : IL N'Y A RIEN À DÉCIDER, ET RIEN À TENIR.
    #
    # L'article L3141-16 laisse à l'employeur le soin de fixer l'ordre et les
    # dates des départs ; la fermeture annuelle en est le cas le plus simple. Elle
    # ne s'arbitre pas — d'où son absence totale des objectifs : aucune variable
    # d'attribution, aucun plan, aucun rang.
    #
    # Trois conséquences, et la troisième est la moins évidente :
    #   1. aucun minimum de couverture à tenir, puisque personne ne travaille ;
    #   2. aucune attribution à prendre sur ces semaines ;
    #   3. une semaine fermée SOUDE les congés de part et d'autre. Sans elle,
    #      accorder S31 autour d'une fermeture en S32 puis S33 compterait deux
    #      morceaux là où le salarié vit une seule absence de trois semaines, et
    #      l'étage `leave_blocks` dépenserait de la qualité à éviter une coupure
    #      qui n'existe pas.
    #
    # Le filtrage vit ICI et non dans l'appelant, même si le contrat ôte déjà ces
    # semaines des plans : c'est le solveur qui répond de ce qu'il a résolu, et une
    # charge utile bâtie à la main ne doit pas pouvoir lui faire vendre une
    # semaine fermée.
    closure = {str(week_id) for week_id in payload.get("closureWeekIds", [])}

    # CE QUI N'A PAS PU ÊTRE SERVI, ET QUI DOIT POUVOIR NE PAS L'ÊTRE
    #
    # La cible était une ÉGALITÉ NUE : `Σ x = targetWeeks`. Une campagne dont la
    # couverture interdit d'accorder tout ce qui est demandé n'avait alors AUCUNE
    # solution, et le gérant recevait `infeasible` — c'est-à-dire rien — là où
    # « deux semaines sur quatre » était la bonne réponse. Une heure de saisie
    # des vœux pour une phrase d'échec.
    #
    # L'écart devient une variable, minimisée avant tout le reste. Quand il peut
    # valoir zéro il vaut zéro, et le modèle redevient EXACTEMENT celui d'avant :
    # une campagne qui passait rend le même résultat, à la semaine près.
    shortfalls: list[int] = []
    max_target = 0

    for employee in payload["employees"]:
        employee_id = employee["id"]
        # L'union des plans, chaque semaine une seule fois, avec le MEILLEUR des
        # rangs qui la contiennent. Une semaine présente dans deux plans ne donne
        # qu'une attribution — on ne part pas deux fois la même semaine — mais
        # elle reste rattachée aux DEUX plans, ce que `plan_weeks` retient plus
        # bas et que le rang seul ne dirait pas.
        # DÉJÀ ABSENT AILLEURS : la variable existe, mais elle est clouée à zéro.
        #
        # Rien ne croisait les deux écrans, et le solveur accordait des congés
        # payés à quelqu'un en arrêt maladie ou en congé parental — deux absences
        # superposées sur la même semaine, l'une décomptée du solde et l'autre
        # pas, découvertes à la paie.
        #
        # Clouée plutôt que supprimée : la semaine garde sa place dans les plans,
        # dans les morceaux de congé et dans le calcul du premier vœu, si bien
        # qu'aucun de ces mécanismes n'a de cas particulier à connaître. Une borne
        # [0, 0] est ce que le pré-traitement élimine le plus facilement.
        blocked = {str(week_id) for week_id in employee.get("unavailableWeekIds", [])}
        for plan in employee["plans"]:
            for week_id in plan["weekIds"]:
                if week_id in closure:
                    continue
                key = (employee_id, week_id)
                if key not in choices:
                    ceiling = 0 if week_id in blocked else 1
                    choices[key] = model.variable(
                        f"grant:{employee_id}:{week_id}", 0, ceiling, 1
                    )
        row = {
            index: 1.0 for (emp, _week), index in choices.items() if emp == employee_id
        }
        target = int(employee["targetWeeks"])
        if target > 0:
            shortfall = model.variable(f"shortfall:{employee_id}", 0, target, 1)
            shortfalls.append(shortfall)
            max_target = max(max_target, target)
            row = {**row, shortfall: 1.0}
        model.constraint(row, target, target)

    # Et servir le plus grand nombre de semaines ne suffit pas : encore faut-il
    # que le manque ne retombe pas sur une seule personne. À total égal, trois
    # salariés amputés d'une semaine valent mieux qu'un seul amputé de trois —
    # c'est la seule répartition qu'un gérant peut défendre devant l'équipe.
    worst_shortfall: int | None = None
    if shortfalls:
        worst_shortfall = model.variable("worst-shortfall", 0, max_target, 1)
        for shortfall in shortfalls:
            model.constraint({worst_shortfall: 1.0, shortfall: -1.0}, lower=0.0)

    # LE COUPLE EST RÉUNI, OU IL NE L'EST PAS — ET PLUS UN DÉCOMPTE DE SEMAINES.
    #
    # L'article L3141-14 donne aux conjoints d'une même entreprise un DROIT au
    # congé simultané. Ce droit se tient ou ne se tient pas ; il ne se mesure pas
    # en semaines. L'étage comptait pourtant `Σ z`, si bien qu'un couple voulant
    # quatre semaines ensemble pesait quatre fois deux couples n'en voulant
    # qu'une — exactement le défaut corrigé sur l'équité puis sur les vœux.
    #
    # Le critère : le couple est réuni quand il a obtenu ENSEMBLE au moins autant
    # de semaines que le plus court des deux congés DEMANDÉS. Demandés, et non
    # obtenus : une cible se lit sur ce que les deux ont écrit, jamais sur ce que
    # le calcul leur a laissé — sans quoi deux personnes repartant les mains
    # vides seraient « réunies ».
    #
    # ENTIÈRE, et c'est le point délicat. Continue, elle vaudrait `Σz / cible` et
    # rendrait un demi-couple pour une semaine partagée sur deux : la
    # proportionnalité que l'on vient précisément de chasser. Bornée à l'entier,
    # elle ne vaut un que lorsque le droit est effectivement tenu.
    #
    # Le chevauchement partiel n'est pas perdu pour autant : il descend d'un
    # cran, au troisième critère, où il départage ce que les deux premiers ont
    # laissé égal. Mieux vaut une semaine ensemble que zéro.
    common_variables: list[tuple[int, int]] = []
    reunited_variables: list[tuple[int, int]] = []
    seen_pairs: set[tuple[str, str]] = set()
    for employee in payload["employees"]:
        partner_id = employee.get("linkedEmployeeId")
        if not partner_id or partner_id not in employees:
            continue
        pair = tuple(sorted((employee["id"], partner_id)))
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        left, right = pair
        common_weeks = sorted(
            {week for emp, week in choices if emp == left}
            & {week for emp, week in choices if emp == right}
        )
        seniority_weight = max(int(employees[left]["seniorityOrder"]), int(employees[right]["seniorityOrder"]))
        shared: list[int] = []
        for week_id in common_weeks:
            z = model.variable(f"common:{left}:{right}:{week_id}", 0, 1, 1)
            x_left = choices[(left, week_id)]
            x_right = choices[(right, week_id)]
            model.constraint({z: 1.0, x_left: -1.0}, upper=0.0)
            model.constraint({z: 1.0, x_right: -1.0}, upper=0.0)
            model.constraint({z: 1.0, x_left: -1.0, x_right: -1.0}, lower=-1.0)
            common_variables.append((z, seniority_weight))
            shared.append(z)

        together = min(
            int(employees[left]["targetWeeks"]), int(employees[right]["targetWeeks"])
        )
        if together > 0 and shared:
            reunited = model.variable(f"reunited:{left}:{right}", 0, 1, 1)
            # cible x reunited - Σ z <= 0 : le drapeau ne peut monter que si les
            # semaines partagées couvrent le plus court des deux congés.
            model.constraint(
                {reunited: float(together), **{z: -1.0 for z in shared}}, upper=0.0
            )
            reunited_variables.append((reunited, seniority_weight))

    # QUEL PLAN, ET NON PLUS QUEL RANG
    #
    # `rank_used` et `mixed` raisonnaient sur le RANG d'une semaine, pas sur son
    # appartenance à un plan. C'était la seule information que le contrat aplati
    # laissait passer, et elle ne suffit pas : une semaine figurant dans deux
    # plans ne porte que le plus petit de ses rangs, si bien qu'accorder le plan
    # de repli en entier pouvait se comptabiliser comme un mélange.
    #
    # Une variable par PLAN, et une seule règle : une semaine ne s'accorde que si
    # l'un des plans qui la contiennent est retenu. Le reste suit — inutile de
    # forcer `plan_used` vers le haut, la contrainte le fait, et l'objectif qui
    # le minimise le ramène à zéro partout où il ne sert pas.
    #
    # Entières, contrairement aux débuts de morceaux : une semaine partagée entre
    # deux plans laisserait sinon le solveur retenir « un demi-plan chacun »,
    # ce qui coûte le même total mais ne désigne plus aucun plan.
    plan_variables: list[int] = []
    plan_rank: dict[int, int] = {}
    extra_plan_variables: list[int] = []
    for employee in payload["employees"]:
        employee_id = employee["id"]
        plan_weeks: dict[int, list[str]] = {}
        used_here: list[int] = []
        for plan in employee["plans"]:
            open_weeks = [week for week in plan["weekIds"] if week not in closure]
            if not open_weeks:
                continue
            used = model.variable(f"plan-used:{employee_id}:{plan['rank']}", 0, 1, 1)
            plan_variables.append(used)
            plan_rank[used] = int(plan["rank"])
            used_here.append(used)
            for week_id in open_weeks:
                plan_weeks.setdefault(week_id, []).append(used)

        # LES PLANS EN TROP, ET SURTOUT PAS LEUR TOTAL.
        #
        # Minimiser `Σ plan_used` récompensait le fait de ne servir PERSONNE :
        # quelqu'un qui repart les mains vides n'utilise aucun plan, donc coûte
        # moins cher que celui à qui l'on accorde la moitié du sien. Sur deux
        # issues à écart égal, le modèle préférait laisser quelqu'un dehors —
        # l'exact contraire de ce que l'étage de l'écart venait d'établir.
        #
        # Le coût porte donc sur le DÉBORDEMENT : zéro pour un plan pur comme
        # pour une personne non servie, un pour deux plans, deux pour trois.
        if len(used_here) > 1:
            extra = model.variable(
                f"extra-plans:{employee_id}", 0, len(used_here) - 1, 0
            )
            model.constraint(
                {extra: 1.0, **{used: -1.0 for used in used_here}}, lower=-1.0
            )
            extra_plan_variables.append(extra)

        for week_id, carriers in plan_weeks.items():
            granted = choices.get((employee_id, week_id))
            if granted is None:
                continue
            # granted - Σ plans qui la portent <= 0
            model.constraint(
                {granted: 1.0, **{used: -1.0 for used in carriers}}, upper=0.0
            )

    # SERVI ENTIÈREMENT SUR SON PREMIER PLAN — LA MÊME UNITÉ QUE L'HISTORIQUE
    #
    # `firstChoiceHistory` compte des PERSONNES intégralement servies au premier
    # vœu, une par campagne validée : c'est ce que `grantIsEntirelyFirstChoice`
    # mesure côté application, et c'est ce que la validation range dans
    # `fullFirstChoiceEmployeeIds`. L'objectif d'équité, lui, pondérait des
    # SEMAINES de rang 1. Il optimisait donc autre chose que ce qu'il prétendait
    # rattraper — et il récompensait la TAILLE de la demande, quelqu'un qui
    # réclamait quatre semaines pesant quatre fois celui qui en réclamait une.
    #
    # Une binaire par personne, vraie quand tout le premier plan est accordé et
    # que rien d'autre ne l'est. Continue, comme les débuts de morceaux : bornée
    # au-dessus par des attributions binaires, elle ne peut valoir que 0 ou 1 à
    # l'optimum, et la déclarer entière coûterait une variable de plus par
    # salarié sans rien resserrer.
    #
    # Pas de variable quand le premier plan est plus COURT que la cible : la
    # personne ne pourrait alors jamais être « entièrement au premier vœu » au
    # sens de l'application, et en fabriquer une ici ferait diverger les deux
    # définitions — exactement le genre d'écart qui rend une campagne
    # invalidable sans que rien ne le dise.
    first_choice: list[tuple[int, int]] = []
    # À QUI appartient chaque variable, pour pouvoir NOMMER qui a été compté.
    #
    # Le même prédicat — « tout son premier plan, et rien d'autre » — existe une
    # seconde fois côté application, où la validation le fige dans
    # `fullFirstChoiceEmployeeIds` et le transporte d'une campagne à l'autre.
    # Deux écritures d'une même règle dont tout l'édifice d'équité dépend, et
    # dont le désaccord ne se verrait qu'À LA CAMPAGNE SUIVANTE, un an plus tard,
    # sous la forme « pourquoi cette personne ne passe-t-elle pas devant ? ».
    #
    # Rendre la liste ne supprime pas le doublon — l'application doit pouvoir
    # juger des attributions retouchées à la main, que le solveur n'a jamais
    # vues. Elle supprime le SILENCE : les deux lectures peuvent enfin être
    # comparées sur les mêmes attributions, à chaque calcul, sur de vraies
    # données — ce qu'aucun jeu d'essai écrit à l'avance ne couvrirait.
    first_choice_employee: dict[int, str] = {}
    for employee in payload["employees"]:
        employee_id = employee["id"]
        target = int(employee["targetWeeks"])
        plan_one = next(
            (plan for plan in employee["plans"] if int(plan["rank"]) == 1), None
        )
        if target <= 0 or plan_one is None:
            continue
        # Sans les semaines fermées, comme la cible : la personne les obtient de
        # toute façon, et les compter ici rendrait le plan plus long que ce qu'il
        # reste à servir — la variable disparaîtrait, et avec elle tout le
        # rattrapage d'équité, sur la seule foi d'une fermeture.
        wanted = {week_id for week_id in plan_one["weekIds"] if week_id not in closure}
        if len(wanted) != target:
            continue

        served = model.variable(f"first-choice:{employee_id}", 0, 1, 0)
        for (emp, week_id), granted in list(choices.items()):
            if emp != employee_id:
                continue
            if week_id in wanted:
                # served <= granted : il faut TOUTES les semaines du plan.
                model.constraint({served: 1.0, granted: -1.0}, upper=0.0)
            else:
                # served + granted <= 1 : et rien qui vienne d'ailleurs.
                model.constraint({served: 1.0, granted: 1.0}, upper=1.0)
        first_choice.append((served, int(employee["firstChoiceHistory"])))
        first_choice_employee[served] = employee_id

    # LA FORME DES CONGÉS, ET NON PLUS SEULEMENT LEUR NOMBRE
    #
    # Rien n'empêchait d'accorder les semaines 29, 30 et 36. Le modèle jugeait
    # cette attribution STRICTEMENT ÉQUIVALENTE à 28, 29 et 30 — mêmes rangs de
    # vœux, même couverture, même coût — et repartait avec l'une ou l'autre selon
    # l'ordre dans lequel les salariés lui étaient présentés. Deux semaines
    # d'affilée plus une isolée six semaines plus tard, ce n'est pas des vacances.
    #
    # C'est aussi ce que la loi regarde : l'article L3141-18 impose au congé
    # principal de plus de douze jours ouvrables d'en comporter douze
    # CONSÉCUTIFS, soit deux semaines d'un bloc. Minimiser les morceaux ne le
    # PROUVE pas — la couverture peut interdire tout regroupement — mais c'est ce
    # qui fait que le cas normal le respecte au lieu d'y échapper par hasard.
    #
    # Un morceau se compte par son DÉBUT : une semaine accordée dont la
    # précédente ne l'est pas. `start >= x(w) - x(w-1)`, et rien d'autre. La
    # borne supérieure est inutile puisqu'on minimise la somme — le solveur
    # ramène chaque `start` à sa plus petite valeur admissible tout seul.
    #
    # Continues à dessein, alors qu'elles valent 0 ou 1 : leur intégralité DÉCOULE
    # de celle des `x`, et la déclarer coûterait autant de variables entières que
    # de vœux sans rien ajouter au modèle.
    week_order = {week_id: position for position, week_id in enumerate(payload["weeks"])}
    block_starts: list[int] = []
    worst_blocks: int | None = None

    for employee in payload["employees"]:
        employee_id = employee["id"]
        starts_of_employee: list[int] = []
        # L'union déjà dédoublonnée, et non les plans : une semaine présente dans
        # deux d'entre eux n'a qu'une attribution, donc qu'un début de morceau.
        for (emp, week_id), granted in list(choices.items()):
            if emp != employee_id:
                continue
            # La semaine d'avant DANS LA CAMPAGNE, et non celle qu'un calcul sur
            # le numéro ISO donnerait : une campagne d'hiver passe de la semaine
            # 52 à la semaine 1 de l'année suivante, et « 1 - 1 » n'y mène nulle
            # part. La position dans la liste des semaines est la seule notion
            # d'adjacence qui traverse le changement d'année.
            position = week_order.get(week_id)
            before = (
                payload["weeks"][position - 1]
                if position is not None and position > 0
                else None
            )

            # UNE SEMAINE DE FERMETURE VAUT UNE SEMAINE D'ABSENCE, et la règle
            # devient vacante : `start >= x - 1` est vraie pour tout `start >= 0`.
            # Ni variable ni ligne, donc — ce qui DIT exactement « cette semaine
            # ne peut pas ouvrir de morceau », là où une variable laissée libre et
            # ramenée à zéro par l'objectif ne ferait que s'y résoudre.
            if before is not None and before in closure:
                continue

            start = model.variable(f"block-start:{employee_id}:{week_id}", 0, 1, 0)
            starts_of_employee.append(start)
            block_starts.append(start)
            previous = (
                choices.get((employee_id, before)) if before is not None else None
            )

            # Sans semaine précédente — début de campagne, ou semaine que cette
            # personne n'a pas demandée — celle-ci ouvre forcément un morceau.
            row = {start: 1.0, granted: -1.0}
            if previous is not None:
                row[previous] = 1.0
            model.constraint(row, lower=0.0)

        if starts_of_employee:
            if worst_blocks is None:
                worst_blocks = model.variable("worst-blocks", 0, max(1, max_target), 0)
            # Même raisonnement que pour l'écart : à nombre total de morceaux
            # égal, deux salariés coupés en deux valent mieux qu'un seul coupé en
            # quatre. La somme seule ne distingue pas les deux.
            model.constraint(
                {worst_blocks: 1.0, **{start: -1.0 for start in starts_of_employee}},
                lower=0.0,
            )

    # Reinforcement variables by applicable pool and coverage cell.
    reinforcement: dict[tuple[str, str, str], int] = {}
    for pool in payload["reinforcementPools"]:
        row: dict[int, float] = {}
        for cell in payload["coverage"]:
            applies = (
                pool["startWeekId"] <= cell["weekId"] <= pool["endWeekId"]
                and (pool["scope"] == "global" or pool.get("sectorId") == cell["sectorId"])
            )
            if not applies:
                continue
            key = (pool["id"], cell["sectorId"], cell["weekId"])
            variable = model.variable(f"reinforce:{':'.join(key)}", 0, float(pool["totalHours"]), 0)
            reinforcement[key] = variable
            row[variable] = 1.0
        model.constraint(row, upper=float(pool["totalHours"]))

    # PAS DE VARIABLE QUAND LA MARGE EST NULLE.
    #
    # `toleratedDeficitHours` vaut ZÉRO par défaut — c'est ce qu'écrit
    # `createPaidLeaveCampaign`, et ce que voit tout gérant qui n'a pas réglé la
    # colonne « marge orange ». La variable de déficit était créée quand même,
    # bornée `[0, 0]` : cent trente variables mortes sur sept cent huit, et un
    # étage lexicographique entier qui les optimisait.
    #
    # Mesuré le 20 septembre 2026 : 27,1 s au lieu de 22,6 s à soixante salariés,
    # pour une réponse rigoureusement identique. Le pré-traitement de HiGHS les
    # élimine, mais pas la résolution supplémentaire qu'elles justifiaient.
    #
    # `deficit_variables` ne portant plus que des variables vivantes, l'étage
    # disparaît de lui-même quand aucune marge n'est réglée : la boucle saute les
    # objectifs vides, et `coverage_deficit` est alors rendu à zéro — ce qu'il
    # vaut effectivement.
    deficit_variables: list[int] = []
    for cell in payload["coverage"]:
        # Magasin fermé : personne ne travaille, il n'y a pas de minimum à tenir.
        # Garder la ligne rendrait `infeasible` une campagne dont la seule faute
        # est d'avoir laissé un minimum saisi sur une semaine de fermeture — et
        # le message accuserait les contrats du rayon, qui n'y sont pour rien.
        if cell["weekId"] in closure:
            continue
        tolerated = float(cell["toleratedDeficitHours"])
        deficit = (
            model.variable(
                f"deficit:{cell['sectorId']}:{cell['weekId']}", 0, tolerated, 0
            )
            if tolerated > 0.0
            else None
        )
        row: dict[int, float] = {}
        if deficit is not None:
            deficit_variables.append(deficit)
            row[deficit] = -1.0
        for employee in payload["employees"]:
            if employee.get("sectorId") != cell["sectorId"]:
                continue
            choice = choices.get((employee["id"], cell["weekId"]))
            if choice is not None:
                add_to(row, choice, float(employee["contractHours"]))
        for pool in payload["reinforcementPools"]:
            variable = reinforcement.get((pool["id"], cell["sectorId"], cell["weekId"]))
            if variable is not None:
                add_to(row, variable, -1.0)
        # absent - reinforcement - deficit <= base - minimum
        model.constraint(row, upper=float(cell["baseContractHours"]) - float(cell["minimumHours"]))

        # COMBIEN DE PERSONNES, ET PLUS SEULEMENT COMBIEN D'HEURES.
        #
        # Le minimum d'heures ne sait pas dire « pas plus de deux en congé en
        # même temps », qui est pourtant la phrase que prononce un gérant. Deux
        # temps partiels pèsent autant qu'un temps plein sans le remplacer quand
        # il s'agit de tenir un comptoir, d'ouvrir ou de fermer.
        #
        # DURE, et c'est la seule contrainte de ce fichier à l'être du côté des
        # salariés. Elle peut donc rendre une campagne infaisable — non : l'écart
        # absorbe, puisque n'accorder aucun congé respecte tout plafond positif.
        # Un plafond à zéro ferme simplement la semaine, ce qui est exactement ce
        # qu'il déclare.
        #
        # `None` vaut « aucun plafond » : c'est le comportement d'avant ce champ,
        # et celui de toute campagne qui n'a pas réglé la case.
        ceiling = cell.get("maximumAbsent")
        if ceiling is not None:
            headcount = {
                choices[(employee["id"], cell["weekId"])]: 1.0
                for employee in payload["employees"]
                if employee.get("sectorId") == cell["sectorId"]
                and (employee["id"], cell["weekId"]) in choices
            }
            if headcount:
                model.constraint(headcount, upper=float(ceiling))

    objectives: list[tuple[str, dict[int, float]]] = []

    # SERVIR, AVANT DE SERVIR BIEN.
    #
    # Premier étage, avant les couples et avant les vœux : une semaine qu'on
    # n'accorde à personne est un échec d'une autre nature qu'un couple mal
    # synchronisé. Tant que l'écart peut valoir zéro, cet étage l'y force et
    # tous les suivants travaillent sur le même problème qu'avant.
    #
    # UN SEUL ÉTAGE POUR DEUX CRITÈRES, et c'est exact, pas approché. Ici les
    # coefficients restent petits, ce qui est la condition pour que la fusion
    # reste rentable — voir l'étage d'équité, où elle a dû être défaite. Les deux
    # sont des comptes entiers, et le pire écart individuel est borné par
    # `max_target`. En pondérant le total par `max_target + 1`, aucune économie
    # sur le pire ne peut compenser une semaine perdue au total : l'ordre
    # lexicographique est conservé, pour le prix d'une seule résolution.
    if shortfalls and worst_shortfall is not None:
        scale = float(max_target + 1)
        objectives.append((
            "unserved_weeks",
            {**{index: scale for index in shortfalls}, worst_shortfall: 1.0},
        ))

    # Trois critères, dans l'ordre où ils se décident : combien de couples sont
    # réunis, lesquels quand il faut choisir, et enfin ce qu'on sauve de
    # chevauchement chez ceux qui ne le sont pas.
    objectives.append((
        "priority_couples_reunited",
        {index: -1.0 for index, _ in reunited_variables},
    ))
    objectives.append((
        "priority_seniority",
        {index: -float(weight) for index, weight in reunited_variables},
    ))
    objectives.append((
        "priority_common_weeks",
        {index: -1.0 for index, _ in common_variables},
    ))

    # UN PLAN PAR PERSONNE, AVANT DE COMPTER LES RANGS.
    #
    # Ce départage vivait tout en bas, sous le nom de `mixed_plans`, et arrivait
    # donc APRÈS le départage des rangs. Le mal était déjà fait : celui-ci
    # maximisait le nombre de semaines de premier rang, si bien qu'une semaine
    # sauvée du plan préféré l'emportait toujours sur le plan de repli entier. Quelqu'un qui
    # demandait « W28+W29, sinon W32+W33 » repartait avec W28+W33 dès que W29
    # sautait — deux semaines isolées dans deux mois, ni l'un ni l'autre de ses
    # plans, et rien à l'écran pour dire que ce n'était pas ce qu'il avait écrit.
    #
    # Remonté ici, juste sous les priorités : un couple configuré passe encore
    # avant, parce que c'est une décision explicite du gérant, là où l'intégrité
    # d'un plan n'est qu'un défaut raisonnable.
    #
    # Objectif et non contrainte : quand la couverture ne laisse aucun plan
    # entier, mieux vaut un mélange annoncé que personne de servi.
    objectives.append(("extra_plans", {index: 1.0 for index in extra_plan_variables}))

    # L'ÉQUITÉ AVANT LE COMPTE DES SEMAINES, SANS QUOI ELLE NE SERT À RIEN.
    #
    # Mesuré le 3 septembre 2026 : placé sous le départage des rangs, cet étage
    # ne changeait STRICTEMENT RIEN — les taux de service étaient identiques
    # qu'il tourne ou non. Une résolution MILP pour zéro effet. La raison est que
    # ce départage décide déjà QUI obtient son premier plan, et qu'il le décidait
    # en comptant des semaines : entre quelqu'un qui n'a jamais eu son vœu et en
    # réclame deux, et quelqu'un qui l'a déjà eu deux fois et en réclame quatre,
    # il choisit le second. C'est exactement l'injustice que `firstChoiceHistory`
    # existe pour corriger, et elle se reproduisait campagne après campagne.
    #
    # Remonté ici, il arbitre AVANT que les semaines ne soient comptées. Un
    # champ tenu à jour par le gérant, transporté d'une campagne à l'autre et
    # figé à la validation, ne peut pas rester décoratif : ou il l'emporte sur
    # un décompte brut, ou il faut le supprimer.
    #
    # DEUX CRITÈRES, ET LE PREMIER PROTÈGE LE SECOND DE LUI-MÊME. On maximise
    # d'abord le NOMBRE de personnes entièrement servies au premier plan ;
    # l'ancienneté de l'attente ne départage qu'à nombre égal. Sans cette
    # précaution, une pondération seule aurait pu servir trois personnes qui
    # attendent depuis longtemps plutôt que cinq qui attendent moins — un recul
    # sur le seul chiffre que le gérant regarde vraiment.
    #
    # DEUX ÉTAGES, ET PAS LA FUSION GÉOMÉTRIQUE employée ailleurs dans ce
    # fichier. Elle tient deux critères entiers en une résolution, et c'est
    # excellent quand les coefficients restent petits — `unserved_weeks` et
    # `leave_blocks` en vivent. Ici le poids de tête vaut `max_history x effectif`,
    # soit plus de cent sur une équipe de soixante : la relaxation se dégrade, et
    # l'étage passait de 3,8 à **37,2 secondes** sur le même problème, pour un
    # résultat rigoureusement identique. Mesuré le 3 septembre 2026.
    #
    # La règle qui s'en dégage : fusionner tant que le poids de tête reste de
    # l'ordre de la dizaine, séparer au-delà. Deux étages faciles battent un
    # étage difficile.
    if first_choice:
        max_history = max(history for _, history in first_choice)
        objectives.append((
            "first_choice_served",
            {index: -1.0 for index, _ in first_choice},
        ))
        objectives.append((
            "waiting_cleared",
            {index: -float(max_history - history) for index, history in first_choice},
        ))

    # LE RANG OBTENU, PAR PERSONNE — ET PLUS UN DÉCOMPTE DE SEMAINES.
    #
    # Trois étages comptaient les semaines accordées à chaque rang. Ils
    # reproduisaient exactement le défaut corrigé sur l'équité : qui demande
    # BEAUCOUP passe devant qui demande peu, sans que personne l'ait décidé.
    #
    # Mesuré le 20 septembre 2026, soixante salariés. e48 réclamait trois
    # semaines, e18 en réclamait deux ; le décompte par semaines donnait donc le
    # premier plan à e48, et renvoyait e18 sur son TROISIÈME. Par personne, e18
    # obtient son premier plan et e48 son second — même nombre de semaines
    # servies, même nombre de morceaux, un salarié de moins sur son dernier vœu.
    # Somme des rangs obtenus : 89 avant, 88 après.
    #
    # `rang - 1` et non `rang` : le premier plan coûte ZÉRO, comme une personne
    # non servie. Sans cela, servir quelqu'un coûterait toujours plus cher que de
    # le laisser dehors — le piège dans lequel `plans_used` était tombé avant de
    # compter les débordements.
    #
    # Un étage au lieu de trois, et 77 à 93 % de temps en moins sur les campagnes
    # les plus lourdes. Ce n'est pas un effet de bord : trois étages épinglés
    # rétrécissent la relaxation de tous les suivants.
    objectives.append((
        "plan_rank",
        {index: float(plan_rank[index] - 1) for index in plan_variables},
    ))
    objectives.append(("coverage_deficit", {index: 1.0 for index in deficit_variables}))
    # APRÈS la couverture, AVANT le renfort, et les deux positions se justifient.
    #
    # Après la couverture : le magasin doit tenir avant que les congés ne soient
    # beaux. Et après l'équité, remontée bien plus haut — rattraper quelqu'un qui
    # n'a jamais eu son premier vœu pèse plus lourd que la forme du congé d'un
    # autre.
    #
    # Avant le renfort : une enveloppe d'appoint ne vaut pas qu'on coupe les
    # vacances de quelqu'un en deux. Le renfort restant à minimiser après coup,
    # on n'en dépense pas davantage — on refuse seulement d'en économiser au prix
    # d'un congé éclaté.
    #
    # Un seul étage pour deux critères, par la même pondération géométrique que
    # `unserved_weeks` : le pire nombre de morceaux d'un salarié est borné par
    # `max_target`, donc aucun gain sur lui ne peut compenser un morceau de plus
    # au total.
    # CE QU'IL NE FAUT PAS « CORRIGER » ICI.
    #
    # L'objection paraît solide : cet étage compte le TOTAL des morceaux, donc
    # quelqu'un dont le vœu est « deux semaines en juillet et deux en septembre »
    # coûte DEUX débuts là où un congé de quatre semaines d'affilée n'en coûte
    # qu'UN. Il serait donc défavorisé pour avoir voulu ce qu'il a écrit, et la
    # correction « naturelle » serait de ne pénaliser que l'excès par rapport au
    # plan retenu — exactement ce qu'on a dû faire pour `plans_used`.
    #
    # C'EST FAUX, ET LA RAISON EST STRUCTURELLE : cet étage arrive APRÈS
    # `first_choice_served`, dont la valeur est déjà épinglée quand il s'exécute.
    # Un étage postérieur ne peut pas coûter son premier vœu à qui que ce soit ;
    # il ne départage que ce que tous les précédents ont laissé équivalent.
    #
    # Vérifié plutôt que supposé, le 21 septembre 2026. Expérience contrôlée :
    # la moitié d'une équipe demande quatre semaines d'affilée, l'autre moitié deux
    # quinzaines séparées, tout le reste identique. Le groupe fragmenté obtient
    # bien 6 points de premiers vœux en moins — mais l'écart SURVIT à la
    # suppression complète de cet étage (5,9 points). Il vient de là où tombent
    # leurs semaines, pas du modèle.
    if block_starts and worst_blocks is not None:
        scale = float(max(1, max_target) + 1)
        objectives.append((
            "leave_blocks",
            {**{index: scale for index in block_starts}, worst_blocks: 1.0},
        ))

    objectives.append(("reinforcement_used", {index: 1.0 for index in reinforcement.values()}))

    # LE DERNIER ÉTAGE DÉCIDE TOUT CE QUI RESTE, ET IL DOIT LE DÉCIDER EXPRÈS.
    #
    # Aucun des étages précédents ne fige les attributions une à une : ils figent
    # des VALEURS. Ce qu'ils laissent équivalent, le dernier le tranche — et tant
    # que ce dernier était « consommer le moins de renfort », il le tranchait au
    # hasard du chemin numérique. Mesuré : les mêmes données présentées dans un
    # autre ordre déplaçaient les semaines de deux salariés sur vingt-deux. Un
    # gérant qui relance et obtient autre chose cesse de croire l'outil.
    #
    # Au plus tôt, donc. Le critère n'est pas neutre et c'est voulu : à qualité
    # rigoureusement égale, placer les congés tôt arrête le calendrier plus vite
    # et laisse la fin de période disponible pour les ajustements. Ce n'est pas
    # un départage arbitraire déguisé en règle, c'est une préférence qu'on peut
    # défendre — et qui a le mérite de rendre le même résultat deux fois.
    #
    # La position dans la campagne, jamais le numéro ISO : une campagne d'hiver
    # passe de la semaine 52 à la semaine 1, et l'ordre des numéros s'y inverse.
    #
    # LA POSITION SEULE NE SUFFIT PAS, et le test l'a montré. Deux salariés qui
    # demandent le même nombre de semaines et se valent partout ailleurs peuvent
    # ÉCHANGER leurs blocs sans changer la somme des positions : le départage est
    # muet, et HiGHS retombe sur son hasard. Constaté sur dix-huit salariés aux
    # vœux très chevauchants.
    #
    # Un second étage rompt cette symétrie, et il faut qu'il COUPLE le salarié à
    # la position : une clé simplement ajoutée ne rompt rien, puisque échanger
    # deux blocs de même taille laisse sa contribution inchangée. C'est la
    # première correction essayée, et elle ne changeait rien — vérifié plutôt
    # que supposé.
    #
    # Le rang vient de l'identifiant TRIÉ, que l'ordre de présentation ne peut
    # pas changer. On le nomme pour ce qu'il est : ARBITRAIRE, mais intrinsèque
    # aux données et donc stable. Une décision arbitraire et reproductible vaut
    # infiniment mieux qu'une décision arbitraire et changeante — la première se
    # discute, la seconde se subit.
    #
    # Un étage à part, et pas une pondération glissée dans le précédent : pour
    # rester sous la position sans jamais la renverser, le poids devrait être si
    # petit qu'il passerait sous l'écart d'optimalité que HiGHS s'autorise, et
    # le départage redeviendrait un tirage.
    objectives.append((
        "calendar_position",
        {
            index: float(week_order.get(week_id, 0))
            for (_employee_id, week_id), index in choices.items()
        },
    ))

    identifiers = sorted(employee["id"] for employee in payload["employees"])
    rank_of = {identifier: rank for rank, identifier in enumerate(identifiers)}
    objectives.append((
        "tie_break",
        {
            index: float(rank_of[employee_id]) * float(week_order.get(week_id, 0))
            for (employee_id, week_id), index in choices.items()
        },
    ))

    solution = None
    objective_values: dict[str, float] = {}
    objective_values["tie_break_proven"] = 1.0
    # Où vit l'épinglage de chaque étage, pour pouvoir le desserrer ensuite et
    # mesurer ce que la concession achète. Sans cette trace, il faudrait
    # reconstruire tout le modèle une fois par sonde.
    pin_rows: dict[str, int] = {}
    for name, objective in objectives:
        if not objective:
            objective_values[name] = 0.0
            continue
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            if not carries_quality(name) and solution is not None:
                objective_values["tie_break_proven"] = 0.0
                break
            return failure("non_optimal", "Le temps imparti ne permet pas de prouver l’optimum.", started)
        result, vector = model.solve(objective, remaining)
        if result.status == 2:
            # Le sens de ce refus a CHANGÉ, et c'est ce qui le rend utile.
            #
            # Tant que la cible était une égalité nue, « infaisable » couvrait
            # deux situations que rien ne distinguait : une couverture trop
            # exigeante, et une demande qu'on aurait pu servir à moitié. Avec
            # l'écart, n'accorder aucun congé est toujours une solution du côté
            # des salariés — il ne reste donc qu'une cause possible, et on peut
            # enfin la nommer.
            return failure(
                "infeasible",
                "Les minimums de couverture sont hors d’atteinte même sans accorder le moindre "
                "congé : ils dépassent ce que les contrats du rayon peuvent fournir.",
                started,
            )
        if result.status != 0 or result.x is None:
            # Un départage qui n'aboutit pas garde la solution précédente : elle
            # est déjà optimale sur tout ce qui compte. Ce qu'on perd est la
            # garantie de retomber sur la même réponse au prochain calcul, et
            # `tie_break_proven` le DIT — une dégradation muette serait pire que
            # la dégradation elle-même.
            if not carries_quality(name) and solution is not None:
                objective_values["tie_break_proven"] = 0.0
                break
            return failure("non_optimal", "Le solveur n’a pas prouvé l’optimum de tous les objectifs.", started)
        solution = result.x
        value = float(np.dot(vector, solution))
        maximise = (
            name.startswith("priority_")
            or name in ("first_choice_served", "waiting_cleared")
        )
        objective_values[name] = round(-value if maximise else value, 6)
        entier = all(model.variables[index].integral for index in objective)
        tolerance = pin_tolerance(
            value, entier, sum(abs(coefficient) for coefficient in objective.values())
        )
        # ENCADRÉ DES DEUX CÔTÉS POUR UN COMPTE, D'UN SEUL POUR DES HEURES.
        #
        # La borne basse est REDONDANTE en logique, quel que soit l'étage :
        # `value` est le minimum sur l'ensemble réalisable, que chaque étage
        # suivant ne fait que rétrécir. Aucun point atteignable plus tard ne peut
        # descendre en dessous.
        #
        # Elle n'est pourtant pas gratuite, et les deux mesures se contredisent
        # en apparence.
        #
        # Sur un objectif ENTIER, elle aide : elle donne à HiGHS une borne duale
        # immédiate sur chaque étage déjà résolu, et c'est avec elle qu'il élague.
        # La retirer partout coûtait 11,5 s au lieu de 9,0 s (3 septembre 2026).
        #
        # Sur un objectif CONTINU, elle tue. La valeur rendue porte des décimales
        # issues d'heures de contrat, et l'encadrer à une bande étroite peut VIDER
        # le polytope — vérifié en le résolvant à objectif nul : `status=2`. Le
        # symptôme est un `infeasible` sur une campagne parfaitement réalisable,
        # quatre fois sur cent huit après l'ajout d'un étage (21 septembre 2026).
        # Élargir la tolérance n'y changeait rien, jusqu'à 1e-4 : ce n'est pas une
        # question de marge, c'est l'égalité elle-même qui est de trop.
        #
        # D'où la règle, mesurée des deux côtés : bilatéral pour les comptes,
        # unilatéral pour les heures. Même temps, et plus d'échec.
        if entier:
            model.constraint(objective, value - tolerance, value + tolerance)
        else:
            model.constraint(objective, upper=value + tolerance)
        pin_rows[name] = len(model.rows) - 1

    if solution is None:
        # RIEN À DÉCIDER N'EST PAS UNE ERREUR, ET CE CAS EST LE PLUS COURANT QUI SOIT.
        #
        # Un modèle sans la moindre variable, c'est une campagne où personne n'a
        # encore exprimé de vœu, sans marge de déficit réglée et sans enveloppe de
        # renfort — autrement dit l'état de TOUTE campagne le jour où on la crée.
        # Il suffit d'y cliquer « Générer » une fois trop tôt.
        #
        # HiGHS refuse un objectif vide (« `c` must be […] at least one element »)
        # et lève, si bien que la route rendait une erreur technique là où l'écran
        # sait déjà dire « aucune semaine n'était demandée » — phrase qu'il n'avait
        # donc jamais l'occasion d'afficher.
        #
        # L'optimum d'un problème sans variable est le vecteur vide, et toutes les
        # sommes qui suivent portent sur des collections vides : la réponse se
        # construit sans rien résoudre.
        if not model.variables:
            solution = np.zeros(0)
        else:
            result, _ = model.solve({}, max(0.1, deadline - time.monotonic()))
            if result.status != 0 or result.x is None:
                return failure("non_optimal", "Le solveur n’a pas prouvé l’optimum.", started)
            solution = result.x

    # L'étage `unserved_weeks` optimise une somme pondérée ; sa valeur brute ne
    # veut rien dire pour un lecteur. Elle est donc remplacée par les deux
    # nombres qu'elle encode, relus sur la solution finale — que les étages
    # suivants n'ont pas pu changer, puisqu'ils travaillent sous son épinglage.
    if shortfalls and worst_shortfall is not None:
        objective_values["unserved_weeks"] = round(
            sum(float(solution[index]) for index in shortfalls), 6
        )
        objective_values["worst_unserved_weeks"] = round(float(solution[worst_shortfall]), 6)

    # Les deux étages d'équité rendent déjà leurs valeurs, mais aucune ne dit ce
    # qu'un gérant veut savoir : combien de personnes ont eu leur premier plan en
    # entier, et combien d'entre elles ne l'avaient JAMAIS eu. Le second est le
    # seul chiffre qui dise si la campagne a rattrapé quelque chose. On ajoute
    # aussi le total de plans retenus, que l'étage `extra_plans` ne donne pas
    # puisqu'il ne compte que les débordements.
    #
    # Rendues MÊME quand personne n'est concerné : une clé qui apparaît et
    # disparaît selon les données oblige chaque lecteur à se demander si zéro
    # veut dire « aucun » ou « pas calculé ».
    objective_values["first_choice_served"] = float(
        round(sum(float(solution[index]) for index, _ in first_choice))
    )
    objective_values["first_choice_backlog_served"] = float(
        round(sum(float(solution[index]) for index, history in first_choice if history == 0))
    )
    objective_values["plans_used"] = float(
        round(sum(float(solution[index]) for index in plan_variables))
    )

    # Même chose pour les morceaux : la somme pondérée ne se lit pas, le nombre
    # de blocs de congés et le pire éclatement individuel, si. Arrondis à
    # l'entier parce qu'ils EN SONT — les variables sont continues, mais leur
    # valeur découle de binaires et ne porte qu'un résidu de virgule flottante.
    if block_starts and worst_blocks is not None:
        objective_values["leave_blocks"] = float(
            round(sum(float(solution[index]) for index in block_starts))
        )
        objective_values["worst_leave_blocks"] = float(round(float(solution[worst_blocks])))

    grants: dict[str, list[str]] = {employee["id"]: [] for employee in payload["employees"]}
    for (employee_id, week_id), index in choices.items():
        if solution[index] > 0.5:
            grants[employee_id].append(week_id)
    for weeks in grants.values():
        weeks.sort()

    allocations: list[dict[str, Any]] = []
    for (pool_id, sector_id, week_id), index in reinforcement.items():
        hours = float(solution[index])
        if hours > 1e-6:
            allocations.append({
                "poolId": pool_id,
                "sectorId": sector_id,
                "weekId": week_id,
                "hours": round(hours, 4),
            })

    # Les personnes que le solveur a effectivement comptées comme servies sur
    # tout leur premier plan. Les variables sont CONTINUES mais ne valent 0 ou 1
    # qu'à l'optimum — bornées au-dessus par des attributions binaires, et leur
    # somme épinglée à son maximum dès l'étage d'équité. Le seuil à 0,5 ne lit
    # donc qu'un résidu de virgule flottante.
    first_choice_ids = sorted(
        first_choice_employee[index]
        for index, _ in first_choice
        if float(solution[index]) > 0.5
    )

    # CE QUE LE BUDGET INUTILISÉ PEUT ACHETER.
    #
    # La campagne est prouvée ; il reste presque toujours des dizaines de
    # secondes sur les soixante allouées. On s'en sert pour répondre à la question
    # que le gérant pose APRÈS le verdict, et à laquelle il répondait jusqu'ici en
    # desserrant un minimum au hasard puis en relançant.
    #
    # Trois leviers, et trois seulement : ce sont les seuls étages au-dessus de
    # l'équité qui correspondent à une décision humaine. Les autres — l'ancienneté
    # des couples, leur chevauchement partiel — ne se « décident » pas.
    concessions = measure_concessions(
        model,
        objectives,
        pin_rows,
        unserved_levers(shortfalls, worst_shortfall, objective_values)
        + [
            Lever("couples", "priority_couples_reunited", 1.0, []),
            Lever("mixed_plans", "extra_plans", 1.0, []),
        ],
        first_choice_employee,
        deadline,
        max(CONCESSION_RESERVE_FLOOR, float(payload.get("timeoutSeconds", 60)) * CONCESSION_RESERVE_RATIO),
        len(first_choice),
        len(first_choice_ids),
    )

    return {
        "status": "optimal",
        "grants": grants,
        "firstChoiceEmployeeIds": first_choice_ids,
        "concessions": concessions,
        "reinforcementAllocations": allocations,
        "objectiveValues": objective_values,
        "durationMs": round((time.monotonic() - started) * 1000),
    }


def failure(status: str, message: str, started: float) -> dict[str, Any]:
    return {
        "status": status,
        "message": message,
        "durationMs": round((time.monotonic() - started) * 1000),
    }


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        response = main(request)
    except Exception as exc:  # The route translates this to a non-applicable error.
        response = {"status": "error", "message": str(exc), "durationMs": 0}
    sys.stdout.write(json.dumps(response, ensure_ascii=False))
