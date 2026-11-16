/** OutfitMarketV2 ABI, generated from contracts/out by the build (do not edit by hand). */
export const outfitMarketV2Abi = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "owner_",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "bem_",
    "type": "address",
    "internalType": "contract IERC20"
   }
  ],
  "stateMutability": "nonpayable"
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
  "name": "MAX_FEE_BPS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "MAX_LISTING",
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
  "name": "MAX_NAME",
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
  "name": "MAX_PIXELS",
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
  "name": "MAX_ROYALTY_BPS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "MAX_SUPPLY",
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
  "name": "MIN_PRICE",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint96",
    "internalType": "uint96"
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
  "name": "balanceOf",
  "inputs": [
   {
    "name": "account",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "id",
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
  "name": "balanceOfBatch",
  "inputs": [
   {
    "name": "accounts",
    "type": "address[]",
    "internalType": "address[]"
   },
   {
    "name": "ids",
    "type": "uint256[]",
    "internalType": "uint256[]"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint256[]",
    "internalType": "uint256[]"
   }
  ],
  "stateMutability": "view"
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
  "name": "burnStray",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "buy",
  "inputs": [
   {
    "name": "listingId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "quantity",
    "type": "uint32",
    "internalType": "uint32"
   },
   {
    "name": "expectedPriceEach",
    "type": "uint96",
    "internalType": "uint96"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "cancel",
  "inputs": [
   {
    "name": "listingId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "create",
  "inputs": [
   {
    "name": "pixels",
    "type": "bytes",
    "internalType": "bytes"
   },
   {
    "name": "name_",
    "type": "string",
    "internalType": "string"
   },
   {
    "name": "price",
    "type": "uint96",
    "internalType": "uint96"
   },
   {
    "name": "maxSupply",
    "type": "uint32",
    "internalType": "uint32"
   },
   {
    "name": "royaltyBps",
    "type": "uint16",
    "internalType": "uint16"
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
  "name": "createItem",
  "inputs": [
   {
    "name": "name_",
    "type": "string",
    "internalType": "string"
   },
   {
    "name": "maxSupply",
    "type": "uint32",
    "internalType": "uint32"
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
  "name": "design",
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
    "internalType": "struct OutfitMarketV2.Design",
    "components": [
     {
      "name": "creator",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "price",
      "type": "uint96",
      "internalType": "uint96"
     },
     {
      "name": "maxSupply",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "minted",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "royaltyBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "closed",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "item",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "name",
      "type": "string",
      "internalType": "string"
     },
     {
      "name": "pixels",
      "type": "bytes",
      "internalType": "bytes"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "feeBps",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "isApprovedForAll",
  "inputs": [
   {
    "name": "account",
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
  "name": "isLive",
  "inputs": [
   {
    "name": "listingId",
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
  "name": "list",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "quantity",
    "type": "uint32",
    "internalType": "uint32"
   },
   {
    "name": "priceEach",
    "type": "uint96",
    "internalType": "uint96"
   },
   {
    "name": "expiresAt",
    "type": "uint64",
    "internalType": "uint64"
   },
   {
    "name": "buyer",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "listingId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "listNonce",
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
    "type": "uint32",
    "internalType": "uint32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "listings",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "seller",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "quantity",
    "type": "uint32",
    "internalType": "uint32"
   },
   {
    "name": "priceEach",
    "type": "uint96",
    "internalType": "uint96"
   },
   {
    "name": "nonce",
    "type": "uint32",
    "internalType": "uint32"
   },
   {
    "name": "expiresAt",
    "type": "uint64",
    "internalType": "uint64"
   },
   {
    "name": "buyer",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "feeBps",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "mint",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "quantity",
    "type": "uint32",
    "internalType": "uint32"
   },
   {
    "name": "expectedPrice",
    "type": "uint96",
    "internalType": "uint96"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "mintTo",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "to",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "quantity",
    "type": "uint32",
    "internalType": "uint32"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "minterCap",
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
    "type": "uint32",
    "internalType": "uint32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "nextDesign",
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
  "name": "nextListing",
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
  "name": "owed",
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
  "name": "renounceOwnership",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "safeBatchTransferFrom",
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
    "name": "ids",
    "type": "uint256[]",
    "internalType": "uint256[]"
   },
   {
    "name": "values",
    "type": "uint256[]",
    "internalType": "uint256[]"
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
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "value",
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
  "name": "setFee",
  "inputs": [
   {
    "name": "feeBps_",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setMinter",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "minter",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "cap",
    "type": "uint32",
    "internalType": "uint32"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setPrice",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "price",
    "type": "uint96",
    "internalType": "uint96"
   },
   {
    "name": "closed",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
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
  "name": "totalOwed",
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
  "type": "function",
  "name": "uri",
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
    "type": "string",
    "internalType": "string"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "withdraw",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "event",
  "name": "ApprovalForAll",
  "inputs": [
   {
    "name": "account",
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
  "name": "Cancelled",
  "inputs": [
   {
    "name": "listingId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
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
    "name": "creator",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "slot",
    "type": "uint8",
    "indexed": false,
    "internalType": "uint8"
   },
   {
    "name": "price",
    "type": "uint96",
    "indexed": false,
    "internalType": "uint96"
   },
   {
    "name": "maxSupply",
    "type": "uint32",
    "indexed": false,
    "internalType": "uint32"
   },
   {
    "name": "royaltyBps",
    "type": "uint16",
    "indexed": false,
    "internalType": "uint16"
   },
   {
    "name": "name",
    "type": "string",
    "indexed": false,
    "internalType": "string"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "FeeChanged",
  "inputs": [
   {
    "name": "feeBps",
    "type": "uint16",
    "indexed": false,
    "internalType": "uint16"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "ItemCreated",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "maxSupply",
    "type": "uint32",
    "indexed": false,
    "internalType": "uint32"
   },
   {
    "name": "name",
    "type": "string",
    "indexed": false,
    "internalType": "string"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Listed",
  "inputs": [
   {
    "name": "listingId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "seller",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "id",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "quantity",
    "type": "uint32",
    "indexed": false,
    "internalType": "uint32"
   },
   {
    "name": "priceEach",
    "type": "uint96",
    "indexed": false,
    "internalType": "uint96"
   },
   {
    "name": "expiresAt",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "buyer",
    "type": "address",
    "indexed": false,
    "internalType": "address"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "ListingsRetired",
  "inputs": [
   {
    "name": "holder",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "id",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "nonce",
    "type": "uint32",
    "indexed": false,
    "internalType": "uint32"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Minted",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "buyer",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "quantity",
    "type": "uint32",
    "indexed": false,
    "internalType": "uint32"
   },
   {
    "name": "paid",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "MintedBy",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "minter",
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
    "name": "quantity",
    "type": "uint32",
    "indexed": false,
    "internalType": "uint32"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "MinterSet",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "minter",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "cap",
    "type": "uint32",
    "indexed": false,
    "internalType": "uint32"
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
  "name": "PriceChanged",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "price",
    "type": "uint96",
    "indexed": false,
    "internalType": "uint96"
   },
   {
    "name": "closed",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Sold",
  "inputs": [
   {
    "name": "listingId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "buyer",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "quantity",
    "type": "uint32",
    "indexed": false,
    "internalType": "uint32"
   },
   {
    "name": "paid",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "TransferBatch",
  "inputs": [
   {
    "name": "operator",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
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
    "name": "ids",
    "type": "uint256[]",
    "indexed": false,
    "internalType": "uint256[]"
   },
   {
    "name": "values",
    "type": "uint256[]",
    "indexed": false,
    "internalType": "uint256[]"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "TransferSingle",
  "inputs": [
   {
    "name": "operator",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
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
    "name": "id",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "value",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "URI",
  "inputs": [
   {
    "name": "value",
    "type": "string",
    "indexed": false,
    "internalType": "string"
   },
   {
    "name": "id",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Withdrawn",
  "inputs": [
   {
    "name": "to",
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
  "type": "error",
  "name": "BadName",
  "inputs": []
 },
 {
  "type": "error",
  "name": "BadPixels",
  "inputs": []
 },
 {
  "type": "error",
  "name": "BadTerms",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ERC1155InsufficientBalance",
  "inputs": [
   {
    "name": "sender",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "balance",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "needed",
    "type": "uint256",
    "internalType": "uint256"
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
  "name": "ERC1155InvalidApprover",
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
  "name": "ERC1155InvalidArrayLength",
  "inputs": [
   {
    "name": "idsLength",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "valuesLength",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "ERC1155InvalidOperator",
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
  "name": "ERC1155InvalidReceiver",
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
  "name": "ERC1155InvalidSender",
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
  "name": "ERC1155MissingApprovalForAll",
  "inputs": [
   {
    "name": "operator",
    "type": "address",
    "internalType": "address"
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
  "name": "Expired",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NoDesign",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NoListing",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotCreator",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotEnoughHeld",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotForSale",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotMinter",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotSeller",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotTheBuyer",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NothingOwed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "OverCap",
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
  "name": "PriceMoved",
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
  "name": "SoldOut",
  "inputs": []
 },
 {
  "type": "error",
  "name": "WrongPayment",
  "inputs": []
 }
] as const;
