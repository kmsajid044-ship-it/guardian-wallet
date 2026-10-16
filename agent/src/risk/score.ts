export type RiskFactor = { code: string; points: number; explanation: string };
export type RiskResult = { score: number; factors: RiskFactor[]; route: "ALLOW" | "FORCE_APPROVAL" | "BLOCK" };

export function scoreRisk(input: {
  untrusted: boolean;
  injectionPatternFound: boolean;
  amount?: bigint;
  contactHistory: bigint[];
  remainingDaily?: bigint;
  outsideUsualHours: boolean;
  riskIntel?: { score: number; sanctioned: boolean };
}): RiskResult {
  const factors: RiskFactor[] = [];
  const add = (code: string, points: number, explanation: string): void => { factors.push({ code, points, explanation }); };
  if (input.untrusted) add("UNTRUSTED_SOURCE", 20, "The action originated in untrusted content.");
  if (input.injectionPatternFound) add("INJECTION_PATTERN", 30, "The content contains an instruction-injection pattern.");
  if (input.amount !== undefined && input.contactHistory.length > 0) {
    const sorted = [...input.contactHistory].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    if (input.amount > median * 2n) add("ABOVE_CONTACT_MEDIAN", 15, "The amount is more than twice this contact’s median payment.");
  }
  if (input.amount !== undefined && input.contactHistory.length === 0) add("FIRST_PAYMENT", 10, "This is the first recorded payment to the contact.");
  if (input.amount !== undefined && input.remainingDaily !== undefined && input.remainingDaily > 0n && input.amount * 100n > input.remainingDaily * 70n) {
    add("MOST_OF_REMAINING_DAILY", 15, "The amount uses more than 70% of the remaining daily limit.");
  }
  if (input.outsideUsualHours) add("OUTSIDE_USUAL_HOURS", 10, "The request is outside the owner’s usual hours.");
  if (input.riskIntel?.sanctioned) add("RISK_INTEL_SANCTIONED", 100, "Risk Intel reported a sanctions match.");
  else if (input.riskIntel && input.riskIntel.score >= 70) add("RISK_INTEL_HIGH", 40, `Risk Intel rated the payee high risk (${input.riskIntel.score}/100).`);
  else if (input.riskIntel && input.riskIntel.score >= 40) add("RISK_INTEL_MEDIUM", 20, `Risk Intel rated the payee medium risk (${input.riskIntel.score}/100).`);
  const score = Math.min(100, factors.reduce((sum, factor) => sum + factor.points, 0));
  return { score, factors, route: score >= 85 ? "BLOCK" : score >= 60 ? "FORCE_APPROVAL" : "ALLOW" };
}
