const CATEGORY_SCENARIOS: Record<string, readonly string[]> = {
  personalUsage: ['wp'],
  crossProfile: ['wp'],
  kioskMode: ['fm', 'dedicated'],
};

export function isPolicyCategoryAvailable(category: string, scenario: string): boolean {
  const supportedScenarios = CATEGORY_SCENARIOS[category];
  return !supportedScenarios || supportedScenarios.includes(scenario);
}
