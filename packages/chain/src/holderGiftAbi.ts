/** HolderGift ABI, generated from contracts/out by the build (do not edit by hand). */
export const holderGiftAbi = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "market_",
    "type": "address",
    "internalType": "contract IGiftMarket"
   },
   {
    "name": "outfit_",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "test1_",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "rig_",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "snapshotRoot_",
    "type": "bytes32",
    "internalType": "bytes32"
   },
   {
    "name": "snapshotBlock_",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "bemMin_",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "fabMin_",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "bemMin",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "claimWithNft",
  "inputs": [
   {
    "name": "collection",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "tokenId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "claimWithSnapshot",
  "inputs": [
   {
    "name": "bemAtSnapshot",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "fabAtSnapshot",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "proof",
    "type": "bytes32[]",
    "internalType": "bytes32[]"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "claimed",
  "inputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "fabMin",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "market",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract IGiftMarket"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "outfit",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "rig",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "snapshotBlock",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "snapshotRoot",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "test1",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "tokenUsed",
  "inputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "total",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "event",
  "name": "Claimed",
  "inputs": [
   {
    "name": "wallet",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "via",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "tokenId",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "error",
  "name": "AlreadyClaimed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "BadSetup",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotHolder",
  "inputs": []
 },
 {
  "type": "error",
  "name": "TokenUsed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "UnknownCollection",
  "inputs": []
 }
] as const;
