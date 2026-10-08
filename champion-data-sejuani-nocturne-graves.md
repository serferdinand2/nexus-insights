# Champion Data — Sejuani, Nocturne, Graves

**Source:** Riot Data Dragon (`ddragon.leagueoflegends.com`), patch **16.14.1**
**Pulled:** 2 August 2026

---

## Is Data Dragon current?

Yes. Riot publishes one Data Dragon build per patch, and the version manifest
(`/api/versions.json`) currently tops out at **16.14.1**. The history is
continuous back to 2013 (`lolpatch_3.7`), one entry every ~2 weeks, so it
tracks live patches rather than lagging behind.

Your app already handles this correctly — `dataDragon.js` fetches the manifest
on startup and takes `versions[0]`, so item stats and tooltips follow patches
automatically. Its hardcoded fallback (`25.S1.1`) is stale, but it's only used
if the manifest request fails.

---

## Important limitation — read before using this

Data Dragon does **not** expose ability ratios (AD/AP scaling), and for several
abilities it doesn't expose base damage either. Its tooltips contain literal
unresolved placeholders — `{{ totaldamage }}`, `{{ basedamage }}`,
`{{ bonustrailad }}` — with zero-filled `effect` arrays behind them.

**Why:** nothing was removed from Data Dragon. Modern abilities are defined as
*formula trees*, not flat per-rank numbers, and Data Dragon's `effect[]` array
format simply cannot represent them.

The real definition lives in each champion's game data file under a
`mSpellCalculations` block, keyed by the very placeholder names Data Dragon
prints raw. Sejuani's R, verbatim from `sejuani.bin.json`:

```json
"mSpellCalculations": {
  "TotalDamageTooltip": {
    "mFormulaParts": [
      { "mDataValue": "EmpoweredBaseDamage", "__type": "NamedDataValueCalculationPart" },
      { "mCoefficient": 0.8, "__type": "StatByCoefficientCalculationPart" }
    ]
  }
}
```

That's `EmpoweredBaseDamage + 0.8 AP`. The game client walks this tree at
runtime to render the tooltip; Data Dragon is a static export with no such
evaluation step, so it ships the template unfilled.

**What is complete and authoritative below:** base stats, per-level growth,
cooldowns, mana costs, ranges, and crowd-control durations.

**What is partial:** ability damage. Where Data Dragon still carries the values
they're listed; where the arrays are zeroed it's marked *not exposed*.

**Where to get ratios if you need them** — Community Dragon
(`raw.communitydragon.org`), a community-run mirror of Riot's own files. Two
endpoints, and the difference matters:

| Endpoint | What you get |
|---|---|
| `/latest/plugins/rcp-be-lol-game-data/global/default/v1/champions/{id}.json` | Same placeholders, plus a `coefficients` field. **Partial** — Sejuani's Q/W/E read `0.0`; only her R carries real values (`0.4` / `0.8`). |
| `/latest/game/data/characters/{name}/{name}.bin.json` | The full `mSpellCalculations` formula trees. **Complete**, but you must evaluate the tree yourself. |

Formula-part types you'll encounter: `NamedDataValueCalculationPart` (a named
base value), `StatByCoefficientCalculationPart` (flat coefficient × a stat),
and `StatByNamedDataValueCalculationPart` (ratio stored under a name such as
`APRatio`). Note the `.bin.json` files are large — Sejuani's is ~50k
characters.

---

## The growth formula (why the tables matter)

Riot's per-level growth is **not linear**. The real formula is:

```
stat(level) = base + growth × (n−1) × (0.7025 + 0.0175 × (n−1))
```

Multiplying `hpperlevel × 17` overshoots level 18 significantly. Attack speed is
different again — it scales as a *percentage of base*:

```
AS(level) = base_AS × (1 + (AS_growth/100) × (n−1) × (0.7025 + 0.0175 × (n−1)))
```

All tables below are computed with these formulas.

---

# Sejuani — *Fury of the North*

**Tags:** Tank · **Resource:** Mana · **Difficulty:** 4/10
**Rating:** Attack 5 · Defence 7 · Magic 6

### Base stats

| Stat | Base | Growth/lvl |
|---|---:|---:|
| Health | 630 | 114 |
| Mana | 400 | 40 |
| Attack damage | 66 | 0 |
| Armour | 34 | 5.45 |
| Magic resist | 32 | 2.05 |
| HP regen (per 5s) | 8.5 | 1 |
| Mana regen (per 5s) | 7 | 0.7 |
| Attack speed | 0.688 | +3.5% |
| Move speed | 340 | — |
| Attack range | 150 (melee) | — |

### Stats by level

| Lvl | HP | Mana | AD | Armor | MR | HP5 | MP5 | Atk Speed |
|----:|---:|-----:|---:|------:|---:|----:|----:|----------:|
| 1 | 630 | 400 | 66 | 34 | 32 | 8.5 | 7 | 0.688 |
| 2 | 712 | 429 | 66 | 37.9 | 33.5 | 9.22 | 7.5 | 0.705 |
| 3 | 798 | 459 | 66 | 42 | 35 | 9.97 | 8.03 | 0.724 |
| 4 | 888 | 491 | 66 | 46.3 | 36.6 | 10.77 | 8.59 | 0.743 |
| 5 | 982 | 524 | 66 | 50.8 | 38.3 | 11.59 | 9.16 | 0.762 |
| 6 | 1080 | 558 | 66 | 55.5 | 40.1 | 12.45 | 9.77 | 0.783 |
| 7 | 1182 | 594 | 66 | 60.4 | 41.9 | 13.34 | 10.39 | 0.805 |
| 8 | 1288 | 631 | 66 | 65.5 | 43.8 | 14.28 | 11.04 | 0.827 |
| 9 | 1398 | 670 | 66 | 70.7 | 45.8 | 15.24 | 11.72 | 0.85 |
| 10 | 1512 | 710 | 66 | 76.2 | 47.9 | 16.24 | 12.42 | 0.874 |
| 11 | 1630 | 751 | 66 | 81.8 | 50 | 17.27 | 13.14 | 0.899 |
| 12 | 1752 | 794 | 66 | 87.7 | 52.2 | 18.34 | 13.89 | 0.925 |
| 13 | 1878 | 838 | 66 | 93.7 | 54.4 | 19.45 | 14.66 | 0.952 |
| 14 | 2008 | 884 | 66 | 99.9 | 56.8 | 20.59 | 15.46 | 0.979 |
| 15 | 2142 | 931 | 66 | 106.3 | 59.2 | 21.77 | 16.29 | 1.007 |
| 16 | 2280 | 979 | 66 | 112.9 | 61.7 | 22.98 | 17.13 | 1.037 |
| 17 | 2422 | 1029 | 66 | 119.7 | 64.2 | 24.22 | 18 | 1.067 |
| 18 | 2568 | 1080 | 66 | 126.7 | 66.8 | 25.5 | 18.9 | 1.097 |

### Abilities

**Passive — Fury of the North**
Out of combat, gains Frost Armor: bonus armour and magic resist plus **slow
immunity**. Persists briefly after taking damage. Damaging a stunned enemy
shatters it for bonus magic damage.

**Q — Arctic Assault** · Range 650

| | 1 | 2 | 3 | 4 | 5 |
|---|---:|---:|---:|---:|---:|
| Cooldown | 18 | 16.5 | 15 | 13.5 | 12 |
| Mana | 60 | 65 | 70 | 75 | 80 |

Charge forward, knocking enemies up for **0.5s**. Charge stops on the first
enemy champion hit. Dash speed ramps 625 → 1000.
*Base damage: not exposed by Data Dragon.*

**W — Winter's Wrath** · Range 600

| | 1 | 2 | 3 | 4 | 5 |
|---|---:|---:|---:|---:|---:|
| Cooldown | 9 | 8 | 7 | 6 | 5 |
| Mana | 60 | 60 | 60 | 60 | 60 |

Two swings. First knocks back minions/monsters; second carries the bulk of the
damage and applies a brief **0.75s** slow. Both swings apply Permafrost stacks.
*Base damage (both hits): not exposed.*

**E — Permafrost** · Range 560

| | 1 | 2 | 3 | 4 | 5 |
|---|---:|---:|---:|---:|---:|
| Cooldown | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 |
| Mana | 20 | 20 | 20 | 20 | 20 |

*Passive:* nearby **melee** allied champions' attacks also apply stacks to
champions and jungle monsters.
*Active:* at **4 stacks**, stun for **1s** plus magic damage. Stack duration 5s.
*Base damage: not exposed.*

**R — Glacial Prison** · Range 1300

| | 1 | 2 | 3 |
|---|---:|---:|---:|
| Cooldown | 120 | 105 | 90 |
| Mana | 100 | 100 | 100 |
| Min damage | 125 | 150 | 175 |
| Max damage | 200 | 300 | 400 |

Bola stuns and reveals the first champion hit for **1s**. If it travels ≥25% of
its range: stun becomes **1.5s** and it creates an ice storm slowing nearby
enemies **80% for 2s**, with all affected taking the higher damage figure.

---

# Nocturne — *the Eternal Nightmare*

**Tags:** Fighter, Assassin · **Resource:** Mana · **Difficulty:** 4/10
**Rating:** Attack 9 · Defence 5 · Magic 2

### Base stats

| Stat | Base | Growth/lvl |
|---|---:|---:|
| Health | 655 | 109 |
| Mana | 275 | 35 |
| Attack damage | 62 | 0 |
| Armour | 38 | 4.2 |
| Magic resist | 32 | 1.55 |
| HP regen (per 5s) | 7 | 0.75 |
| Mana regen (per 5s) | 7 | 0.45 |
| Attack speed | 0.721 | +2.7% |
| Move speed | 345 | — |
| Attack range | 125 (melee) | — |

### Stats by level

| Lvl | HP | Mana | AD | Armor | MR | HP5 | MP5 | Atk Speed |
|----:|---:|-----:|---:|------:|---:|----:|----:|----------:|
| 1 | 655 | 275 | 62 | 38 | 32 | 7 | 7 | 0.721 |
| 2 | 733 | 300 | 62 | 41 | 33.1 | 7.54 | 7.32 | 0.735 |
| 3 | 816 | 327 | 62 | 44.2 | 34.3 | 8.11 | 7.66 | 0.75 |
| 4 | 902 | 354 | 62 | 47.5 | 35.5 | 8.7 | 8.02 | 0.765 |
| 5 | 992 | 383 | 62 | 51 | 36.8 | 9.32 | 8.39 | 0.781 |
| 6 | 1086 | 413 | 62 | 54.6 | 38.1 | 9.96 | 8.78 | 0.798 |
| 7 | 1183 | 445 | 62 | 58.3 | 39.5 | 10.63 | 9.18 | 0.815 |
| 8 | 1284 | 477 | 62 | 62.3 | 41 | 11.33 | 9.6 | 0.833 |
| 9 | 1390 | 511 | 62 | 66.3 | 42.4 | 12.05 | 10.03 | 0.852 |
| 10 | 1499 | 546 | 62 | 70.5 | 44 | 12.8 | 10.48 | 0.872 |
| 11 | 1611 | 582 | 62 | 74.9 | 45.6 | 13.58 | 10.95 | 0.892 |
| 12 | 1728 | 620 | 62 | 79.3 | 47.3 | 14.38 | 11.43 | 0.913 |
| 13 | 1849 | 658 | 62 | 84 | 49 | 15.21 | 11.93 | 0.934 |
| 14 | 1973 | 698 | 62 | 88.8 | 50.7 | 16.07 | 12.44 | 0.956 |
| 15 | 2101 | 739 | 62 | 93.7 | 52.6 | 16.95 | 12.97 | 0.979 |
| 16 | 2233 | 782 | 62 | 98.8 | 54.4 | 17.86 | 13.51 | 1.003 |
| 17 | 2368 | 825 | 62 | 104 | 56.4 | 18.79 | 14.07 | 1.027 |
| 18 | 2508 | 870 | 62 | 109.4 | 58.4 | 19.75 | 14.65 | 1.052 |

### Abilities

**Passive — Umbra Blades**
Periodically, the next attack strikes surrounding enemies for bonus physical
damage and heals. Basic attacks reduce its cooldown.

**Q — Duskbringer** · Range 1125 · **Cooldown 8s at all ranks**

| | 1 | 2 | 3 | 4 | 5 |
|---|---:|---:|---:|---:|---:|
| Mana | 60 | 65 | 70 | 75 | 80 |
| Damage | 65 | 105 | 145 | 185 | 225 |
| Move speed | 15% | 20% | 25% | 30% | 35% |
| Bonus AD | 15 | 25 | 35 | 45 | 55 |

Throws a shadow blade leaving a **5s** dusk trail; champions hit also leave a
trail. On the trail Nocturne is **ghosted** and gains the MS and AD above.

**W — Shroud of Darkness** · Self-cast

| | 1 | 2 | 3 | 4 | 5 |
|---|---:|---:|---:|---:|---:|
| Cooldown | 20 | 18 | 16 | 14 | 12 |
| Mana | 50 | 50 | 50 | 50 | 50 |
| Attack speed | 30% | 35% | 40% | 45% | 50% |

*Passive:* the attack speed above.
*Active:* spell shield for **1.5s**. If it blocks an ability, attack speed
**doubles** for 5s (60/70/80/90/100%).

**E — Unspeakable Horror** · Range 425 · Tether break 465

| | 1 | 2 | 3 | 4 | 5 |
|---|---:|---:|---:|---:|---:|
| Cooldown | 15 | 14 | 13 | 12 | 11 |
| Mana | 60 | 65 | 70 | 75 | 80 |
| Damage | 80 | 125 | 170 | 215 | 260 |
| Fear duration | 1.25s | 1.5s | 1.75s | 2s | 2.25s |

Tether dealing damage over **2s**. If unbroken, fears. *Passive:* bonus move
speed toward feared targets.

**R — Paranoia** · Global-ish

| | 1 | 2 | 3 |
|---|---:|---:|---:|
| Cooldown | 140 | 115 | 90 |
| Mana | 100 | 100 | 100 |
| Dash range | 2500 | 3250 | 4000 |

Darkens the map, cutting enemy sight radius and removing their vision of
allies. Recast to launch at a champion.
*Damage: not exposed by Data Dragon.*

---

# Graves — *the Outlaw*

**Tags:** Marksman · **Resource:** Mana · **Difficulty:** 3/10
**Rating:** Attack 8 · Defence 5 · Magic 3

### Base stats

| Stat | Base | Growth/lvl |
|---|---:|---:|
| Health | 625 | 106 |
| Mana | 325 | 40 |
| Attack damage | 66 | 0 |
| Armour | 33 | 4.6 |
| Magic resist | 30 | 1.3 |
| HP regen (per 5s) | 8 | 0.7 |
| Mana regen (per 5s) | 8 | 0.7 |
| Attack speed | 0.475 | +3% |
| Move speed | 340 | — |
| Attack range | 425 | — |

> Note the unusually low base attack speed (0.475) — a consequence of the
> shotgun passive firing 4 bullets per attack.

### Stats by level

| Lvl | HP | Mana | AD | Armor | MR | HP5 | MP5 | Atk Speed |
|----:|---:|-----:|---:|------:|---:|----:|----:|----------:|
| 1 | 625 | 325 | 66 | 33 | 30 | 8 | 8 | 0.475 |
| 2 | 701 | 354 | 66 | 36.3 | 30.9 | 8.5 | 8.5 | 0.485 |
| 3 | 781 | 384 | 66 | 39.8 | 31.9 | 9.03 | 9.03 | 0.496 |
| 4 | 865 | 416 | 66 | 43.4 | 32.9 | 9.59 | 9.59 | 0.507 |
| 5 | 953 | 449 | 66 | 47.2 | 34 | 10.16 | 10.16 | 0.519 |
| 6 | 1044 | 483 | 66 | 51.2 | 35.1 | 10.77 | 10.77 | 0.531 |
| 7 | 1139 | 519 | 66 | 55.3 | 36.3 | 11.39 | 11.39 | 0.544 |
| 8 | 1237 | 556 | 66 | 59.6 | 37.5 | 12.04 | 12.04 | 0.557 |
| 9 | 1339 | 595 | 66 | 64 | 38.8 | 12.72 | 12.72 | 0.571 |
| 10 | 1445 | 635 | 66 | 68.6 | 40.1 | 13.42 | 13.42 | 0.585 |
| 11 | 1555 | 676 | 66 | 73.4 | 41.4 | 14.14 | 14.14 | 0.6 |
| 12 | 1669 | 719 | 66 | 78.3 | 42.8 | 14.89 | 14.89 | 0.615 |
| 13 | 1786 | 763 | 66 | 83.4 | 44.2 | 15.66 | 15.66 | 0.631 |
| 14 | 1907 | 809 | 66 | 88.6 | 45.7 | 16.46 | 16.46 | 0.647 |
| 15 | 2031 | 856 | 66 | 94 | 47.2 | 17.29 | 17.29 | 0.664 |
| 16 | 2159 | 904 | 66 | 99.6 | 48.8 | 18.13 | 18.13 | 0.681 |
| 17 | 2291 | 954 | 66 | 105.3 | 50.4 | 19 | 19 | 0.699 |
| 18 | 2427 | 1005 | 66 | 111.2 | 52.1 | 19.9 | 19.9 | 0.717 |

### Abilities

**Passive — New Destiny**
Shotgun with ammo: must reload when empty. Each attack fires **4 bullets** that
cannot pass through units. Non-champions hit by multiple bullets are knocked
back.

**Q — End of the Line** · Range 925

| | 1 | 2 | 3 | 4 | 5 |
|---|---:|---:|---:|---:|---:|
| Cooldown | 13 | 11.25 | 9.5 | 7.75 | 6 |
| Mana | 80 | 80 | 80 | 80 | 80 |

Powder round that detonates after **1s** or on hitting terrain, dealing damage
again along the travel path and around the blast.
*Base and detonation damage: not exposed by Data Dragon.*

**W — Smoke Screen** · Range 950 · Radius 200

| | 1 | 2 | 3 | 4 | 5 |
|---|---:|---:|---:|---:|---:|
| Cooldown | 26 | 24 | 22 | 20 | 18 |
| Mana | 70 | 75 | 80 | 85 | 90 |
| Impact damage | 60 | 110 | 160 | 210 | 260 |

Smoke cloud lasting **4s**, slowing enemies inside **50%** and blocking their
vision outside the area.

**E — Quickdraw** · Range 425 · Max 4 stacks

| | 1 | 2 | 3 | 4 | 5 |
|---|---:|---:|---:|---:|---:|
| Cooldown | 16 | 15 | 14 | 13 | 12 |
| Mana | 40 | 40 | 40 | 40 | 40 |
| Armour per stack | 30 | 40 | 50 | 60 | 70 |
| MR per stack | 15 | 20 | 25 | 30 | 35 |

Dash + reload one shell. Grants **1 stack**, or **2 stacks** if dashing toward
an enemy champion. Stacks refresh on damaging a non-minion. Each bullet that
hits reduces the cooldown.

**R — Collateral Damage** · Range 1000

| | 1 | 2 | 3 |
|---|---:|---:|---:|
| Cooldown | 100 | 80 | 60 |
| Mana | 100 | 100 | 100 |

Explosive cartridge that knocks Graves backwards. Heavy damage to the first
champion hit, then explodes in a cone.
*Damage values: not exposed by Data Dragon.*

---

## Quick comparison

| | Sejuani | Nocturne | Graves |
|---|---:|---:|---:|
| HP @1 / @18 | 630 / 2568 | 655 / 2508 | 625 / 2427 |
| Armour @18 | 126.7 | 109.4 | 111.2 |
| MR @18 | 66.8 | 58.4 | 52.1 |
| Base AD | 66 | 62 | 66 |
| Attack speed @18 | 1.097 | 1.052 | 0.717 |
| Move speed | 340 | 345 | 340 |
| Ultimate CD (r3) | 90s | 90s | 60s |

Sejuani is the clear tank profile — highest HP, armour and MR at 18. Nocturne
trades that for the highest base attack rating (9) and the fastest early
clear tools. Graves' low attack-speed figure is misleading in isolation: with
4 bullets per attack, effective DPS is far above what the number suggests.
