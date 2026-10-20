# Guardian Wallet: how to use the console

Guardian Wallet is a research prototype. You play the **owner** of a demo account. An AI agent pays, saves and plans for you, but only inside limits it cannot change. All money here is simulated demo units. There is no real money.

Online demo: https://104-208-100-228.sslip.io (no installation, nothing to sign up for).

## The idea in one line

The AI proposes. Code verifies. The contract enforces. You decide above the line.

## Try it in 5 minutes

Open the **Home** tab and follow these steps in order. Each step shows a different layer of protection.

1. **A normal payment.** Tap `Pay Ana $50`. The agent checks the request (firewall, policy check, simulation, risk score) and pays. The receipt says "Paid $50.00 to Ana". Tap **View proof** to see the transaction, then **Verify** to ask the blockchain node for its receipt.
2. **A payment that needs you.** Tap `Pay Ana $250`. It is above the $200 approval line, so the receipt says "Needs your OK" with **Approve** and **Decline**. Approve runs the owner's approval on the chain; Decline rejects it. Success appears only after the chain confirms.
3. **A payment the contract refuses.** Type `Send Ana $600`. The answer is "Blocked: $600.00 is above your $500 limit." The contract itself refuses it, and the refusal is recorded with a hash.
4. **An unclear request.** Type `Pay someone`. The AI asks "Who should I pay?" and shows your contacts as buttons instead of guessing.
5. **Amounts in words.** Type `Pay Ana fifty USD`. The AI asks "Please give the amount in digits" instead of guessing. (Write the currency as `USD`, `$`, `CNY` or `¥`: with "dollars" it asks a more general question.)
6. **Stop everything.** Tap **Pause AI** (on Home or in Controls). It asks first. Then every page shows "Paused. The AI can't pay anyone." until you resume.
7. **Attack it.** Open the **Security** tab and run all 11 attacks (prompt injection, over-limit payment, split payments, unknown recipient, and more). Each one is blocked. Several are also refused when sent straight to the contract, which shows that safety does not depend on the AI behaving.

## The four tabs

| Tab | What it is for |
|---|---|
| **Home** | Demo balances, the "What should your AI do?" box with example buttons, the answer as a receipt, anything waiting for your approval, and the Pause button |
| **Activity** | Everything the AI did. Filter the list and open any row to see its proof and a "Why this action" explanation |
| **Controls** | Your limits, the list of allowed recipients, and Pause / Resume |
| **Security** | For reviewers: the Attack Lab (**Run all 11**), the Evidence Inspector (every recorded transaction, on-chain refusal and off-chain block; in a local install each one is checkable against the node, while the online demo shows where to re-check them from the GitHub repo), and the Evaluation results |

## What the labels mean

| You see | It means |
|---|---|
| **Done** | The payment was made and the chain confirmed it |
| **Needs your OK** | The amount is above your approval line; only you can approve it |
| **Blocked** | A rule refused it (limit, unknown recipient, cooldown, injection, and so on) |
| **Asking you** | The request was unclear, so the AI asked a question |
| **Paused** | You (or the guardian) paused the AI; only you can resume it |

## The top bar

- **Chain information.** Shows which chain the console is connected to, its chain ID and the current block height, read live from the node.
- **AI label.** Shows which model is reading your requests, for example "AI: Ministral 8B via Mistral". It says "offline rules" when no model is available. The demo keeps working either way: if the model is unavailable, the agent falls back to its offline rules.
- **Technical details switch.** Turn it on to see backend codes, permission tiers (T0 to T3), risk factors, hashes and the "Why this action" panel on every card.
- **Reduce effects, light and dark mode.** Display options.
- **Menu.** "Guide" opens this guide; "Show tour again" repeats the short first-visit tour.

## Good to know

- **Who you are.** Every visitor acts as the demo owner, so Approve, Decline, Pause and Resume really work. The owner and agent keys are generated inside the server when it starts and never leave it.
- **Resetting.** Use **Reset demo**, on the right of the online-demo banner at the top of every page, to start again with fresh contracts and synthetic data. The demo also resets itself after 30 minutes without changes.
- **Rate limit.** Chat is limited to 20 requests per minute per address.
- **Money.** All balances (USD and CNY) are simulated demo units with no value. Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.
- **The chain.** The demo runs on a four-node FISCO BCOS network, a permissioned chain operated by the team. The recorded evidence (134 transactions, verified on all four nodes) comes from the team's own network and is in the repository, not on the online chain.

## If something looks wrong

- Nothing happens after a request: wait a few seconds, then try again. The first request after a long idle period can be slower.
- The AI label says "offline rules": this is normal when the model quota is used up. Everything still works.
- The page looks stuck or the balances look odd: use **Reset demo** in the banner at the top of the page.

## Where to find the proof

- In the console: **Security**, then **Evidence Inspector**.
- In the repository: `docs/EXECUTION_EVIDENCE.md`, `docs/EVAL_REPORT.md` and `docs/ATTACK_LAB_EVIDENCE.md`.
- To re-check the recorded transactions yourself: `pnpm verify-evidence --running`, or `pnpm verify-evidence --fresh` for a new network.
