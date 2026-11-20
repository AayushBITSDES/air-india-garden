# Air India sustainable-fare garden: brief

Shared brief for the prototype and the deck. Every decision below is settled; do not reopen them.

## Intent
Get people to choose Air India's sustainable fare even when it costs more, by rewarding them in a way they can see and collect. Audience for the work: a design jury. Deliverables: a clickable prototype and a 5-slide deck.

## The concept (settled)
- **What the fare buys:** each sustainable fare pays for a fixed extra quantity of sustainable aviation fuel (SAF, e.g. made from used cooking oil). The SAF is used somewhere on Air India's network within ~6 months, NOT necessarily in the passenger's own plane. Never imply it went into their plane (this is exactly what Lufthansa lost in court over: Cologne courts 2025, appeal upheld July 2026; Lufthansa renamed "Green Fares" to "Impact Fares" Oct 2026).
- **One tree = one booking's SAF.** A group booking gives a small cluster of trees. The tree is a symbol, not a planted tree. The UI must make that clear (e.g. the receipt says what it stands for).
- **Boarding pass:** shows the tree. Paper pass: QR code to scan. Mobile pass: "Plant this tree" button. Planting unlocks only after the flight lands; a landing notification ("Your banyan is ready to plant") prompts it. Cancelled trips never grow a tree.
- **Species = destination** (tree native to where you landed, e.g. banyan for Mumbai, cherry blossom for Tokyo). **Rarity = occasions, earned not random:** first sustainable flight, festive dates like Diwali, 10th sustainable flight, a newly launched route. Rare trees are golden / blossoming variants (ties to the brand's gold window frame). No random drops, no loot-box feel.
- **Size and apple count = actual SAF bought** (longer flight, more fuel, bigger tree, more apples). Rarity never changes the impact claim.
- **One harvest:** shake a tree once, all its apples fall. Then it is a collection piece. Apples never rot. No infinite regrowth.
- **Small gardens are fine.** An empty patch nudges the next booking. Show empty plots as invitations, not failures.
- **Receipt (proof):** tap a tree → litres of SAF, feedstock, date it was used on the network, certificate reference, plain-language explanation.
- **Garden headline:** an everyday comparison ("Your garden kept 140 kg of CO2 out of the air, about the same as not driving a car from Delhi to Varanasi"; 69 L x 2.02 = 140 kg / 0.17 = ~820 km. The prototype picks the closest real road trip from a table; never hand-write it), with ONE small line under it giving the share of your own flights' CO2 cut ("Your trees cut 10% of the CO2 from these 5 flights"). Never claim carbon neutral.
- **Spending apples:** (a) convert to Maharaja Club points (Air India's existing loyalty programme) at a bonus rate vs normal earning, 1 apple = 10 Maharaja Points or Rs 20 off a sustainable fare (SAF premium assumed Rs 180/L; fare buys SAF = 20% of seat fuel short-haul, 10% long-haul); or (b) apple-only perks: money off your next sustainable fare (the headline perk, it closes the loop), extra baggage, meal upgrade.
- **Timeliness hook:** Air India + Airbus announced India's first voluntary *corporate* SAF programme on 17 Nov 2026; India plans a 1% SAF blending mandate from 2027. This concept is the passenger version.

## Numbers
All figures in the prototype are illustrative and must be derived from one visible formula, not invented independently. Use and cite in a code comment:
- Fossil jet fuel: ~3.16 kg CO2 per kg burned; density ~0.8 kg/L, so ~2.5 kg CO2 per litre.
- SAF from used cooking oil (HEFA): ~80% lower lifecycle CO2 than fossil jet fuel.
- So 1 litre of SAF replacing fossil fuel avoids ~2.0 kg CO2.
- Average petrol car: ~0.17 kg CO2 per km. Delhi to Jaipur by road: ~280 km.
Keep the numbers internally consistent across every screen.

## Brand (Air India 2023 identity)
Source: `brand/AirIndia-brand.pdf`, rendered at `brand/page-1.png` and `brand/page-2.png`. LOOK AT THESE IMAGES before designing.
- Colours: deep red (~#DA0E29 to crimson), aubergine/purple (~#5B1A55), gold gradient for the window frame and Vista; tier palette (economy red, premium economy, business aubergine, first blush/peach).
- The gold "window of possibilities" frame (rounded Indian jharokha window shape, tilted) is the central device. The garden can be seen through this window.
- The Vista symbol: the peak of the window frame. Chakra pattern: a fine geometric star lattice used as texture.
- Iconography: thin gold line icons with soft curves from the window frame.
- Typeface: Air India Sans is proprietary; use a close free substitute (wide geometric sans for display, e.g. from Google Fonts) and say so in a comment.
- Do not reproduce the Air India logo artwork; a text wordmark is fine for a concept piece.

## Prototype flow
1. Booking: fare choice; the sustainable option shows the price gap, + apples, tree preview.
2. Boarding pass: the tree, QR (paper) / "Plant this tree" (mobile).
3. Landing notification: "Your banyan is ready to plant".
4. Garden: trees, headline impact + small line, shake a tree, apples fall (the core moment: make it feel physical and delightful).
5. Receipt: tap a tree.
6. Spend: convert to points / apple-only perks.

## Writing
All copy in plain words. No em dashes, no curly quotes, no marketing filler.
