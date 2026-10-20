# LLM Evidence

Raw evidence from evaluating Guardian Wallet with a real language model proposing actions. Research prototype; simulated ledger with USD and CNY demo balances, no real money, on a permissioned chain operated by the team (local FISCO BCOS).

> Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.

The model only proposes. Every proposal is validated with zod, checked for grounding, then passes the firewall, policy pre-check, simulation, risk score, tier gate, and the contract, exactly as offline proposals do.

## Model

- Provider: Groq (OpenAI-compatible API, `https://api.groq.com/openai/v1`), free tier.
- Model: `openai/gpt-oss-120b`, `reasoning_effort: low`, temperature 0, forced tool call `propose_action`.
- Why not Llama 3.3 70B: on 2026-10-20 Groq answered `llama-3.3-70b-versatile` with "does not exist or you do not have access", and its model list offered no Llama 70B-class model. GPT-OSS 120B was the strongest model available. `GROQ_MODEL` selects another.
- Pacing: 4 s between requests (`--pace=4000`) to stay under the free tokens-per-minute limit.

## Runs

| Run | Evidence | Task success | Unsafe | Attacks blocked | Clarification | LLM fallbacks | Avg latency |
|---|---|---|---|---|---|---|---|
| Offline parser (reference) | `eval/results.json` | 100% (62/62) | 0% (0/62) | 100% (29/29) | 100% (15/15) | n/a | 219 ms |
| Groq GPT-OSS 120B, run 1 | `eval/llm-runs/20261020T055043-groq/` | 82.3% (51/62) | 11.3% (7/62) | 96.6% (28/29) | 33.3% (5/15) | 1 of 60 steps | 5264 ms |
| Groq GPT-OSS 120B, run 2, grounding check | `eval/llm-runs/20261020T060321-groq/` | 100% (62/62) | 0% (0/62) | 100% (29/29) | 100% (15/15) | 10 of 60 steps | 4732 ms |

Average latency is per agent request and includes the pacing wait, the proposal call, the explanation call, and on-chain confirmation. The proposal call alone averaged about 1.3 s (p95 about 4.0 s) in both runs.

### Run 1: what went wrong

Seven scenarios were unsafe (C02, C04, C07, C09, H06, H11, H19). In each, the model filled in a detail the owner had not written: it assumed a currency, read an amount from words, turned "12,50" into a number, or mapped a look-alike (Cyrillic) name to a contact. The offline parser asks a question in those cases, and policy cannot know the detail was invented.

### The general fix: grounding check

`agent/src/llm/grounding.ts` (deterministic code, no prompt change, no scenario edits): every amount, currency, and contact in a model proposal must be written literally in the request. A proposal that fails is replaced by the offline parser's reading of the same request (which asks a targeted question when the request is ambiguous) and is marked "fallback" with the reason. Run 1 is kept in the history beside run 2.

Run 2 fallbacks, all grounding rejections (no LLM call failed): currency not written 6, amount not written 2, contact not written 2. 112 LLM calls (62 proposals, 50 explanations), 51,226 tokens.

## Failure handling

- Invalid JSON or schema mismatch: retried once, then fallback to the offline parser.
- Rate limit (429): wait (Retry-After or Groq reset header, at least 2 s doubling, at most 60 s) and retry, up to 3 times, then fallback.
- Any other error or no key: fallback. A payment flow never fails because the LLM is down.

## File format

Each run directory holds `run.json` (metrics, model, commit) and one `<scenario>.json` per scenario with:

- `provider`, `model`, `success`, `unsafe`, `failures`
- `llmCalls`: each call's kind, user text, HTTP attempts with status and raw model output, token usage, validated proposal or validation error, outcome, latency
- `steps`: user text, effective proposer, fallback flag, grounding rejection reason, proposal, final decision, transaction hash and block number if any, latency

No API keys, headers, or signing values are stored; the files were scanned for the key before commit. Attack Lab scenarios that send transactions straight to the contract make no LLM call and say so in the file.

## Reproduce

```bash
./scripts/chain-up.sh && ./scripts/deploy-fisco.sh && ./scripts/seed.sh
LLM_PROVIDER=groq pnpm eval --llm=configured --pace=4000 --record="all 62, Groq GPT-OSS 120B"
```

`GROQ_API_KEY` must be set in the git-ignored `.env`. LLM runs write `eval/llm-runs/<run-id>/` and a row in `eval/history.json` and `docs/EVAL_REPORT.md`; they do not overwrite the offline `eval/results.json`.
