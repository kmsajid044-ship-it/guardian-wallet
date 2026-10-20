import type { ReactNode } from "react";

// The user guide as static text: the same content as docs/USER_GUIDE.md (web/user-guide.test.ts
// checks that they match). No data, no requests.

const ONLINE_DEMO = "https://104-208-100-228.sslip.io";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card space-y-3">
    <h2 className="font-display text-heading font-semibold">{title}</h2>
    {children}
  </section>;
}

function Table({ head, rows }: { head: [string, string]; rows: Array<[ReactNode, ReactNode]> }) {
  return <div className="overflow-x-auto">
    <table className="w-full text-left text-body">
      <thead><tr className="border-b border-line text-small text-muted"><th className="py-2 pr-4 font-medium">{head[0]}</th><th className="py-2 font-medium">{head[1]}</th></tr></thead>
      <tbody>{rows.map(([first, second], index) => <tr key={index} className="border-b border-line align-top last:border-0"><td className="py-2 pr-4">{first}</td><td className="py-2">{second}</td></tr>)}</tbody>
    </table>
  </div>;
}

const code = (text: string) => <code className="code-tag">{text}</code>;

export function GuideContent() {
  return <div data-testid="user-guide" className="space-y-5 text-body text-fg2">
    <section className="card space-y-3">
      <h2 className="font-display text-heading font-semibold">Guardian Wallet: how to use the console</h2>
      <p>Guardian Wallet is a research prototype. You play the <b>owner</b> of a demo account. An AI agent pays, saves and plans for you, but only inside limits it cannot change. All money here is simulated demo units. There is no real money.</p>
      <p>Online demo: <a className="underline" href={ONLINE_DEMO}>{ONLINE_DEMO}</a> (no installation, nothing to sign up for).</p>
    </section>

    <Section title="The idea in one line">
      <p>The AI proposes. Code verifies. The contract enforces. You decide above the line.</p>
    </Section>

    <Section title="Try it in 5 minutes">
      <p>Open the <b>Home</b> tab and follow these steps in order. Each step shows a different layer of protection.</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li><b>A normal payment.</b> Tap {code("Pay Ana $50")}. The agent checks the request (firewall, policy check, simulation, risk score) and pays. The receipt says "Paid $50.00 to Ana". Tap <b>View proof</b> to see the transaction, then <b>Verify</b> to ask the blockchain node for its receipt.</li>
        <li><b>A payment that needs you.</b> Tap {code("Pay Ana $250")}. It is above the $200 approval line, so the receipt says "Needs your OK" with <b>Approve</b> and <b>Decline</b>. Approve runs the owner's approval on the chain; Decline rejects it. Success appears only after the chain confirms.</li>
        <li><b>A payment the contract refuses.</b> Type {code("Send Ana $600")}. The answer is "Blocked: $600.00 is above your $500 limit." The contract itself refuses it, and the refusal is recorded with a hash.</li>
        <li><b>An unclear request.</b> Type {code("Pay someone")}. The AI asks "Who should I pay?" and shows your contacts as buttons instead of guessing.</li>
        <li><b>Amounts in words.</b> Type {code("Pay Ana fifty USD")}. The AI asks "Please give the amount in digits" instead of guessing. (Write the currency as {code("USD")}, {code("$")}, {code("CNY")} or {code("¥")}: with "dollars" it asks a more general question.)</li>
        <li><b>Stop everything.</b> Tap <b>Pause AI</b> (on Home or in Controls). It asks first. Then every page shows "Paused. The AI can't pay anyone." until you resume.</li>
        <li><b>Attack it.</b> Open the <b>Security</b> tab and run all 11 attacks (prompt injection, over-limit payment, split payments, unknown recipient, and more). Each one is blocked. Several are also refused when sent straight to the contract, which shows that safety does not depend on the AI behaving.</li>
      </ol>
    </Section>

    <Section title="The four tabs">
      <Table head={["Tab", "What it is for"]} rows={[
        [<b>Home</b>, "Demo balances, the \"What should your AI do?\" box with example buttons, the answer as a receipt, anything waiting for your approval, and the Pause button"],
        [<b>Activity</b>, "Everything the AI did. Filter the list and open any row to see its proof and a \"Why this action\" explanation"],
        [<b>Controls</b>, "Your limits, the list of allowed recipients, and Pause / Resume"],
        [<b>Security</b>, <>For reviewers: the Attack Lab (<b>Run all 11</b>), the Evidence Inspector (every recorded transaction, on-chain refusal and off-chain block; in a local install each one is checkable against the node, while the online demo shows where to re-check them from the GitHub repo), and the Evaluation results</>],
      ]} />
    </Section>

    <Section title="What the labels mean">
      <Table head={["You see", "It means"]} rows={[
        [<b>Done</b>, "The payment was made and the chain confirmed it"],
        [<b>Needs your OK</b>, "The amount is above your approval line; only you can approve it"],
        [<b>Blocked</b>, "A rule refused it (limit, unknown recipient, cooldown, injection, and so on)"],
        [<b>Asking you</b>, "The request was unclear, so the AI asked a question"],
        [<b>Paused</b>, "You (or the guardian) paused the AI; only you can resume it"],
      ]} />
    </Section>

    <Section title="The top bar">
      <ul className="list-disc space-y-2 pl-5">
        <li><b>Chain information.</b> Shows which chain the console is connected to, its chain ID and the current block height, read live from the node.</li>
        <li><b>AI label.</b> Shows which model is reading your requests, for example "AI: Ministral 8B via Mistral". It says "offline rules" when no model is available. The demo keeps working either way: if the model is unavailable, the agent falls back to its offline rules.</li>
        <li><b>Technical details switch.</b> Turn it on to see backend codes, permission tiers (T0 to T3), risk factors, hashes and the "Why this action" panel on every card.</li>
        <li><b>Reduce effects, light and dark mode.</b> Display options.</li>
        <li><b>Menu.</b> "Guide" opens this guide; "Show tour again" repeats the short first-visit tour.</li>
      </ul>
    </Section>

    <Section title="Good to know">
      <ul className="list-disc space-y-2 pl-5">
        <li><b>Who you are.</b> Every visitor acts as the demo owner, so Approve, Decline, Pause and Resume really work. The owner and agent keys are generated inside the server when it starts and never leave it.</li>
        <li><b>Resetting.</b> Use <b>Reset demo</b>, on the right of the online-demo banner at the top of every page, to start again with fresh contracts and synthetic data. The demo also resets itself after 30 minutes without changes.</li>
        <li><b>Rate limit.</b> Chat is limited to 20 requests per minute per address.</li>
        <li><b>Money.</b> All balances (USD and CNY) are simulated demo units with no value. Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.</li>
        <li><b>The chain.</b> The demo runs on a four-node FISCO BCOS network, a permissioned chain operated by the team. The recorded evidence (134 transactions, verified on all four nodes) comes from the team's own network and is in the repository, not on the online chain.</li>
      </ul>
    </Section>

    <Section title="If something looks wrong">
      <ul className="list-disc space-y-2 pl-5">
        <li>Nothing happens after a request: wait a few seconds, then try again. The first request after a long idle period can be slower.</li>
        <li>The AI label says "offline rules": this is normal when the model quota is used up. Everything still works.</li>
        <li>The page looks stuck or the balances look odd: use <b>Reset demo</b> in the banner at the top of the page.</li>
      </ul>
    </Section>

    <Section title="Where to find the proof">
      <ul className="list-disc space-y-2 pl-5">
        <li>In the console: <b>Security</b>, then <b>Evidence Inspector</b>.</li>
        <li>In the repository: {code("docs/EXECUTION_EVIDENCE.md")}, {code("docs/EVAL_REPORT.md")} and {code("docs/ATTACK_LAB_EVIDENCE.md")}.</li>
        <li>To re-check the recorded transactions yourself: {code("pnpm verify-evidence --running")}, or {code("pnpm verify-evidence --fresh")} for a new network.</li>
      </ul>
    </Section>
  </div>;
}
