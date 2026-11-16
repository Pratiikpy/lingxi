/** BreederV2 ABI, generated from contracts/out by the build (do not edit by hand). */
export const breederV2Abi = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "registry_",
    "type": "address",
    "internalType": "contract PetRegistry"
   },
   {
    "name": "bem_",
    "type": "address",
    "internalType": "contract IERC20"
   },
   {
    "name": "owner_",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "ADULT_AGE",
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
  "name": "BURN",
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
  "name": "COOLDOWN",
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
  "name": "GLUE_HASH",
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
  "name": "MAX_CHILDREN",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "MAX_FEE",
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
  "name": "MIN_FEE",
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
  "name": "acceptOwnership",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "allowPartner",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "partnerOwner",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "allowed",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "bem",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract IERC20"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "breed",
  "inputs": [
   {
    "name": "a",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "b",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "childProcessor",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "childBrainId",
    "type": "uint64",
    "internalType": "uint64"
   },
   {
    "name": "line",
    "type": "uint8",
    "internalType": "uint8"
   },
   {
    "name": "maxFee",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "child",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "breedFee",
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
  "name": "children",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "consent",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "partnerOwner",
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
  "name": "consentBy",
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
    "name": "by",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "ownership",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "isChildCircuit",
  "inputs": [
   {
    "name": "processor",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "brainId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "pa",
    "type": "tuple",
    "internalType": "struct PetRegistry.Pet",
    "components": [
     {
      "name": "processor",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "brainId",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "line",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "brainBits",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "day",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "born",
      "type": "uint40",
      "internalType": "uint40"
     },
     {
      "name": "checkedAt",
      "type": "uint40",
      "internalType": "uint40"
     },
     {
      "name": "logHash",
      "type": "bytes32",
      "internalType": "bytes32"
     },
     {
      "name": "state",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "parentA",
      "type": "uint128",
      "internalType": "uint128"
     },
     {
      "name": "parentB",
      "type": "uint128",
      "internalType": "uint128"
     }
    ]
   },
   {
    "name": "pb",
    "type": "tuple",
    "internalType": "struct PetRegistry.Pet",
    "components": [
     {
      "name": "processor",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "brainId",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "line",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "brainBits",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "day",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "born",
      "type": "uint40",
      "internalType": "uint40"
     },
     {
      "name": "checkedAt",
      "type": "uint40",
      "internalType": "uint40"
     },
     {
      "name": "logHash",
      "type": "bytes32",
      "internalType": "bytes32"
     },
     {
      "name": "state",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "parentA",
      "type": "uint128",
      "internalType": "uint128"
     },
     {
      "name": "parentB",
      "type": "uint128",
      "internalType": "uint128"
     }
    ]
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
  "name": "lastBred",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "owner",
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
  "name": "pendingOwner",
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
  "name": "registry",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract PetRegistry"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "renounceOwnership",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setFee",
  "inputs": [
   {
    "name": "fee",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "totalBurned",
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
  "name": "transferOwnership",
  "inputs": [
   {
    "name": "newOwner",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "event",
  "name": "Born",
  "inputs": [
   {
    "name": "child",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "parentA",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "parentB",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "processor",
    "type": "address",
    "indexed": false,
    "internalType": "address"
   },
   {
    "name": "brainId",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Burned",
  "inputs": [
   {
    "name": "payer",
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
  "name": "Consent",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "partnerOwner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "allowed",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "FeeChanged",
  "inputs": [
   {
    "name": "fee",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "OwnershipTransferStarted",
  "inputs": [
   {
    "name": "previousOwner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "newOwner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "OwnershipTransferred",
  "inputs": [
   {
    "name": "previousOwner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "newOwner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   }
  ],
  "anonymous": false
 },
 {
  "type": "error",
  "name": "BadFee",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ComposedBrain",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "FeeMoved",
  "inputs": [
   {
    "name": "fee",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "NoConsent",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotAChildOf",
  "inputs": [
   {
    "name": "parentA",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "parentB",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "NotAdult",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "NotFirstGeneration",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "NotYours",
  "inputs": []
 },
 {
  "type": "error",
  "name": "OwnableInvalidOwner",
  "inputs": [
   {
    "name": "owner",
    "type": "address",
    "internalType": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "OwnableUnauthorizedAccount",
  "inputs": [
   {
    "name": "account",
    "type": "address",
    "internalType": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "PaymentShort",
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
  "name": "SamePet",
  "inputs": []
 },
 {
  "type": "error",
  "name": "TooManyChildren",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "TooSoon",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 }
] as const;
