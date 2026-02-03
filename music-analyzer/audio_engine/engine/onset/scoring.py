"""
L4 Aggregation: band 기반 역할 할당 (이벤트×대역 → P0/P1/P2).
P0 = 반복 집합 내 상대 에너지(accent, top quantile). P1 = 반복 집합 소속(패턴 유지). P2 = 뉘앙스.
"""
from __future__ import annotations

import numpy as np

BAND_NAMES = ("low", "mid", "high")


def _repetition_groups_from_ioi(
    onset_times: np.ndarray,
    rel_tol: float = 0.2,
) -> np.ndarray:
    """
    반복 집합(Repetition Group) 최소 규칙: IOI가 거의 같은 연속 이벤트 → 같은 집합.
    규칙: |ioi[i] - ioi[i-1]| <= rel_tol * median_ioi 이면 같은 집합, 아니면 새 집합.
    첫 이벤트(0): ioi[0] 없음 → ioi[1]이 이웃(1-2)과 유사하면 0을 1과 같은 그룹에 넣어 P1 후보 가능.
    docs/layering.md §0.2 참고.
    반환: group_id[i] = 이벤트 i가 속한 집합 인덱스 (0, 1, 2, ...).
    """
    n = len(onset_times)
    if n < 2:
        return np.zeros(n, dtype=np.intp)
    ioi = np.zeros(n)
    ioi[0] = np.nan
    ioi[1:] = onset_times[1:] - onset_times[:-1]
    valid = np.isfinite(ioi)
    median_ioi = np.nanmedian(ioi[1:]) if np.any(valid) else 0.5
    if median_ioi <= 0:
        median_ioi = 0.5
    tol = rel_tol * median_ioi
    group_id = np.zeros(n, dtype=np.intp)
    g = 0
    for i in range(1, n):
        if np.isfinite(ioi[i]) and np.isfinite(ioi[i - 1]) and abs(ioi[i] - ioi[i - 1]) <= tol:
            group_id[i] = g
        else:
            g += 1
            group_id[i] = g
    # 첫 이벤트(0): ioi[0] 없어서 원래 혼자 그룹 0 → P1 불가. 다음과 동일 반복이면 0을 1과 같은 그룹에 넣음.
    if n >= 2 and np.isfinite(ioi[1]):
        if n >= 3 and np.isfinite(ioi[2]) and abs(ioi[1] - ioi[2]) <= tol:
            group_id[0] = group_id[1]
        elif n == 2:
            group_id[0] = group_id[1]
    return group_id


def normalize_metrics_per_track(
    metrics: dict[str, np.ndarray],
    use_percentile: bool = True,
    low: float = 1.0,
    high: float = 99.0,
) -> dict[str, np.ndarray]:
    """
    1차 분석: 트랙 내 지표 분포로 각 메트릭을 0~1로 재정규화.
    """
    out = {}
    for key, arr in metrics.items():
        valid = np.isfinite(arr)
        if np.sum(valid) < 2:
            out[key] = np.clip(np.nan_to_num(arr, nan=0.5), 0, 1)
            continue
        if use_percentile:
            p_lo = np.nanpercentile(arr, low)
            p_hi = np.nanpercentile(arr, high)
            if p_hi <= p_lo:
                out[key] = np.clip(np.nan_to_num(arr, nan=0.5), 0, 1)
                continue
            x = (arr - p_lo) / (p_hi - p_lo)
        else:
            a, b = np.nanmin(arr), np.nanmax(arr)
            if b <= a:
                out[key] = np.clip(np.nan_to_num(arr, nan=0.5), 0, 1)
                continue
            x = (arr - a) / (b - a)
        out[key] = np.clip(np.nan_to_num(x, nan=0.5), 0, 1)
    return out


def _ioi_similarity(ioi_i: float, ioi_prev: float, sigma_sec: float = 0.05) -> float:
    """IOI 유사도: exp(-|ioi_i - ioi_prev| / sigma)."""
    if not np.isfinite(ioi_i) or not np.isfinite(ioi_prev) or sigma_sec <= 0:
        return 0.0
    return float(np.exp(-min(abs(ioi_i - ioi_prev) / sigma_sec, 10.0)))


def assign_roles_by_band(
    energy_extras: dict[str, np.ndarray],
    *,
    temporal: np.ndarray | None = None,
    dependency: np.ndarray | None = None,
    focus: np.ndarray | None = None,
    onset_times: np.ndarray | None = None,
    band_evidence: list[dict] | None = None,
    use_repetition_group: bool = True,
    p0_quantile: float = 0.80,
    ioi_rel_tol: float = 0.20,
    eps_broadband: float = 0.08,
    tau_repeat: float = 0.35,
    dep_th: float = 0.5,
    p2_abs_floor: float = 0.10,
    p2_ratio_to_p0: float = 0.6,
    ioi_sigma_sec: float = 0.05,
) -> list[dict]:
    """
    이벤트×대역 역할 할당. P0/P1 독립(중복 허용).
    onset_times + use_repetition_group=True 시:
      P1 = 반복 집합 소속 → 해당 이벤트의 band evidence 전부 P1.
      P0 = 반복 집합 내 band별 상위 quantile(accent) → 해당 band P0.
    그 외: P0=argmax, P1=repeat_score 기반(레거시).
    """
    E_low = np.asarray(energy_extras["E_norm_low"])
    E_mid = np.asarray(energy_extras["E_norm_mid"])
    E_high = np.asarray(energy_extras["E_norm_high"])
    n = len(E_low)
    stacked = np.stack([E_low, E_mid, E_high], axis=1)

    # 반복 집합 기반 모드: P0 = group-relative quantile, P1 = group membership
    if use_repetition_group and onset_times is not None and n >= 2:
        group_id = _repetition_groups_from_ioi(np.asarray(onset_times), rel_tol=ioi_rel_tol)
        group_ids = np.unique(group_id)
        p0_bands_list = []
        p1_bands_list = []
        p0_primary = []
        p0_energy_for_p2 = np.array([float(stacked[i, np.argmax(stacked[i])]) for i in range(n)])
        for i in range(n):
            g = group_id[i]
            in_g = group_id == g
            group_size = np.sum(in_g)
            p1_list = []
            if band_evidence is not None and i < len(band_evidence):
                for b in BAND_NAMES:
                    ev = band_evidence[i].get(b)
                    if ev and ev.get("present") and group_size >= 2:
                        p1_list.append(b)
            elif group_size >= 2:
                p1_list = list(BAND_NAMES)
            p1_bands_list.append(p1_list)

            p0_list = []
            for b_idx in range(3):
                E_b = stacked[in_g, b_idx]
                if E_b.size < 2:
                    if E_b.size == 1 and E_b[0] >= 0:
                        p0_list.append(BAND_NAMES[b_idx])
                    continue
                th = np.nanpercentile(E_b, p0_quantile * 100)
                if np.isfinite(th) and stacked[i, b_idx] >= th:
                    p0_list.append(BAND_NAMES[b_idx])
            p0_bands_list.append(p0_list)
            if p0_list:
                best_b = max(p0_list, key=lambda b: stacked[i, BAND_NAMES.index(b)])
                p0_primary.append(best_b)
            else:
                p0_primary.append(BAND_NAMES[np.argmax(stacked[i])])
        p0_bands = p0_primary
        p0_energy = p0_energy_for_p2
        is_broadband = (np.max(stacked, axis=1) - np.sort(stacked, axis=1)[:, -2]) < eps_broadband
        p2_gate = np.asarray(dependency) >= dep_th if dependency is not None else np.zeros(n, dtype=bool)

        def p2_candidates(i: int) -> list[str]:
            if is_broadband[i] or not p2_gate[i]:
                return []
            th_hi = p0_energy[i] * p2_ratio_to_p0
            out_list = []
            for bi, b in enumerate(BAND_NAMES):
                if b in (p0_bands_list[i] or [p0_primary[i]]):
                    continue
                e_b = stacked[i, bi]
                if p2_abs_floor < e_b < th_hi:
                    out_list.append(b)
            return out_list

        out = []
        for i in range(n):
            p2 = p2_candidates(i)
            out.append({"P0": p0_bands_list[i] or [p0_primary[i]], "P0_primary": p0_primary[i], "P1": p1_bands_list[i], "P2": p2})
        return out

    # 레거시: P0 = argmax, P1 = repeat_score
    p0_idx = np.argmax(stacked, axis=1)
    p0_bands = [BAND_NAMES[i] for i in p0_idx]
    p0_energy = np.array([stacked[i, p0_idx[i]] for i in range(n)])
    sorted_stack = np.sort(stacked, axis=1)
    second_max = sorted_stack[:, -2]
    max_vals = sorted_stack[:, -1]
    is_broadband = (max_vals - second_max) < eps_broadband
    p2_gate = np.zeros(n, dtype=bool)
    if dependency is not None:
        p2_gate = np.asarray(dependency) >= dep_th

    def p2_candidates_legacy(i: int) -> list[str]:
        if is_broadband[i] or not p2_gate[i]:
            return []
        p0_b = p0_bands[i]
        th_hi = p0_energy[i] * p2_ratio_to_p0
        out_list = []
        for bi, b in enumerate(BAND_NAMES):
            if b == p0_b:
                continue
            e_b = stacked[i, bi]
            if p2_abs_floor < e_b < th_hi:
                out_list.append(b)
        return out_list

    p1_bands_list = [[] for _ in range(n)]
    if temporal is not None and n >= 2:
        T = np.asarray(temporal)
        if band_evidence is not None and onset_times is not None and len(band_evidence) >= n:
            times = np.asarray(onset_times)
            ioi = np.zeros(n)
            ioi[0] = np.nan
            ioi[1:] = times[1:] - times[:-1]
            last_seen = {b: -1 for b in BAND_NAMES}
            all_strengths = []
            for i in range(n):
                for b in BAND_NAMES:
                    ev = band_evidence[i].get(b)
                    if ev and ev.get("present"):
                        all_strengths.append(ev.get("onset_strength", 0))
            str_max = max(all_strengths, default=1.0)
            str_min = min(all_strengths, default=0.0)
            if str_max <= str_min:
                str_max = str_min + 1.0
            for i in range(n):
                p1_list = []
                for b in BAND_NAMES:
                    ev_i = band_evidence[i].get(b)
                    if not ev_i or not ev_i.get("present"):
                        continue
                    prev = last_seen[b]
                    if prev < 0:
                        s = T[i] * 0.5
                    else:
                        ev_prev = band_evidence[prev].get(b)
                        if not ev_prev or not ev_prev.get("present"):
                            s = T[i] * 0.5
                        else:
                            str_i = (ev_i.get("onset_strength", 0) - str_min) / (str_max - str_min)
                            str_p = (ev_prev.get("onset_strength", 0) - str_min) / (str_max - str_min)
                            sim_strength = 1.0 - min(1.0, abs(str_i - str_p))
                            sim_ioi = _ioi_similarity(ioi[i], ioi[prev], ioi_sigma_sec)
                            s = T[i] * sim_strength * sim_ioi
                    if s > tau_repeat:
                        p1_list.append(b)
                    if ev_i.get("present"):
                        last_seen[b] = i
                p1_bands_list[i] = p1_list
        else:
            for i in range(n):
                p1_list = []
                for b_idx, b in enumerate(BAND_NAMES):
                    E_b = stacked[:, b_idx]
                    if i == 0:
                        s = 0.0
                    else:
                        s = T[i] * (1.0 - min(1.0, abs(E_b[i] - E_b[i - 1])))
                    if s > tau_repeat:
                        p1_list.append(b)
                p1_bands_list[i] = p1_list

    out = []
    for i in range(n):
        p2 = p2_candidates_legacy(i)
        out.append({"P0": [p0_bands[i]], "P0_primary": p0_bands[i], "P1": p1_bands_list[i], "P2": p2})
    return out
