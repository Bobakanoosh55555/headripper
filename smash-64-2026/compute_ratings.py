#!/usr/bin/env python3
"""
compute_ratings.py - Compute Glicko-2 ratings from tournament set data.

Usage:
    python compute_ratings.py <sets_dir> <tournaments_dir> [players.json] [output_dir]

Defaults (relative to script location):
    sets_dir:        ./sets
    tournaments_dir: ./tournaments
    players.json:    ./players.json
    output_dir:      ./computed

Outputs:
    computed/ratings.json             - Sequential Glicko-2 snapshots after each tournament
    computed/ratings-retroactive.json - Retroactive snapshots (full-season context)
    computed/ratings-whole-history.json - Whole-History snapshots (joint graph solve, no placement seeding)
    computed/h2h.json                 - Head-to-head records between every player pair
    computed/stats.json               - Per-player career stats

DQ sets are excluded from all rating calculations but are counted in stats.

Rating approach (Sequential/Retroactive):
  New players (no prior rating) are seeded from their final tournament
  placement before Glicko-2 runs. 1st place seeds at 1700, last place at
  1300, smooth curve in between scaled to field size. This gives the
  convergence loop a meaningful prior so established players aren't unfairly
  penalised by facing a strong newcomer who entered at a flat 1500.

  Established players always use their actual Glicko-2 prior — placement
  seeding only applies to first appearances.

  The 1700 ceiling isn't flat — it's pulled up toward the field's own
  established players when any are present (see `_confidence_blend`), so a
  stacked bracket seeds its debutants higher than a field of unknowns. Only
  established players who lost at least one set THIS tournament count as
  evidence of field depth: an anchor who went undefeated is evidence about
  themselves, not about anyone below them, since nothing in the bracket
  tested how deep the field actually was. Confidence in the field's own
  median also scales with how many such tested anchors are present — one
  tested anchor barely moves the ceiling off 1700; several do.

Whole-History mode is structurally different: it doesn't do placement
seeding at all. See `run_whole_history_pipeline`.
"""

import sys
import json
import os
import math
from collections import defaultdict


# ---------------------------------------------------------------------------
# Glicko-2 constants
# ---------------------------------------------------------------------------

MU_0    = 1500.0
PHI_0   = 350.0
SIGMA_0 = 0.06
TAU     = 0.4
EPSILON = 0.000001
SCALE   = 173.7178

MAX_PASSES     = 200
CONVERGE_DELTA = 0.1

# Placement seeding parameters (new players only)
SEED_TOP    = 1700.0   # rating for 1st place
SEED_BOTTOM = 1300.0   # rating for last place
SEED_CURVE  = 0.6      # exponent — < 1 stretches top end, > 1 stretches bottom

SEED_CONFIDENCE_K = 4.0   # tested anchors needed before the field-specific median is ~fully trusted
SEED_SIGMA        = 0.09  # starting volatility for placement-seeded ratings (vs SIGMA_0=0.06) —
                           # lets a bad seed correct faster once the player reaches a better-connected event

ENTRANT_REFERENCE  = 40.0  # field size at which the seed ceiling is ~fully trusted (1.0x)
ENTRANT_MIN_FACTOR = 0.5   # floor on how much the ceiling can be dampened for very small fields
ENTRANT_MAX_BONUS  = 0.25  # how far above 1.0 the single largest tournament in the dataset can push the ceiling

LOSS_FLOOR = 0.1   # a loss counts as this instead of 0.0 in Glicko-2's outcome value — a small
                    # amount of "credit for competing" that softens how hard a loss pulls rating
                    # down, without touching how much a win pulls it up (see set_outcome)


def placement_seed(place, n):
    """
    Map a final placement to a starting rating.
    place: 1-indexed finishing position
    n: total entrants in the tournament
    """
    if n <= 1:
        return MU_0
    t = 1.0 - (place - 1) / (n - 1)   # 1.0 for 1st, 0.0 for last
    spread = SEED_TOP - SEED_BOTTOM
    return SEED_BOTTOM + spread * (t ** SEED_CURVE)


def _confidence_blend(tested_ratings, fallback):
    """
    Blend the median of tested_ratings toward `fallback` based on sample size.
    Zero or few tested anchors barely move the ceiling off the global default;
    more independent tested anchors let the field's own signal dominate.

    "Tested" anchors matter here specifically: an established player who went
    undefeated tells us nothing about how deep the rest of the field is, only
    about themselves.
    """
    if not tested_ratings:
        return fallback
    sorted_r = sorted(tested_ratings)
    raw_median = sorted_r[len(sorted_r) // 2]
    n = len(tested_ratings)
    confidence = n / (n + SEED_CONFIDENCE_K)
    return confidence * raw_median + (1 - confidence) * fallback


def _entrant_size_factor(n_entrants, n_entrants_max):
    """
    How much of the (SEED_TOP - SEED_BOTTOM) range a field's placement curve
    can reach, scaled by field size. Steep log growth up to ENTRANT_REFERENCE
    (a small regional vs. a mid-size major matters a lot); beyond that, growth
    continues but gently, scaled to how this field compares to the single
    largest tournament in the dataset — so the curve keeps extending on its
    own if a bigger major is added later, instead of capping hard at 1.0.
    """
    if n_entrants <= 1:
        return ENTRANT_MIN_FACTOR
    if n_entrants <= ENTRANT_REFERENCE:
        raw = math.log(n_entrants) / math.log(ENTRANT_REFERENCE)
        return max(ENTRANT_MIN_FACTOR, raw)
    if n_entrants_max <= ENTRANT_REFERENCE:
        return 1.0
    extra = math.log(n_entrants / ENTRANT_REFERENCE) / math.log(n_entrants_max / ENTRANT_REFERENCE)
    return 1.0 + ENTRANT_MAX_BONUS * min(1.0, extra)


# ---------------------------------------------------------------------------
# Glicko-2 core
# ---------------------------------------------------------------------------

def to_g2(mu, phi):
    return (mu - MU_0) / SCALE, phi / SCALE


def to_display(mu, phi):
    return mu * SCALE + MU_0, phi * SCALE


def g(phi):
    return 1.0 / math.sqrt(1 + 3 * phi**2 / math.pi**2)


def E(mu, mu_j, phi_j):
    return 1.0 / (1 + math.exp(-g(phi_j) * (mu - mu_j)))


def glicko2_update(mu, phi, sigma, results):
    if not results:
        phi_new = min(math.sqrt(phi**2 + sigma**2), PHI_0 / SCALE)
        return mu, phi_new, sigma

    v_inv = sum(g(pj)**2 * E(mu, mj, pj) * (1 - E(mu, mj, pj))
                for mj, pj, _ in results)
    v = 1.0 / v_inv

    delta_sum = sum(g(pj) * (s - E(mu, mj, pj)) for mj, pj, s in results)
    delta = v * delta_sum

    a = math.log(sigma**2)

    def f(x):
        ex = math.exp(x)
        return (ex * (delta**2 - phi**2 - v - ex) /
                (2 * (phi**2 + v + ex)**2) - (x - a) / TAU**2)

    A = a
    if delta**2 > phi**2 + v:
        B = math.log(delta**2 - phi**2 - v)
    else:
        k = 1
        while f(a - k * TAU) < 0 and k < 100:
            k += 1
        B = a - k * TAU

    fA, fB = f(A), f(B)
    for _ in range(200):
        if abs(B - A) <= EPSILON:
            break
        C = A + (A - B) * fA / (fB - fA)
        fC = f(C)
        if fC * fB < 0:
            A, fA = B, fB
        else:
            fA /= 2
        B, fB = C, fC

    sigma_new = math.exp(A / 2)
    phi_star  = math.sqrt(phi**2 + sigma_new**2)
    phi_new   = 1.0 / math.sqrt(1.0 / phi_star**2 + 1.0 / v)
    mu_new    = mu + phi_new**2 * delta_sum

    return mu_new, phi_new, sigma_new


# ---------------------------------------------------------------------------
# Rating convergence
# ---------------------------------------------------------------------------

def run_tournament(playable, prior_states, dq_losses=None):
    """
    Compute converged ratings for one tournament period.
    prior_states already has placement seeds applied for new players.

    Pass 1: standard Glicko-2 (establishes RD/volatility).
    Passes 2+: freeze RD/volatility, iterate ratings until convergence.
    """
    period_players = set(t for ta, tb, _, __ in playable for t in (ta, tb))
    mu0, phi0 = to_g2(MU_0, PHI_0)

    def get_prior(tag):
        return prior_states.get(tag, [mu0, phi0, SIGMA_0])

    # Pass 1
    states = {}
    for tag in period_players:
        cur = get_prior(tag)
        results = [
            (get_prior(tb)[0], get_prior(tb)[1], oa) if ta == tag
            else (get_prior(ta)[0], get_prior(ta)[1], ob)
            for ta, tb, oa, ob in playable if ta == tag or tb == tag
        ]
        nm, np, ns = glicko2_update(cur[0], cur[1], cur[2], results)
        states[tag] = [nm, np, ns]

    frozen_phi   = {t: states[t][1] for t in period_players}
    frozen_sigma = {t: states[t][2] for t in period_players}

    # Passes 2+ — iterate ratings only, starting from each player's prior
    # (not from mu0=1500). This is critical: using mu0 would treat all
    # established players as 1500 during convergence, completely ignoring
    # their actual rating when computing expected outcomes.
    for _ in range(1, MAX_PASSES):
        new_states = {}
        for tag in period_players:
            phi, sigma = frozen_phi[tag], frozen_sigma[tag]
            prior_mu = get_prior(tag)[0]
            results = [
                (states[tb][0], frozen_phi[tb], oa) if ta == tag
                else (states[ta][0], frozen_phi[ta], ob)
                for ta, tb, oa, ob in playable if ta == tag or tb == tag
            ]
            nm, np, ns = glicko2_update(prior_mu, phi, sigma, results)
            new_states[tag] = [nm, frozen_phi[tag], frozen_sigma[tag]]

        max_delta = max(
            abs(to_display(new_states[t][0], 0)[0] -
                to_display(states[t][0], 0)[0])
            for t in period_players
        )
        states = new_states
        if max_delta < CONVERGE_DELTA:
            break

    # Apply DQ losses: each DQ'd player takes a half-penalty loss against
    # their actual opponent's converged rating. A score of 0.45 (part way
    # between 0=full loss and 0.5=draw) gives half the normal Glicko-2
    # penalty applied ON TOP of the converged rating — not from the prior.
    # Using the real opponent means losing to a strong player hurts less
    # than losing to a weak one, as expected.
    if dq_losses:
        mu0_g2, phi0_g2 = to_g2(MU_0, PHI_0)
        for tag, opp_tag in dq_losses:
            cur = states.get(tag)
            if cur is None:
                cur = [get_prior(tag)[0], phi0_g2, SIGMA_0]
            # Use opponent's converged rating if available, else their prior
            if opp_tag in states:
                opp_mu  = states[opp_tag][0]
                opp_phi = frozen_phi.get(opp_tag, states[opp_tag][1])
            else:
                opp_mu, opp_phi = get_prior(opp_tag)[:2]
            # Start from converged rating (cur[0]), not prior, so the penalty
            # applies on top of what they actually earned in real sets
            nm, np, ns = glicko2_update(
                cur[0],
                frozen_phi.get(tag, cur[1]),
                SIGMA_0,
                [(opp_mu, opp_phi, 0.45)]  # half-penalty vs actual opponent
            )
            states[tag] = [nm, frozen_phi.get(tag, cur[1]), SIGMA_0]

    return states


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def build_alt_index(players):
    index = {}
    for p in players:
        index[p['tag'].lower()] = p['tag']
        for alt in p.get('alternate_tags', []):
            index[alt.lower()] = p['tag']
    return index


def resolve(tag, alt_index):
    return alt_index.get(tag.lower(), tag)


def is_dq(s):
    sa, sb = s.get('score_a'), s.get('score_b')
    if sa == 'DQ' or sb == 'DQ':
        return True
    # Some tournament organizers leave a no-show set unreported rather than
    # marking it DQ, and just push the bracket forward — "0 - 0" then means
    # neither player showed up, not a legitimate 0-0 result (Smash 64 sets
    # are always best-of-3/5, so a real completed set can never end 0-0).
    if sa == 0 and sb == 0:
        return True
    return False


def is_double_dq(s):
    """True if BOTH sides no-showed — neither player actually competed, so
    (unlike a normal single-sided DQ) this set should cost nobody anything:
    both get a DQ loss recorded for bookkeeping, but no rating impact at all,
    since there's no real opponent performance to calibrate a penalty against."""
    sa, sb = s.get('score_a'), s.get('score_b')
    return (sa == 'DQ' and sb == 'DQ') or (sa == 0 and sb == 0)


def set_outcome(s):
    if is_dq(s):
        return None
    sa, sb = s.get('score_a'), s.get('score_b')
    if sa == 'W' or sb == 'L':   return 1.0, LOSS_FLOOR
    if sb == 'W' or sa == 'L':   return LOSS_FLOOR, 1.0
    if isinstance(sa, (int, float)) and isinstance(sb, (int, float)):
        if sa > sb: return 1.0, LOSS_FLOOR
        if sb > sa: return LOSS_FLOOR, 1.0
        return 0.5, 0.5
    return None


def h2h_key(a, b):
    return tuple(sorted([a, b]))


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

def run_pipeline(tournaments, sets_dir, alt_index, retroactive=False,
                  season_ratings=None, season_tournament_counts=None,
                  n_entrants_max=0):
    """
    Process all tournaments and return (snapshots, h2h, stats_acc).

    retroactive=False  — sequential: each tournament uses ratings from all
                         prior tournaments as priors (standard Glicko-2).

    retroactive=True   — retroactive: before processing tournament N, reset
                         global ratings and reprocess tournaments 1..N-1 from
                         scratch. This means every snapshot is computed with
                         full-season context, so early wins against players who
                         later prove strong are correctly valued.
    """
    mu0, phi0 = to_g2(MU_0, PHI_0)

    h2h = defaultdict(lambda: {"wins": [0, 0], "sets": 0, "by_tournament": {}})
    stats_acc = defaultdict(lambda: {
        "sets_won": 0, "sets_lost": 0, "sets_total": 0,
        "tournaments": 0, "placements": [],
        "peak_rating": None, "peak_rating_after": None,
    })
    snapshots = []

    def process_tournaments_up_to(idx, existing_h2h=None, existing_stats=None):
        """Process tournaments[0..idx] and return global_ratings."""
        gr = {}
        for tournament in tournaments[:idx + 1]:
            gr = process_one_tournament(tournament, gr, sets_dir, alt_index,
                                        mu0, phi0, existing_h2h, existing_stats,
                                        season_ratings, season_tournament_counts,
                                        n_entrants_max)
        return gr

    def process_one_tournament(tournament, global_ratings, sets_dir, alt_index,
                                mu0, phi0, h2h_acc=None, stats_acc_=None,
                                season_ratings=None, season_tournament_counts=None,
                                n_entrants_max=0):
        tid        = tournament['id']
        n_entrants = tournament.get('entrant_count', 0)
        sets_path  = os.path.join(sets_dir, f"{tid}.json")
        if not os.path.exists(sets_path):
            return global_ratings

        raw_sets      = load_json(sets_path)
        placement_map = {resolve(p['tag'], alt_index): p['place']
                         for p in tournament.get('placements', [])}

        playable  = []
        dq_losses = []
        dq_count  = 0
        players_with_real_sets = set()  # only ever populated from playable sets, never DQ ones

        for s in raw_sets:
            outcome = set_outcome(s)
            tag_a   = resolve(s['player_a'], alt_index)
            tag_b   = resolve(s['player_b'], alt_index)
            if outcome is None:
                dq_count += 1
                if is_dq(s):
                    if s.get('score_b') == 'DQ':
                        dq_losses.append((tag_b, tag_a))
                        if stats_acc_ is not None:
                            stats_acc_[tag_b]['sets_lost']  += 1
                            stats_acc_[tag_b]['sets_total'] += 1
                    elif s.get('score_a') == 'DQ':
                        dq_losses.append((tag_a, tag_b))
                        if stats_acc_ is not None:
                            stats_acc_[tag_a]['sets_lost']  += 1
                            stats_acc_[tag_a]['sets_total'] += 1
                continue
            playable.append((tag_a, tag_b, outcome[0], outcome[1]))
            players_with_real_sets.add(tag_a)
            players_with_real_sets.add(tag_b)

        # Built only from playable sets. A player DQ'd out of every scheduled
        # match this tournament never lands here, so they never get a rating
        # or a counted tournament/placement (below) — run_tournament()'s
        # dq_losses branch computes a rating for them internally, but it's
        # discarded since they're absent from this set. This is intentional:
        # a 100%-DQ player didn't demonstrate anything to rate and didn't
        # really "attend". A player who played some real sets and got DQ'd
        # out of the rest DOES land here (via their real sets), so their DQ
        # losses apply as a penalty on top of real performance instead of
        # being dropped, and they count fully as having attended.
        period_players = set(t for ta, tb, _, __ in playable for t in (ta, tb))

        # Players who lost at least one real set this tournament. Used to
        # decide whether an established player's rating is trustworthy
        # evidence of field depth for placement seeding below — someone who
        # went undefeated was never tested by the field.
        players_with_a_loss = set()
        for ta, tb, oa, ob in playable:
            if oa < ob:
                players_with_a_loss.add(ta)
            elif ob < oa:
                players_with_a_loss.add(tb)

        if stats_acc_ is not None:
            for tag_a, tag_b, oa, ob in playable:
                stats_acc_[tag_a]['sets_total'] += 1
                stats_acc_[tag_b]['sets_total'] += 1
                if oa > ob:
                    stats_acc_[tag_a]['sets_won']  += 1
                    stats_acc_[tag_b]['sets_lost'] += 1
                elif ob > oa:
                    stats_acc_[tag_b]['sets_won']  += 1
                    stats_acc_[tag_a]['sets_lost'] += 1

        if h2h_acc is not None:
            for tag_a, tag_b, oa, ob in playable:
                key = h2h_key(tag_a, tag_b)
                entry = h2h_acc[key]
                is_a_first = key[0] == tag_a
                if tid not in entry['by_tournament']:
                    entry['by_tournament'][tid] = {"wins": [0, 0], "sets": 0}
                bt = entry['by_tournament'][tid]
                entry['sets'] += 1
                bt['sets']    += 1
                if oa > ob:
                    idx_ = 0 if is_a_first else 1
                    entry['wins'][idx_] += 1
                    bt['wins'][idx_]    += 1
                elif ob > oa:
                    idx_ = 1 if is_a_first else 0
                    entry['wins'][idx_] += 1
                    bt['wins'][idx_]    += 1

        established_ratings = [
            to_display(global_ratings[t][0], 0)[0]
            for t in period_players if t in global_ratings
        ]
        has_established = len(established_ratings) > 0

        # Only established players this field actually tested (beat at least
        # once) count as evidence of field depth for the seed ceiling below —
        # see _confidence_blend and the module docstring.
        tested_established_ratings = [
            to_display(global_ratings[t][0], 0)[0]
            for t in period_players
            if t in global_ratings and t in players_with_a_loss
        ]

        if season_ratings is not None:
            # Retroactive mode: same tested-anchor philosophy, but the anchor
            # pool is field members with genuine multi-tournament season
            # history (not just their own eventual rating from THIS event,
            # which would be circular).
            tested_field_season_ratings = [
                season_ratings[t] for t in period_players
                if t in season_ratings and t in players_with_a_loss
                and season_tournament_counts.get(t, 0) > 1
            ]
            seed_top = _confidence_blend(tested_field_season_ratings, SEED_TOP)
            has_established = True  # always seed from placement in retroactive mode
        elif has_established:
            seed_top = _confidence_blend(tested_established_ratings, SEED_TOP)
        else:
            seed_top = SEED_TOP

        # Dampen (or extend) the ceiling by how large this field actually is —
        # doing well in a small field isn't as strong evidence as doing well
        # in a large one. See _entrant_size_factor.
        size_factor = _entrant_size_factor(n_entrants, n_entrants_max)
        effective_seed_top = SEED_BOTTOM + (seed_top - SEED_BOTTOM) * size_factor

        prior = {}
        for tag in period_players:
            if tag in global_ratings:
                prior[tag] = global_ratings[tag][:3]
            else:
                place = placement_map.get(tag)
                if has_established and place is not None and n_entrants > 1:
                    t_norm = 1.0 - (place - 1) / (n_entrants - 1)
                    seed_mu = SEED_BOTTOM + (effective_seed_top - SEED_BOTTOM) * (t_norm ** SEED_CURVE)
                    seed_mu_g2, _ = to_g2(seed_mu, 0)
                    prior[tag] = [seed_mu_g2, phi0, SEED_SIGMA]
                else:
                    prior[tag] = [mu0, phi0, SIGMA_0]

        new_ratings = run_tournament(playable, prior, dq_losses)

        # RD decay for absent players
        for tag, st in global_ratings.items():
            if tag not in period_players:
                phi_d = min(math.sqrt(st[1]**2 + st[2]**2), PHI_0 / SCALE)
                global_ratings[tag][1] = phi_d

        all_tournament_players = set(period_players)
        for s in raw_sets:
            if is_dq(s):
                all_tournament_players.add(resolve(s['player_a'], alt_index))
                all_tournament_players.add(resolve(s['player_b'], alt_index))

        for tag in period_players:
            nr   = new_ratings[tag]
            prev = global_ratings.get(tag, [mu0, phi0, SIGMA_0, 0, 0])
            set_count = sum(1 for ta, tb, _, __ in playable if ta == tag or tb == tag)
            global_ratings[tag] = [nr[0], nr[1], nr[2], prev[3] + set_count, prev[4] + 1]

        if stats_acc_ is not None:
            for tag in all_tournament_players:
                # players_with_real_sets excludes anyone DQ'd out of every set
                # this tournament (see period_players above) — sets_total/won/
                # lost are still tracked for them elsewhere, just not this.
                if tag in players_with_real_sets:
                    stats_acc_[tag]['tournaments'] += 1
                    place = placement_map.get(tag)
                    if place is not None:
                        stats_acc_[tag]['placements'].append({"tournament": tid, "place": place})

        return global_ratings

    # ── Main loop ──
    global_ratings = {}
    for i, tournament in enumerate(tournaments):
        tid  = tournament['id']
        date = tournament['date']
        name = tournament['name']

        sets_path = os.path.join(sets_dir, f"{tid}.json")
        if not os.path.exists(sets_path):
            print(f"  WARNING: no sets file for {tid}, skipping", file=sys.stderr)
            continue

        if retroactive and i > 0:
            # For the retroactive snapshot of tournament i, reprocess all
            # prior tournaments from scratch using the same logic, but without
            # accumulating h2h/stats (those come from the sequential pass).
            # This gives us ratings for tournaments 0..i-1 that already reflect
            # the full context of who those players turned out to be.
            retroactive_ratings = {}
            for j, prior_t in enumerate(tournaments[:i]):
                prior_path = os.path.join(sets_dir, f"{prior_t['id']}.json")
                if os.path.exists(prior_path):
                    retroactive_ratings = process_one_tournament(
                        prior_t, retroactive_ratings, sets_dir, alt_index,
                        mu0, phi0, None, None, season_ratings, season_tournament_counts,
                        n_entrants_max
                    )
            global_ratings = retroactive_ratings

        global_ratings = process_one_tournament(
            tournament, global_ratings, sets_dir, alt_index,
            mu0, phi0, h2h, stats_acc, season_ratings, season_tournament_counts,
            n_entrants_max
        )

        ranked = sorted(
            [{"tag": tag, "rank": 0,
              "rating":      round(to_display(st[0], 0)[0], 2),
              "rd":          round(to_display(0, st[1])[1], 2),
              "volatility":  round(st[2], 6),
              "sets":        st[3],
              "tournaments": st[4]}
             for tag, st in global_ratings.items()],
            key=lambda x: x['rating'], reverse=True
        )
        for i_, p in enumerate(ranked):
            p['rank'] = i_ + 1

        for entry in ranked:
            tag, rating = entry['tag'], entry['rating']
            if stats_acc[tag]['peak_rating'] is None or rating > stats_acc[tag]['peak_rating']:
                stats_acc[tag]['peak_rating']       = rating
                stats_acc[tag]['peak_rating_after'] = tid

        snapshots.append({"after": tid, "name": name, "date": date, "ratings": ranked})
        mode = "retroactive" if retroactive else "sequential"
        print(f"  [{mode}] {name} ({date}): {len(ranked)} players")

    return snapshots, h2h, stats_acc


def run_whole_history_pipeline(tournaments, sets_dir, alt_index):
    """
    Jointly solves the ENTIRE accumulated match graph at each tournament
    boundary, instead of carrying forward a per-tournament sequential state
    or seeding new players from placement at all. A new player's rating
    emerges purely from their real connections across the whole dataset, so
    the placement-seed inflation this module works around elsewhere (see
    module docstring) is structurally impossible here — there's no seed
    step to inflate.

    Recomputes from scratch at every tournament boundary (re-reads every
    prior tournament's sets file each time) rather than carrying forward
    incremental state — O(n^2) in tournament count, trivial at this
    dataset's size.
    """
    snapshots = []
    for i, tournament in enumerate(tournaments):
        # Match run_pipeline's behavior: no snapshot at all for a tournament
        # missing its own sets file, so all three modes' snapshot lists stay
        # index-aligned by tournament id (the frontend relies on this).
        if not os.path.exists(os.path.join(sets_dir, f"{tournament['id']}.json")):
            continue

        all_playable   = []
        all_dq_losses  = []
        set_counts     = defaultdict(int)
        tournament_ids = defaultdict(set)

        for prior_t in tournaments[:i + 1]:
            sets_path = os.path.join(sets_dir, f"{prior_t['id']}.json")
            if not os.path.exists(sets_path):
                continue
            for s in load_json(sets_path):
                tag_a   = resolve(s['player_a'], alt_index)
                tag_b   = resolve(s['player_b'], alt_index)
                outcome = set_outcome(s)
                if outcome is None:
                    if is_dq(s):
                        if s.get('score_b') == 'DQ':
                            all_dq_losses.append((tag_b, tag_a))
                        elif s.get('score_a') == 'DQ':
                            all_dq_losses.append((tag_a, tag_b))
                    continue
                all_playable.append((tag_a, tag_b, outcome[0], outcome[1]))
                set_counts[tag_a] += 1
                set_counts[tag_b] += 1
                tournament_ids[tag_a].add(prior_t['id'])
                tournament_ids[tag_b].add(prior_t['id'])

        states = run_tournament(all_playable, {}, all_dq_losses)

        # Same rule as the other two modes: a player with zero real (non-DQ)
        # sets in their whole accumulated history didn't demonstrate
        # anything to rate, even though run_tournament()'s dq_losses branch
        # computes a rating for them internally.
        ranked = sorted(
            [{"tag": tag, "rank": 0,
              "rating":      round(to_display(st[0], 0)[0], 2),
              "rd":          round(to_display(0, st[1])[1], 2),
              "volatility":  round(st[2], 6),
              "sets":        set_counts[tag],
              "tournaments": len(tournament_ids[tag])}
             for tag, st in states.items() if tag in set_counts],
            key=lambda x: x['rating'], reverse=True
        )
        for i_, p in enumerate(ranked):
            p['rank'] = i_ + 1

        snapshots.append({"after": tournament['id'], "name": tournament['name'],
                           "date": tournament['date'], "ratings": ranked})
        print(f"  [whole-history] {tournament['name']} ({tournament['date']}): {len(ranked)} players")

    return snapshots


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))

    sets_dir        = sys.argv[1] if len(sys.argv) > 1 else os.path.join(script_dir, 'sets')
    tournaments_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(script_dir, 'tournaments')
    players_path    = sys.argv[3] if len(sys.argv) > 3 else os.path.join(script_dir, 'players.json')
    output_dir      = sys.argv[4] if len(sys.argv) > 4 else os.path.join(script_dir, 'computed')

    players   = load_json(players_path) if os.path.exists(players_path) else []
    alt_index = build_alt_index(players)

    tournaments = []
    for fname in sorted(os.listdir(tournaments_dir)):
        if fname.endswith('.json'):
            tournaments.append(load_json(os.path.join(tournaments_dir, fname)))
    tournaments.sort(key=lambda t: t['date'])

    n_entrants_max = max((t.get('entrant_count', 0) for t in tournaments), default=0)

    os.makedirs(output_dir, exist_ok=True)

    # ── Run all three pipelines ──
    print("Running sequential pipeline...")
    seq_snaps, seq_h2h, seq_stats = run_pipeline(tournaments, sets_dir, alt_index, retroactive=False,
                                                  n_entrants_max=n_entrants_max)

    # Build season_ratings: each player's rating after their last attended tournament.
    # Used by the retroactive pass to set informed seed ceilings even for tournament 1.
    # season_tournament_counts (their final season-long tournament count) gates
    # which of those season ratings count as real external signal vs a
    # debutant's own seed-derived number circularly validating itself.
    season_ratings = {}
    season_tournament_counts = {}
    for snap in seq_snaps:
        for p in snap['ratings']:
            # Overwrite each time — last snapshot where player appears wins
            season_ratings[p['tag']] = p['rating']
            season_tournament_counts[p['tag']] = p['tournaments']

    print("Running retroactive pipeline...")
    ret_snaps, _, _ = run_pipeline(tournaments, sets_dir, alt_index,
                                    retroactive=True, season_ratings=season_ratings,
                                    season_tournament_counts=season_tournament_counts,
                                    n_entrants_max=n_entrants_max)

    print("Running whole-history pipeline...")
    wh_snaps = run_whole_history_pipeline(tournaments, sets_dir, alt_index)

    # ── Write ratings files ──
    seq_path = os.path.join(output_dir, 'ratings.json')
    with open(seq_path, 'w', encoding='utf-8') as f:
        json.dump({"snapshots": seq_snaps}, f, indent=2, ensure_ascii=False)
    print(f"\nWrote {seq_path}")

    ret_path = os.path.join(output_dir, 'ratings-retroactive.json')
    with open(ret_path, 'w', encoding='utf-8') as f:
        json.dump({"snapshots": ret_snaps}, f, indent=2, ensure_ascii=False)
    print(f"Wrote {ret_path}")

    wh_path = os.path.join(output_dir, 'ratings-whole-history.json')
    with open(wh_path, 'w', encoding='utf-8') as f:
        json.dump({"snapshots": wh_snaps}, f, indent=2, ensure_ascii=False)
    print(f"Wrote {wh_path}")

    # ── H2H (same for all three — based on actual results, not ratings) ──
    h2h_out = [{"players": list(k), "wins": v['wins'], "sets": v['sets'],
                 "by_tournament": {t: {"wins": b['wins'], "sets": b['sets']}
                                   for t, b in v['by_tournament'].items()}}
               for k, v in sorted(seq_h2h.items())]
    h2h_path = os.path.join(output_dir, 'h2h.json')
    with open(h2h_path, 'w', encoding='utf-8') as f:
        json.dump(h2h_out, f, indent=2, ensure_ascii=False)
    print(f"Wrote {h2h_path}  ({len(h2h_out)} pairs)")

    # ── Stats (use sequential ratings as current_rating/rank baseline) ──
    final_ratings = {}
    for entry in seq_snaps[-1]['ratings']:
        final_ratings[entry['tag']] = {'rating': entry['rating'],
                                        'rd': entry['rd'], 'rank': entry['rank']}

    stats_out = []
    for tag in sorted(set(seq_stats.keys()) | set(final_ratings.keys())):
        acc = seq_stats[tag]
        fr  = final_ratings.get(tag)
        st  = acc['sets_total']
        sw  = acc['sets_won']
        pl  = sorted(acc['placements'], key=lambda p: p['tournament'])
        stats_out.append({
            "tag": tag, "tournaments": acc['tournaments'],
            "sets_total": st, "sets_won": sw, "sets_lost": acc['sets_lost'],
            "win_rate": round(sw / st, 4) if st else 0,
            "best_placement": min((p['place'] for p in pl), default=None),
            "placements": pl,
            "peak_rating": acc['peak_rating'],
            "peak_rating_after": acc['peak_rating_after'],
            "current_rating": fr['rating'] if fr else None,
            "current_rd":     fr['rd']     if fr else None,
            "current_rank":   fr['rank']   if fr else None,
        })

    stats_out.sort(key=lambda x: x['current_rank'] if x['current_rank'] else 9999)
    stats_path = os.path.join(output_dir, 'stats.json')
    with open(stats_path, 'w', encoding='utf-8') as f:
        json.dump(stats_out, f, indent=2, ensure_ascii=False)
    print(f"Wrote {stats_path}  ({len(stats_out)} players)")


if __name__ == '__main__':
    main()
