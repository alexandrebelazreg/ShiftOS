"""`v3-highs-fast` — the decomposed MILP engine.

Same rules, same validator, same fixtures as `v3-highs-global`; a different
decomposition. The global engine solves one model that decides minutes and hours
together and can prove a lexicographic optimum. This one splits the question —
allocate, skeleton, place — and trades that proof for speed.

Neither replaces the other. `v3-highs-global` stays the ORACLE: when the two
disagree on a scenario, the oracle is right by definition and the gap is a
measurement of this engine.
"""

from .pipeline import ENGINE, solve_fast

__all__ = ["ENGINE", "solve_fast"]
