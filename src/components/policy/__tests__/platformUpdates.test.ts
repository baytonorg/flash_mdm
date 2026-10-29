import { describe, expect, it } from 'vitest';
import {
  buildSystemUpdateMigrationCandidates,
  daysToDuration,
  describeUucRule,
  durationToDays,
  getEffectiveControlOverview,
  getRuleEditorIssues,
  getRuleEditorWarnings,
  hasConfiguredSystemUpdate,
  isTargetShadowed,
  type UucRule,
} from '@/components/policy/platformUpdates';

describe('platform update policy model', () => {
  it('computes effective control per target and preserves partly effective mixed rules', () => {
    const config = {
      systemUpdate: { type: 'WINDOWED' },
      unifiedUpdatePolicy: {
        rules: [{
          id: 'mixed',
          targets: [
            { targetType: 'OS_UPDATE_WITH_API_LEVEL_CHANGE' },
            { targetType: 'GOOGLE_PLAY_SYSTEM_UPDATE' },
          ],
          outcome: { outcomeType: 'BLOCK' },
        }],
      },
    };
    const overview = getEffectiveControlOverview(config);

    expect(hasConfiguredSystemUpdate(config)).toBe(true);
    expect(isTargetShadowed(config, 'OS_UPDATE_WITH_API_LEVEL_CHANGE')).toBe(true);
    expect(isTargetShadowed(config, 'GOOGLE_PLAY_SYSTEM_UPDATE')).toBe(false);
    expect(overview.find((row) => row.targetType === 'OS_UPDATE_WITH_API_LEVEL_CHANGE')?.control).toBe('systemUpdate');
    expect(overview.find((row) => row.targetType === 'GOOGLE_PLAY_SYSTEM_UPDATE')?.control).toBe('uuc');
    expect(overview.find((row) => row.targetType === 'GOOGLE_SYSTEM_SERVICES')?.control).toBe('default');
  });

  it('round-trips whole-day durations', () => {
    expect(daysToDuration(7)).toBe('604800s');
    expect(daysToDuration(1.5)).toBe('');
    expect(daysToDuration(-1)).toBe('');
    expect(durationToDays('604800s')).toBe(7);
    expect(durationToDays('604800.000000000s')).toBe(7);
    expect(durationToDays('90000s')).toBe('');
    expect(durationToDays('86400.5s')).toBe('');
  });

  it('separates invalid inputs from valid predicates that never match', () => {
    const rules: UucRule[] = [
      {
        id: 'duplicate',
        targets: [{ targetType: 'GOOGLE_PLAY_SYSTEM_UPDATE' }],
        predicate: {
          timeOfDayLowerBound: { hours: 17 },
          timeOfDayUpperBound: { hours: 9 },
          updateAgeLowerBound: '604800s',
          updateAgeUpperBound: '86400s',
        },
        outcome: { outcomeType: 'USER_PROMPT' },
      },
      {
        id: 'duplicate',
        targets: [],
        outcome: { outcomeType: 'OUTCOME_TYPE_UNSPECIFIED' },
      },
    ];

    expect(getRuleEditorIssues(rules[0], 0, rules)).toEqual(expect.arrayContaining([
      'Rule ID must be unique.',
    ]));
    expect(getRuleEditorIssues(rules[0], 0, rules)).not.toEqual(expect.arrayContaining([
      expect.stringContaining('Time lower bound'),
      expect.stringContaining('Update-age lower bound'),
    ]));
    expect(getRuleEditorWarnings(rules[0])).toEqual(expect.arrayContaining([
      expect.stringContaining('User prompt has no effect'),
      expect.stringContaining('time window never matches'),
      expect.stringContaining('update-age range never matches'),
    ]));
    expect(getRuleEditorIssues(rules[1], 1, rules)).toEqual(expect.arrayContaining([
      'Rule ID must be unique.',
      'Choose at least one target.',
      'Choose an outcome.',
    ]));
  });

  it('treats update-age upper bound zero as unbounded', () => {
    const rule: UucRule = {
      id: 'zero-upper-age',
      targets: [{ targetType: 'OS_UPDATE_WITH_API_LEVEL_CHANGE' }],
      predicate: {
        updateAgeLowerBound: '604800s',
        updateAgeUpperBound: '0s',
      },
      outcome: { outcomeType: 'BLOCK' },
    };

    expect(getRuleEditorIssues(rule, 0, [rule])).toHaveLength(0);
    expect(getRuleEditorWarnings(rule)).toContain('An update-age upper bound of 0 is unbounded in UUC. It always evaluates to true.');
    expect(describeUucRule(rule)).toContain('update age 7 to any days');
  });

  it('describes one-sided and exclusive time bounds honestly', () => {
    const lowerOnly: UucRule = {
      id: 'evening',
      targets: [{ targetType: 'OS_UPDATE_WITH_API_LEVEL_CHANGE' }],
      predicate: { timeOfDayLowerBound: { hours: 17 } },
      outcome: { outcomeType: 'BLOCK' },
    };
    const upperOnly: UucRule = {
      ...lowerOnly,
      id: 'morning',
      predicate: { timeOfDayUpperBound: { hours: 9 } },
    };
    const bounded: UucRule = {
      ...lowerOnly,
      id: 'business-hours',
      predicate: { timeOfDayLowerBound: { hours: 9 }, timeOfDayUpperBound: { hours: 17 } },
    };

    expect(describeUucRule(lowerOnly)).toContain('from 17:00 to the end of the day');
    expect(describeUucRule(upperOnly)).toContain('before 09:00');
    expect(describeUucRule(bounded)).toContain('09:00 inclusive to 17:00 exclusive');
  });

  it('mirrors server validation for form-authored package, stage, day, date, and duration values', () => {
    const rule = {
      id: 'invalid-form-values',
      targets: [{ targetType: 'SINGLE_APP', singleApp: { packageName: 'bad package' } }],
      stages: ['STAGE_DOWNLOAD', 'STAGE_DOWNLOAD'],
      predicate: {
        daysOfWeek: ['MONDAY', 'MONDAY'],
        timeOfDayLowerBound: { hours: 9, minutes: 0 },
        dateLowerBound: { year: 2026, month: 2, day: 30 },
        updateAgeLowerBound: '90000s',
      },
      outcome: { outcomeType: 'BLOCK' },
    } as UucRule;

    expect(getRuleEditorIssues(rule, 0, [rule])).toEqual(expect.arrayContaining([
      'Single-app package name is invalid.',
      'Evaluation stages must not contain duplicates.',
      'Days of week must not contain duplicates.',
      'Time lower bound must contain only an hour from 0 to 23. Omit minutes, seconds, and nanos.',
      'Date lower bound must be a valid date.',
      'Update-age lower bound must be a whole number of days.',
    ]));
  });

  it('builds review-only candidates without clearing systemUpdate', () => {
    const config = {
      systemUpdate: { type: 'WINDOWED', startMinutes: 1320, endMinutes: 120 },
      unifiedUpdatePolicy: { rules: [] },
    };
    const preview = buildSystemUpdateMigrationCandidates(config);

    expect(preview.rules).toHaveLength(2);
    expect(preview.rules[0]).toEqual(expect.objectContaining({
      stages: ['STAGE_APPLY'],
      predicate: {
        timeOfDayLowerBound: { hours: 2 },
        timeOfDayUpperBound: { hours: 22 },
      },
      outcome: { outcomeType: 'BLOCK' },
    }));
    expect(preview.rules[1]).toEqual(expect.objectContaining({
      stages: ['STAGE_APPLY'],
      outcome: { outcomeType: 'FORCE' },
    }));
    expect(preview.rules[1]?.predicate).toBeUndefined();
    expect(config.systemUpdate).toEqual({ type: 'WINDOWED', startMinutes: 1320, endMinutes: 120 });
    expect(preview.warnings.some((warning) => warning.includes('not identical'))).toBe(true);
  });

  it('narrows minute-based windows and refuses a window with no complete hour', () => {
    const narrowed = buildSystemUpdateMigrationCandidates({
      systemUpdate: { type: 'WINDOWED', startMinutes: 570, endMinutes: 1050 },
    });
    expect(narrowed.rules).toHaveLength(3);
    expect(narrowed.rules[0]?.predicate).toEqual({ timeOfDayUpperBound: { hours: 10 } });
    expect(narrowed.rules[1]?.predicate).toEqual({ timeOfDayLowerBound: { hours: 17 } });
    expect(narrowed.warnings.some((warning) => warning.includes('narrowed'))).toBe(true);

    const tooShort = buildSystemUpdateMigrationCandidates({
      systemUpdate: { type: 'WINDOWED', startMinutes: 570, endMinutes: 600 },
    });
    expect(tooShort.rules).toHaveLength(0);
    expect(tooShort.warnings.some((warning) => warning.includes('no complete hour'))).toBe(true);
  });
});
