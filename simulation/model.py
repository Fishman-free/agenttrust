"""
SchellingVotingModel — 质押投票博弈的 mesa 仿真模型。

与 contracts/src/SchellingVoting.sol 的结算逻辑逐字一致：
  - 三方 Side ∈ {BUYER, SELLER, ABSTAIN}，每票质押 stake（wei 语义）
  - total = m_B + m_S（不含弃权）
  - total == 0 → 作废（winner = ABSTAIN）
  - 多数判定：m_X * 10000 >= total * majority_bps（默认 6500）
  - winner 优先级 BUYER → SELLER → ABSTAIN
  - effective = total >= min_voters(3) && winner != ABSTAIN
  - 作废案：全部投票者（含弃权）退款
  - 有效案：多数派 net = floor(stake_wei * L / W)；少数派 net = -stake_wei；弃权 net = 0
  - 资金守恒：Σ net = -dust（dust = (stake_wei * L) % W）
"""
from mesa import Agent, Model
import numpy as np

BUYER, SELLER, ABSTAIN = 0, 1, 2
WEI = 1_000_000_000_000_000_000  # 1 ETH = 1e18 wei

STRATEGIES = {"honest", "invert", "always_buyer", "always_seller", "abstain"}


class VoterAgent(Agent):
    """一位投票者：持有（含噪声的）真实信号，按策略投票，结算后记录净收益。"""

    def __init__(self, model, signal, strategy):
        super().__init__(model)
        self.signal = signal        # BUYER / SELLER（含信号噪声）
        self.strategy = strategy    # 见 STRATEGIES
        self.vote = None
        self.net_wei = 0            # 净收益（收到 - 质押），wei 整数

    def step(self):
        s = self.strategy
        if s == "honest":
            self.vote = self.signal
        elif s == "invert":         # 系统性逆信号（投机坏策略）
            self.vote = SELLER if self.signal == BUYER else BUYER
        elif s == "always_buyer":
            self.vote = BUYER
        elif s == "always_seller":
            self.vote = SELLER
        elif s == "abstain":
            self.vote = ABSTAIN
        else:
            raise ValueError(f"unknown strategy: {s}")


class SchellingVotingModel(Model):
    """一轮质押投票博弈。

    参数
    ----
    n_voters : int            投票者人数
    q : float                信号正确率（Condorcet，> 0.5）
    stake : float             每票质押（ETH）
    majority_bps : int        多数判定阈值（万分数，默认 6500）
    min_voters : int          最低有效票数（默认 3）
    strategies : str | list   全体策略，或逐人策略列表
    registration_fee : float  注册费（ETH），抗女巫成本项
    true_state : int|None     真实状态（BUYER=0/SELLER=1），None 时随机
    seed : int                随机种子
    """

    def __init__(self, n_voters=15, q=0.7, stake=1.0, majority_bps=6500,
                 min_voters=3, strategies="honest", registration_fee=0.0,
                 true_state=None, seed=42):
        super().__init__()
        self.rng = np.random.RandomState(seed)
        self.n = n_voters
        self.q = q
        self.stake_wei = int(stake * WEI)
        self.majority_bps = majority_bps
        self.min_voters = min_voters
        self.registration_fee_wei = int(registration_fee * WEI)

        self.true_state = int(true_state) if true_state is not None else int(self.rng.rand() < 0.5)
        if isinstance(strategies, str):
            strategies = [strategies] * n_voters
        assert len(strategies) == n_voters

        signals = self._gen_signals()
        for i in range(n_voters):
            VoterAgent(self, int(signals[i]), strategies[i])

        self.winner = None
        self.effective = None

    # ---------------- 信号 ----------------
    def _gen_signals(self):
        correct = self.rng.rand(self.n) < self.q
        return np.where(correct, self.true_state, 1 - self.true_state)

    # ---------------- 主循环 ----------------
    def step(self):
        """一轮：投票（mesa 随机激活）→ 结算 → 净收益。"""
        self.agents.shuffle_do("step")
        self._settle()

    def _settle(self):
        votes = np.array([a.vote for a in self.agents])
        mB = int(np.sum(votes == BUYER))
        mS = int(np.sum(votes == SELLER))
        mA = int(np.sum(votes == ABSTAIN))
        total = mB + mS
        stake = self.stake_wei

        # —— 与 SchellingVoting.settle() 逐字对应 ——
        if total == 0:
            winner = ABSTAIN
        else:
            buyer_maj = mB * 10000 >= total * self.majority_bps
            seller_maj = mS * 10000 >= total * self.majority_bps
            winner = BUYER if buyer_maj else (SELLER if seller_maj else ABSTAIN)
        effective = total >= self.min_voters and winner != ABSTAIN

        self.winner = winner
        self.effective = effective
        self.mB, self.mS, self.mA, self.total = mB, mS, mA, total

        # —— 净收益分配（与 claimReward / claimRefund 一致）——
        for a in self.agents:
            if not effective:
                # 作废案：全部投票者退款（net = 0）
                a.net_wei = 0
            elif a.vote == ABSTAIN:
                a.net_wei = 0          # 有效案弃权：退款
            elif a.vote == winner:
                # 多数派：本金 + 少数派罚没均分（整除，余数 dust 滞留）
                lcount = mS if winner == BUYER else mB
                wcount = mB if winner == BUYER else mS
                a.net_wei = (stake * lcount) // wcount
            else:
                # 少数派：质押罚没
                a.net_wei = -stake

    # ---------------- 结果 ----------------
    def correct_verdict(self):
        """裁决是否正确（与真实状态一致）。作废/弃权视为不正确。"""
        return bool(self.effective and self.winner == self.true_state)

    def sum_net(self):
        """Σ 净收益（wei）。理论上 = -dust（有效案）或 0（作废案）。"""
        return sum(a.net_wei for a in self.agents)

    def dust_wei(self):
        """理论 dust = (stake_wei * L) % W。"""
        L = self.mS if self.winner == BUYER else self.mB
        W = self.mB if self.winner == BUYER else self.mS
        return (self.stake_wei * L) % W if W > 0 else 0


def strategies_mixed(n, counts):
    """由 (strategy, count) 列表构造逐人策略列表。"""
    out = []
    for s, c in counts:
        out += [s] * c
    assert len(out) == n
    return out
