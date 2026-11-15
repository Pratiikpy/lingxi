# Lingxi · 灵犀

**A pet whose mind is a real circuit on X Layer.** You care for it, teach it in your own words, and watch who it becomes. And at any moment, anyone can check that what it did was what its circuit says it would do.

Live: **https://lingxi.knole.me** · game `/play.html` · proof page `/verify.html#1`

---

## What it is

Lingxi is a virtual pet with a brain you can read. The brain is a TapeOut circuit of NAND gates and memory latches, taped out on X Layer as a processor through the TapeOut factory. Once a minute the pet reads 16 input pins: how hungry, tired, dirty, bored and happy it feels, the time of day, and what you just did. The circuit's answer decides what it does next. The rule that fired is shown to you, lit up gate by gate.

- **Raise it.** Choose one of three eggs (gentle, bold or curious). Feed, clean, play and talk. Over two weeks it grows from baby to adult, and the adult form depends on how you raised it. Neglect has consequences: it can get sick, and your care mistakes are counted.
- **Teach it.** Type a rule in plain English or Chinese, or take a Pet School lesson that works offline. Lingxi compiles your words into one more rule in its circuit and shows you the rule before anything changes.
- **Live in a world.** Seventy rooms that follow your own clock, residents with their own stories, foraging, crafting and errands.
- **Meet friends.** Pets share a room live over WebSocket. Gifts and red packets travel by link. Two grown pets can raise a child, and the child's mind is built from both of its parents' circuits.
- **Spar.** Nobody presses buttons: each move comes from your pet's own circuit reading the fight. After a loss, the coach replays the fight with every lesson your pet could learn, and tells you which one actually wins.
- **Verify it.** Each day the pet's 256-bit state and a hash of everything it sensed are saved on chain. The proof page replays its thoughts against the processor on X Layer, and can check all 65,536 possible inputs.

## Live on X Layer mainnet (chain 196)

| What | Address / id |
|---|---|
| Lingxi processor (TapeOut) | `0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e` |
| Transistors (ERC-1155) | `0x92DFda52386386Be40EFd7becB545139372C7139` |
| PetRegistry (pets, daily checkpoints, sitters) | `0x103d7252eb6b2fec22b3f65a6bb605945f280e99` |
| Breeder (families) | `0x5e5bbb798c5a2afc89f431debabaa0b889f77dd1` |
| RedPacket (USDT / USD₮0 packets) | `0x7acceb7ab1cff102fe2660f511e88d42010e806b` |
| Starter circuits | 1 gentle (296 gates) · 2 bold (233) · 3 curious (248) · 4 evolution (58) · 5 red-packet seal (251) |

Pet #1 hatched in tx `0x83f3b2cb…11dc`. Its day-1 checkpoint is tx `0x63035765…8555`.

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
packages/chain    viem client for the processor, registry, breeder and red packets; deploy scripts
contracts         Solidity (Foundry): PetRegistry, Breeder, RedPacket
services/api      Hono server: site hosting, live rooms (WebSocket), teach-by-words, brain relayer
deploy            pm2 config for the server and the Cloudflare tunnel
```

The circuit is the source of truth. The game code runs the same netlist through a fast local evaluator, and any beat can be re-run on chain through the processor's `step`. A pet's thoughts are only ever claimed when the two agree.

## Tests

```sh
pnpm test                                     # brain 47 · game 50 · world 14 · web 10 · api 15
cd contracts && forge test --fork-url https://rpc.xlayer.tech --fork-block-number <recent block - 2000>
                                              # 29 contract tests against a fork of X Layer
```

The brain tests include an exhaustive check of the seal circuit against its reference on all 65,536 inputs. The contract tests run against the real TapeOut factory on a fork. Use a block about 2,000 behind the head so that the block hashes the red-packet reveal reads already exist on chain. The contracts have had three security reviews; the findings and their fixes are recorded with the build notes.

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
- **TapeFly** (github.com/tapefly/tapefly), MIT License, Copyright (c) 2026 Richard. Our circuit compiler started from TapeFly's netlist compiler, and our gate-depth layout follows its approach.
- **Aavegotchi** (github.com/aavegotchi/aavegotchi-contracts), MIT License, Copyright (c) 2020 Aavegotchi. Kinship that fades lazily over time follows its `kinship()` pattern.
- **TapeOut Protocol** TAPs (github.com/TapeOutProtocol/TAPs), CC0 1.0. The TAP-02 netlist format and processor interface.
- **OpenZeppelin Contracts** (MIT) and **forge-std** (MIT / Apache-2.0).
- **Pixelify Sans** and **Baloo 2** fonts (SIL Open Font License 1.1), via Fontsource.
- **PixiJS**, **viem**, **React**, **Hono**, **Motion**, **zustand** and **Vite** (all MIT).

The MIT licences above permit use with this notice: Permission is hereby granted, free of charge, to any person obtaining a copy of the software and associated documentation files, to deal in the software without restriction, subject to including the copyright notice and this permission notice in all copies or substantial portions. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
