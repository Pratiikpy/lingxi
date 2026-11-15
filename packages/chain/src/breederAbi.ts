/** Breeder ABI, generated from contracts/out by the build (do not edit by hand). */
export const breederAbi = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "registry_",
    "type": "address",
    "internalType": "contract PetRegistry"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "ADULT_STAGE",
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
  "name": "consent",
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
    "type": "bool",
    "internalType": "bool"
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
  "name": "NotYours",
  "inputs": []
 },
 {
  "type": "error",
  "name": "SamePet",
  "inputs": []
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
