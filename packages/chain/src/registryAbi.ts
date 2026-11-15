/** PetRegistry ABI, generated from contracts/out by the build (do not edit by hand). */
export const petRegistryAbi = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "factory_",
    "type": "address",
    "internalType": "contract ITapeOutFactory"
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
  "name": "MAX_BRAIN_STATE",
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
  "name": "MAX_SITTING",
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
  "name": "N_IN",
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
  "name": "N_OUT",
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
  "name": "SETTLED_AGE",
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
  "name": "SETTLED_DAYS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint32",
    "internalType": "uint32"
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
  "name": "approve",
  "inputs": [
   {
    "name": "to",
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
  "name": "balanceOf",
  "inputs": [
   {
    "name": "owner",
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
  "name": "breeders",
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
  "name": "chainLog",
  "inputs": [
   {
    "name": "h",
    "type": "bytes32",
    "internalType": "bytes32"
   },
   {
    "name": "word",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ],
  "stateMutability": "pure"
 },
 {
  "type": "function",
  "name": "checkpoint",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "day",
    "type": "uint32",
    "internalType": "uint32"
   },
   {
    "name": "state",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "logHash",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "factory",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract ITapeOutFactory"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getApproved",
  "inputs": [
   {
    "name": "tokenId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
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
  "name": "hatch",
  "inputs": [
   {
    "name": "to",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "line",
    "type": "uint8",
    "internalType": "uint8"
   },
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
    "name": "initialState",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "hatchChild",
  "inputs": [
   {
    "name": "to",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "line",
    "type": "uint8",
    "internalType": "uint8"
   },
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
    "name": "initialState",
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
  ],
  "outputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "isApprovedForAll",
  "inputs": [
   {
    "name": "owner",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "operator",
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
  "name": "isKeeper",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "who",
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
  "name": "isSettled",
  "inputs": [
   {
    "name": "petId",
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
  "name": "name",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "string",
    "internalType": "string"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "nextPetId",
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
  "name": "ownerOf",
  "inputs": [
   {
    "name": "tokenId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
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
  "name": "pet",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
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
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "renderer",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract IPetRenderer"
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
  "name": "replayStep",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "brainState",
    "type": "uint64",
    "internalType": "uint64"
   },
   {
    "name": "inputs",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "outputs": [
   {
    "name": "next",
    "type": "uint64",
    "internalType": "uint64"
   },
   {
    "name": "outputs",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "safeTransferFrom",
  "inputs": [
   {
    "name": "from",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "to",
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
  "name": "safeTransferFrom",
  "inputs": [
   {
    "name": "from",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "to",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "tokenId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "data",
    "type": "bytes",
    "internalType": "bytes"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setApprovalForAll",
  "inputs": [
   {
    "name": "operator",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "approved",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setBrain",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "processor",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "brainId",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setBreeder",
  "inputs": [
   {
    "name": "breeder",
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
  "name": "setRenderer",
  "inputs": [
   {
    "name": "r",
    "type": "address",
    "internalType": "contract IPetRenderer"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setSitter",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "who",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "until",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setStarterBrain",
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
    "name": "approved",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "sitters",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "who",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "until",
    "type": "uint64",
    "internalType": "uint64"
   },
   {
    "name": "grantedBy",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "starterBrain",
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
  "name": "supportsInterface",
  "inputs": [
   {
    "name": "interfaceId",
    "type": "bytes4",
    "internalType": "bytes4"
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
  "name": "symbol",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "string",
    "internalType": "string"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "tokenURI",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "string",
    "internalType": "string"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "transferCount",
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
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "transferFrom",
  "inputs": [
   {
    "name": "from",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "to",
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
  "type": "function",
  "name": "verifyBeat",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "fromState",
    "type": "uint64",
    "internalType": "uint64"
   },
   {
    "name": "inputs",
    "type": "uint16",
    "internalType": "uint16"
   },
   {
    "name": "toState",
    "type": "uint64",
    "internalType": "uint64"
   },
   {
    "name": "outputs",
    "type": "uint8",
    "internalType": "uint8"
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
  "type": "event",
  "name": "Approval",
  "inputs": [
   {
    "name": "owner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "approved",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "tokenId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "ApprovalForAll",
  "inputs": [
   {
    "name": "owner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "operator",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "approved",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "BrainChanged",
  "inputs": [
   {
    "name": "petId",
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
   },
   {
    "name": "brainBits",
    "type": "uint8",
    "indexed": false,
    "internalType": "uint8"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Bred",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "parentA",
    "type": "uint128",
    "indexed": true,
    "internalType": "uint128"
   },
   {
    "name": "parentB",
    "type": "uint128",
    "indexed": true,
    "internalType": "uint128"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "BreederSet",
  "inputs": [
   {
    "name": "breeder",
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
  "name": "Checkpoint",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "day",
    "type": "uint32",
    "indexed": true,
    "internalType": "uint32"
   },
   {
    "name": "state",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "logHash",
    "type": "bytes32",
    "indexed": false,
    "internalType": "bytes32"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Hatched",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "to",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "line",
    "type": "uint8",
    "indexed": false,
    "internalType": "uint8"
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
   },
   {
    "name": "state",
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
  "type": "event",
  "name": "RendererSet",
  "inputs": [
   {
    "name": "renderer",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "SitterSet",
  "inputs": [
   {
    "name": "petId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "sitter",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "until",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "StarterBrainSet",
  "inputs": [
   {
    "name": "processor",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "brainId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "approved",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Transfer",
  "inputs": [
   {
    "name": "from",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "to",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "tokenId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "error",
  "name": "BadOutput",
  "inputs": [
   {
    "name": "len",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "BrainTooBig",
  "inputs": [
   {
    "name": "nState",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "DayInFuture",
  "inputs": [
   {
    "name": "day",
    "type": "uint32",
    "internalType": "uint32"
   },
   {
    "name": "today",
    "type": "uint32",
    "internalType": "uint32"
   }
  ]
 },
 {
  "type": "error",
  "name": "DayNotAfter",
  "inputs": [
   {
    "name": "last",
    "type": "uint32",
    "internalType": "uint32"
   },
   {
    "name": "day",
    "type": "uint32",
    "internalType": "uint32"
   }
  ]
 },
 {
  "type": "error",
  "name": "ERC721IncorrectOwner",
  "inputs": [
   {
    "name": "sender",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "tokenId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "owner",
    "type": "address",
    "internalType": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "ERC721InsufficientApproval",
  "inputs": [
   {
    "name": "operator",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "tokenId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "ERC721InvalidApprover",
  "inputs": [
   {
    "name": "approver",
    "type": "address",
    "internalType": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "ERC721InvalidOperator",
  "inputs": [
   {
    "name": "operator",
    "type": "address",
    "internalType": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "ERC721InvalidOwner",
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
  "name": "ERC721InvalidReceiver",
  "inputs": [
   {
    "name": "receiver",
    "type": "address",
    "internalType": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "ERC721InvalidSender",
  "inputs": [
   {
    "name": "sender",
    "type": "address",
    "internalType": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "ERC721NonexistentToken",
  "inputs": [
   {
    "name": "tokenId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "NotACpu",
  "inputs": [
   {
    "name": "processor",
    "type": "address",
    "internalType": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "NotBreeder",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotKeeper",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotStarter",
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
  "name": "SittingTooLong",
  "inputs": []
 },
 {
  "type": "error",
  "name": "UnknownPet",
  "inputs": []
 },
 {
  "type": "error",
  "name": "WrongPins",
  "inputs": [
   {
    "name": "nIn",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "nOut",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 }
] as const;
