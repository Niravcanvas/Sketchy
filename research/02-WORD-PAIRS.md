# Word Pairs — Examples, Categories & Design Principles

The word pair is the engine of the whole game. This doc collects real examples scraped from live
implementations plus the design principles they follow, so you can either reuse these directly or
generate more in the same spirit.

## Design Principle

> "Good word pairs have enough overlap to be debatable but enough difference to create suspicion...
> close enough that the Undercover can survive a few rounds, but different enough that a sharp
> Civilian can catch them." — undercover.gg

Every implementation that documents this agrees: the pair needs a **shared semantic category**
(same "shape" of thing) with a **meaningful point of difference** (texture, size, function, era,
sensory experience) that a good clue can expose without being a dead giveaway.

Sources differ on the exact split, but a 3-tier **difficulty ladder** shows up repeatedly:

- **Easy** — pairs share the category but differ obviously once described (Cat / Dog).
- **Medium** — pairs are close cousins, need a specific clue to tell apart (Coffee / Tea).
- **Hard** — pairs are near-synonyms or highly related concepts (River / Canal, Envy / Jealousy).

## Example Word Pairs by Category (scraped from undercover.gg/words)

**Food & Drink**

- Easy: waffle / pancake · pizza / calzone · coffee / tea · burger / sandwich · donut / bagel ·
  ketchup / mustard · bacon / ham · mac and cheese / grilled cheese
- Medium: sushi / sashimi · brownie / fudge · milkshake / smoothie · pretzel / breadstick ·
  cornbread / biscuit
- Hard: ranch dressing / blue cheese dressing · BBQ ribs / BBQ wings

**Animals**

- Easy: dolphin / whale · cat / tiger · dog / wolf · turkey / chicken
- Medium: eagle / hawk · octopus / squid · raccoon / possum · chipmunk / squirrel
- Hard: alligator / crocodile · bison / buffalo · moose / elk

**Tech**

- Easy: iPhone / Android · Netflix / Hulu · PlayStation / Xbox · Google / Bing ·
  Spotify / Apple Music · Uber / Lyft · Venmo / Cash App
- Medium: TikTok / Instagram Reels · Twitter / Threads · Discord / Slack ·
  Reddit / Quora

**Abstract / Feelings** (a harder, more "party game with adults" category)

- Medium: fear / terror · pride / arrogance · luck / fate
- Hard: jealousy / envy · freedom / independence · joy / happiness · courage / bravery ·
  nostalgia / homesickness · wisdom / knowledge · empathy / sympathy · guilt / shame

- Site also lists **Places, Sports, Music, and Movies** categories with the same difficulty tiering,
  though full pair lists weren't captured in this pass.

## Additional Examples (from other sources)

- Apple / Pear (clue given as example: "Crunchy") — pocketparty.app
- Sofa / Armchair · Mustache / Beard · Apartment / House · Magnet / Sticker · Limousine / Truck —
  Pablo-Rio open-source word file format example
- Handphone / Walkie-talkie — pnwchords.com paper-rules example

## Category Breadth (bestpartygames.net claims)

One implementation advertises **15 categories and 1,500+ pairs**:
Food & Drink, Animals, Objects, Jobs & Roles, Entertainment, Nature & Weather, Funny, Movies,
Internet Slang, Sports & Fitness, Technology & Digital, Travel & Places, Relationships,
Brands & Companies, Historical Figures.

This is a good reference list of **category names** to seed your own word-pair generator or content
plan, even though the underlying 1,500 pairs themselves weren't retrievable (page blocked scraping).

## Data Format Convention (from open-source implementations)

The simplest, most portable storage format seen in the wild — one pair per line, semicolon-delimited:

```
sofa;armchair
mustache;beard
apartment;house
magnet;sticker
limousine;truck
```

A "used words" list is tracked separately in at least one implementation to avoid repeating the same
pair across games in a single session — worth doing if you pre-author a finite word bank.

## Implication for Your Build

- You'll want word pairs tagged by **category** and **difficulty**, not just a flat list — every
  serious implementation exposes at least a category filter, and several expose difficulty too.
- Custom/user-submitted word pairs are a common feature (yanstarstudio, bestpartygames both support
  "add your own word pair" in a Personal/Custom category) — worth planning for even in v1's data
  model even if you don't build the UI for it immediately.
- Consider AI-assisted generation for scale: since the design rule ("same category, meaningful but
  not obvious difference, tiered by difficulty") is a clean, explicit heuristic, it's straightforward
  to prompt an LLM to bulk-generate pairs per category/difficulty and have a human spot-check them.
