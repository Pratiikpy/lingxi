/** RedPacket ABI, generated from contracts/out by the build (do not edit by hand). */
export const redPacketAbi = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "processor_",
    "type": "address",
    "internalType": "contract ISealProcessor"
   },
   {
    "name": "sealId_",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "pets_",
    "type": "address",
    "internalType": "contract IPetCount"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "MAX_LIFETIME",
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
  "name": "MAX_SHARES",
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
  "name": "REVEAL_GRACE",
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
  "name": "claim",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "sig",
    "type": "bytes",
    "internalType": "bytes"
   }
  ],
  "outputs": [
   {
    "name": "amount",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "claimDigest",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "claimer",
    "type": "address",
    "internalType": "address"
   }
  ],
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
  "name": "claimedBy",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
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
  "name": "create",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "contract IERC20"
   },
   {
    "name": "total",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "count",
    "type": "uint16",
    "internalType": "uint16"
   },
   {
    "name": "floor",
    "type": "uint128",
    "internalType": "uint128"
   },
   {
    "name": "lifetime",
    "type": "uint64",
    "internalType": "uint64"
   },
   {
    "name": "key",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "lucky",
    "type": "bool",
    "internalType": "bool"
   },
   {
    "name": "petOwnersOnly",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "outputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "nextId",
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
  "name": "packet",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "tuple",
    "internalType": "struct RedPacket.Packet",
    "components": [
     {
      "name": "sender",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "expiry",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "count",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "claimed",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "paid",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "lucky",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "petOwnersOnly",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "token",
      "type": "address",
      "internalType": "contract IERC20"
     },
     {
      "name": "key",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "remaining",
      "type": "uint128",
      "internalType": "uint128"
     },
     {
      "name": "floor",
      "type": "uint128",
      "internalType": "uint128"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "pending",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "atBlock",
    "type": "uint64",
    "internalType": "uint64"
   },
   {
    "name": "index",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "pets",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract IPetCount"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "processor",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract ISealProcessor"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "refund",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "reveal",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "amount",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "sealId",
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
    "name": "id",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "claimer",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "index",
    "type": "uint16",
    "indexed": false,
    "internalType": "uint16"
   },
   {
    "name": "sealInput",
    "type": "uint16",
    "indexed": false,
    "internalType": "uint16"
   },
   {
    "name": "sealOutput",
    "type": "uint8",
    "indexed": false,
    "internalType": "uint8"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Created",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "sender",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "token",
    "type": "address",
    "indexed": false,
    "internalType": "address"
   },
   {
    "name": "total",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "count",
    "type": "uint16",
    "indexed": false,
    "internalType": "uint16"
   },
   {
    "name": "lucky",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   },
   {
    "name": "petOwnersOnly",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   },
   {
    "name": "expiry",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Refunded",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "sender",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Reserved",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "claimer",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "index",
    "type": "uint16",
    "indexed": false,
    "internalType": "uint16"
   },
   {
    "name": "atBlock",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   }
  ],
  "anonymous": false
 },
 {
  "type": "error",
  "name": "AllClaimed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "AlreadyClaimed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "BadKey",
  "inputs": []
 },
 {
  "type": "error",
  "name": "BadLifetime",
  "inputs": []
 },
 {
  "type": "error",
  "name": "BadShares",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ECDSAInvalidSignature",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ECDSAInvalidSignatureLength",
  "inputs": [
   {
    "name": "length",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "ECDSAInvalidSignatureS",
  "inputs": [
   {
    "name": "s",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ]
 },
 {
  "type": "error",
  "name": "Empty",
  "inputs": []
 },
 {
  "type": "error",
  "name": "Expired",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NoKey",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotYet",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NothingToReveal",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ReentrancyGuardReentrantCall",
  "inputs": []
 },
 {
  "type": "error",
  "name": "SafeERC20FailedOperation",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "SealSaysNo",
  "inputs": []
 },
 {
  "type": "error",
  "name": "TooEarly",
  "inputs": []
 },
 {
  "type": "error",
  "name": "TooSmall",
  "inputs": []
 },
 {
  "type": "error",
  "name": "Unknown",
  "inputs": []
 }
] as const;
