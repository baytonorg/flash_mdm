import { describe, expect, it } from 'vitest';
import {
  buildSystemUpdateMigrationCandidates,
  daysToDuration,
  durationToDays,
  getEffectiveControlOverview,
  getRuleEditorIssues,
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
    expect(durationToDays('90000s')).toBe('');
  });

  it('validates IDs, targets, outcomes, and ordered bounds in the editor', () => {
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
      'User prompt is available only for OEM OS targets.',
      expect.stringContaining('Time lower bound'),
      expect.stringContaining('Update-age lower bound'),
    ]));
    expect(getRuleEditorIssues(rules[1], 1, rules)).toEqual(expect.arrayContaining([
      'Rule ID must be unique.',
      'Choose at least one target.',
      'Choose an outcome.',
    ]));
  });

  it('mirrors server validation for form-authored package, stage, day, date, and duration values', () => {
    const rule = {
      id: 'invalid-form-values',
      targets: [{ targetType: 'SINGLE_APP', singleApp: { packageName: 'bad package' } }],
      stages: ['STAGE_DOWNLOAD', 'STAGE_DOWNLOAD'],
      predicate: {
        daysOfWeek: ['MONDAY', 'MONDAY'],
        dateLowerBound: { year: 2026, month: 2, day: 30 },
        updateAgeLowerBound: '90000s',
      },
      outcome: { outcomeType: 'BLOCK' },
    } as UucRule;

    expect(getRuleEditorIssues(rule, 0, [rule])).toEqual(expect.arrayContaining([
      'Single-app package name is invalid.',
      'Evaluation stages must not contain duplicates.',
      'Days of week must not contain duplicates.',
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
