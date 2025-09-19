# Special Roles, House Rules & Variants

Beyond the core three roles (Civilian / Undercover / Mister White), the most feature-complete
implementation found (yanstarstudio's Undercover™ app) layers in optional special roles to add
depth for repeat play. Useful as a v2/v3 feature roadmap — don't build these first, but they show
where the genre goes once the core loop is solid.

## Special Roles (yanstarstudio)

| Role                       | Effect                                                                                                                                                                                                | Min. players |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **Goddess of Justice**     | Whenever a vote ends in a tie, she unilaterally decides who's ousted. Stays active even after she herself is eliminated.                                                                              | —            |
| **The Lovers**             | Two players secretly paired at round start (can be on different factions). If one is voted out, the other is automatically eliminated too.                                                            | 5+           |
| **Mr. Meme (Mime)**        | Each round, one random player must describe their word using **gestures only, no speaking**. Requires players to be visible to each other (not usable in text-only remote play).                      | —            |
| **The Revenger (Avenger)** | When eliminated, drags one more player down with them (their choice). Can be layered onto any base role.                                                                                              | 5+           |
| **The Duelists**           | Two players are secretly in a duel; whichever one is eliminated first loses 2 points, the other gains 2.                                                                                              | 5+           |
| **The Ghost**              | Eliminated players stay involved — they can keep discussing, suggesting votes, and even voting, without being back in the "alive" pool. Lowers the "I'm out, I'm bored" problem of elimination games. | —            |
| **The Falafel Vendor**     | Distributes an item each round that either protects or sabotages a player.                                                                                                                            | 4+           |
| **The Boomerang**          | First time this player receives the majority of votes, all votes against them bounce back onto whoever cast them instead (one-time power).                                                            | —            |
| **The Joy Fool**           | If this player happens to be the very first one eliminated, they get a bonus +4 points as compensation.                                                                                               | —            |

These are clearly designed to solve two specific pain points of the base game:

1. **Early elimination boredom** (The Ghost, The Joy Fool) — being voted out round 1 in a 12-player
   game means sitting out a long time; these roles keep eliminated players engaged or reward them.
2. **Tie-breaking without arguments** (Goddess of Justice) and **swingy late-game moments**
   (Boomerang, Revenger, Lovers) to create memorable "oh no" moments.

## Tie-Vote Resolution — Options Actually Seen in the Wild

No universal standard; pick one when designing:

1. **Rock-paper-scissors** between the tied players — fast, simple, no app support needed.
2. **Sudden-death mini-round**: tied players each give one more clue, then the table re-votes on
   just those players.
3. **Special role arbitration**: a "Goddess of Justice"-style role breaks the tie by fiat.
4. **Straight re-vote**: some digital implementations simply re-run the whole vote.

## Alternate Base-Role Naming (for awareness / SEO / localization)

Different implementations rename the same three roles — useful if you want your own distinct brand
voice, or want to recognize these as the same game under a different skin:

| Civilian                                   | Undercover                   | Mister White                   |
| ------------------------------------------ | ---------------------------- | ------------------------------ |
| Civilian, Citizen, Normal Player, Villager | Undercover, Infiltrator, Spy | Mr. White, Blank(-card holder) |

`undercovergame.com` (branded "Infiltrator: Find the Spy") is a near-exact rules clone using
Civilian / Infiltrator / Spy naming instead — confirms this rule set is treated as public-domain
party-game mechanics, not a proprietary system tied to one app.

## Paper/No-App Variant (pnwchords.com)

A pen-and-paper house-rule variant worth noting for a "no-app-needed" mode of your product:

- 7–20 players, 7–15 min, "12+ recommended (better for adults)".
- Gamemaster hand-writes/deals word slips instead of an app assigning them.
- 2–3 Undercovers and 1–2 Mister Whites recommended, scaling with player count.
- **No repeat clues rule stated explicitly**: "No description of a word should be allowed more than
  once" (i.e., across the whole game, not just the current round) — a stricter version of the usual
  "no repeating this round" rule.
- Elimination count can scale to **2 players per round** in larger groups, not just 1.
- Optional **Detective role**: sees both words in the pair, is on the Civilians' side, doesn't speak
  up automatically — effectively a very powerful informed-Civilian sub-role. Interesting design
  precedent if you want a "helper" role beyond Civilian/Undercover/Mister White.

## Product/Feature Ideas Surfaced by Competitor Research (not rules, but relevant to planning)

- **Offline/pass-and-play vs. online room-code vs. public matchmaking** — all three modes exist
  across the market; offline pass-and-play is described as the simplest/most requested by at least
  one FAQ.
- **Custom word packs** — nearly universal feature; users can add their own word pairs under a
  "Personal"/"Custom" category.
- **Real-time ranking / persistent scoring shown at round end** — mentioned as a retention feature.
- **Auto-suggested role counts based on player count**, always overridable by the host.
