# Claims

Every factual sentence Lingxi publishes, where it appears, and how it is checked. `scripts/claims-check.mts` reads this
table, refuses a row without a check, and runs every automatic check against X Layer and the live site;
`pnpm status:check` runs it. A sentence that changes changes here first.

Kinds of check:

- `auto:<name>`: a check in `scripts/claims-check.mts`, run against X Layer mainnet and the live site.
- `test:<path>`: a test in the repo's suites (run by `pnpm test`, `forge test` and CI).
- `facts:<name>`: a number counted from the repo by `scripts/readme-facts.mts`.
- `judge`: `pnpm judge:check`, the read-only check of mainnet (about five minutes).
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
| keeps-no-bem | README, numbers, extras | Lingxi keeps no BEM: no contract holds a balance to take. | auto:no-bem-held |
| no-token | README | Lingxi has no token of its own. | manual: the deployment record lists every contract Lingxi deployed (`packages/chain/deployments/xlayer.json`); none is a token. BEM is TapeOut's. |
| owner-powers | README | Fees move only within fixed bounds; burn shares cannot change; ownership is two-step. | test:contracts/test/SecurityReview.t.sol |
| processor | README, judge check | The processor is registered with TapeOut's factory. | judge |
| circuits-hash | README, proof page | The five core circuits on chain have the keccak256 hashes listed. | auto:circuit-hashes |
| circuits-compiler | README | The circuits on chain are byte for byte what this repo's compiler produces. | judge |
| rules | README, game, proof page | 17 rule circuits on X Layer, each byte for byte the rule the game compiles. | auto:rules |
| starter-brain | landing | Mochi's starter brain has 296 gates and 8 bits of memory. | auto:starter-brain |
| replay-gas | landing | Re-running one beat on chain costs about 760,000 gas for Mochi's 296 gates. | auto:replay-gas |
| save-cost | landing | A day's save fits in 256 bits and costs a fraction of a cent. | auto:save-cost |
| pet1-all | landing, README, proof page | At pet #1's saved memory, all 65,536 inputs give the chain's own answer. | judge |
| pet1-log | README, proof page | Pet #1's log hashes to the value on chain and replays to the saved memory. | judge |
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
| deweb-server | on-chain copy | The on-chain copy has no server of its own; its proof page asks Lingxi's indexer only which transactions to read. | test:apps/web/src/game/rpcAsk.test.ts |
| live-pages | README, landing | The live site serves the game, the proof page, the numbers, the tree of life and the agents' API. | auto:live-pages |
| red-packet | landing, README | Red packets hold USDT in a contract, and a circuit decides each share. | test:contracts/test/RedPacket.fork.t.sol |
| families | landing, README | A child's mind is its parents' circuits composed by REF, on chain. | test:contracts/test/BreederV2.fork.t.sol |
| handheld | README | The handheld runs the same circuit and the game replays its trip bit for bit before taking the pet back. | test:packages/handheld/test/trip.test.ts |
| cardputer-build | README | The Cardputer firmware builds (849 KB of flash, 240 KB of RAM). | manual: PlatformIO build of env `cardputer-adv`, recorded in BUILD-STATUS section 102; the self-test image runs on an emulated ESP32-S3 (`pnpm --filter @lingxi/handheld chip:selftest`). |
| adoption-young | README | Only a bred, still young pet that never changed hands can be offered for adoption. | test:contracts/test/AdoptionCentre.fork.t.sol |
