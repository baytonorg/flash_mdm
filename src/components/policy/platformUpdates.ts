export const PLATFORM_UPDATE_TARGETS = [
  'OS_UPDATE_WITH_API_LEVEL_CHANGE',
  'OS_UPDATE_WITHOUT_API_LEVEL_CHANGE',
  'GOOGLE_PLAY_SYSTEM_UPDATE',
  'GOOGLE_SYSTEM_SERVICES',
  'SINGLE_APP',
] as const;

export type PlatformUpdateTargetType = typeof PLATFORM_UPDATE_TARGETS[number];
export type UucStage = 'STAGE_DOWNLOAD' | 'STAGE_APPLY';
export type UucOutcomeType = 'BLOCK' | 'USER_PROMPT' | 'FORCE';

export type UucTarget = {
  targetType: PlatformUpdateTargetType;
  singleApp?: { packageName: string };
};

export type UucPredicate = {
  daysOfWeek?: string[];
  timeOfDayLowerBound?: { hours: number };
  timeOfDayUpperBound?: { hours: number };
  dateLowerBound?: { year: number; month: number; day: number };
  dateUpperBound?: { year: number; month: number; day: number };
  updateAgeLowerBound?: string;
  updateAgeUpperBound?: string;
};

export type UucRule = {
  id: string;
  targets: UucTarget[];
  stages?: UucStage[];
  predicate?: UucPredicate;
  outcome: { outcomeType: UucOutcomeType | 'OUTCOME_TYPE_UNSPECIFIED' };
};

export const PLATFORM_UPDATE_TARGET_LABELS: Record<PlatformUpdateTargetType, string> = {
  OS_UPDATE_WITH_API_LEVEL_CHANGE: 'Major OS updates',
  OS_UPDATE_WITHOUT_API_LEVEL_CHANGE: 'Minor OS and security updates',
  GOOGLE_PLAY_SYSTEM_UPDATE: 'Google Play system updates',
  GOOGLE_SYSTEM_SERVICES: 'Google system services',
  SINGLE_APP: 'Single Google system-service app',
};

const OS_TARGETS = new Set<PlatformUpdateTargetType>([
  'OS_UPDATE_WITH_API_LEVEL_CHANGE',
  'OS_UPDATE_WITHOUT_API_LEVEL_CHANGE',
]);

const DAY_SECONDS = 86400;
const ANDROID_PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const UUC_STAGES = new Set<UucStage>(['STAGE_DOWNLOAD', 'STAGE_APPLY']);
const UUC_DAYS = new Set([
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function hasConfiguredSystemUpdate(config: Record<string, unknown>): boolean {
  const systemUpdate = asRecord(config.systemUpdate);
  return !!systemUpdate && Object.values(systemUpdate).some((value) => value !== undefined && value !== null);
}

export function getUucRules(config: Record<string, unknown>): UucRule[] {
  const policy = asRecord(config.unifiedUpdatePolicy);
  return Array.isArray(policy?.rules) ? policy.rules as UucRule[] : [];
}

export function isOsTarget(targetType: PlatformUpdateTargetType): boolean {
  return OS_TARGETS.has(targetType);
}

export function isTargetShadowed(config: Record<string, unknown>, targetType: PlatformUpdateTargetType): boolean {
  return isOsTarget(targetType) && hasConfiguredSystemUpdate(config);
}

export type EffectiveControl = 'systemUpdate' | 'uuc' | 'default';

export type EffectiveControlRow = {
  targetType: PlatformUpdateTargetType;
  label: string;
  control: EffectiveControl;
  detail: string;
};

export function getEffectiveControlOverview(config: Record<string, unknown>): EffectiveControlRow[] {
  const systemUpdateConfigured = hasConfiguredSystemUpdate(config);
  const rules = getUucRules(config);
  return PLATFORM_UPDATE_TARGETS.map((targetType) => {
    const hasUucTarget = rules.some((rule) =>
      Array.isArray(rule.targets) && rule.targets.some((target) => target?.targetType === targetType));
    if (isOsTarget(targetType) && systemUpdateConfigured) {
      return {
        targetType,
        label: PLATFORM_UPDATE_TARGET_LABELS[targetType],
        control: 'systemUpdate' as const,
        detail: hasUucTarget
          ? 'System update policy is authoritative; matching UUC targets are shadowed.'
          : 'System update policy is authoritative for this OEM target.',
      };
    }
    if (hasUucTarget) {
      return {
        targetType,
        label: PLATFORM_UPDATE_TARGET_LABELS[targetType],
        control: 'uuc' as const,
        detail: isOsTarget(targetType)
          ? 'UUC is configured. Device and OEM support still determine whether it is effective.'
          : 'At least one UUC rule targets this update class.',
      };
    }
    return {
      targetType,
      label: PLATFORM_UPDATE_TARGET_LABELS[targetType],
      control: 'default' as const,
      detail: isOsTarget(targetType)
        ? 'No explicit control is configured. Device support and update-client defaults apply.'
        : 'No UUC rule targets this update class; the update client uses its default behaviour.',
    };
  });
}

export function createDefaultUucRule(index: number): UucRule {
  return {
    id: `update-rule-${index + 1}`,
    targets: [],
    outcome: { outcomeType: 'OUTCOME_TYPE_UNSPECIFIED' },
  };
}

export function durationToDays(value: unknown): number | '' {
  if (typeof value !== 'string') return '';
  const match = /^(0|[1-9]\d*)s$/.exec(value);
  if (!match) return '';
  const seconds = Number(match[1]);
  return Number.isSafeInteger(seconds) && seconds % DAY_SECONDS === 0
    ? seconds / DAY_SECONDS
    : '';
}

export function daysToDuration(value: number): string {
  const seconds = value * DAY_SECONDS;
  if (!Number.isInteger(value) || value < 0 || !Number.isSafeInteger(seconds)) return '';
  return `${seconds}s`;
}

export function dateToInput(value: unknown): string {
  const date = asRecord(value);
  const year = Number(date?.year);
  const month = Number(date?.month);
  const day = Number(date?.day);
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31) return '';
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function inputToDate(value: string): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function getRuleEditorIssues(rule: UucRule, index: number, rules: UucRule[]): string[] {
  const issues: string[] = [];
  const id = typeof rule.id === 'string' ? rule.id.trim() : '';
  if (!id) issues.push('Rule ID is required.');
  if (id.length > 64) issues.push('Rule ID must be 64 characters or fewer.');
  if (id && rules.some((candidate, candidateIndex) => candidateIndex !== index && candidate.id?.trim() === id)) {
    issues.push('Rule ID must be unique.');
  }
  const targets = Array.isArray(rule.targets) ? rule.targets : [];
  if (targets.length === 0) issues.push('Choose at least one target.');
  if (new Set(targets.map((target) => target.targetType)).size !== targets.length) {
    issues.push('Targets must not contain duplicates.');
  }
  for (const target of targets) {
    if (!PLATFORM_UPDATE_TARGETS.includes(target.targetType)) {
      issues.push(`Unsupported target type: ${String(target.targetType)}.`);
    }
    if (target.targetType === 'SINGLE_APP') {
      const packageName = target.singleApp?.packageName?.trim() ?? '';
      if (!packageName) issues.push('Single-app targets require a package name.');
      else if (!ANDROID_PACKAGE_NAME.test(packageName)) issues.push('Single-app package name is invalid.');
    } else if (target.singleApp) {
      issues.push('Single-app configuration is valid only for the single-app target.');
    }
  }
  const stages = Array.isArray(rule.stages) ? rule.stages : [];
  if (rule.stages !== undefined && !Array.isArray(rule.stages)) issues.push('Evaluation stages must be a list.');
  if (new Set(stages).size !== stages.length) issues.push('Evaluation stages must not contain duplicates.');
  if (stages.some((stage) => !UUC_STAGES.has(stage))) issues.push('Choose only supported evaluation stages.');
  if (!rule.outcome?.outcomeType || rule.outcome.outcomeType === 'OUTCOME_TYPE_UNSPECIFIED') {
    issues.push('Choose an outcome.');
  }
  if (rule.outcome?.outcomeType === 'USER_PROMPT' && targets.some((target) => !isOsTarget(target.targetType))) {
    issues.push('User prompt is available only for OEM OS targets.');
  }
  const days = rule.predicate?.daysOfWeek;
  if (days !== undefined) {
    if (!Array.isArray(days) || days.length === 0) issues.push('Days of week must be a non-empty list when set.');
    else {
      if (new Set(days).size !== days.length) issues.push('Days of week must not contain duplicates.');
      if (days.some((day) => !UUC_DAYS.has(day))) issues.push('Choose only supported days of week.');
    }
  }
  const validateHour = (value: unknown): number | undefined => {
    const record = asRecord(value);
    if (!record) return undefined;
    const hours = record.hours;
    if (!Number.isInteger(hours) || Number(hours) < 0 || Number(hours) > 23) return undefined;
    if (['minutes', 'seconds', 'nanos'].some((key) => record[key] !== undefined && record[key] !== 0)) return undefined;
    return Number(hours);
  };
  const lowerHour = validateHour(rule.predicate?.timeOfDayLowerBound);
  const upperHour = validateHour(rule.predicate?.timeOfDayUpperBound);
  if (rule.predicate?.timeOfDayLowerBound !== undefined && lowerHour === undefined) {
    issues.push('Time lower bound must use a whole hour from 0 to 23.');
  }
  if (rule.predicate?.timeOfDayUpperBound !== undefined && upperHour === undefined) {
    issues.push('Time upper bound must use a whole hour from 0 to 23.');
  }
  if (lowerHour !== undefined && upperHour !== undefined && lowerHour >= upperHour) {
    issues.push('Time lower bound must be earlier than the upper bound. Split overnight windows into separate rules.');
  }
  const lowerDate = dateToInput(rule.predicate?.dateLowerBound);
  const upperDate = dateToInput(rule.predicate?.dateUpperBound);
  if (rule.predicate?.dateLowerBound !== undefined && !lowerDate) issues.push('Date lower bound must be a valid date.');
  if (rule.predicate?.dateUpperBound !== undefined && !upperDate) issues.push('Date upper bound must be a valid date.');
  if (lowerDate && upperDate && lowerDate > upperDate) issues.push('Date lower bound must not be after the upper bound.');
  const lowerAge = durationToDays(rule.predicate?.updateAgeLowerBound);
  const upperAge = durationToDays(rule.predicate?.updateAgeUpperBound);
  if (rule.predicate?.updateAgeLowerBound !== undefined && lowerAge === '') issues.push('Update-age lower bound must be a whole number of days.');
  if (rule.predicate?.updateAgeUpperBound !== undefined && upperAge === '') issues.push('Update-age upper bound must be a whole number of days.');
  if (lowerAge !== '' && upperAge !== '' && lowerAge > upperAge) {
    issues.push('Update-age lower bound must not exceed the upper bound.');
  }
  return issues;
}

export function describeUucRule(rule: UucRule): string {
  const targets = (rule.targets ?? []).map((target) =>
    target.targetType === 'SINGLE_APP' && target.singleApp?.packageName
      ? target.singleApp.packageName
      : PLATFORM_UPDATE_TARGET_LABELS[target.targetType]).filter(Boolean);
  const outcome = rule.outcome?.outcomeType === 'OUTCOME_TYPE_UNSPECIFIED'
    ? 'No outcome selected'
    : rule.outcome?.outcomeType.replace('_', ' ').toLowerCase();
  const conditions: string[] = [];
  if (rule.predicate?.daysOfWeek?.length) conditions.push(rule.predicate.daysOfWeek.join(', '));
  if (rule.predicate?.timeOfDayLowerBound || rule.predicate?.timeOfDayUpperBound) {
    conditions.push(`hours ${rule.predicate.timeOfDayLowerBound?.hours ?? 0}:00 to ${rule.predicate.timeOfDayUpperBound?.hours ?? 23}:00`);
  }
  const lowerDate = dateToInput(rule.predicate?.dateLowerBound);
  const upperDate = dateToInput(rule.predicate?.dateUpperBound);
  if (lowerDate || upperDate) conditions.push(`dates ${lowerDate || 'any'} to ${upperDate || 'any'}`);
  const lowerAge = durationToDays(rule.predicate?.updateAgeLowerBound);
  const upperAge = durationToDays(rule.predicate?.updateAgeUpperBound);
  if (lowerAge !== '' || upperAge !== '') conditions.push(`update age ${lowerAge === '' ? 0 : lowerAge} to ${upperAge === '' ? 'any' : upperAge} days`);
  const stages = rule.stages?.length
    ? ` at ${rule.stages.map((stage) => stage === 'STAGE_DOWNLOAD' ? 'download' : 'apply').join(' and ')}`
    : '';
  return `${outcome} for ${targets.length ? targets.join(', ') : 'no targets'}${stages}${conditions.length ? ` when ${conditions.join(' and ')}` : ' whenever evaluated'}.`;
}

function nextCandidateId(base: string, existing: Set<string>): string {
  let candidate = base.slice(0, 64);
  let suffix = 2;
  while (existing.has(candidate)) {
    const suffixText = `-${suffix}`;
    candidate = `${base.slice(0, 64 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  existing.add(candidate);
  return candidate;
}

export type MigrationPreview = { rules: UucRule[]; warnings: string[] };

export function buildSystemUpdateMigrationCandidates(config: Record<string, unknown>): MigrationPreview {
  const systemUpdate = asRecord(config.systemUpdate);
  if (!systemUpdate) return { rules: [], warnings: ['No system update policy is configured.'] };
  const existingIds = new Set(getUucRules(config).map((rule) => rule.id));
  const targets: UucTarget[] = [
    { targetType: 'OS_UPDATE_WITH_API_LEVEL_CHANGE' },
    { targetType: 'OS_UPDATE_WITHOUT_API_LEVEL_CHANGE' },
  ];
  const type = typeof systemUpdate.type === 'string' ? systemUpdate.type : 'SYSTEM_UPDATE_TYPE_UNSPECIFIED';
  if (type === 'AUTOMATIC') {
    return {
      rules: [{
        id: nextCandidateId('candidate-automatic-os-updates', existingIds),
        targets,
        outcome: { outcomeType: 'FORCE' },
      }],
      warnings: ['FORCE is more assertive than systemUpdate AUTOMATIC. Review download and apply behaviour before adding this candidate.'],
    };
  }
  if (type === 'POSTPONE') {
    return {
      rules: [{
        id: nextCandidateId('candidate-postpone-os-updates', existingIds),
        targets,
        stages: ['STAGE_APPLY'],
        predicate: { updateAgeUpperBound: daysToDuration(30) },
        outcome: { outcomeType: 'BLOCK' },
      }],
      warnings: ['This candidate blocks only the apply stage. UUC maximum deferral varies by target and management mode, and 30 days exceeds the managed maximum for minor OS updates.'],
    };
  }
  if (type === 'WINDOWED') {
    const startMinutes = Number(systemUpdate.startMinutes);
    const endMinutes = Number(systemUpdate.endMinutes);
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
      return { rules: [], warnings: ['The window does not have valid start and end values, so no candidate can be generated.'] };
    }
    if (startMinutes < 0 || startMinutes > 1439 || endMinutes < 0 || endMinutes > 1439) {
      return { rules: [], warnings: ['The window is outside the valid time-of-day range, so no candidate can be generated.'] };
    }
    const windowMinutes = (endMinutes - startMinutes + 1440) % 1440 || 1440;
    const startHour = Math.ceil(startMinutes / 60) % 24;
    const endHour = Math.floor(endMinutes / 60);
    const wholeHourWindow = windowMinutes === 1440 ? 24 : (endHour - startHour + 24) % 24;
    const warnings = [
      'Candidates apply only at STAGE_APPLY. Download timing remains under the update client.',
      'BLOCK outside the candidate window plus FORCE inside it is not identical to systemUpdate WINDOWED. Review reboot and apply behaviour before adding these candidates.',
      'The System update policy window also affects Google Play app update timing; these OEM OS candidates do not recreate that behaviour.',
    ];
    if (startMinutes % 60 !== 0 || endMinutes % 60 !== 0) {
      warnings.unshift('UUC time predicates use whole hours. The candidate window is narrowed to complete hours rather than widened into blocked time.');
    }
    if (wholeHourWindow === 0) {
      return {
        rules: [],
        warnings: [...warnings, 'The maintenance window contains no complete hour after safe rounding, so Flash cannot generate a non-widening candidate.'],
      };
    }
    if (wholeHourWindow === 24) {
      return {
        rules: [{
          id: nextCandidateId('candidate-windowed-os-updates', existingIds),
          targets,
          stages: ['STAGE_APPLY'],
          outcome: { outcomeType: 'FORCE' },
        }],
        warnings: [...warnings, 'The window spans the full day, so the candidate has no time predicate.'],
      };
    }
    const blockedWindows = startHour < endHour
      ? [
          ...(startHour > 0 ? [{ upper: startHour }] : []),
          ...(endHour < 24 ? [{ lower: endHour }] : []),
        ]
      : [{
          ...(endHour > 0 ? { lower: endHour } : {}),
          ...(startHour < 24 ? { upper: startHour } : {}),
        }];
    const blockedRules: UucRule[] = blockedWindows.map((window, index) => ({
      id: nextCandidateId(`candidate-windowed-block-outside-${index + 1}`, existingIds),
      targets: targets.map((target) => ({ ...target })),
      stages: ['STAGE_APPLY'],
      predicate: {
        ...(window.lower !== undefined ? { timeOfDayLowerBound: { hours: window.lower } } : {}),
        ...(window.upper !== undefined ? { timeOfDayUpperBound: { hours: window.upper } } : {}),
      },
      outcome: { outcomeType: 'BLOCK' },
    }));
    return {
      rules: [...blockedRules, {
        id: nextCandidateId('candidate-windowed-force-inside', existingIds),
        targets: targets.map((target) => ({ ...target })),
        stages: ['STAGE_APPLY'],
        outcome: { outcomeType: 'FORCE' },
      }],
      warnings,
    };
  }
  return {
    rules: [],
    warnings: ['The configured system update type has no safe candidate mapping. Build UUC rules manually.'],
  };
}
