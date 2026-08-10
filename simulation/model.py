"""Versioned simulation model for the stake-voting mechanism.

This is an economic model, not a theorem prover or a byte-for-byte Solidity model.
The Solidity implementation is being refactored in parallel; see README for the
parameters and behaviours that must be checked by differential tests afterwards.
"""
from dataclasses import dataclass
from typing import Optional, Sequence

import numpy as np

BUYER, SELLER, ABSTAIN = 0, 1, 2
WEI = 10**18
MODEL_VERSION = "stake-vote-econ-v2.0.0"
STRATEGIES = {"honest", "invert", "always_buyer", "always_seller", "abstain"}


@dataclass(frozen=True)
class MechanismConfig:
    """Single source of truth for mechanism and economic assumptions."""

    model_version: str = MODEL_VERSION
    stake_eth: float = 1.0
    majority_bps: int = 6500  # 65%, deliberately not labelled 2/3
    min_directional_votes: int = 3
    identity_fee_eth: float = 0.10  # non-refundable
    capital_annual_rate: float = 0.08
    lock_days: float = 7.0
    gas_per_identity_eth: float = 0.003
    coordination_fixed_eth: float = 0.05
    coordination_per_identity_eth: float = 0.002

    def __post_init__(self):
        if not 5000 <= self.majority_bps <= 10000:
            raise ValueError("majority_bps must be in [5000, 10000]")
        if self.min_directional_votes < 1 or self.stake_eth < 0:
            raise ValueError("invalid stake or minimum vote count")

    @property
    def stake_wei(self) -> int:
        return int(round(self.stake_eth * WEI))

    @property
    def opportunity_cost_per_identity_eth(self) -> float:
        return self.stake_eth * self.capital_annual_rate * self.lock_days / 365.0


@dataclass
class Voter:
    signal: int
    strategy: str
    active: bool = True
    vote: Optional[int] = None
    net_wei: int = 0

    def cast(self) -> Optional[int]:
        if not self.active:
            self.vote = None
        elif self.strategy == "honest":
            self.vote = self.signal
        elif self.strategy == "invert":
            self.vote = SELLER if self.signal == BUYER else BUYER
        elif self.strategy == "always_buyer":
            self.vote = BUYER
        elif self.strategy == "always_seller":
            self.vote = SELLER
        elif self.strategy == "abstain":
            self.vote = ABSTAIN
        else:
            raise ValueError(f"unknown strategy: {self.strategy}")
        return self.vote


class SchellingVotingModel:
    """One voting round with explicit correct/wrong/void outcomes.

    ``turnout`` applies to ordinary voters. Indices listed in ``forced_active``
    participate for sure, which lets an attacking coalition coordinate turnout.
    Inactive candidates neither lock stake nor pay per-participation costs here.
    """

    def __init__(
        self,
        n_voters: int = 15,
        q: float = 0.7,
        config: Optional[MechanismConfig] = None,
        strategies: Sequence[str] | str = "honest",
        true_state: Optional[int] = None,
        turnout: float = 1.0,
        forced_active: Optional[Sequence[int]] = None,
        seed: int = 42,
        signals: Optional[Sequence[int]] = None,
        active_draws: Optional[Sequence[float]] = None,
    ):
        if n_voters < 1 or not 0 <= q <= 1 or not 0 <= turnout <= 1:
            raise ValueError("invalid n_voters, q, or turnout")
        self.config = config or MechanismConfig()
        self.rng = np.random.default_rng(seed)
        self.n = n_voters
        self.q = q
        self.true_state = int(true_state) if true_state is not None else int(self.rng.integers(0, 2))
        if isinstance(strategies, str):
            strategies = [strategies] * n_voters
        if len(strategies) != n_voters or any(s not in STRATEGIES for s in strategies):
            raise ValueError("strategies must contain one known strategy per voter")
        if signals is None:
            correct = self.rng.random(n_voters) < q
            signals = np.where(correct, self.true_state, 1 - self.true_state)
        if active_draws is None:
            active_draws = self.rng.random(n_voters)
        forced = set(forced_active or [])
        self.voters = [
            Voter(int(signals[i]), strategies[i], bool(active_draws[i] < turnout or i in forced))
            for i in range(n_voters)
        ]
        self.winner = ABSTAIN
        self.effective = False
        self.outcome = "void"
        self.mB = self.mS = self.mA = self.total = 0

    @property
    def agents(self):
        """Compatibility alias for earlier experiment code."""
        return self.voters

    def step(self):
        for voter in self.voters:
            voter.cast()
        self._settle()
        return self

    def _settle(self):
        votes = np.array([v.vote if v.vote is not None else -1 for v in self.voters])
        self.mB = int(np.sum(votes == BUYER))
        self.mS = int(np.sum(votes == SELLER))
        self.mA = int(np.sum(votes == ABSTAIN))
        self.total = self.mB + self.mS
        cfg = self.config
        if self.total == 0:
            self.winner = ABSTAIN
        else:
            buyer_majority = self.mB * 10000 >= self.total * cfg.majority_bps
            seller_majority = self.mS * 10000 >= self.total * cfg.majority_bps
            self.winner = BUYER if buyer_majority else SELLER if seller_majority else ABSTAIN
        self.effective = self.total >= cfg.min_directional_votes and self.winner != ABSTAIN
        self.outcome = "void" if not self.effective else "correct" if self.winner == self.true_state else "wrong"
        for voter in self.voters:
            if not voter.active or not self.effective or voter.vote == ABSTAIN:
                voter.net_wei = 0
            elif voter.vote == self.winner:
                losers = self.mS if self.winner == BUYER else self.mB
                winners = self.mB if self.winner == BUYER else self.mS
                voter.net_wei = (cfg.stake_wei * losers) // winners
            else:
                voter.net_wei = -cfg.stake_wei

    def sum_net_wei(self) -> int:
        return sum(v.net_wei for v in self.voters)

    def sum_net(self) -> int:
        return self.sum_net_wei()

    def dust_wei(self) -> int:
        if not self.effective:
            return 0
        losers = self.mS if self.winner == BUYER else self.mB
        winners = self.mB if self.winner == BUYER else self.mS
        return (self.config.stake_wei * losers) % winners

    def correct_verdict(self) -> bool:
        return self.outcome == "correct"


def strategies_mixed(n: int, counts):
    out = [strategy for strategy, count in counts for _ in range(count)]
    if len(out) != n:
        raise ValueError("strategy counts do not sum to n")
    return out


def attack_economics(model: SchellingVotingModel, coalition_indices: Sequence[int], success_benefit_eth: float):
    """Return realised attack economics; refundable principal is not a cost.

    Profit includes the coalition's settlement net payoff and exogenous benefit
    only on a wrong effective verdict, then subtracts non-refundable identity,
    opportunity, gas, and coordination costs. ``failed_slashing_eth`` is shown
    separately and already appears in settlement_net_eth, so it is not subtracted twice.
    """
    cfg = model.config
    idx = list(coalition_indices)
    k = len(idx)
    settlement = sum(model.voters[i].net_wei for i in idx) / WEI
    success = model.outcome == "wrong"
    failed_slashing = sum(
        -min(model.voters[i].net_wei, 0) / WEI for i in idx
    ) if not success else 0.0
    identity = k * cfg.identity_fee_eth
    opportunity = k * cfg.opportunity_cost_per_identity_eth
    gas = k * cfg.gas_per_identity_eth
    coordination = (cfg.coordination_fixed_eth if k else 0.0) + k * cfg.coordination_per_identity_eth
    profit = float(success) * success_benefit_eth + settlement - identity - opportunity - gas - coordination
    return {
        "success": int(success),
        "settlement_net_eth": settlement,
        "success_benefit_eth": float(success) * success_benefit_eth,
        "failed_slashing_eth": failed_slashing,
        "identity_fee_eth": identity,
        "opportunity_cost_eth": opportunity,
        "gas_cost_eth": gas,
        "coordination_cost_eth": coordination,
        "refundable_stake_principal_eth": k * cfg.stake_eth,
        "profit_eth": profit,
    }
