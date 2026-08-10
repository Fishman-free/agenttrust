"""
experiments.py — 5 组蒙特卡洛实验，验证 mech-design.tex 的博弈论定理。

Exp1  诚实均衡      ：honest vs invert 期望净收益（Lemma1 / Theorem1）
Exp2  共谋稳健性    ：恶意联盟比例 vs 裁决翻转率（Theorem2）
Exp3  女巫成本      ：身份数与成本/收益权衡（Theorem3）
Exp4  资金守恒      ：Σ net == -dust（Lemma2）
Exp5  阈值扫描      ：majority_bps ∈ {0.5..0.7} 正确率/作废率权衡

运行：cd <repo>/simulation && python experiments.py
输出：simulation/results/*.csv 与 simulation/plots/*.png
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from model import (SchellingVotingModel, strategies_mixed, BUYER, SELLER, ABSTAIN, WEI)

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "results")
PLT = os.path.join(HERE, "plots")
os.makedirs(RES, exist_ok=True)
os.makedirs(PLT, exist_ok=True)

SEED = 20260810
plt.rcParams.update({
    "font.family": "serif", "font.size": 11,
    "axes.grid": True, "grid.alpha": 0.3, "figure.dpi": 300,
})


def mean_ci(x, z=1.96):
    x = np.asarray(x, dtype=float)
    m = x.mean()
    sem = x.std(ddof=1) / np.sqrt(len(x)) if len(x) > 1 else 0.0
    return m, z * sem


# =====================================================================
# Exp1  诚实均衡（单方面偏离：n-1 诚实 + 1 叛离者）
#        Lemma 1 的严格含义：给定其他人都诚实，偏离诚实不是更优。
# =====================================================================
def exp1(reps=3000):
    qs = [0.51, 0.6, 0.7, 0.8, 0.9]
    n = 15
    deviators = ["honest", "invert", "always_buyer", "always_seller", "abstain"]
    rows = []
    for q in qs:
        for dev in deviators:
            dev_nets, hon_nets = [], []
            for r in range(reps):
                strategies = strategies_mixed(n, [("honest", n - 1), (dev, 1)])
                m = SchellingVotingModel(n_voters=n, q=q, stake=1.0,
                                         strategies=strategies, seed=SEED + r)
                m.step()
                agents = list(m.agents)
                dev_agent = agents[-1]  # 创建顺序：n-1 诚实后 1 叛离者
                dev_nets.append(dev_agent.net_wei / WEI)
                hon_nets.append(np.mean([a.net_wei / WEI for a in agents[:-1]]))
            dmu, dci = mean_ci(dev_nets)
            hmu, hci = mean_ci(hon_nets)
            rows.append({"q": q, "n": n, "deviator": dev,
                         "deviator_net_eth": dmu, "deviator_ci": dci,
                         "honest_net_eth": hmu, "honest_ci": hci})
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(RES, "exp1_honest_equilibrium.csv"), index=False)

    # 每个 q 下：叛离者=诚实 的收益应 ≥ 其他所有叛离策略（诚实为最优响应）
    fig, axes = plt.subplots(2, 3, figsize=(12, 7))
    axes = axes.ravel()
    for i, q in enumerate(qs):
        ax = axes[i]
        sub = df[df.q == q]
        x = np.arange(len(deviators))
        ax.bar(x, sub.deviator_net_eth, color="C0", label="deviator payoff")
        ax.axhline(0, color="k", lw=0.8)
        ax.set(xticks=x, xticklabels=sub.deviator, ylabel="net payoff (ETH)",
               title=f"q = {q}")
        ax.tick_params(axis="x", rotation=30)
    axes[5].axis("off")
    fig.suptitle("One-sided deviation: 14 honest voters + 1 deviator (Lemma 1 / Thm 1)",
                 fontsize=12)
    fig.tight_layout()
    fig.savefig(os.path.join(PLT, "exp1_honest_equilibrium.png"))
    plt.close(fig)
    return df


# =====================================================================
# Exp2  共谋稳健性
# =====================================================================
def exp2(reps=2000):
    n = 21
    q = 0.85
    cvals = list(range(0, n + 1, 2))
    rows = []
    for c in cvals:
        flipped = 0
        for r in range(reps):
            strategies = strategies_mixed(n, [("always_seller", c), ("honest", n - c)])
            m = SchellingVotingModel(n_voters=n, q=q, stake=1.0, strategies=strategies,
                                     true_state=BUYER, seed=SEED + r)
            m.step()
            if m.winner == SELLER:
                flipped += 1
        rate = flipped / reps
        rows.append({"n": n, "colluders": c, "collusion_ratio": c / n,
                     "flip_rate": rate})
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(RES, "exp2_collusion.csv"), index=False)

    # 理论门槛 c* = ceil(13h/7), h = n - c
    cstar = next(c for c in cvals if c >= 13 * (n - c) / 7)

    fig, ax = plt.subplots(figsize=(6.5, 4))
    ax.plot(df.collusion_ratio, df.flip_rate, marker="o", label="flip rate (empirical)")
    ax.axvline(cstar / n, color="r", ls="--", label=f"theoretical threshold {cstar}/{n}")
    ax.axvline(0.35, color="g", ls=":", label="35% malicious")
    ax.axhline(0.05, color="gray", lw=0.8, alpha=0.6)
    ax.set(xlabel="malicious fraction c/n", ylabel="P(verdict flipped)",
           title="Collusion resistance (Thm 2), n=21, q=0.85")
    ax.legend()
    fig.tight_layout()
    fig.savefig(os.path.join(PLT, "exp2_collusion.png"))
    plt.close(fig)
    return df, cstar


# =====================================================================
# Exp3  女巫成本
# =====================================================================
def exp3(reps=1500):
    h = 14                      # 诚实人数
    q = 0.85
    fee, stake_eth = 0.1, 1.0   # 注册费 + 质押（ETH）
    max_k = 40
    rows = []
    for k in range(0, max_k + 1, 2):
        flipped = 0
        n = h + k
        for r in range(reps):
            strategies = strategies_mixed(n, [("always_seller", k), ("honest", h)])
            m = SchellingVotingModel(n_voters=n, q=q, stake=stake_eth,
                                     strategies=strategies, true_state=BUYER,
                                     registration_fee=fee, seed=SEED + r)
            m.step()
            if m.winner == SELLER:
                flipped += 1
        cost = k * (fee + stake_eth)
        rows.append({"k": k, "h": h, "flip_rate": flipped / reps,
                     "attack_cost_eth": cost})
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(RES, "exp3_sybil.csv"), index=False)

    # 理论捕获门槛 k* = ceil(13h/7)
    kstar = int(np.ceil(13 * h / 7))
    # 攻击"收益上限"示例：翻转裁决帮卖家省下的赔偿 = 交易额（= 2*stake 的场景，用 stake_eth 的 3 倍作示
    payoff_cap = 5.0

    fig, ax1 = plt.subplots(figsize=(6.5, 4))
    ax1.plot(df.k, df.flip_rate, marker="o", color="C0", label="flip rate")
    ax1.axvline(kstar, color="r", ls="--", label=f"capture threshold k*={kstar}")
    ax1.set(xlabel="# sybil identities k", ylabel="P(verdict flipped)")
    ax2 = ax1.twinx()
    ax2.plot(df.k, df.attack_cost_eth, color="C3", ls="--", marker="s", label="attack cost")
    ax2.axhline(payoff_cap, color="C3", ls=":", label=f"payoff cap {payoff_cap}")
    ax2.set(ylabel="attack cost (ETH)")
    ax1.set(title="Sybil resistance (Thm 3): cost ≥ payoff => unattractive")
    for a in (ax1, ax2):
        a.legend(loc="upper left", fontsize=8)
    fig.tight_layout()
    fig.savefig(os.path.join(PLT, "exp3_sybil.png"))
    plt.close(fig)
    return df, kstar


# =====================================================================
# Exp4  资金守恒
# =====================================================================
def exp4(reps=4000):
    rng = np.random.RandomState(SEED)
    max_dev = 0.0
    n_effective = n_void = 0
    dust_ok = True
    for r in range(reps):
        n = rng.randint(5, 30)
        q = rng.uniform(0.55, 0.95)
        strat = rng.choice(["honest", "invert", "abstain"])
        m = SchellingVotingModel(n_voters=n, q=q, stake=1.0, strategies=strat,
                                 true_state=int(rng.rand() < 0.5), seed=SEED + r)
        m.step()
        total_in = m.n * m.stake_wei
        sum_net = m.sum_net()
        if not m.effective:
            n_void += 1
            expect = 0
        else:
            n_effective += 1
            expect = -m.dust_wei()
        dev = abs(sum_net - expect)
        max_dev = max(max_dev, dev)
        if dev != 0:
            dust_ok = False
    with open(os.path.join(RES, "exp4_fund_conservation.txt"), "w") as f:
        f.write(f"reps={reps}\n")
        f.write(f"effective_cases={n_effective}, void_cases={n_void}\n")
        f.write(f"max |sum_net - expected| (wei) = {int(max_dev)}\n")
        f.write(f"conservation_holds_exactly = {dust_ok}\n")
    return n_effective, n_void, max_dev, dust_ok


# =====================================================================
# Exp5  阈值扫描
# =====================================================================
def exp5(reps=3000):
    bps = [5000, 5500, 6000, 6500, 7000]
    n, q = 15, 0.7
    rows = []
    for b in bps:
        correct = void = 0
        for r in range(reps):
            m = SchellingVotingModel(n_voters=n, q=q, stake=1.0, strategies="honest",
                                     majority_bps=b, seed=SEED + r)
            m.step()
            correct += int(m.correct_verdict())
            void += int(not m.effective)
        rows.append({"majority_bps": b, "correct_rate": correct / reps,
                     "void_rate": void / reps})
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(RES, "exp5_threshold_scan.csv"), index=False)

    fig, ax = plt.subplots(figsize=(6.5, 4))
    ax.plot(df.majority_bps / 100, df.correct_rate, marker="o", color="C0", label="correct verdict rate")
    ax.plot(df.majority_bps / 100, df.void_rate, marker="s", color="C2", label="void rate (no 2/3)")
    ax.axvline(0.65, color="r", ls="--", label="AgentTrust 6500 bps")
    ax.set(xlabel="majority threshold", ylabel="rate", title="Threshold trade-off (honest voters, n=15, q=0.7)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(os.path.join(PLT, "exp5_threshold_scan.png"))
    plt.close(fig)
    return df


# =====================================================================
if __name__ == "__main__":
    print("[Exp1] honest equilibrium ...")
    d1 = exp1()
    # 每个 q 下验证：叛离者=诚实 收益为所有策略最大
    for q in d1.q.unique():
        sub = d1[d1.q == q].sort_values("deviator_net_eth", ascending=False)
        best = sub.iloc[0]
        print(f"  q={q}: best deviator = {best.deviator}({best.deviator_net_eth:+.3f} ETH), "
              f"invert={sub[sub.deviator=='invert'].deviator_net_eth.values[0]:+.3f}, "
              f"always_seller={sub[sub.deviator=='always_seller'].deviator_net_eth.values[0]:+.3f}")

    print("[Exp2] collusion resistance ...")
    d2, cstar = exp2()
    at35 = d2.iloc[(d2.collusion_ratio - 0.35).abs().argmin()]
    print(f"  done. flip rate @35% malicious = {at35.flip_rate:.4f}, threshold k*={cstar}")

    print("[Exp3] sybil cost ...")
    d3, kstar = exp3()
    atk = d3[d3.k == kstar]
    print(f"  done. flip rate @k*={kstar} = {atk.flip_rate.values[0]:.4f}, cost={atk.attack_cost_eth.values[0]:.2f} ETH")

    print("[Exp4] fund conservation ...")
    ne, nv, mdev, ok = exp4()
    print(f"  done. effective={ne}, void={nv}, max_dev={int(mdev)} wei, holds={ok}")

    print("[Exp5] threshold scan ...")
    d5 = exp5()
    print("  done.")
    print(d5.round(4).to_string(index=False))
    print("\nAll outputs written to simulation/results/ and simulation/plots/")
