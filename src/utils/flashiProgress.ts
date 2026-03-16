/**
 * Progress step generation for Flashi chat loading states.
 * Adapted from MCP-POC assistantProgress.ts, simplified for Flash MDM context.
 */

const isCountQuery = (text: string) =>
  /\bhow many\b|\bcount\b|\bnumber of\b|\btotal\b|\bmost\b/i.test(text);

const asksForDevices = (text: string) =>
  /\bdevice\b|\bdevices\b|\benrolled\b|\benrolment\b/i.test(text);

const asksForPolicies = (text: string) => /\bpolicy\b|\bpolicies\b/i.test(text);

const asksForGroups = (text: string) => /\bgroup\b|\bgroups\b/i.test(text);

const asksForApps = (text: string) =>
  /\bapplication\b|\bapplications\b|\bapp\b|\bapps\b|\bpackage\b|\bweb app\b/i.test(
    text,
  );

const asksForEnrolment = (text: string) =>
  /\benrol\b|\benrolment\b|\benrollment\b|\btoken\b|\btokens\b|\bqr\b/i.test(
    text,
  );

const asksForLicensing = (text: string) =>
  /\blicen[cs]\b|\bsubscription\b|\bbilling\b|\bplan\b|\bseat\b/i.test(text);

export function buildFlashiProgressPlan(message: string): string[] {
  const text = String(message || "").trim();

  if (asksForDevices(text) && isCountQuery(text)) {
    return [
      "Counting devices...",
      "Querying device data...",
      "Composing response...",
    ];
  }

  if (asksForDevices(text)) {
    return [
      "Querying device data...",
      "Reviewing device information...",
      "Composing response...",
    ];
  }

  if (asksForPolicies(text)) {
    return [
      "Querying policies...",
      "Reviewing policy configuration...",
      "Composing response...",
    ];
  }

  if (asksForGroups(text)) {
    return [
      "Loading group hierarchy...",
      "Reviewing group data...",
      "Composing response...",
    ];
  }

  if (asksForApps(text)) {
    return [
      "Checking application data...",
      "Reviewing app information...",
      "Composing response...",
    ];
  }

  if (asksForEnrolment(text)) {
    return [
      "Checking enrolment data...",
      "Reviewing tokens and configuration...",
      "Composing response...",
    ];
  }

  if (asksForLicensing(text)) {
    return [
      "Checking licensing information...",
      "Reviewing subscription status...",
      "Composing response...",
    ];
  }

  return [
    "Analysing your request...",
    "Querying Flash MDM data...",
    "Composing response...",
  ];
}
