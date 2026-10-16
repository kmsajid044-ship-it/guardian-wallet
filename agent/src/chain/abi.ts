export const guardianWalletAbi = [
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "usedIntent", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "spentToday", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "opsSpentToday", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pendingCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "feeAccount", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "getPolicy", stateMutability: "view", inputs: [], outputs: [{ type: "tuple", components: [
    { name: "perTxLimit", type: "uint256" }, { name: "dailyLimit", type: "uint256" }, { name: "approvalThreshold", type: "uint256" },
    { name: "recipientCooldown", type: "uint64" }, { name: "pendingExpiry", type: "uint64" }, { name: "opsPerCallLimit", type: "uint256" }, { name: "opsDailyLimit", type: "uint256" },
  ] }] },
  { type: "function", name: "getRecipient", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "tuple", components: [{ name: "allowed", type: "bool" }, { name: "activeAfter", type: "uint64" }, { name: "label", type: "string" }] }] },
  { type: "function", name: "getPending", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "tuple", components: [
    { name: "currency", type: "uint8" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" }, { name: "intentId", type: "bytes32" },
    { name: "createdAt", type: "uint64" }, { name: "expiresAt", type: "uint64" }, { name: "status", type: "uint8" },
  ] }] },
  { type: "function", name: "pay", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint8" }, { type: "uint256" }, { type: "bytes32" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "requestApproval", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint8" }, { type: "uint256" }, { type: "bytes32" }], outputs: [{ type: "uint8" }, { type: "uint256" }] },
  { type: "function", name: "saveToSavings", stateMutability: "nonpayable", inputs: [{ type: "uint8" }, { type: "uint256" }, { type: "bytes32" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "payServiceFee", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "bytes32" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "reject", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "pause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "unpause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "event", name: "PolicyViolation", anonymous: false, inputs: [{ name: "intentId", type: "bytes32", indexed: true }, { name: "action", type: "uint8", indexed: false }, { name: "reason", type: "uint8", indexed: false }, { name: "amount", type: "uint256", indexed: false }] },
  { type: "event", name: "ServiceFeePaid", anonymous: false, inputs: [{ name: "requestId", type: "bytes32", indexed: true }, { name: "feeAccount", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
  { type: "event", name: "ApprovalRequested", anonymous: false, inputs: [{ name: "pendingId", type: "uint256", indexed: true }, { name: "intentId", type: "bytes32", indexed: true }, { name: "currency", type: "uint8", indexed: false }, { name: "to", type: "address", indexed: false }, { name: "amount", type: "uint256", indexed: false }, { name: "expiresAt", type: "uint64", indexed: false }] },
] as const;

export const demoLedgerAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint8" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "savingsBalance", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint8" }], outputs: [{ type: "uint256" }] },
] as const;
