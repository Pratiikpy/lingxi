# Claims

Every factual sentence Lingxi publishes, where it appears, and how it is checked. `scripts/claims-check.mts` reads this
table, refuses a row without a check, and runs every automatic check against X Layer and the live site;
`pnpm status:check` runs it. A sentence that changes changes here first.

Kinds of check:

- `auto:<name>`: a check in `scripts/claims-check.mts`, run against X Layer mainnet and the live site.
- `test:<path>`: a test in the repo's suites, run by the checker (see below).
- `facts:<name>`: a number counted from the repo by `scripts/readme-facts.mts`.
- `judge: <step>`: the step of `pnpm judge:check` (the read-only check of mainnet, about five minutes) the claim rests on; the checker runs it and passes the row only if that step passed.
- A `test:` row runs its test: a vitest file in its package, a Foundry test by its path; a browser spec counts only when CI's latest completed run on master passed its browser job with the spec, and is PENDING until then.
- `manual: …`: how it was checked by hand, with the evidence.

| Id | Where | Claim | Check |
|---|---|---|---|
| fee-two-rails | README, fashion market | Every fee paid in BEM is burned; the first outfit market takes 3% of OKB sales for the project. | auto:fees-markets |
| fee-breed | README, family screen | Breeding a child costs 0.1 BEM, burned. | auto:fees-breed |
| fee-adopt | README, adoption centre | Adoption: price 0.01 to 100 BEM; 3% burned, 10% to the other parent's owner, the rest to the breeder. | auto:fees-adopt |
| fee-items | README, item shop | Four decorations, 0.05 BEM each, 500 copies, the whole price burned. | auto:fees-items |
| fee-limited | README, wardrobe | The Tape-out set: three outfits, 0.1 BEM each, 300 copies each, the whole price burned. | auto:fees-limited |
| fee-extras | README, extras panel | Room space, saved looks and a name colour: 0.05 BEM each, the whole price burned; room and looks up to three times. | auto:fees-extras |
| fee-holder | README, numbers | The holder outfit is free for BEM, FAB, Rig and TapeCode-Test1 holders. | auto:holder-gift |
| keeps-no-bem | README, extras | Lingxi takes no share of any BEM payment; no contract keeps a fee, and a contract holds only what it owes others until they take it. | auto:no-bem-held |
| no-token | README | Lingxi has no token of its own. | manual: the deployment record lists every contract Lingxi deployed (`packages/chain/deployments/xlayer.json`); none is a token. BEM is TapeOut's. |
| owner-powers | README | Fees move only within fixed bounds; burn shares cannot change. | test:contracts/test/SecurityReview.t.sol |
| two-step-owners | README | Ownership is handed over in two steps on every owned contract except the first outfit market. | auto:two-step-owners |
| processor | README, judge check | The processor is registered with TapeOut's factory. | judge: processor is registered with TapeOut's factory |
| circuits-hash | README, proof page | The five core circuits on chain have the keccak256 hashes listed. | auto:circuit-hashes |
| circuits-compiler | README | The circuits on chain are byte for byte what this repo's compiler produces. | judge: equals this repo's compiler output |
| minds-taped-out | README (EN, ZH), proof page, agents page (EN, ZH) | Every pet's mind is a circuit of NAND gates and latches; once its owner keeps it on X Layer, that circuit is taped out there (the line's starter circuit at hatching, its own when its new mind is put on chain). | test:apps/web/src/game/chain.test.ts |
| teach-taped-out | README | A taught rule is compiled into the circuit; for a pet kept on X Layer, the new circuit is taped out when its owner puts its new mind on chain. | test:e2e/specs/relay.spec.ts |
| handheld-circuit | README, handheld panel | The handheld runs the circuit read from X Layer when the pet's mind is on chain, the game's own circuit otherwise, checked on all 65,536 inputs. | test:e2e/specs/handheld.spec.ts |
| tapekit-letters | README | Letters between homes stay closed until TapeSend's hub accepts circuits from Lingxi's processor; TapeKit's gateway serves the on-chain copy. | manual: every branch of `apps/web/src/play/Home.tsx`'s letters note keeps them closed ("coming next", hub code not approved, or circuits not accepted), and `packages/chain/src/home.ts` checks the hub against its allow-list; the gateway is `links.ts`'s `*.tapekit.org` (checked 2026-11-20). |
| builders-lane | README | Five tribute pets on Builders' Lane; Behemoth runs the founder's 4-bit CPU read gate for gate from BNB Chain, the other four are Lingxi pets with two lessons each. | test:packages/game/test/builders.test.ts |
| note-log-chain | the note on every page (EN, ZH) | A checkpoint holds the brain's memory and a hash chained over every input the pet has had since it hatched. | test:packages/game/test/sim.test.ts |
| note-rules-checked | the note on every page (EN, ZH) | The 17 rule circuits are checked against the game's own rules each time the game opens. | test:e2e/specs/rules-mark.spec.ts |
| note-server-list | the note on every page (EN, ZH) | What reaches the server: teaching and voices, live rooms and their sharing, the game's chain reads and signed transactions (forwarded to X Layer's public nodes), and what the player chooses to send (a moved save held 15 minutes, a published diary, duel links, arena and season entries, a pet left with a friend, adoption papers, minds to tape out); the game reads mail and the daily block, the tree and the numbers from it. | manual: every write route the server mounts (`grep app.post services/api/src`: teach, voice, lessons/share, push, rpc, move with `MOVE_TTL_MS` 15 minutes, pets/:id/log, duels, arena/snapshot, season/enter, sit, papers, and the relay routes tapeout, tapeout-child, tapeout-instinct; live rooms over `/live`; the agent API is for agents, not on the page) is named in the list, and its reads (mail, daily, tree, numbers); checked 2026-11-20. |
| circuit-table | README | The gentle, bold and curious starter brains have 296, 233 and 248 gates with 8 memory bits; the evolution circuit 58 gates and the seal 251, with none. | auto:circuit-table |
| brain-shape | README, agents page | A pet's brain reads 16 input pins and answers on 8 output pins (PET-16x8/1); a starter brain keeps 8 bits of memory, a child's more. | test:packages/brain/test/manifests.test.ts |
| agents-limits | agents page (EN, ZH), `/api/v1` | An agent name and an address raise at most 5 pets at once, and an idle pet goes home after 30 days; an address enters at most 3 pets a week, and 16 of the week's 64 places go to agent-raised pets. | test:services/api/test/agentApi.test.ts |
| pet-school | README | Pet School has eight levels with three goals each, scored by running the pet's own circuit. | test:packages/game/test/school.test.ts |
| royalty-cap | README, fashion market | A creator's royalty is at most 10%. | auto:royalty-cap |
| home-container | README | Pet #1's home is TapeOut container 0x31B025aD4cBD4142007f59684D51cD1F2ccc5098. | auto:home-container |
| rules | README, game, proof page | 17 rule circuits on X Layer, each byte for byte the rule the game compiles. | auto:rules |
| starter-brain | landing | Mochi's starter brain has 296 gates and 8 bits of memory. | auto:starter-brain |
| replay-gas | landing | Re-running one beat on chain costs about 760,000 gas for Mochi's 296 gates. | auto:replay-gas |
| save-cost | landing | A day's save fits in 256 bits and costs a fraction of a cent. | auto:save-cost |
| pet1-all | landing, README, proof page | At pet #1's saved memory, all 65,536 inputs give the chain's own answer. | judge: pet #1's brain at its saved memory |
| pet1-log | README, proof page | Pet #1's log hashes to the value on chain. | judge: the log's hash chain equals the hash committed on chain |
| pet1-replay | README, proof page | Pet #1's log replays to the memory saved on chain. | judge: replaying the log gives exactly the memory saved on chain |
| anchored | README, proof page | Before replaying a log, the proof page anchors every brain it names to the pet's own Hatched and BrainChanged events. | test:packages/chain/test/anchor.test.ts |
| public-rpcs | README, proof page | The proof page reads X Layer through the public RPCs, or the judge's own; Lingxi's server only when every public one fails, and it says so. | test:apps/web/src/game/rpcAsk.test.ts |
| sourcify | README, proof page | All eleven contracts are verified on Sourcify as an exact match of creation and runtime bytecode. | auto:sourcify |
| growth | landing, README | In a week a pet grows from baby to adult (adult on day 8). | auto:growth |
| rooms | landing, README | Seventy places to wander. | facts:rooms |
| quests | README | 80 story quests and three dailies a day. | facts:quests |
| items | README | 116 items and 39 recipes. | facts:items |
| skills | README | Four skill trees, 72 skills. | facts:skills |
| residents | README | Nine residents and five Builders' Lane pets, each greeted by its own circuit. | facts:residents |
| tests | README | The test counts in the README. | facts:tests |
| no-server-lessons | landing, README | Pet School lessons and hand-built rules need no server. | test:packages/game/test/lessons.test.ts |
| deweb | README | The whole site is published on chain at 1.2.419.tape. | auto:deweb |
| deweb-server | on-chain copy | The on-chain copy has no server of its own; its proof page asks Lingxi's indexer only for public things (which transactions to read, an owner's published log) and proves each on X Layer. | test:apps/web/src/game/rpcAsk.test.ts |
| live-pages | README, landing | The live site serves the game, the proof page, the numbers, the tree of life and the agents' API. | auto:live-pages |
| red-packet | landing, README | Red packets hold USDT in a contract, and a circuit decides each share. | test:contracts/test/RedPacket.fork.t.sol |
| families | landing, README | A child's mind is its parents' circuits composed by REF, on chain. | test:contracts/test/BreederV2.fork.t.sol |
| handheld | README | The handheld runs the same circuit and the game replays its trip bit for bit before taking the pet back. | test:packages/handheld/test/trip.test.ts |
| cardputer-build | README | The Cardputer firmware builds (849 KB of flash, 240 KB of RAM). | manual: PlatformIO build of env `cardputer-adv`, recorded in BUILD-STATUS section 102; the self-test image runs on an emulated ESP32-S3 (`pnpm --filter @lingxi/handheld chip:selftest`). |
| adoption-young | README | Only a bred, still young pet that never changed hands can be offered for adoption. | test:contracts/test/AdoptionCentre.fork.t.sol |
