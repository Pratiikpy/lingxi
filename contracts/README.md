# Lingxi contracts

Solidity contracts for Lingxi, built with Foundry: `PetRegistry` (pets, daily checkpoints, sitters), `Breeder` (families) and `RedPacket` (USDT packets settled by the seal circuit).

```sh
forge build
forge test --fork-url https://rpc.xlayer.tech --fork-block-number <recent block - 2000>
```

The tests run against a fork of X Layer so they use the real TapeOut factory. Mainnet addresses are in `../packages/chain/deployments/xlayer.json`.
