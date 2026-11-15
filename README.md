# Lingxi · 灵犀

**A pet whose mind is a real circuit on X Layer.** You care for it, teach it in your own words, and watch who it becomes. And at any moment, anyone can check that what it did was what its circuit says it would do.

Live: **https://lingxi.knole.me** · game `/play.html` · proof page `/verify.html#1` · fully on chain (DeWEB): **https://1-2-419.tapekit.org/** (`1.2.419.tape`)

---

## What it is

Lingxi is a virtual pet with a brain you can read. The brain is a TapeOut circuit of NAND gates and memory latches, taped out on X Layer as a processor through the TapeOut factory. Once a minute the pet reads 16 input pins: how hungry, tired, dirty, bored and happy it feels, the time of day, and what you just did. The circuit's answer decides what it does next. The rule that fired is shown to you, lit up gate by gate.

- **Raise it.** Choose one of three eggs (gentle, bold or curious) and switch on any of four instincts (brave, greedy, curious, calm), which are wired into its circuit for life. Feed, clean, play and talk. Over two weeks it grows from baby to adult, and its adult body (Puff, Blossom, Dumpling, Scholar or the rare Moonpetal) is decided by how you raised it. Neglect has consequences: it can get sick, and your care mistakes are counted. While you are away, friends drop by and toys turn up, its brain decides what to do, and you come back to the story.
- **Teach it.** Type a rule in plain English or Chinese, or work through Pet School: eight levels with three goals each, scored by running your pet's own circuit. Order is strategy: a lesson placed too high can steal another's stars, and Lingxi names the rule that gets in the way. Every lesson shows its cost in gates against the brain's 500-gate budget.
- **Rewind.** Scrub back through any day or spar and see, moment by moment, what it sensed, which rule fired, and whether that rule was taught, an instinct or inborn.
- **Live in a world.** Seventy rooms that follow your own clock, residents with their own stories, foraging, crafting and errands.
- **Meet friends.** Pets share a room live over WebSocket; friends can visit your decorated home. Gifts and red packets travel by link. Two grown pets can raise a child, and the child's mind is built from both of its parents' circuits.
- **Spar.** Nobody presses buttons: each move comes from your pet's own circuit reading the fight. After a loss, the coach replays the fight with every lesson your pet could learn, and tells you which one actually wins. Challenge a friend by link (the result link replays the identical fight for anyone), and take the daily challenge, seeded by the first X Layer block of the day.
- **Verify it.** Each day the pet's 256-bit state and a hash of everything it sensed are saved on chain. The proof page replays its thoughts against the processor on X Layer, and can check all 65,536 possible inputs. Its picture and name are drawn on chain too (PetLook), and the whole site is published on chain through DeWEB.
- **Tape it out yourself.** The relayer tapes out new brains for free, or a player can do it with their own wallet: the full cost (gates, TapeOut's fees, network fees) is shown first, and the circuit is read back byte for byte.

## Live on X Layer mainnet (chain 196)

| What | Address / id |
|---|---|
| Lingxi processor (TapeOut) | `0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e` |
| Transistors (ERC-1155) | `0x92DFda52386386Be40EFd7becB545139372C7139` |
| PetRegistry (pets, daily checkpoints, sitters) | `0x103d7252eb6b2fec22b3f65a6bb605945f280e99` |
| Breeder (families) | `0x5e5bbb798c5a2afc89f431debabaa0b889f77dd1` |
| RedPacket (USDT / USD₮0 packets) | `0x7acceb7ab1cff102fe2660f511e88d42010e806b` |
| PetLook (on-chain pictures and names) | `0x0642a802967260714d4efec05fef701b17d31b75` |
| The site on DeWEB | `1.2.419.tape`, served at https://1-2-419.tapekit.org/ |

Pet #1 hatched in tx `0x83f3b2cb…11dc`. Its day-1 checkpoint is tx `0x63035765…8555`.

### Proof table

| Circuit | Id on processor | Gates | Memory bits | Netlist bytes | keccak256 of the netlist on chain |
|---|---|---|---|---|---|
| Gentle starter brain | 1 | 296 | 8 | 2,048 | `0xab2d7b0e5c8eeb1fcdf6f0225b6dd912459a26b6fcc73f86d5470152a18a1e47` |
| Bold starter brain | 2 | 233 | 8 | 1,607 | `0x085d9b6352bf1cd5f06061c948f48787db58469454558f627a198569d55b24cd` |
| Curious starter brain | 3 | 248 | 8 | 1,712 | `0x372b08dab3d43d9d14e0f4c8884c8063d978264abbc1fe4261c8d25eb8064a7a` |
| Evolution (adult form) | 4 | 58 | 0 | 406 | `0x9dfb688b75b94a700690c28f34e978a0ef8bc2f2d5be621317f4d1f8fd8fc7d0` |
| Red-packet seal | 5 | 251 | 0 | 1,757 | `0x0d031b05b1928278eab4b2b82ecf15354990dc45311eedeaa1ea915a93687cb1` |

| Check | Result |
|---|---|
| Each circuit on chain is byte for byte what our compiler produces | yes, all five (`pnpm judge:check`) |
| Exhaustive: the gentle brain and the seal answer like the reference on all 65,536 inputs | yes (`pnpm judge:check`, and in the browser on the proof page) |
| Pet #1's saved log hash and memory reproduce exactly | yes (`pnpm judge:check`) |
| Unit and integration tests | 210 passing (`pnpm test`) |
| Contract tests against a fork of X Layer | 29 passing (`forge test`) |
| Fork tests of PetLook and the self tape-out | passing (`FORK_RPC=… pnpm --filter @lingxi/chain test`) |

Hashes read from X Layer on 2026-11-15; `judge:check` recomputes them.

### Check it yourself

```sh
pnpm install
pnpm judge:check
```

`judge:check` runs read-only against mainnet. It confirms:
- the processor is registered with the TapeOut factory;
- the five circuits on chain are byte-for-byte what our compiler produces;
- pet #1's saved log hash and memory reproduce exactly;
- the gentle brain and the seal circuit give the chain's own answer on every one of their 65,536 inputs.

It takes about three and a half minutes. The proof page does the same checks in a browser.

## How it is built

```
apps/web          React 19 + Vite + PixiJS: landing page, game, proof page (English and Chinese)
packages/brain    rule language → TAP-02 netlist compiler, evaluator, memory, seal circuit
packages/game     pet simulation: needs, growth, sickness, kinship, lessons, spars, families, gifts
packages/world    rooms, residents, items, recipes, foraging
packages/art      pet sprites drawn in code (bodies, expressions, growth stages)
packages/chain    viem client for the processor, registry, breeder, red packets and PetLook; own-wallet tape-out; deploy and DeWEB publish scripts
contracts         Solidity (Foundry): PetRegistry, Breeder, RedPacket, PetLook
services/api      Hono server: site hosting, live rooms (WebSocket), shared home decorations, teach-by-words, the pet's voice, lesson library, reminders, history indexer, brain relayer
deploy            pm2 config for the server and the Cloudflare tunnel
```

The circuit is the source of truth. The game code runs the same netlist through a fast local evaluator, and any beat can be re-run on chain through the processor's `step`. A pet's thoughts are only ever claimed when the two agree.

## Tests

```sh
pnpm test                                     # brain 47 · game 98 · world 17 · web 10 · api 35 · chain 3 (+4 fork)
cd contracts && forge test --fork-url https://rpc.xlayer.tech --fork-block-number <recent block - 2000>
                                              # 29 contract tests against a fork of X Layer
```

The brain tests include an exhaustive check of the seal circuit against its reference on all 65,536 inputs. The contract tests run against the real TapeOut factory on a fork. Use a block about 2,000 behind the head so that the block hashes the red-packet reveal reads already exist on chain. The contracts have had three internal security reviews (not an external audit); the findings and their fixes are recorded with the build notes.

## Running it locally

```sh
pnpm install
pnpm --filter @lingxi/web dev                 # site on http://localhost:5173
pnpm --filter @lingxi/api start               # API and live rooms on :8787
```

Teach-by-words needs an Anthropic API key in the server's environment. The brain relayer needs a funded relayer key file (`LINGXI_RELAYER_KEY_FILE`). Without them, the game still runs fully: Pet School lessons and hand-built rules work offline.

## Credits

Lingxi stands on other people's work, and is grateful for it.

- **the source game** by Asphodel (github.com/Asphodel-OS/the source game-open). The world's art comes from the source game, used and adapted with the maker's permission: the rooms and the map, the residents' portraits, the item sprites, the interface sound effects, and parts of the world data. Lingxi's pets, words, rules and music are our own.
- **TapeFly** (github.com/tapefly/tapefly), MIT License, Copyright (c) 2026 Richard. Our circuit compiler started from TapeFly's netlist compiler, and our gate-depth layout follows its approach. The TapeFly-format brains in `packages/brain/src/tapefly.ts` (the program format, its `p1.` link code and the compiler) are adapted from TapeFly's `sim/program.ts` and `sim/compile.ts`; the brawl chips and ladder rivals are the rules TapeFly publishes at tapefly.xyz/api/v1/brawl, read under its DUEL-12x3/1 interface draft.
- **Aavegotchi** (github.com/aavegotchi/aavegotchi-contracts), MIT License, Copyright (c) 2020 Aavegotchi. Kinship that fades lazily over time follows its `kinship()` pattern.
- **TapeOut Protocol** TAPs (github.com/TapeOutProtocol/TAPs), CC0 1.0. The TAP-02 netlist format and processor interface.
- **OpenZeppelin Contracts** (MIT) and **forge-std** (MIT / Apache-2.0).
- **Pixelify Sans** and **Baloo 2** fonts (SIL Open Font License 1.1), via Fontsource.
- **PixiJS**, **viem**, **React**, **Hono**, **Motion**, **zustand** and **Vite** (all MIT).

The MIT licences above permit use with this notice: Permission is hereby granted, free of charge, to any person obtaining a copy of the software and associated documentation files, to deal in the software without restriction, subject to including the copyright notice and this permission notice in all copies or substantial portions. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
