import { useState } from 'react';
import clsx from 'clsx';
import BooleanField from '@/components/policy/fields/BooleanField';
import SelectField from '@/components/policy/fields/SelectField';
import TextField from '@/components/policy/fields/TextField';
import NumberField from '@/components/policy/fields/NumberField';
import EnumField from '@/components/policy/fields/EnumField';
import RepeaterField from '@/components/policy/fields/RepeaterField';
import JsonField from '@/components/policy/fields/JsonField';
import ManagedConfigEditor from '@/components/apps/ManagedConfigEditor';
import { useAppDetails } from '@/api/queries/apps';
import { useContextStore } from '@/stores/context';

interface PolicyFormSectionProps {
  category: string;
  config: Record<string, any>;
  onChange: (path: string, value: any) => void;
}

/** Helper to read a nested value by dot-separated path. */
function getPath(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((cur, key) => cur?.[key], obj);
}

function asStringArray(value: any): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function uniqueNonEmptyStrings(value: any): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of asStringArray(value)) {
    const v = raw.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function isValidSha256Hex(v: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(v.trim());
}

function normalizeMinutesOfDay(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1439, Math.max(0, Math.floor(n)));
}

function minutesToTimeInput(value: unknown): string {
  const minutes = normalizeMinutesOfDay(value);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function timeInputToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return 0;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(mins)) return 0;
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return 0;
  return hours * 60 + mins;
}

function getMaintenanceWindowDurationMinutes(startValue: unknown, endValue: unknown): number {
  const start = normalizeMinutesOfDay(startValue);
  const end = normalizeMinutesOfDay(endValue);
  if (start === end) return 0;
  return end > start ? end - start : (1440 - start) + end;
}

const FREEZE_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const FREEZE_DAYS_PER_MONTH_NON_LEAP = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

type FreezePeriodEditorItem = {
  startMonth: number;
  startDay: number;
  durationDays: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFreezeMonth(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(12, Math.max(1, Math.floor(n)));
}

function getFreezeDaysInMonth(month: number): number {
  return FREEZE_DAYS_PER_MONTH_NON_LEAP[normalizeFreezeMonth(month) - 1] ?? 31;
}

function normalizeFreezeDay(value: unknown, month: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  const max = getFreezeDaysInMonth(month);
  return Math.min(max, Math.max(1, Math.floor(n)));
}

function normalizeFreezeDurationDays(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(90, Math.max(1, Math.floor(n)));
}

function toFreezeOrdinal(month: number, day: number): number {
  const safeMonth = normalizeFreezeMonth(month);
  const safeDay = normalizeFreezeDay(day, safeMonth);
  let ordinal = safeDay;
  for (let i = 0; i < safeMonth - 1; i += 1) {
    ordinal += FREEZE_DAYS_PER_MONTH_NON_LEAP[i] ?? 0;
  }
  return ordinal;
}

function fromFreezeOrdinal(ordinalInput: number): { month: number; day: number } {
  const safeOrdinal = ((Math.floor(ordinalInput) - 1 + 365) % 365) + 1;
  let remaining = safeOrdinal;
  for (let month = 1; month <= 12; month += 1) {
    const days = getFreezeDaysInMonth(month);
    if (remaining <= days) return { month, day: remaining };
    remaining -= days;
  }
  return { month: 12, day: 31 };
}

function readFreezeMonthDay(value: unknown): { month: number; day: number } | null {
  if (!isPlainObject(value)) return null;
  const monthRaw = value.month;
  const dayRaw = value.day ?? value.date;
  if (typeof monthRaw !== 'number' || typeof dayRaw !== 'number') return null;
  if (!Number.isInteger(monthRaw) || !Number.isInteger(dayRaw)) return null;
  if (monthRaw < 1 || monthRaw > 12) return null;
  const maxDays = getFreezeDaysInMonth(monthRaw);
  if (dayRaw < 1 || dayRaw > maxDays) return null;
  return { month: monthRaw, day: dayRaw };
}

function getFreezeDurationDays(start: { month: number; day: number }, end: { month: number; day: number }): number {
  const startOrdinal = toFreezeOrdinal(start.month, start.day);
  const endOrdinal = toFreezeOrdinal(end.month, end.day);
  return ((endOrdinal - startOrdinal + 365) % 365) + 1;
}

function normalizeFreezeEditorItem(value: unknown): FreezePeriodEditorItem {
  if (!isPlainObject(value)) {
    return { startMonth: 1, startDay: 1, durationDays: 30 };
  }
  const startMonth = normalizeFreezeMonth(value.startMonth);
  const startDay = normalizeFreezeDay(value.startDay, startMonth);
  const durationDays = normalizeFreezeDurationDays(value.durationDays);
  return { startMonth, startDay, durationDays };
}

function policyFreezePeriodToEditorItem(value: unknown): FreezePeriodEditorItem {
  if (!isPlainObject(value)) {
    return { startMonth: 1, startDay: 1, durationDays: 30 };
  }
  const start = readFreezeMonthDay(value.startDate);
  const end = readFreezeMonthDay(value.endDate);
  if (!start) {
    return { startMonth: 1, startDay: 1, durationDays: 30 };
  }
  const durationDays = end
    ? normalizeFreezeDurationDays(getFreezeDurationDays(start, end))
    : 30;
  return {
    startMonth: start.month,
    startDay: start.day,
    durationDays,
  };
}

function editorItemToPolicyFreezePeriod(item: FreezePeriodEditorItem): { startDate: { month: number; day: number }; endDate: { month: number; day: number } } {
  const normalized = normalizeFreezeEditorItem(item);
  const startOrdinal = toFreezeOrdinal(normalized.startMonth, normalized.startDay);
  const endOrdinal = ((startOrdinal - 1) + (normalized.durationDays - 1)) % 365 + 1;
  const end = fromFreezeOrdinal(endOrdinal);
  return {
    startDate: {
      month: normalized.startMonth,
      day: normalized.startDay,
    },
    endDate: {
      month: end.month,
      day: end.day,
    },
  };
}

type PasswordPolicyRow = Record<string, any>;

function PolicyAppManagedConfigSection({
  item,
  onItemChange,
}: {
  item: Record<string, any>;
  onItemChange: (next: Record<string, any>) => void;
}) {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const activeEnvironment = useContextStore((s) => s.activeEnvironment);
  const packageName = typeof item.packageName === 'string' ? item.packageName.trim() : '';
  const { data: appDetail, isLoading } = useAppDetails(activeEnvironment?.id, packageName || undefined);
  const managedSchema = appDetail?.managed_properties ?? [];
  const hasSchema = managedSchema.length > 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h5 className="text-sm font-semibold text-gray-900">Managed Configuration</h5>
          <p className="text-xs text-gray-500">
            {packageName
              ? hasSchema
                ? `Generated form from ${managedSchema.length} managed propert${managedSchema.length === 1 ? 'y' : 'ies'}`
                : isLoading
                  ? 'Loading managed properties from app details...'
                  : 'No managed properties found for this package. Use JSON if needed.'
              : 'Enter a package name to load app managed properties and generate a form.'}
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setMode('form')}
            className={clsx(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              mode === 'form' ? 'bg-accent text-white' : 'text-gray-600 hover:text-gray-900'
            )}
          >
            Form
          </button>
          <button
            type="button"
            onClick={() => setMode('json')}
            className={clsx(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              mode === 'json' ? 'bg-accent text-white' : 'text-gray-600 hover:text-gray-900'
            )}
          >
            JSON
          </button>
        </div>
      </div>

      {mode === 'form' ? (
        hasSchema ? (
          <div className="rounded-lg border border-gray-200 bg-white p-3 max-h-[28rem] overflow-y-auto">
            <ManagedConfigEditor
              schema={managedSchema}
              value={(item.managedConfiguration && typeof item.managedConfiguration === 'object' && !Array.isArray(item.managedConfiguration))
                ? item.managedConfiguration
                : {}}
              onChange={(v) => onItemChange({ ...item, managedConfiguration: v })}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white px-3 py-4 text-xs text-gray-500">
            {packageName
              ? 'Managed properties are unavailable for this app package in the current environment.'
              : 'Add a package name to load managed properties for a generated form.'}
          </div>
        )
      ) : (
        <JsonField
          label="Managed Configuration (JSON)"
          description="App-managed configuration object. Keys/values must match the app's managed config schema."
          value={item.managedConfiguration}
          onChange={(v) => onItemChange({ ...item, managedConfiguration: v })}
          kind="object"
          rows={8}
        />
      )}
    </div>
  );
}

const PASSWORD_COMPLEXITY_QUALITIES = new Set([
  'COMPLEXITY_LOW',
  'COMPLEXITY_MEDIUM',
  'COMPLEXITY_HIGH',
]);

const PASSWORD_COMPLEX_COUNTER_KEYS = [
  'passwordMinimumLetters',
  'passwordMinimumNonLetter',
  'passwordMinimumLowerCase',
  'passwordMinimumUpperCase',
  'passwordMinimumNumeric',
  'passwordMinimumSymbols',
] as const;

function createPasswordPolicyRow(overrides: Partial<PasswordPolicyRow> = {}): PasswordPolicyRow {
  return {
    passwordScope: 'SCOPE_DEVICE',
    passwordQuality: 'PASSWORD_QUALITY_UNSPECIFIED',
    requirePasswordUnlock: 'REQUIRE_PASSWORD_UNLOCK_UNSPECIFIED',
    unifiedLockSettings: 'UNIFIED_LOCK_SETTINGS_UNSPECIFIED',
    passwordMinimumLength: 0,
    passwordHistoryLength: 0,
    maximumFailedPasswordsForWipe: 0,
    ...overrides,
  };
}

function buildPasswordFallbackPair(scope: 'SCOPE_DEVICE' | 'SCOPE_PROFILE'): PasswordPolicyRow[] {
  return [
    createPasswordPolicyRow({
      passwordScope: scope,
      passwordQuality: 'ALPHANUMERIC',
    }),
    createPasswordPolicyRow({
      passwordScope: scope,
      passwordQuality: 'COMPLEXITY_MEDIUM',
    }),
  ];
}

function getPasswordFallbackPairState(rowsInput: unknown, scope: 'SCOPE_DEVICE' | 'SCOPE_PROFILE'): {
  hasComplexityRow: boolean;
  hasNonComplexityRow: boolean;
  missingRows: PasswordPolicyRow[];
  isComplete: boolean;
} {
  const rows = Array.isArray(rowsInput) ? (rowsInput as PasswordPolicyRow[]) : [];
  let hasComplexityRow = false;
  let hasNonComplexityRow = false;

  for (const row of rows) {
    if (getPasswordRowScope(row) !== scope) continue;
    const quality = getPasswordRowQuality(row);
    if (isComplexityBasedPasswordQuality(quality)) hasComplexityRow = true;
    else hasNonComplexityRow = true;
  }

  const missingRows: PasswordPolicyRow[] = [];
  if (!hasNonComplexityRow) {
    missingRows.push(createPasswordPolicyRow({
      passwordScope: scope,
      passwordQuality: 'ALPHANUMERIC',
    }));
  }
  if (!hasComplexityRow) {
    missingRows.push(createPasswordPolicyRow({
      passwordScope: scope,
      passwordQuality: 'COMPLEXITY_MEDIUM',
    }));
  }

  return {
    hasComplexityRow,
    hasNonComplexityRow,
    missingRows,
    isComplete: hasComplexityRow && hasNonComplexityRow,
  };
}

function isComplexityBasedPasswordQuality(value: unknown): boolean {
  return typeof value === 'string' && PASSWORD_COMPLEXITY_QUALITIES.has(value);
}

function isComplexPasswordQuality(value: unknown): boolean {
  return value === 'COMPLEX';
}

function getPasswordRowScope(row: PasswordPolicyRow): string {
  return typeof row?.passwordScope === 'string' ? row.passwordScope : 'SCOPE_UNSPECIFIED';
}

function getPasswordRowQuality(row: PasswordPolicyRow): string {
  return typeof row?.passwordQuality === 'string' ? row.passwordQuality : 'PASSWORD_QUALITY_UNSPECIFIED';
}

function countComplexCounterValues(row: PasswordPolicyRow): number {
  return PASSWORD_COMPLEX_COUNTER_KEYS.reduce((sum, key) => {
    const v = Number(row?.[key] ?? 0);
    return sum + (Number.isFinite(v) && v > 0 ? v : 0);
  }, 0);
}

function validatePasswordPolicies(rowsInput: unknown): {
  summaryErrors: string[];
  rowErrors: Record<number, string[]>;
  rowHints: Record<number, string[]>;
} {
  const rows = Array.isArray(rowsInput) ? rowsInput as PasswordPolicyRow[] : [];
  const rowErrors: Record<number, string[]> = {};
  const rowHints: Record<number, string[]> = {};
  const summaryErrors: string[] = [];

  const scopeStats: Record<'SCOPE_DEVICE' | 'SCOPE_PROFILE', { complexity: number[]; nonComplexity: number[]; any: number[] }> = {
    SCOPE_DEVICE: { complexity: [], nonComplexity: [], any: [] },
    SCOPE_PROFILE: { complexity: [], nonComplexity: [], any: [] },
  };

  rows.forEach((row, index) => {
    const scope = getPasswordRowScope(row);
    const quality = getPasswordRowQuality(row);
    const complexityBased = isComplexityBasedPasswordQuality(quality);
    const unifiedLockSettings = typeof row?.unifiedLockSettings === 'string'
      ? row.unifiedLockSettings
      : 'UNIFIED_LOCK_SETTINGS_UNSPECIFIED';

    if (scope === 'SCOPE_UNSPECIFIED') {
      (rowErrors[index] ??= []).push('Choose an explicit scope (Device or Work Profile). Fallback pairing is scope-specific.');
    }

    if (unifiedLockSettings !== 'UNIFIED_LOCK_SETTINGS_UNSPECIFIED' && scope !== 'SCOPE_PROFILE') {
      (rowErrors[index] ??= []).push('Unified lock settings are only valid for SCOPE_PROFILE.');
    }

    if (complexityBased && countComplexCounterValues(row) > 0) {
      (rowHints[index] ??= []).push('Complexity-based rows ignore the Min Letters/Numbers/Symbols counters.');
    }

    if (scope === 'SCOPE_DEVICE' || scope === 'SCOPE_PROFILE') {
      scopeStats[scope].any.push(index);
      if (complexityBased) scopeStats[scope].complexity.push(index);
      else scopeStats[scope].nonComplexity.push(index);
    }
  });

  for (const scope of ['SCOPE_DEVICE', 'SCOPE_PROFILE'] as const) {
    const stats = scopeStats[scope];
    if (stats.complexity.length > 0 && stats.nonComplexity.length === 0) {
      summaryErrors.push(`${scope}: complexity-based rows require a paired non-complexity row for fallback behaviour.`);
      for (const idx of stats.complexity) {
        (rowErrors[idx] ??= []).push('Add a non-complexity row for this same scope (fallback pair requirement).');
      }
    }
  }

  const profileHasComplexity = scopeStats.SCOPE_PROFILE.complexity.length > 0;
  const hasAnyDeviceRows = scopeStats.SCOPE_DEVICE.any.length > 0;
  if (profileHasComplexity && hasAnyDeviceRows) {
    if (scopeStats.SCOPE_DEVICE.complexity.length === 0) {
      summaryErrors.push('When using a profile complexity row and any device-scoped rows, add a device-scoped complexity row as well.');
      for (const idx of scopeStats.SCOPE_DEVICE.any) {
        (rowErrors[idx] ??= []).push('Device scope also needs a complexity-based row when profile complexity is configured.');
      }
    }
    if (scopeStats.SCOPE_DEVICE.nonComplexity.length === 0) {
      summaryErrors.push('When using a profile complexity row and any device-scoped rows, add a device-scoped non-complexity row as well.');
      for (const idx of scopeStats.SCOPE_DEVICE.any) {
        (rowErrors[idx] ??= []).push('Device scope also needs a non-complexity row when profile complexity is configured.');
      }
    }
  }

  return { summaryErrors, rowErrors, rowHints };
}

function sanitizeLegacyPasswordRequirementsForMigration(value: unknown): PasswordPolicyRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const legacy = value as Record<string, unknown>;
  const row = createPasswordPolicyRow({ passwordScope: 'SCOPE_DEVICE' });

  const quality = typeof legacy.passwordQuality === 'string' ? legacy.passwordQuality : undefined;
  if (quality && !PASSWORD_COMPLEXITY_QUALITIES.has(quality)) {
    row.passwordQuality = quality;
  }

  const stringFields = ['passwordExpirationTimeout'] as const;
  for (const key of stringFields) {
    if (typeof legacy[key] === 'string') row[key] = legacy[key];
  }

  const numberFields = [
    'passwordMinimumLength',
    'passwordHistoryLength',
    'maximumFailedPasswordsForWipe',
    'passwordMinimumLetters',
    'passwordMinimumNonLetter',
    'passwordMinimumLowerCase',
    'passwordMinimumUpperCase',
    'passwordMinimumNumeric',
    'passwordMinimumSymbols',
  ] as const;
  for (const key of numberFields) {
    const v = legacy[key];
    if (typeof v === 'number' && Number.isFinite(v)) row[key] = v;
  }

  row.requirePasswordUnlock = 'REQUIRE_PASSWORD_UNLOCK_UNSPECIFIED';
  row.unifiedLockSettings = 'UNIFIED_LOCK_SETTINGS_UNSPECIFIED';

  return row;
}

export default function PolicyFormSection({ category, config, onChange }: PolicyFormSectionProps) {
  switch (category) {
    // ---------------------------------------------------------------
    // PASSWORD REQUIREMENTS
    // ---------------------------------------------------------------
    case 'password': {
      const passwordPolicies = Array.isArray(getPath(config, 'passwordPolicies'))
        ? (getPath(config, 'passwordPolicies') as PasswordPolicyRow[])
        : [];
      const legacyPasswordRequirements = getPath(config, 'passwordRequirements');
      const hasLegacyPasswordRequirements =
        !!legacyPasswordRequirements &&
        typeof legacyPasswordRequirements === 'object' &&
        !Array.isArray(legacyPasswordRequirements);
      const passwordValidation = validatePasswordPolicies(passwordPolicies);
      const deviceFallbackPair = getPasswordFallbackPairState(passwordPolicies, 'SCOPE_DEVICE');
      const profileFallbackPair = getPasswordFallbackPairState(passwordPolicies, 'SCOPE_PROFILE');

      return (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Password Requirements</h3>
          <p className="text-sm text-gray-500 mb-6">Configure password policies for the device or work profile.</p>
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <p className="font-medium">Android 12+ fallback pairing</p>
            <p className="mt-1">
              Duplicate scopes are expected when using fallback behaviour. Configure a same-scope pair with one
              non-complexity quality row (for older/quality-based behaviour) and one complexity-based row
              (`COMPLEXITY_LOW/MEDIUM/HIGH`) for newer devices.
            </p>
            <p className="mt-1">
              Work profile behaviour differs between company-owned and personally-owned devices. Validate on real
              devices using reported `appliedPasswordPolicies`.
            </p>
          </div>

          {hasLegacyPasswordRequirements && (
            <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">Legacy `passwordRequirements` detected</p>
                  <p className="text-xs text-gray-600">
                    Compatibility-only view. AMAPI still supports this with restrictions; new authoring should use `passwordPolicies`.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const migrated = sanitizeLegacyPasswordRequirementsForMigration(legacyPasswordRequirements);
                    if (!migrated) return;
                    onChange('passwordPolicies', [...passwordPolicies, migrated]);
                  }}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  Migrate to passwordPolicies
                </button>
              </div>
              <pre className="mt-3 max-h-48 overflow-auto rounded border border-gray-200 bg-white p-2 text-xs text-gray-700">
{JSON.stringify(legacyPasswordRequirements, null, 2)}
              </pre>
            </div>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (deviceFallbackPair.missingRows.length === 0) return;
                onChange('passwordPolicies', [...passwordPolicies, ...deviceFallbackPair.missingRows]);
              }}
              disabled={deviceFallbackPair.isComplete}
              className={clsx(
                'rounded-lg px-3 py-1.5 text-xs font-medium',
                deviceFallbackPair.isComplete
                  ? 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
                  : 'border border-dashed border-gray-300 text-gray-700 hover:border-accent hover:text-accent'
              )}
            >
              {deviceFallbackPair.isComplete
                ? 'Device Fallback Pair Added'
                : deviceFallbackPair.missingRows.length === 1
                  ? 'Add Missing Device Fallback Row'
                  : 'Generate Device Fallback Pair'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (profileFallbackPair.missingRows.length === 0) return;
                onChange('passwordPolicies', [...passwordPolicies, ...profileFallbackPair.missingRows]);
              }}
              disabled={profileFallbackPair.isComplete}
              className={clsx(
                'rounded-lg px-3 py-1.5 text-xs font-medium',
                profileFallbackPair.isComplete
                  ? 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
                  : 'border border-dashed border-gray-300 text-gray-700 hover:border-accent hover:text-accent'
              )}
            >
              {profileFallbackPair.isComplete
                ? 'Work Profile Fallback Pair Added'
                : profileFallbackPair.missingRows.length === 1
                  ? 'Add Missing Work Profile Fallback Row'
                  : 'Generate Work Profile Fallback Pair'}
            </button>
          </div>

          {passwordValidation.summaryErrors.length > 0 && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-medium text-red-800">Password policy validation</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-red-700">
                {passwordValidation.summaryErrors.map((msg, idx) => (
                  <li key={idx}>{msg}</li>
                ))}
              </ul>
            </div>
          )}

          <RepeaterField
            label="Password Policies (Scoped)"
            description="Scoped password policies. Duplicate scopes are valid and often required for fallback pairs (quality-based + complexity-based)."
            value={passwordPolicies}
            onChange={(v) => onChange('passwordPolicies', v)}
            defaultItem={createPasswordPolicyRow()}
            renderItem={(item, index, onItemChange) => {
              const scope = getPasswordRowScope(item);
              const quality = getPasswordRowQuality(item);
              const isComplexityBand = isComplexityBasedPasswordQuality(quality);
              const isComplex = isComplexPasswordQuality(quality);
              const rowErrors = passwordValidation.rowErrors[index] ?? [];
              const rowHints = passwordValidation.rowHints[index] ?? [];

              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-gray-500">Row {index + 1}</p>
                    <span className="text-xs text-gray-400">
                      {isComplexityBand ? 'Complexity-based' : 'Quality-based'}
                    </span>
                  </div>
                  {rowErrors.length > 0 && (
                    <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
                      {rowErrors.map((msg, i) => (
                        <p key={i}>{msg}</p>
                      ))}
                    </div>
                  )}
                  {rowHints.length > 0 && (
                    <div className="rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-blue-700">
                      {rowHints.map((msg, i) => (
                        <p key={i}>{msg}</p>
                      ))}
                    </div>
                  )}
                <SelectField
                  label="Password Scope"
                  value={scope}
                  onChange={(v) =>
                    onItemChange({
                      ...item,
                      passwordScope: v,
                      unifiedLockSettings:
                        v === 'SCOPE_PROFILE'
                          ? (item.unifiedLockSettings ?? 'UNIFIED_LOCK_SETTINGS_UNSPECIFIED')
                          : 'UNIFIED_LOCK_SETTINGS_UNSPECIFIED',
                    })}
                  options={[
                    { value: 'SCOPE_UNSPECIFIED', label: 'Unspecified (default by mode)' },
                    { value: 'SCOPE_DEVICE', label: 'Device' },
                    { value: 'SCOPE_PROFILE', label: 'Work Profile' },
                  ]}
                />
                <SelectField
                  label="Password Quality"
                  value={quality}
                  onChange={(v) => onItemChange({ ...item, passwordQuality: v })}
                  options={[
                    { value: 'PASSWORD_QUALITY_UNSPECIFIED', label: 'Unspecified' },
                    { value: 'BIOMETRIC_WEAK', label: 'Biometric (Weak)' },
                    { value: 'SOMETHING', label: 'Something' },
                    { value: 'NUMERIC', label: 'Numeric' },
                    { value: 'NUMERIC_COMPLEX', label: 'Numeric Complex' },
                    { value: 'ALPHABETIC', label: 'Alphabetic' },
                    { value: 'ALPHANUMERIC', label: 'Alphanumeric' },
                    { value: 'COMPLEX', label: 'Complex' },
                    { value: 'COMPLEXITY_LOW', label: 'Complexity Low' },
                    { value: 'COMPLEXITY_MEDIUM', label: 'Complexity Medium' },
                    { value: 'COMPLEXITY_HIGH', label: 'Complexity High' },
                  ]}
                />
                {scope === 'SCOPE_PROFILE' ? (
                  <SelectField
                    label="Unified Lock Settings"
                    value={item.unifiedLockSettings ?? 'UNIFIED_LOCK_SETTINGS_UNSPECIFIED'}
                    onChange={(v) => onItemChange({ ...item, unifiedLockSettings: v })}
                    options={[
                      { value: 'UNIFIED_LOCK_SETTINGS_UNSPECIFIED', label: 'Unspecified' },
                      { value: 'ALLOW_UNIFIED_WORK_AND_PERSONAL_LOCK', label: 'Allow Unified Lock' },
                      { value: 'REQUIRE_SEPARATE_WORK_LOCK', label: 'Require Separate Work Lock' },
                    ]}
                  />
                ) : (
                  <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    `unifiedLockSettings` only applies to `SCOPE_PROFILE`.
                  </div>
                )}
                <SelectField
                  label="Require Password Unlock"
                  value={item.requirePasswordUnlock ?? 'REQUIRE_PASSWORD_UNLOCK_UNSPECIFIED'}
                  onChange={(v) => onItemChange({ ...item, requirePasswordUnlock: v })}
                  options={[
                    { value: 'REQUIRE_PASSWORD_UNLOCK_UNSPECIFIED', label: 'Unspecified' },
                    { value: 'USE_DEFAULT_DEVICE_TIMEOUT', label: 'Device Default' },
                    { value: 'REQUIRE_EVERY_DAY', label: 'Every Day' },
                  ]}
                />
                <TextField
                  label="Password Expiration Timeout"
                  value={item.passwordExpirationTimeout ?? ''}
                  onChange={(v) => onItemChange({ ...item, passwordExpirationTimeout: v })}
                  placeholder="e.g. 7776000s"
                />
                <NumberField
                  label="Minimum Length"
                  value={item.passwordMinimumLength ?? 0}
                  onChange={(v) => onItemChange({ ...item, passwordMinimumLength: v })}
                  min={0}
                  max={64}
                />
                <NumberField
                  label="History Length"
                  value={item.passwordHistoryLength ?? 0}
                  onChange={(v) => onItemChange({ ...item, passwordHistoryLength: v })}
                  min={0}
                  max={100}
                />
                <NumberField
                  label="Max Failed Passwords For Wipe"
                  value={item.maximumFailedPasswordsForWipe ?? 0}
                  onChange={(v) => onItemChange({ ...item, maximumFailedPasswordsForWipe: v })}
                    min={0}
                    max={100}
                  />
                {isComplex ? (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <NumberField
                      label="Min Letters"
                      value={item.passwordMinimumLetters ?? 0}
                      onChange={(v) => onItemChange({ ...item, passwordMinimumLetters: v })}
                      min={0}
                      max={64}
                    />
                    <NumberField
                      label="Min Non-Letter"
                      value={item.passwordMinimumNonLetter ?? 0}
                      onChange={(v) => onItemChange({ ...item, passwordMinimumNonLetter: v })}
                      min={0}
                      max={64}
                    />
                    <NumberField
                      label="Min Lowercase"
                      value={item.passwordMinimumLowerCase ?? 0}
                      onChange={(v) => onItemChange({ ...item, passwordMinimumLowerCase: v })}
                      min={0}
                      max={64}
                    />
                    <NumberField
                      label="Min Uppercase"
                      value={item.passwordMinimumUpperCase ?? 0}
                      onChange={(v) => onItemChange({ ...item, passwordMinimumUpperCase: v })}
                      min={0}
                      max={64}
                    />
                    <NumberField
                      label="Min Numeric"
                      value={item.passwordMinimumNumeric ?? 0}
                      onChange={(v) => onItemChange({ ...item, passwordMinimumNumeric: v })}
                      min={0}
                      max={64}
                    />
                    <NumberField
                      label="Min Symbols"
                      value={item.passwordMinimumSymbols ?? 0}
                      onChange={(v) => onItemChange({ ...item, passwordMinimumSymbols: v })}
                      min={0}
                      max={64}
                    />
                  </div>
                ) : isComplexityBand ? (
                  <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    Complexity-based rows ignore the `passwordMinimumLetters` / `Numeric` / `Symbols` counters.
                    Use the complexity level and shared fields above.
                  </div>
                ) : null}
                </div>
              );
            }}
          />
          <p className="mt-2 text-xs text-gray-500">
            Enforcement can vary by Android version, management mode, and ownership model. Confirm the effective result
            on-device using reported `appliedPasswordPolicies`.
          </p>
        </div>
      );
    }

    // ---------------------------------------------------------------
    // SCREEN LOCK
    // ---------------------------------------------------------------
    case 'screenLock':
      return (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Screen Lock</h3>
          <p className="text-sm text-gray-500 mb-6">Control screen lock timeout and related settings.</p>

          <NumberField
            label="Maximum Time to Lock (seconds)"
            description="Maximum time in seconds before the screen is automatically locked."
            value={getPath(config, 'maximumTimeToLock') ?? 0}
            onChange={(v) => onChange('maximumTimeToLock', v)}
            min={0}
          />
          <BooleanField
            label="Keyguard Disabled (Dedicated)"
            description="Disable the lock screen on dedicated devices."
            value={getPath(config, 'keyguardDisabled') ?? false}
            onChange={(v) => onChange('keyguardDisabled', v)}
          />
          <BooleanField
            label="Stay On While Plugged In"
            description="Keep the screen on while the device is plugged in."
            value={(getPath(config, 'stayOnPluggedModes') ?? []).length > 0}
            onChange={(v) => onChange('stayOnPluggedModes', v ? ['AC', 'USB', 'WIRELESS'] : [])}
          />
          <TextField
            label="Lock Screen Owner Message"
            description="Device owner text shown on the lock screen."
            value={getPath(config, 'deviceOwnerLockScreenInfo.defaultMessage') ?? ''}
            onChange={(v) => onChange('deviceOwnerLockScreenInfo.defaultMessage', v)}
            placeholder="If found, contact IT..."
          />
          <EnumField
            label="Screen Timeout Mode"
            description="Controls whether the user can change screen timeout."
            value={getPath(config, 'displaySettings.screenTimeoutSettings.screenTimeoutMode') ?? 'SCREEN_TIMEOUT_MODE_UNSPECIFIED'}
            onChange={(v) => onChange('displaySettings.screenTimeoutSettings.screenTimeoutMode', v)}
            options={[
              { value: 'SCREEN_TIMEOUT_MODE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'SCREEN_TIMEOUT_USER_CHOICE', label: 'User Choice' },
              { value: 'SCREEN_TIMEOUT_ENFORCED', label: 'Enforced' },
            ]}
          />
          <TextField
            label="Screen Timeout Duration"
            description="Duration string for enforced screen timeout (for example 30s, 2m)."
            value={getPath(config, 'displaySettings.screenTimeoutSettings.screenTimeout') ?? ''}
            onChange={(v) => onChange('displaySettings.screenTimeoutSettings.screenTimeout', v)}
            placeholder="e.g. 30s"
          />
          <EnumField
            label="Screen Brightness Mode"
            description="Controls whether brightness is user-controlled, automatic, or fixed."
            value={getPath(config, 'displaySettings.screenBrightnessSettings.screenBrightnessMode') ?? 'SCREEN_BRIGHTNESS_MODE_UNSPECIFIED'}
            onChange={(v) => onChange('displaySettings.screenBrightnessSettings.screenBrightnessMode', v)}
            options={[
              { value: 'SCREEN_BRIGHTNESS_MODE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'BRIGHTNESS_USER_CHOICE', label: 'User Choice' },
              { value: 'BRIGHTNESS_AUTOMATIC', label: 'Automatic' },
              { value: 'BRIGHTNESS_FIXED', label: 'Fixed' },
            ]}
          />
          <NumberField
            label="Screen Brightness (1-255)"
            description="Used with automatic/fixed brightness modes. 0 leaves brightness unset."
            value={getPath(config, 'displaySettings.screenBrightnessSettings.screenBrightness') ?? 0}
            onChange={(v) => onChange('displaySettings.screenBrightnessSettings.screenBrightness', v)}
            min={0}
            max={255}
          />
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">Keyguard Disabled Features</label>
            <p className="text-xs text-gray-500 mb-3">Select lock screen features to disable. Multiple can be selected.</p>
            <div className="space-y-2">
              {[
                { value: 'CAMERA', label: 'Camera' },
                { value: 'NOTIFICATIONS', label: 'Notifications' },
                { value: 'UNREDACTED_NOTIFICATIONS', label: 'Unredacted Notifications' },
                { value: 'TRUST_AGENTS', label: 'Trust Agents' },
                { value: 'DISABLE_FINGERPRINT', label: 'Fingerprint' },
                { value: 'DISABLE_FACE', label: 'Face Unlock' },
                { value: 'DISABLE_IRIS', label: 'Iris' },
                { value: 'ALL_FEATURES', label: 'All Features' },
              ].map((opt) => {
                const current: string[] = getPath(config, 'keyguardDisabledFeatures') ?? [];
                const arr = Array.isArray(current) ? current : [];
                const checked = arr.includes(opt.value);
                return (
                  <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...arr, opt.value]
                          : arr.filter((v: string) => v !== opt.value);
                        onChange('keyguardDisabledFeatures', next.length > 0 ? next : []);
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      );

    // ---------------------------------------------------------------
    // DEVICE SETTINGS
    // ---------------------------------------------------------------
    case 'deviceSettings':
      return (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Device Settings</h3>
          <p className="text-sm text-gray-500 mb-6">Control general device configurations and restrictions.</p>

          <BooleanField
            label="Screen Capture Disabled"
            description="Prevent users from taking screenshots."
            value={getPath(config, 'screenCaptureDisabled') ?? false}
            onChange={(v) => onChange('screenCaptureDisabled', v)}
          />
          <BooleanField
            label="Factory Reset Disabled"
            description="Prevent factory reset from settings."
            value={getPath(config, 'factoryResetDisabled') ?? false}
            onChange={(v) => onChange('factoryResetDisabled', v)}
          />
          <BooleanField
            label="Add User Disabled"
            description="Prevent adding new users or profiles."
            value={getPath(config, 'addUserDisabled') ?? false}
            onChange={(v) => onChange('addUserDisabled', v)}
          />
          <BooleanField
            label="Remove User Disabled"
            description="Prevent removing other users."
            value={getPath(config, 'removeUserDisabled') ?? false}
            onChange={(v) => onChange('removeUserDisabled', v)}
          />
          <BooleanField
            label="Modify Accounts Disabled"
            description="Prevent adding or removing accounts."
            value={getPath(config, 'modifyAccountsDisabled') ?? false}
            onChange={(v) => onChange('modifyAccountsDisabled', v)}
          />
          <BooleanField
            label="Bluetooth Disabled"
            description="Disable Bluetooth entirely."
            value={getPath(config, 'bluetoothDisabled') ?? false}
            onChange={(v) => onChange('bluetoothDisabled', v)}
          />
          <BooleanField
            label="Bluetooth Config Disabled"
            description="Prevent changing Bluetooth settings."
            value={getPath(config, 'bluetoothConfigDisabled') ?? false}
            onChange={(v) => onChange('bluetoothConfigDisabled', v)}
          />
          <BooleanField
            label="Bluetooth Contact Sharing Disabled"
            description="Disable Bluetooth contact sharing."
            value={getPath(config, 'bluetoothContactSharingDisabled') ?? false}
            onChange={(v) => onChange('bluetoothContactSharingDisabled', v)}
          />
          <BooleanField
            label="Mount Physical Media Disabled"
            description="Prevent mounting physical external media (SD cards, USB drives)."
            value={getPath(config, 'mountPhysicalMediaDisabled') ?? false}
            onChange={(v) => onChange('mountPhysicalMediaDisabled', v)}
          />
          <BooleanField
            label="Credentials Config Disabled"
            description="Prevent users from configuring credentials."
            value={getPath(config, 'credentialsConfigDisabled') ?? false}
            onChange={(v) => onChange('credentialsConfigDisabled', v)}
          />
          <BooleanField
            label="Create Windows Disabled"
            description="Prevent creating windows other than app windows."
            value={getPath(config, 'createWindowsDisabled') ?? false}
            onChange={(v) => onChange('createWindowsDisabled', v)}
          />
          <BooleanField
            label="Set User Icon Disabled"
            description="Prevent changing the user icon."
            value={getPath(config, 'setUserIconDisabled') ?? false}
            onChange={(v) => onChange('setUserIconDisabled', v)}
          />
          <BooleanField
            label="Skip First Use Hints"
            description="Skip showing first-time use hints and tutorials."
            value={getPath(config, 'skipFirstUseHintsEnabled') ?? false}
            onChange={(v) => onChange('skipFirstUseHintsEnabled', v)}
          />
          <BooleanField
            label="Adjust Volume Disabled"
            description="Prevent adjusting device volume."
            value={getPath(config, 'adjustVolumeDisabled') ?? false}
            onChange={(v) => onChange('adjustVolumeDisabled', v)}
          />
          <BooleanField
            label="Set Wallpaper Disabled"
            description="Prevent changing the wallpaper."
            value={getPath(config, 'setWallpaperDisabled') ?? false}
            onChange={(v) => onChange('setWallpaperDisabled', v)}
          />
          <BooleanField
            label="Outgoing Calls Disabled"
            description="Disable outgoing phone calls."
            value={getPath(config, 'outgoingCallsDisabled') ?? false}
            onChange={(v) => onChange('outgoingCallsDisabled', v)}
          />
          <BooleanField
            label="SMS Disabled"
            description="Disable sending and receiving SMS messages."
            value={getPath(config, 'smsDisabled') ?? false}
            onChange={(v) => onChange('smsDisabled', v)}
          />
          <BooleanField
            label="Outgoing Beam Disabled (NFC)"
            description="Prevent NFC Android Beam-style data sharing."
            value={getPath(config, 'outgoingBeamDisabled') ?? false}
            onChange={(v) => onChange('outgoingBeamDisabled', v)}
          />
          <EnumField
            label="Printing Policy"
            description="Allow or disallow printing where supported."
            value={getPath(config, 'printingPolicy') ?? 'PRINTING_POLICY_UNSPECIFIED'}
            onChange={(v) => onChange('printingPolicy', v)}
            options={[
              { value: 'PRINTING_POLICY_UNSPECIFIED', label: 'Unspecified' },
              { value: 'PRINTING_DISALLOWED', label: 'Disallowed' },
              { value: 'PRINTING_ALLOWED', label: 'Allowed' },
            ]}
          />
          <EnumField
            label="Assist Content Policy"
            description="Allow or block AssistContent (screenshots/app context) for privileged assistants (Android 15+)."
            value={getPath(config, 'assistContentPolicy') ?? 'ASSIST_CONTENT_POLICY_UNSPECIFIED'}
            onChange={(v) => onChange('assistContentPolicy', v)}
            options={[
              { value: 'ASSIST_CONTENT_POLICY_UNSPECIFIED', label: 'Unspecified' },
              { value: 'ASSIST_CONTENT_DISALLOWED', label: 'Disallowed' },
              { value: 'ASSIST_CONTENT_ALLOWED', label: 'Allowed' },
            ]}
          />
          <EnumField
            label="Camera Access"
            description="Control camera availability and user access to the Android camera toggle."
            value={getPath(config, 'cameraAccess') ?? 'CAMERA_ACCESS_UNSPECIFIED'}
            onChange={(v) => onChange('cameraAccess', v)}
            options={[
              { value: 'CAMERA_ACCESS_UNSPECIFIED', label: 'Unspecified' },
              { value: 'CAMERA_ACCESS_USER_CHOICE', label: 'User Choice' },
              { value: 'CAMERA_ACCESS_DISABLED', label: 'Disabled' },
              { value: 'CAMERA_ACCESS_ENFORCED', label: 'Enforced On' },
            ]}
          />
          <EnumField
            label="Microphone Access"
            description="Control microphone availability and user access to the Android microphone toggle (fully managed)."
            value={getPath(config, 'microphoneAccess') ?? 'MICROPHONE_ACCESS_UNSPECIFIED'}
            onChange={(v) => onChange('microphoneAccess', v)}
            options={[
              { value: 'MICROPHONE_ACCESS_UNSPECIFIED', label: 'Unspecified' },
              { value: 'MICROPHONE_ACCESS_USER_CHOICE', label: 'User Choice' },
              { value: 'MICROPHONE_ACCESS_DISABLED', label: 'Disabled' },
              { value: 'MICROPHONE_ACCESS_ENFORCED', label: 'Enforced On' },
            ]}
          />
          <BooleanField
            label="Fun Disabled"
            description="Disable the easter egg game in the Settings app."
            value={getPath(config, 'funDisabled') ?? false}
            onChange={(v) => onChange('funDisabled', v)}
          />
        </div>
      );

    // ---------------------------------------------------------------
    // NETWORK
    // ---------------------------------------------------------------
    case 'network':
      return (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Network</h3>
          <p className="text-sm text-gray-500 mb-6">Configure wireless networks and VPN settings.</p>
          <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-sm font-medium text-gray-900">Configure Wi-Fi and APN payloads through Networks</p>
            <p className="mt-1 text-xs text-gray-600">
              Network payloads are managed in the Networks module and merged into policy derivatives at deployment time.
            </p>
            <a href="/networks" className="mt-2 inline-flex text-xs font-medium text-accent hover:underline">
              Open Networks
            </a>
          </div>
          <BooleanField
            label="Cell Broadcasts Config Disabled"
            description="Disable configuring cell broadcast receivers."
            value={getPath(config, 'cellBroadcastsConfigDisabled') ?? false}
            onChange={(v) => onChange('cellBroadcastsConfigDisabled', v)}
          />
          <BooleanField
            label="Mobile Networks Config Disabled"
            description="Prevent configuring mobile networks."
            value={getPath(config, 'mobileNetworksConfigDisabled') ?? false}
            onChange={(v) => onChange('mobileNetworksConfigDisabled', v)}
          />
          <BooleanField
            label="VPN Config Disabled"
            description="Prevent configuring VPN."
            value={getPath(config, 'vpnConfigDisabled') ?? false}
            onChange={(v) => onChange('vpnConfigDisabled', v)}
          />
          <BooleanField
            label="Network Reset Disabled"
            description="Prevent resetting network settings."
            value={getPath(config, 'networkResetDisabled') ?? false}
            onChange={(v) => onChange('networkResetDisabled', v)}
          />
          <BooleanField
            label="Data Roaming Disabled"
            description="Prevent data roaming."
            value={getPath(config, 'dataRoamingDisabled') ?? false}
            onChange={(v) => onChange('dataRoamingDisabled', v)}
          />
          <TextField
            label="Always-On VPN Package"
            description="Package name of the VPN app used for always-on VPN."
            value={getPath(config, 'alwaysOnVpnPackage.packageName') ?? ''}
            onChange={(v) => onChange('alwaysOnVpnPackage.packageName', v)}
            placeholder="com.example.vpn"
          />
          <BooleanField
            label="Always-On VPN Lockdown"
            description="Block networking when the VPN is disconnected."
            value={getPath(config, 'alwaysOnVpnPackage.lockdownEnabled') ?? false}
            onChange={(v) => onChange('alwaysOnVpnPackage.lockdownEnabled', v)}
          />
          <EnumField
            label="Preferential Network Service"
            description="Enable or disable preferential network service (carrier enterprise slice) where supported."
            value={getPath(config, 'preferentialNetworkService') ?? 'PREFERENTIAL_NETWORK_SERVICE_UNSPECIFIED'}
            onChange={(v) => onChange('preferentialNetworkService', v)}
            options={[
              { value: 'PREFERENTIAL_NETWORK_SERVICE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'PREFERENTIAL_NETWORK_SERVICE_DISABLED', label: 'Disabled' },
              { value: 'PREFERENTIAL_NETWORK_SERVICE_ENABLED', label: 'Enabled' },
            ]}
          />
          <BooleanField
            label="Network Escape Hatch Enabled"
            description="Allow a temporary network connection during boot if unable to connect to any configured network."
            value={getPath(config, 'networkEscapeHatchEnabled') ?? false}
            onChange={(v) => onChange('networkEscapeHatchEnabled', v)}
          />
          <EnumField
            label="Auto Date/Time/Zone"
            description="Control whether automatic date, time, and timezone are enforced."
            value={getPath(config, 'autoDateAndTimeZone') ?? 'AUTO_DATE_AND_TIME_ZONE_UNSPECIFIED'}
            onChange={(v) => onChange('autoDateAndTimeZone', v)}
            options={[
              { value: 'AUTO_DATE_AND_TIME_ZONE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'AUTO_DATE_AND_TIME_ZONE_USER_CHOICE', label: 'User Choice' },
              { value: 'AUTO_DATE_AND_TIME_ZONE_ENFORCED', label: 'Enforced' },
            ]}
          />
          <EnumField
            label="Connectivity: Configure WiFi"
            description="Preferred replacement for legacy WiFi config booleans."
            value={getPath(config, 'deviceConnectivityManagement.configureWifi') ?? 'CONFIGURE_WIFI_UNSPECIFIED'}
            onChange={(v) => onChange('deviceConnectivityManagement.configureWifi', v)}
            options={[
              { value: 'CONFIGURE_WIFI_UNSPECIFIED', label: 'Unspecified' },
              { value: 'ALLOW_CONFIGURING_WIFI', label: 'Allow Configuring WiFi' },
              { value: 'DISALLOW_ADD_WIFI_CONFIG', label: 'Disallow Adding WiFi' },
              { value: 'DISALLOW_CONFIGURING_WIFI', label: 'Disallow Configuring WiFi' },
            ]}
          />
          <EnumField
            label="Connectivity: Tethering"
            description="Preferred replacement for legacy tethering config booleans."
            value={getPath(config, 'deviceConnectivityManagement.tetheringSettings') ?? 'TETHERING_SETTINGS_UNSPECIFIED'}
            onChange={(v) => onChange('deviceConnectivityManagement.tetheringSettings', v)}
            options={[
              { value: 'TETHERING_SETTINGS_UNSPECIFIED', label: 'Unspecified' },
              { value: 'ALLOW_ALL_TETHERING', label: 'Allow All' },
              { value: 'DISALLOW_WIFI_TETHERING', label: 'Disallow WiFi Tethering' },
              { value: 'DISALLOW_ALL_TETHERING', label: 'Disallow All Tethering' },
            ]}
          />
          <EnumField
            label="Connectivity: WiFi Direct"
            description="Control WiFi Direct usage on supported devices."
            value={getPath(config, 'deviceConnectivityManagement.wifiDirectSettings') ?? 'WIFI_DIRECT_SETTINGS_UNSPECIFIED'}
            onChange={(v) => onChange('deviceConnectivityManagement.wifiDirectSettings', v)}
            options={[
              { value: 'WIFI_DIRECT_SETTINGS_UNSPECIFIED', label: 'Unspecified' },
              { value: 'ALLOW_WIFI_DIRECT', label: 'Allow' },
              { value: 'DISALLOW_WIFI_DIRECT', label: 'Disallow' },
            ]}
          />
          <EnumField
            label="Connectivity: Bluetooth Sharing"
            description="Control Bluetooth sharing behaviour."
            value={getPath(config, 'deviceConnectivityManagement.bluetoothSharing') ?? 'BLUETOOTH_SHARING_UNSPECIFIED'}
            onChange={(v) => onChange('deviceConnectivityManagement.bluetoothSharing', v)}
            options={[
              { value: 'BLUETOOTH_SHARING_UNSPECIFIED', label: 'Unspecified' },
              { value: 'BLUETOOTH_SHARING_ALLOWED', label: 'Allowed' },
              { value: 'BLUETOOTH_SHARING_DISALLOWED', label: 'Disallowed' },
            ]}
          />
          <EnumField
            label="Connectivity: USB Data Access"
            description="Preferred replacement for legacy USB file/mass-storage controls."
            value={getPath(config, 'deviceConnectivityManagement.usbDataAccess') ?? 'USB_DATA_ACCESS_UNSPECIFIED'}
            onChange={(v) => onChange('deviceConnectivityManagement.usbDataAccess', v)}
            options={[
              { value: 'USB_DATA_ACCESS_UNSPECIFIED', label: 'Unspecified' },
              { value: 'ALLOW_USB_DATA_TRANSFER', label: 'Allow USB Data Transfer' },
              { value: 'DISALLOW_USB_FILE_TRANSFER', label: 'Disallow USB File Transfer' },
              { value: 'DISALLOW_USB_DATA_TRANSFER', label: 'Disallow All USB Data Transfer' },
            ]}
          />
          <EnumField
            label="WiFi SSID Policy Type"
            description="Controls which WiFi SSIDs devices can connect to. When set to ALLOWLIST, managed network SSIDs are automatically included."
            value={getPath(config, 'deviceConnectivityManagement.wifiSsidPolicy.wifiSsidPolicyType') ?? 'WIFI_SSID_POLICY_TYPE_UNSPECIFIED'}
            onChange={(v) => onChange('deviceConnectivityManagement.wifiSsidPolicy.wifiSsidPolicyType', v)}
            options={[
              { value: 'WIFI_SSID_POLICY_TYPE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'WIFI_SSID_DENYLIST', label: 'Denylist (block listed SSIDs)' },
              { value: 'WIFI_SSID_ALLOWLIST', label: 'Allowlist (only allow listed SSIDs)' },
            ]}
          />
          <RepeaterField
            label="WiFi SSIDs"
            description="List of WiFi SSIDs for the policy. Managed network SSIDs from openNetworkConfiguration are auto-included when using allowlist."
            value={getPath(config, 'deviceConnectivityManagement.wifiSsidPolicy.wifiSsids') ?? []}
            onChange={(v) => onChange('deviceConnectivityManagement.wifiSsidPolicy.wifiSsids', v)}
            defaultItem={{ wifiSsid: '' }}
            renderItem={(item, _index, onItemChange) => (
              <TextField
                label="SSID"
                value={item.wifiSsid ?? ''}
                onChange={(v) => onItemChange({ ...item, wifiSsid: v })}
                placeholder="MyNetwork"
              />
            )}
          />
          <EnumField
            label="WiFi Roaming Mode"
            description="Global WiFi roaming mode. Aggressive roaming can improve performance in areas with weak signals."
            value={getPath(config, 'deviceConnectivityManagement.wifiRoamingPolicy.wifiRoamingMode') ?? 'WIFI_ROAMING_MODE_UNSPECIFIED'}
            onChange={(v) => onChange('deviceConnectivityManagement.wifiRoamingPolicy.wifiRoamingMode', v)}
            options={[
              { value: 'WIFI_ROAMING_MODE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'WIFI_ROAMING_DEFAULT', label: 'Default' },
              { value: 'WIFI_ROAMING_AGGRESSIVE', label: 'Aggressive' },
            ]}
          />
          <RepeaterField
            label="Per-SSID WiFi Roaming Settings"
            description="Override the global roaming mode for specific SSIDs."
            value={getPath(config, 'deviceConnectivityManagement.wifiRoamingPolicy.wifiRoamingSettings') ?? []}
            onChange={(v) => onChange('deviceConnectivityManagement.wifiRoamingPolicy.wifiRoamingSettings', v)}
            defaultItem={{ wifiSsid: '', wifiRoamingMode: 'WIFI_ROAMING_MODE_UNSPECIFIED' }}
            renderItem={(item, _index, onItemChange) => (
              <div className="space-y-2">
                <TextField
                  label="SSID"
                  value={item.wifiSsid ?? ''}
                  onChange={(v) => onItemChange({ ...item, wifiSsid: v })}
                  placeholder="MyNetwork"
                />
                <SelectField
                  label="Roaming Mode"
                  value={item.wifiRoamingMode ?? 'WIFI_ROAMING_MODE_UNSPECIFIED'}
                  onChange={(v) => onItemChange({ ...item, wifiRoamingMode: v })}
                  options={[
                    { value: 'WIFI_ROAMING_MODE_UNSPECIFIED', label: 'Unspecified' },
                    { value: 'WIFI_ROAMING_DEFAULT', label: 'Default' },
                    { value: 'WIFI_ROAMING_AGGRESSIVE', label: 'Aggressive' },
                  ]}
                />
              </div>
            )}
          />
          <EnumField
            label="Preferential Network Default ID (Advanced)"
            description="Advanced replacement for the legacy preferential network enum. Requires matching configs below."
            value={getPath(config, 'deviceConnectivityManagement.preferentialNetworkServiceSettings.defaultPreferentialNetworkId') ?? 'PREFERENTIAL_NETWORK_ID_UNSPECIFIED'}
            onChange={(v) => onChange('deviceConnectivityManagement.preferentialNetworkServiceSettings.defaultPreferentialNetworkId', v)}
            options={[
              { value: 'PREFERENTIAL_NETWORK_ID_UNSPECIFIED', label: 'Unspecified' },
              { value: 'NO_PREFERENTIAL_NETWORK', label: 'No Preferential Network' },
              { value: 'PREFERENTIAL_NETWORK_ID_ONE', label: 'Network ID 1' },
              { value: 'PREFERENTIAL_NETWORK_ID_TWO', label: 'Network ID 2' },
              { value: 'PREFERENTIAL_NETWORK_ID_THREE', label: 'Network ID 3' },
              { value: 'PREFERENTIAL_NETWORK_ID_FOUR', label: 'Network ID 4' },
              { value: 'PREFERENTIAL_NETWORK_ID_FIVE', label: 'Network ID 5' },
            ]}
          />
          <RepeaterField
            label="Preferential Network Service Configs"
            description="Network slicing configs. `preferentialNetworkId` values should be unique."
            value={getPath(config, 'deviceConnectivityManagement.preferentialNetworkServiceSettings.preferentialNetworkServiceConfigs') ?? []}
            onChange={(v) => onChange('deviceConnectivityManagement.preferentialNetworkServiceSettings.preferentialNetworkServiceConfigs', v)}
            defaultItem={{
              preferentialNetworkId: 'PREFERENTIAL_NETWORK_ID_ONE',
              fallbackToDefaultConnection: 'FALLBACK_TO_DEFAULT_CONNECTION_ALLOWED',
              nonMatchingNetworks: 'NON_MATCHING_NETWORKS_ALLOWED',
            }}
            renderItem={(item, _index, onItemChange) => (
              <div className="space-y-2">
                <SelectField
                  label="Preferential Network ID"
                  value={item.preferentialNetworkId ?? 'PREFERENTIAL_NETWORK_ID_ONE'}
                  onChange={(v) => onItemChange({ ...item, preferentialNetworkId: v })}
                  options={[
                    { value: 'PREFERENTIAL_NETWORK_ID_ONE', label: 'Network ID 1' },
                    { value: 'PREFERENTIAL_NETWORK_ID_TWO', label: 'Network ID 2' },
                    { value: 'PREFERENTIAL_NETWORK_ID_THREE', label: 'Network ID 3' },
                    { value: 'PREFERENTIAL_NETWORK_ID_FOUR', label: 'Network ID 4' },
                    { value: 'PREFERENTIAL_NETWORK_ID_FIVE', label: 'Network ID 5' },
                  ]}
                />
                <SelectField
                  label="Fallback To Default Connection"
                  value={item.fallbackToDefaultConnection ?? 'FALLBACK_TO_DEFAULT_CONNECTION_ALLOWED'}
                  onChange={(v) => onItemChange({ ...item, fallbackToDefaultConnection: v })}
                  options={[
                    { value: 'FALLBACK_TO_DEFAULT_CONNECTION_UNSPECIFIED', label: 'Unspecified' },
                    { value: 'FALLBACK_TO_DEFAULT_CONNECTION_ALLOWED', label: 'Allowed' },
                    { value: 'FALLBACK_TO_DEFAULT_CONNECTION_DISALLOWED', label: 'Disallowed' },
                  ]}
                />
                <SelectField
                  label="Non-Matching Networks"
                  value={item.nonMatchingNetworks ?? 'NON_MATCHING_NETWORKS_ALLOWED'}
                  onChange={(v) => onItemChange({ ...item, nonMatchingNetworks: v })}
                  options={[
                    { value: 'NON_MATCHING_NETWORKS_UNSPECIFIED', label: 'Unspecified' },
                    { value: 'NON_MATCHING_NETWORKS_ALLOWED', label: 'Allowed' },
                    { value: 'NON_MATCHING_NETWORKS_DISALLOWED', label: 'Disallowed' },
                  ]}
                />
                <p className="text-xs text-amber-700">
                  Validation note: `NON_MATCHING_NETWORKS_DISALLOWED` requires `Fallback To Default Connection = Disallowed`.
                </p>
              </div>
            )}
          />
          <EnumField
            label="Radio: WiFi State"
            description="Control WiFi state and whether the user may change it."
            value={getPath(config, 'deviceRadioState.wifiState') ?? 'WIFI_STATE_UNSPECIFIED'}
            onChange={(v) => onChange('deviceRadioState.wifiState', v)}
            options={[
              { value: 'WIFI_STATE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'WIFI_STATE_USER_CHOICE', label: 'User Choice' },
              { value: 'WIFI_ENABLED', label: 'Enabled' },
              { value: 'WIFI_DISABLED', label: 'Disabled' },
            ]}
          />
          <EnumField
            label="Radio: Airplane Mode"
            description="Control whether airplane mode can be toggled."
            value={getPath(config, 'deviceRadioState.airplaneModeState') ?? 'AIRPLANE_MODE_STATE_UNSPECIFIED'}
            onChange={(v) => onChange('deviceRadioState.airplaneModeState', v)}
            options={[
              { value: 'AIRPLANE_MODE_STATE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'AIRPLANE_MODE_USER_CHOICE', label: 'User Choice' },
              { value: 'AIRPLANE_MODE_DISABLED', label: 'Disabled (cannot enable)' },
            ]}
          />
          <EnumField
            label="Radio: Cellular 2G"
            description="Control whether users can enable 2G."
            value={getPath(config, 'deviceRadioState.cellularTwoGState') ?? 'CELLULAR_TWO_G_STATE_UNSPECIFIED'}
            onChange={(v) => onChange('deviceRadioState.cellularTwoGState', v)}
            options={[
              { value: 'CELLULAR_TWO_G_STATE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'CELLULAR_TWO_G_USER_CHOICE', label: 'User Choice' },
              { value: 'CELLULAR_TWO_G_DISABLED', label: 'Disabled' },
            ]}
          />
          <EnumField
            label="Radio: Minimum WiFi Security"
            description="Minimum WiFi network security level the device can connect to."
            value={getPath(config, 'deviceRadioState.minimumWifiSecurityLevel') ?? 'MINIMUM_WIFI_SECURITY_LEVEL_UNSPECIFIED'}
            onChange={(v) => onChange('deviceRadioState.minimumWifiSecurityLevel', v)}
            options={[
              { value: 'MINIMUM_WIFI_SECURITY_LEVEL_UNSPECIFIED', label: 'Unspecified' },
              { value: 'OPEN_NETWORK_SECURITY', label: 'Open Networks Allowed' },
              { value: 'PERSONAL_NETWORK_SECURITY', label: 'Personal or Better' },
              { value: 'ENTERPRISE_NETWORK_SECURITY', label: 'Enterprise or Better' },
              { value: 'ENTERPRISE_BIT192_NETWORK_SECURITY', label: 'Enterprise 192-bit Only' },
            ]}
          />
          <EnumField
            label="Radio: Ultra Wideband"
            description="Control ultra wideband state and user toggle access."
            value={getPath(config, 'deviceRadioState.ultraWidebandState') ?? 'ULTRA_WIDEBAND_STATE_UNSPECIFIED'}
            onChange={(v) => onChange('deviceRadioState.ultraWidebandState', v)}
            options={[
              { value: 'ULTRA_WIDEBAND_STATE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'ULTRA_WIDEBAND_USER_CHOICE', label: 'User Choice' },
              { value: 'ULTRA_WIDEBAND_DISABLED', label: 'Disabled' },
            ]}
          />
          <EnumField
            label="User-Initiated Add eSIM"
            description="Allow or block user-added eSIM profiles."
            value={getPath(config, 'deviceRadioState.userInitiatedAddEsimSettings') ?? 'USER_INITIATED_ADD_ESIM_SETTINGS_UNSPECIFIED'}
            onChange={(v) => onChange('deviceRadioState.userInitiatedAddEsimSettings', v)}
            options={[
              { value: 'USER_INITIATED_ADD_ESIM_SETTINGS_UNSPECIFIED', label: 'Unspecified' },
              { value: 'USER_INITIATED_ADD_ESIM_ALLOWED', label: 'Allowed' },
              { value: 'USER_INITIATED_ADD_ESIM_DISALLOWED', label: 'Disallowed' },
            ]}
          />
          <EnumField
            label="Private DNS Mode"
            description="Controls the device's global private DNS setting. `Specified Host` requires a hostname below."
            value={
              getPath(config, 'deviceConnectivityManagement.privateDnsSettings.privateDnsMode')
              ?? getPath(config, 'privateDnsSettings.privateDnsMode')
              ?? 'PRIVATE_DNS_MODE_UNSPECIFIED'
            }
            onChange={(v) => onChange('deviceConnectivityManagement.privateDnsSettings.privateDnsMode', v)}
            options={[
              { value: 'PRIVATE_DNS_MODE_UNSPECIFIED', label: 'Unspecified (User Choice)' },
              { value: 'PRIVATE_DNS_USER_CHOICE', label: 'User Choice' },
              { value: 'PRIVATE_DNS_AUTOMATIC', label: 'Automatic' },
              { value: 'PRIVATE_DNS_SPECIFIED_HOST', label: 'Specified Host' },
            ]}
          />
          <TextField
            label="Private DNS Host"
            description="Hostname for the private DNS server. Set only when Private DNS Mode is `Specified Host`."
            value={
              getPath(config, 'deviceConnectivityManagement.privateDnsSettings.privateDnsHost')
              ?? getPath(config, 'privateDnsSettings.privateDnsHost')
              ?? ''
            }
            onChange={(v) => onChange('deviceConnectivityManagement.privateDnsSettings.privateDnsHost', v.trim())}
            placeholder="dns.example.com"
          />
          <TextField
            label="Recommended Global Proxy Host"
            description="The host of the recommended global HTTP proxy."
            value={getPath(config, 'recommendedGlobalProxy.host') ?? ''}
            onChange={(v) => onChange('recommendedGlobalProxy.host', v)}
            placeholder="proxy.example.com"
          />
          <NumberField
            label="Recommended Global Proxy Port"
            description="The port of the recommended global HTTP proxy."
            value={getPath(config, 'recommendedGlobalProxy.port') ?? 0}
            onChange={(v) => onChange('recommendedGlobalProxy.port', v)}
            min={0}
            max={65535}
          />
        </div>
      );

    // ---------------------------------------------------------------
    // APPLICATIONS
    // ---------------------------------------------------------------
    case 'applications':
      return (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Applications</h3>
          <p className="text-sm text-gray-500 mb-6">Manage application install policies and permissions.</p>
          <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-sm font-medium text-gray-900">Assign apps through Applications</p>
            <p className="mt-1 text-xs text-gray-600">
              App catalogue entries and scoped app configs are managed in Applications and merged into policy derivatives.
            </p>
            <a href="/apps" className="mt-2 inline-flex text-xs font-medium text-accent hover:underline">
              Open Applications
            </a>
          </div>

          <BooleanField
            label="Install Apps Disabled"
            description="Prevent users from installing apps."
            value={getPath(config, 'installAppsDisabled') ?? false}
            onChange={(v) => onChange('installAppsDisabled', v)}
          />
          <BooleanField
            label="Uninstall Apps Disabled"
            description="Prevent users from uninstalling apps."
            value={getPath(config, 'uninstallAppsDisabled') ?? false}
            onChange={(v) => onChange('uninstallAppsDisabled', v)}
          />
          <EnumField
            label="Play Store Mode"
            description="Controls which apps are available in the Play Store for this policy."
            value={(() => {
              const mode = getPath(config, 'playStoreMode');
              if (mode === 'BLOCKLIST') return 'BLACKLIST';
              return mode ?? 'PLAY_STORE_MODE_UNSPECIFIED';
            })()}
            onChange={(v) => onChange('playStoreMode', v)}
            options={[
              { value: 'PLAY_STORE_MODE_UNSPECIFIED', label: 'Unspecified', description: 'Defaults to allowlist (WHITELIST).' },
              { value: 'WHITELIST', label: 'Allowlist', description: 'Only apps in this policy\'s applications list are available.' },
              { value: 'BLACKLIST', label: 'Blocklist', description: 'All Play Store apps are available except blocked apps.' },
            ]}
          />
          <EnumField
            label="Global App Auto Update Policy"
            description="Default app auto-update behaviour when per-app overrides are not used."
            value={getPath(config, 'appAutoUpdatePolicy') ?? 'APP_AUTO_UPDATE_POLICY_UNSPECIFIED'}
            onChange={(v) => onChange('appAutoUpdatePolicy', v)}
            options={[
              { value: 'APP_AUTO_UPDATE_POLICY_UNSPECIFIED', label: 'Unspecified' },
              { value: 'CHOICE_TO_THE_USER', label: 'User Choice' },
              { value: 'NEVER', label: 'Never' },
              { value: 'WIFI_ONLY', label: 'WiFi Only' },
              { value: 'ALWAYS', label: 'Always' },
            ]}
          />
          <EnumField
            label="App Functions"
            description="Allow or block apps from exposing app functions where supported."
            value={getPath(config, 'appFunctions') ?? 'APP_FUNCTIONS_UNSPECIFIED'}
            onChange={(v) => onChange('appFunctions', v)}
            options={[
              { value: 'APP_FUNCTIONS_UNSPECIFIED', label: 'Unspecified' },
              { value: 'APP_FUNCTIONS_DISALLOWED', label: 'Disallowed' },
              { value: 'APP_FUNCTIONS_ALLOWED', label: 'Allowed' },
            ]}
          />
          {false && <RepeaterField
            label="Applications"
            description="List of managed applications and their settings."
            value={getPath(config, 'applications') ?? []}
            onChange={(v) => onChange('applications', v)}
            defaultItem={{ packageName: '', installType: 'AVAILABLE', disabled: false, roles: [] }}
            renderItem={(item, _index, onItemChange) => (
              <div className="space-y-2">
                <TextField
                  label="Package Name"
                  value={item.packageName ?? ''}
                  onChange={(v) => onItemChange({ ...item, packageName: v.trim() })}
                  placeholder="com.example.app"
                />
                <SelectField
                  label="Install Type"
                  value={item.installType ?? 'AVAILABLE'}
                  onChange={(v) => onItemChange({ ...item, installType: v })}
                  options={[
                    { value: 'INSTALL_TYPE_UNSPECIFIED', label: 'Unspecified' },
                    { value: 'PREINSTALLED', label: 'Preinstalled' },
                    { value: 'AVAILABLE', label: 'Available' },
                    { value: 'FORCE_INSTALLED', label: 'Force Installed' },
                    { value: 'BLOCKED', label: 'Blocked' },
                    { value: 'REQUIRED_FOR_SETUP', label: 'Required for Setup' },
                    { value: 'CUSTOM', label: 'Custom (AMAPI SDK)' },
                  ]}
                />
                <RepeaterField
                  label="App Roles"
                  description="Use `KIOSK` role instead of deprecated `InstallType=KIOSK`. Role types must be unique per app."
                  value={Array.isArray(item.roles) ? item.roles : []}
                  onChange={(roles) => {
                    const deduped = (Array.isArray(roles) ? roles : []).filter((r: any) => r && typeof r === 'object')
                      .filter((r: any) => typeof r.roleType === 'string' && r.roleType)
                      .reduce((acc: any[], role: any) => (
                        acc.some((r) => r.roleType === role.roleType) ? acc : [...acc, { roleType: role.roleType }]
                      ), []);
                    onItemChange({ ...item, roles: deduped });
                  }}
                  defaultItem={{ roleType: 'KIOSK' }}
                  renderItem={(roleItem, __idx, onRoleChange) => (
                    <SelectField
                      label="Role Type"
                      value={roleItem?.roleType ?? 'KIOSK'}
                      onChange={(v) => onRoleChange({ roleType: v })}
                      options={[
                        { value: 'KIOSK', label: 'Kiosk' },
                        { value: 'COMPANION_APP', label: 'Companion App' },
                        { value: 'MOBILE_THREAT_DEFENSE_ENDPOINT_DETECTION_RESPONSE', label: 'MTD / EDR' },
                        { value: 'SYSTEM_HEALTH_MONITORING', label: 'System Health Monitoring' },
                      ]}
                    />
                  )}
                />
                <BooleanField
                  label="Disabled"
                  value={item.disabled ?? false}
                  onChange={(v) => onItemChange({ ...item, disabled: v })}
                />
                <SelectField
                  label="Auto Update Mode"
                  value={item.autoUpdateMode ?? 'AUTO_UPDATE_MODE_UNSPECIFIED'}
                  onChange={(v) => onItemChange({ ...item, autoUpdateMode: v })}
                  options={[
                    { value: 'AUTO_UPDATE_MODE_UNSPECIFIED', label: 'Unspecified' },
                    { value: 'AUTO_UPDATE_DEFAULT', label: 'Default' },
                    { value: 'AUTO_UPDATE_POSTPONED', label: 'Postponed' },
                    { value: 'AUTO_UPDATE_HIGH_PRIORITY', label: 'High Priority' },
                  ]}
                />
                <SelectField
                  label="Per-App Default Permission Policy"
                  value={item.defaultPermissionPolicy ?? 'PERMISSION_POLICY_UNSPECIFIED'}
                  onChange={(v) => onItemChange({ ...item, defaultPermissionPolicy: v })}
                  options={[
                    { value: 'PERMISSION_POLICY_UNSPECIFIED', label: 'Unspecified' },
                    { value: 'PROMPT', label: 'Prompt' },
                    { value: 'GRANT', label: 'Grant' },
                    { value: 'DENY', label: 'Deny' },
                  ]}
                />
                <EnumField
                  label="User Control Settings"
                  description="Control force-stop / clear-data style user controls for the app."
                  value={item.userControlSettings ?? 'USER_CONTROL_SETTINGS_UNSPECIFIED'}
                  onChange={(v) => onItemChange({ ...item, userControlSettings: v })}
                  options={[
                    { value: 'USER_CONTROL_SETTINGS_UNSPECIFIED', label: 'Unspecified' },
                    { value: 'USER_CONTROL_ALLOWED', label: 'Allowed' },
                    { value: 'USER_CONTROL_DISALLOWED', label: 'Disallowed' },
                  ]}
                />
                <EnumField
                  label="Always-On VPN Lockdown Exemption"
                  description="Only applies when always-on VPN lockdown is enabled."
                  value={item.alwaysOnVpnLockdownExemption ?? 'ALWAYS_ON_VPN_LOCKDOWN_EXEMPTION_UNSPECIFIED'}
                  onChange={(v) => onItemChange({ ...item, alwaysOnVpnLockdownExemption: v })}
                  options={[
                    { value: 'ALWAYS_ON_VPN_LOCKDOWN_EXEMPTION_UNSPECIFIED', label: 'Unspecified' },
                    { value: 'VPN_LOCKDOWN_ENFORCED', label: 'Respect Lockdown' },
                    { value: 'VPN_LOCKDOWN_EXEMPTION', label: 'Exempt' },
                  ]}
                />
                <NumberField
                  label="Install Priority"
                  description="Valid range 0-10000 (lower is higher priority)."
                  value={item.installPriority ?? 0}
                  onChange={(v) => onItemChange({ ...item, installPriority: Math.min(10000, Math.max(0, v)) })}
                  min={0}
                  max={10000}
                />
                <NumberField
                  label="Minimum Version Code"
                  description="At most 20 apps per policy may set this."
                  value={item.minimumVersionCode ?? 0}
                  onChange={(v) => onItemChange({ ...item, minimumVersionCode: Math.max(0, v) })}
                  min={0}
                />
                <EnumField
                  label="Work Profile Widgets"
                  description="Override whether this app can place work profile widgets."
                  value={item.workProfileWidgets ?? 'WORK_PROFILE_WIDGETS_UNSPECIFIED'}
                  onChange={(v) => onItemChange({ ...item, workProfileWidgets: v })}
                  options={[
                    { value: 'WORK_PROFILE_WIDGETS_UNSPECIFIED', label: 'Unspecified' },
                    { value: 'WORK_PROFILE_WIDGETS_ALLOWED', label: 'Allowed' },
                    { value: 'WORK_PROFILE_WIDGETS_DISALLOWED', label: 'Disallowed' },
                  ]}
                />
                <EnumField
                  label="Connected Work/Personal App"
                  description="Allow or block app self-communication across work/personal profiles."
                  value={item.connectedWorkAndPersonalApp ?? 'CONNECTED_WORK_AND_PERSONAL_APP_UNSPECIFIED'}
                  onChange={(v) => onItemChange({ ...item, connectedWorkAndPersonalApp: v })}
                  options={[
                    { value: 'CONNECTED_WORK_AND_PERSONAL_APP_UNSPECIFIED', label: 'Unspecified' },
                    { value: 'CONNECTED_WORK_AND_PERSONAL_APP_DISALLOWED', label: 'Disallowed' },
                    { value: 'CONNECTED_WORK_AND_PERSONAL_APP_ALLOWED', label: 'Allowed' },
                  ]}
                />
                <EnumField
                  label="Preferential Network ID"
                  description="App-specific preferential network selection (Android 13+)."
                  value={item.preferentialNetworkId ?? 'PREFERENTIAL_NETWORK_ID_UNSPECIFIED'}
                  onChange={(v) => onItemChange({ ...item, preferentialNetworkId: v })}
                  options={[
                    { value: 'PREFERENTIAL_NETWORK_ID_UNSPECIFIED', label: 'Unspecified' },
                    { value: 'NO_PREFERENTIAL_NETWORK', label: 'No Preferential Network' },
                    { value: 'PREFERENTIAL_NETWORK_ID_ONE', label: 'Network ID 1' },
                    { value: 'PREFERENTIAL_NETWORK_ID_TWO', label: 'Network ID 2' },
                    { value: 'PREFERENTIAL_NETWORK_ID_THREE', label: 'Network ID 3' },
                    { value: 'PREFERENTIAL_NETWORK_ID_FOUR', label: 'Network ID 4' },
                    { value: 'PREFERENTIAL_NETWORK_ID_FIVE', label: 'Network ID 5' },
                  ]}
                />
                <EnumField
                  label="Credential Provider Policy"
                  description="Per-app passkey/credential provider allow setting (Android 14+)."
                  value={item.credentialProviderPolicy ?? 'CREDENTIAL_PROVIDER_POLICY_UNSPECIFIED'}
                  onChange={(v) => onItemChange({ ...item, credentialProviderPolicy: v })}
                  options={[
                    { value: 'CREDENTIAL_PROVIDER_POLICY_UNSPECIFIED', label: 'Unspecified' },
                    { value: 'CREDENTIAL_PROVIDER_ALLOWED', label: 'Allowed' },
                  ]}
                />
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Delegated Scopes</label>
                  <p className="text-xs text-gray-500 mb-2">
                    Duplicates are removed automatically. `CERT_SELECTION` conflicts with `choosePrivateKeyRules`.
                  </p>
                  <div className="space-y-2">
                    {[
                      'CERT_INSTALL',
                      'MANAGED_CONFIGURATIONS',
                      'BLOCK_UNINSTALL',
                      'PERMISSION_GRANT',
                      'PACKAGE_ACCESS',
                      'ENABLE_SYSTEM_APP',
                      'NETWORK_ACTIVITY_LOGS',
                      'SECURITY_LOGS',
                      'CERT_SELECTION',
                    ].map((scope) => {
                      const current = uniqueNonEmptyStrings(item.delegatedScopes);
                      const checked = current.includes(scope);
                      return (
                        <label key={scope} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked ? [...current, scope] : current.filter((s) => s !== scope);
                              onItemChange({ ...item, delegatedScopes: uniqueNonEmptyStrings(next) });
                            }}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          {scope}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <RepeaterField
                  label="Signing Key Certs"
                  description="SHA-256 signing cert fingerprints. Required for some custom/role/extension scenarios."
                  value={Array.isArray(item.signingKeyCerts) ? item.signingKeyCerts : []}
                  onChange={(certs) => onItemChange({ ...item, signingKeyCerts: certs })}
                  defaultItem={{ signingKeyCertFingerprintSha256: '' }}
                  renderItem={(cert, __idx, onCertChange) => (
                    <div className="space-y-1">
                      <TextField
                        label="SHA-256 Fingerprint"
                        value={cert.signingKeyCertFingerprintSha256 ?? ''}
                        onChange={(v) => onCertChange({ signingKeyCertFingerprintSha256: v.trim() })}
                        placeholder="64 hex chars"
                      />
                      {typeof cert.signingKeyCertFingerprintSha256 === 'string' &&
                      cert.signingKeyCertFingerprintSha256.trim() &&
                      !isValidSha256Hex(cert.signingKeyCertFingerprintSha256) ? (
                        <p className="text-xs text-amber-700">Expected 64 hex characters (SHA-256 digest).</p>
                      ) : null}
                    </div>
                  )}
                />
                <RepeaterField
                  label="Per-App Permission Grants"
                  description="Overrides policy-level permission behaviour for this app."
                  value={Array.isArray(item.permissionGrants) ? item.permissionGrants : []}
                  onChange={(grants) => onItemChange({ ...item, permissionGrants: grants })}
                  defaultItem={{ permission: '', policy: 'PERMISSION_POLICY_UNSPECIFIED' }}
                  renderItem={(grant, __idx, onGrantChange) => (
                    <div className="space-y-2">
                      <TextField
                        label="Permission"
                        value={grant.permission ?? ''}
                        onChange={(v) => onGrantChange({ ...grant, permission: v.trim() })}
                        placeholder="android.permission.CAMERA"
                      />
                      <SelectField
                        label="Policy"
                        value={grant.policy ?? 'PERMISSION_POLICY_UNSPECIFIED'}
                        onChange={(v) => onGrantChange({ ...grant, policy: v })}
                        options={[
                          { value: 'PERMISSION_POLICY_UNSPECIFIED', label: 'Unspecified' },
                          { value: 'PROMPT', label: 'Prompt' },
                          { value: 'GRANT', label: 'Grant' },
                          { value: 'DENY', label: 'Deny' },
                        ]}
                      />
                    </div>
                  )}
                />
                <RepeaterField
                  label="Accessible Track IDs"
                  description="Play track IDs available to the device for this app."
                  value={asStringArray(item.accessibleTrackIds)}
                  onChange={(trackIds) => onItemChange({ ...item, accessibleTrackIds: uniqueNonEmptyStrings(trackIds) })}
                  defaultItem=""
                  renderItem={(trackId, __idx, onTrackIdChange) => (
                    <TextField
                      label="Track ID"
                      value={typeof trackId === 'string' ? trackId : ''}
                      onChange={onTrackIdChange}
                      placeholder="enterprise-track-id"
                    />
                  )}
                />
                <RepeaterField
                  label="Install Constraint"
                  description="AMAPI allows at most one install constraint."
                  value={Array.isArray(item.installConstraint) ? item.installConstraint : []}
                  onChange={(constraints) => onItemChange({ ...item, installConstraint: constraints })}
                  maxItems={1}
                  defaultItem={{
                    chargingConstraint: 'CHARGING_CONSTRAINT_UNSPECIFIED',
                    networkTypeConstraint: 'NETWORK_TYPE_CONSTRAINT_UNSPECIFIED',
                    deviceIdleConstraint: 'DEVICE_IDLE_CONSTRAINT_UNSPECIFIED',
                  }}
                  renderItem={(constraint, __idx, onConstraintChange) => (
                    <div className="space-y-2">
                      <SelectField
                        label="Charging Constraint"
                        value={constraint.chargingConstraint ?? 'CHARGING_CONSTRAINT_UNSPECIFIED'}
                        onChange={(v) => onConstraintChange({ ...constraint, chargingConstraint: v })}
                        options={[
                          { value: 'CHARGING_CONSTRAINT_UNSPECIFIED', label: 'Unspecified' },
                          { value: 'CHARGING_NOT_REQUIRED', label: 'Not Required' },
                          { value: 'INSTALL_ONLY_WHEN_CHARGING', label: 'Only When Charging' },
                        ]}
                      />
                      <SelectField
                        label="Network Type Constraint"
                        value={constraint.networkTypeConstraint ?? 'NETWORK_TYPE_CONSTRAINT_UNSPECIFIED'}
                        onChange={(v) => onConstraintChange({ ...constraint, networkTypeConstraint: v })}
                        options={[
                          { value: 'NETWORK_TYPE_CONSTRAINT_UNSPECIFIED', label: 'Unspecified' },
                          { value: 'INSTALL_ON_ANY_NETWORK', label: 'Any Network' },
                          { value: 'INSTALL_ONLY_ON_UNMETERED_NETWORK', label: 'Unmetered Only' },
                        ]}
                      />
                      <SelectField
                        label="Device Idle Constraint"
                        value={constraint.deviceIdleConstraint ?? 'DEVICE_IDLE_CONSTRAINT_UNSPECIFIED'}
                        onChange={(v) => onConstraintChange({ ...constraint, deviceIdleConstraint: v })}
                        options={[
                          { value: 'DEVICE_IDLE_CONSTRAINT_UNSPECIFIED', label: 'Unspecified' },
                          { value: 'DEVICE_IDLE_NOT_REQUIRED', label: 'Not Required' },
                          { value: 'INSTALL_ONLY_WHEN_DEVICE_IDLE', label: 'Only When Idle' },
                        ]}
                      />
                    </div>
                  )}
                />
                <PolicyAppManagedConfigSection
                  item={item}
                  onItemChange={onItemChange}
                />
                <JsonField
                  label="Custom App Config (JSON)"
                  description="Custom app configuration object. Requires `installType = CUSTOM`."
                  value={item.customAppConfig}
                  onChange={(v) => onItemChange({ ...item, customAppConfig: v })}
                  kind="object"
                  rows={8}
                />
              </div>
            )}
          />}
          <RepeaterField
            label="Default Application Settings"
            description="Define default apps by type and scope. Types should be unique across entries."
            value={getPath(config, 'defaultApplicationSettings') ?? []}
            onChange={(v) => onChange('defaultApplicationSettings', v)}
            defaultItem={{
              defaultApplicationType: 'DEFAULT_BROWSER',
              defaultApplicationScopes: ['SCOPE_FULLY_MANAGED'],
              defaultApplications: [{ packageName: '' }],
            }}
            renderItem={(item, _index, onItemChange) => (
              <div className="space-y-2">
                <SelectField
                  label="Default Application Type"
                  value={item.defaultApplicationType ?? 'DEFAULT_BROWSER'}
                  onChange={(v) => onItemChange({ ...item, defaultApplicationType: v })}
                  options={[
                    { value: 'DEFAULT_BROWSER', label: 'Browser' },
                    { value: 'DEFAULT_DIALER', label: 'Dialer' },
                    { value: 'DEFAULT_SMS', label: 'SMS' },
                    { value: 'DEFAULT_ASSISTANT', label: 'Assistant' },
                    { value: 'DEFAULT_HOME', label: 'Home' },
                    { value: 'DEFAULT_CALL_REDIRECTION', label: 'Call Redirection' },
                    { value: 'DEFAULT_CALL_SCREENING', label: 'Call Screening' },
                    { value: 'DEFAULT_WALLET', label: 'Wallet' },
                  ]}
                />
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Scopes</label>
                  <p className="text-xs text-gray-500 mb-2">At least one scope is required. Duplicates are removed automatically.</p>
                  <div className="space-y-2">
                    {[
                      { value: 'SCOPE_FULLY_MANAGED', label: 'Fully Managed' },
                      { value: 'SCOPE_WORK_PROFILE', label: 'Work Profile' },
                      { value: 'SCOPE_PERSONAL_PROFILE', label: 'Personal Profile (Company-Owned WP)' },
                    ].map((opt) => {
                      const current = uniqueNonEmptyStrings(item.defaultApplicationScopes);
                      const checked = current.includes(opt.value);
                      return (
                        <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked ? [...current, opt.value] : current.filter((v) => v !== opt.value);
                              onItemChange({ ...item, defaultApplicationScopes: uniqueNonEmptyStrings(next) });
                            }}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          {opt.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <RepeaterField
                  label="Default Applications"
                  description="Ordered list. The first installed/qualified app becomes the default."
                  value={Array.isArray(item.defaultApplications) ? item.defaultApplications : []}
                  onChange={(apps) => onItemChange({
                    ...item,
                    defaultApplications: (Array.isArray(apps) ? apps : [])
                      .filter((a: any) => a && typeof a === 'object')
                      .map((a: any) => ({ packageName: typeof a.packageName === 'string' ? a.packageName.trim() : '' })),
                  })}
                  defaultItem={{ packageName: '' }}
                  renderItem={(defaultApp, __idx, onDefaultAppChange) => (
                    <TextField
                      label="Package Name"
                      value={defaultApp.packageName ?? ''}
                      onChange={(v) => onDefaultAppChange({ packageName: v })}
                      placeholder="com.example.app"
                    />
                  )}
                />
              </div>
            )}
          />
        </div>
      );

    // ---------------------------------------------------------------
    // SECURITY
    // ---------------------------------------------------------------
    case 'security':
      return (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Security</h3>
          <p className="text-sm text-gray-500 mb-6">Configure encryption, development, and security policies.</p>

          <EnumField
            label="Encryption Policy"
            description="Encryption requirement for the device."
            value={getPath(config, 'encryptionPolicy') ?? 'ENCRYPTION_POLICY_UNSPECIFIED'}
            onChange={(v) => onChange('encryptionPolicy', v)}
            options={[
              { value: 'ENCRYPTION_POLICY_UNSPECIFIED', label: 'Unspecified' },
              { value: 'ENABLED_WITHOUT_PASSWORD', label: 'Enabled without password' },
              { value: 'ENABLED_WITH_PASSWORD', label: 'Enabled with password' },
            ]}
          />
          <EnumField
            label="Google Play Protect Verify Apps"
            description="Controls the Google Play Protect verify apps setting."
            value={getPath(config, 'advancedSecurityOverrides.googlePlayProtectVerifyApps') ?? 'GOOGLE_PLAY_PROTECT_VERIFY_APPS_UNSPECIFIED'}
            onChange={(v) => onChange('advancedSecurityOverrides.googlePlayProtectVerifyApps', v)}
            options={[
              { value: 'GOOGLE_PLAY_PROTECT_VERIFY_APPS_UNSPECIFIED', label: 'Unspecified' },
              { value: 'VERIFY_APPS_ENFORCED', label: 'Enforced' },
              { value: 'VERIFY_APPS_USER_CHOICE', label: 'User Choice' },
            ]}
          />
          <EnumField
            label="Common Criteria Mode"
            description="High-assurance security mode. Use only when required due to device behaviour impact."
            value={getPath(config, 'advancedSecurityOverrides.commonCriteriaMode') ?? 'COMMON_CRITERIA_MODE_UNSPECIFIED'}
            onChange={(v) => onChange('advancedSecurityOverrides.commonCriteriaMode', v)}
            options={[
              { value: 'COMMON_CRITERIA_MODE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'COMMON_CRITERIA_MODE_DISABLED', label: 'Disabled' },
              { value: 'COMMON_CRITERIA_MODE_ENABLED', label: 'Enabled' },
            ]}
          />
          <EnumField
            label="Untrusted Apps Policy"
            description="Replacement for deprecated unknown-sources controls."
            value={getPath(config, 'advancedSecurityOverrides.untrustedAppsPolicy') ?? 'UNTRUSTED_APPS_POLICY_UNSPECIFIED'}
            onChange={(v) => onChange('advancedSecurityOverrides.untrustedAppsPolicy', v)}
            options={[
              { value: 'UNTRUSTED_APPS_POLICY_UNSPECIFIED', label: 'Unspecified' },
              { value: 'DISALLOW_INSTALL', label: 'Disallow Install' },
              { value: 'ALLOW_INSTALL_IN_PERSONAL_PROFILE_ONLY', label: 'Allow in Personal Profile Only' },
              { value: 'ALLOW_INSTALL_DEVICE_WIDE', label: 'Allow Device-Wide' },
            ]}
          />
          <EnumField
            label="Content Protection Policy"
            description="Android 15+ deceptive-app content protection behaviour."
            value={getPath(config, 'advancedSecurityOverrides.contentProtectionPolicy') ?? 'CONTENT_PROTECTION_POLICY_UNSPECIFIED'}
            onChange={(v) => onChange('advancedSecurityOverrides.contentProtectionPolicy', v)}
            options={[
              { value: 'CONTENT_PROTECTION_POLICY_UNSPECIFIED', label: 'Unspecified' },
              { value: 'CONTENT_PROTECTION_DISABLED', label: 'Disabled' },
              { value: 'CONTENT_PROTECTION_ENFORCED', label: 'Enforced' },
              { value: 'CONTENT_PROTECTION_USER_CHOICE', label: 'User Choice' },
            ]}
          />
          <EnumField
            label="MTE Policy"
            description="Memory Tagging Extension policy (Android 14+ where supported)."
            value={getPath(config, 'advancedSecurityOverrides.mtePolicy') ?? 'MTE_POLICY_UNSPECIFIED'}
            onChange={(v) => onChange('advancedSecurityOverrides.mtePolicy', v)}
            options={[
              { value: 'MTE_POLICY_UNSPECIFIED', label: 'Unspecified' },
              { value: 'MTE_USER_CHOICE', label: 'User Choice' },
              { value: 'MTE_ENFORCED', label: 'Enforced' },
              { value: 'MTE_DISABLED', label: 'Disabled' },
            ]}
          />
          <BooleanField
            label="Private Key Selection Enabled"
            description="Allow a key alias picker UI when no choose-private-key rule matches."
            value={getPath(config, 'privateKeySelectionEnabled') ?? false}
            onChange={(v) => onChange('privateKeySelectionEnabled', v)}
          />
          <RepeaterField
            label="Choose Private Key Rules"
            description="Rules for key alias selection. Must be empty if any app has delegated scope `CERT_SELECTION`."
            value={getPath(config, 'choosePrivateKeyRules') ?? []}
            onChange={(v) => onChange('choosePrivateKeyRules', v)}
            defaultItem={{ privateKeyAlias: '', urlPattern: '', packageNames: [] }}
            renderItem={(item, _index, onItemChange) => (
              <div className="space-y-2">
                <TextField
                  label="Private Key Alias"
                  value={item.privateKeyAlias ?? ''}
                  onChange={(v) => onItemChange({ ...item, privateKeyAlias: v.trim() })}
                  placeholder="corp-client-cert"
                />
                <TextField
                  label="URL Pattern (Java regex)"
                  description="Leave empty to match all URLs. Java regex syntax is used by Android."
                  value={item.urlPattern ?? ''}
                  onChange={(v) => onItemChange({ ...item, urlPattern: v })}
                  placeholder="https://vpn\\.example\\.com/.*"
                />
                <RepeaterField
                  label="Package Names"
                  description="Optional allowlist of apps for this alias. Empty means any app that requests via KeyChain API."
                  value={asStringArray(item.packageNames)}
                  onChange={(pkgNames) => onItemChange({ ...item, packageNames: uniqueNonEmptyStrings(pkgNames) })}
                  defaultItem=""
                  renderItem={(pkg, __idx, onPkgChange) => (
                    <TextField
                      label="Package Name"
                      value={typeof pkg === 'string' ? pkg : ''}
                      onChange={onPkgChange}
                      placeholder="com.example.app"
                    />
                  )}
                />
              </div>
            )}
          />
          <EnumField
            label="Credential Provider Default Policy"
            description="Default policy for credential provider apps (Android 14+)."
            value={getPath(config, 'credentialProviderPolicyDefault') ?? 'CREDENTIAL_PROVIDER_POLICY_DEFAULT_UNSPECIFIED'}
            onChange={(v) => onChange('credentialProviderPolicyDefault', v)}
            options={[
              { value: 'CREDENTIAL_PROVIDER_POLICY_DEFAULT_UNSPECIFIED', label: 'Unspecified' },
              { value: 'CREDENTIAL_PROVIDER_DEFAULT_DISALLOWED', label: 'Disallowed' },
              { value: 'CREDENTIAL_PROVIDER_DEFAULT_DISALLOWED_EXCEPT_SYSTEM', label: 'Disallowed Except System' },
            ]}
          />
          <NumberField
            label="Minimum API Level"
            description="Minimum Android API level allowed on enrolled devices."
            value={getPath(config, 'minimumApiLevel') ?? 0}
            onChange={(v) => onChange('minimumApiLevel', v)}
            min={0}
          />
          <RepeaterField
            label="FRP Admin Emails"
            description="Admin emails allowed to unlock a device after factory reset protection."
            value={asStringArray(getPath(config, 'frpAdminEmails'))}
            onChange={(v) => onChange('frpAdminEmails', v)}
            defaultItem=""
            renderItem={(item, _index, onItemChange) => (
              <TextField
                label="Email"
                value={typeof item === 'string' ? item : ''}
                onChange={onItemChange}
                placeholder="admin@example.com"
              />
            )}
          />
          <BooleanField
            label="Policy Wipe: Remove Managed eSIMs"
            description="Sets policy `wipeDataFlags` for policy-triggered wipes (for example non-compliance wipe actions). Manual WIPE commands can set this separately."
            value={asStringArray(getPath(config, 'wipeDataFlags')).includes('WIPE_ESIMS')}
            onChange={(v) => onChange('wipeDataFlags', v ? ['WIPE_ESIMS'] : [])}
          />
          <EnumField
            label="Developer Settings"
            description="Controls access to developer settings."
            value={getPath(config, 'advancedSecurityOverrides.developerSettings') ?? 'DEVELOPER_SETTINGS_UNSPECIFIED'}
            onChange={(v) => onChange('advancedSecurityOverrides.developerSettings', v)}
            options={[
              { value: 'DEVELOPER_SETTINGS_UNSPECIFIED', label: 'Unspecified' },
              { value: 'DEVELOPER_SETTINGS_DISABLED', label: 'Disabled' },
              { value: 'DEVELOPER_SETTINGS_ALLOWED', label: 'Allowed' },
            ]}
          />
        </div>
      );

    // ---------------------------------------------------------------
    // SYSTEM UPDATES
    // ---------------------------------------------------------------
    case 'systemUpdates':
      {
      const startMinutes = normalizeMinutesOfDay(getPath(config, 'systemUpdate.startMinutes') ?? 0);
      const endMinutes = normalizeMinutesOfDay(getPath(config, 'systemUpdate.endMinutes') ?? 0);
      const maintenanceWindowDurationMinutes = getMaintenanceWindowDurationMinutes(startMinutes, endMinutes);
      const showDurationTip = maintenanceWindowDurationMinutes > 240;
      const freezePeriodsRaw = Array.isArray(getPath(config, 'systemUpdate.freezePeriods'))
        ? getPath(config, 'systemUpdate.freezePeriods')
        : [];
      const freezePeriods = freezePeriodsRaw.map((period: unknown) => policyFreezePeriodToEditorItem(period));
      const handleFreezePeriodsChange = (items: FreezePeriodEditorItem[]) => {
        const mapped = items.map((item) => editorItemToPolicyFreezePeriod(item));
        onChange('systemUpdate.freezePeriods', mapped);
      };

      return (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">System Updates</h3>
          <p className="text-sm text-gray-500 mb-6">Configure over-the-air update policy.</p>

          <EnumField
            label="System Update Type"
            description="The type of system update policy."
            value={getPath(config, 'systemUpdate.type') ?? 'SYSTEM_UPDATE_TYPE_UNSPECIFIED'}
            onChange={(v) => onChange('systemUpdate.type', v)}
            options={[
              { value: 'SYSTEM_UPDATE_TYPE_UNSPECIFIED', label: 'Unspecified', description: 'Follow default device behaviour.' },
              { value: 'AUTOMATIC', label: 'Automatic', description: 'Install automatically when available.' },
              { value: 'WINDOWED', label: 'Windowed', description: 'Install within a maintenance window.' },
              { value: 'POSTPONE', label: 'Postpone', description: 'Postpone for up to 30 days.' },
            ]}
          />
          <div className="py-3">
            <label className="block text-sm font-medium text-gray-900 mb-1">Window Start Time</label>
            <p className="text-xs text-gray-500 mb-2 leading-relaxed">
              Start time of the maintenance window (00:00-23:59). Only used with Windowed type.
            </p>
            <input
              type="time"
              step={60}
              value={minutesToTimeInput(startMinutes)}
              onChange={(e) => onChange('systemUpdate.startMinutes', timeInputToMinutes(e.target.value))}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="py-3">
            <label className="block text-sm font-medium text-gray-900 mb-1">Window End Time</label>
            <p className="text-xs text-gray-500 mb-2 leading-relaxed">
              End time of the maintenance window (00:00-23:59). Only used with Windowed type.
            </p>
            <input
              type="time"
              step={60}
              value={minutesToTimeInput(endMinutes)}
              onChange={(e) => onChange('systemUpdate.endMinutes', timeInputToMinutes(e.target.value))}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            {showDurationTip ? (
              <p className="mt-2 text-xs text-amber-700">Tip: 4 hours or less is better.</p>
            ) : null}
          </div>

          <RepeaterField
            label="Freeze Periods"
            description="Annually recurring OTA freeze windows. Set start month/day and duration (1-90 days); end date is calculated automatically with no year."
            value={freezePeriods}
            onChange={handleFreezePeriodsChange}
            defaultItem={{ startMonth: 1, startDay: 1, durationDays: 30 }}
            renderItem={(item, _index, onItemChange) => {
              const normalized = normalizeFreezeEditorItem(item);
              const computed = editorItemToPolicyFreezePeriod(normalized);
              const daysInStartMonth = getFreezeDaysInMonth(normalized.startMonth);
              return (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-700">Start Month</label>
                      <select
                        value={normalized.startMonth}
                        onChange={(e) => {
                          const nextMonth = normalizeFreezeMonth(Number(e.target.value));
                          onItemChange({
                            ...normalized,
                            startMonth: nextMonth,
                            startDay: normalizeFreezeDay(normalized.startDay, nextMonth),
                          });
                        }}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                      >
                        {FREEZE_MONTH_NAMES.map((name, idx) => (
                          <option key={name} value={idx + 1}>{name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-700">Start Day</label>
                      <select
                        value={normalized.startDay}
                        onChange={(e) => onItemChange({
                          ...normalized,
                          startDay: normalizeFreezeDay(Number(e.target.value), normalized.startMonth),
                        })}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                      >
                        {Array.from({ length: daysInStartMonth }, (_, i) => i + 1).map((day) => (
                          <option key={day} value={day}>{day}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-700">Duration (days)</label>
                      <input
                        type="number"
                        min={1}
                        max={90}
                        value={normalized.durationDays}
                        onChange={(e) => onItemChange({
                          ...normalized,
                          durationDays: normalizeFreezeDurationDays(Number(e.target.value)),
                        })}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">
                    Maps to startDate {`{month: ${computed.startDate.month}, day: ${computed.startDate.day}}`} and endDate {`{month: ${computed.endDate.month}, day: ${computed.endDate.day}}`}.
                  </p>
                </div>
              );
            }}
          />
          <p className="mt-2 text-xs text-amber-700">
            AMAPI requires each freeze period to be at most 90 days and separated by at least 60 days.
          </p>
        </div>
      );
      }

    // ---------------------------------------------------------------
    // PERMISSIONS
    // ---------------------------------------------------------------
    case 'permissions':
      return (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Permissions</h3>
          <p className="text-sm text-gray-500 mb-6">Configure default permission grants and policy.</p>

          <EnumField
            label="Default Permission Policy"
            description="The default policy for all permissions requested by apps."
            value={getPath(config, 'defaultPermissionPolicy') ?? 'PERMISSION_POLICY_UNSPECIFIED'}
            onChange={(v) => onChange('defaultPermissionPolicy', v)}
            options={[
              { value: 'PERMISSION_POLICY_UNSPECIFIED', label: 'Unspecified' },
              { value: 'PROMPT', label: 'Prompt' },
              { value: 'GRANT', label: 'Auto Grant' },
              { value: 'DENY', label: 'Auto Deny' },
            ]}
          />
          <RepeaterField
            label="Permission Grants"
            description="Explicit grants or denials of specific permissions."
            value={getPath(config, 'permissionGrants') ?? []}
            onChange={(v) => onChange('permissionGrants', v)}
            defaultItem={{ permission: '', policy: 'PERMISSION_POLICY_UNSPECIFIED' }}
            renderItem={(item, _index, onItemChange) => (
              <div className="space-y-2">
                <TextField
                  label="Permission"
                  value={item.permission ?? ''}
                  onChange={(v) => onItemChange({ ...item, permission: v })}
                  placeholder="android.permission.CAMERA"
                />
                <SelectField
                  label="Policy"
                  value={item.policy ?? 'PERMISSION_POLICY_UNSPECIFIED'}
                  onChange={(v) => onItemChange({ ...item, policy: v })}
                  options={[
                    { value: 'PERMISSION_POLICY_UNSPECIFIED', label: 'Unspecified' },
                    { value: 'PROMPT', label: 'Prompt' },
                    { value: 'GRANT', label: 'Grant' },
                    { value: 'DENY', label: 'Deny' },
                  ]}
                />
              </div>
            )}
          />
          <RepeaterField
            label="Permitted Accessibility Services"
            description="Restrict which accessibility service packages are allowed."
            value={asStringArray(getPath(config, 'permittedAccessibilityServices.packageNames'))}
            onChange={(v) => onChange('permittedAccessibilityServices.packageNames', v)}
            defaultItem=""
            renderItem={(item, _index, onItemChange) => (
              <TextField
                label="Package Name"
                value={typeof item === 'string' ? item : ''}
                onChange={onItemChange}
                placeholder="com.example.accessibility"
              />
            )}
          />
          <RepeaterField
            label="Permitted Input Methods"
            description="Restrict which keyboard/input method packages are allowed."
            value={asStringArray(getPath(config, 'permittedInputMethods.packageNames'))}
            onChange={(v) => onChange('permittedInputMethods.packageNames', v)}
            defaultItem=""
            renderItem={(item, _index, onItemChange) => (
              <TextField
                label="Package Name"
                value={typeof item === 'string' ? item : ''}
                onChange={onItemChange}
                placeholder="com.example.keyboard"
              />
            )}
          />
        </div>
      );

    // ---------------------------------------------------------------
    // STATUS REPORTING
    // ---------------------------------------------------------------
    case 'statusReporting':
      return (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Status Reporting</h3>
          <p className="text-sm text-gray-500 mb-6">Configure what status information the device reports.</p>

          <BooleanField
            label="Application Reports Enabled"
            description="Report the list of installed applications."
            value={getPath(config, 'statusReportingSettings.applicationReportsEnabled') ?? false}
            onChange={(v) => onChange('statusReportingSettings.applicationReportsEnabled', v)}
          />
          <BooleanField
            label="Include Removed Apps In Reports"
            description="Include removed apps in application reports."
            value={getPath(config, 'statusReportingSettings.applicationReportingSettings.includeRemovedApps') ?? false}
            onChange={(v) => onChange('statusReportingSettings.applicationReportingSettings.includeRemovedApps', v)}
          />
          <BooleanField
            label="Device Settings Enabled"
            description="Report device settings."
            value={getPath(config, 'statusReportingSettings.deviceSettingsEnabled') ?? false}
            onChange={(v) => onChange('statusReportingSettings.deviceSettingsEnabled', v)}
          />
          <BooleanField
            label="Software Info Enabled"
            description="Report software information."
            value={getPath(config, 'statusReportingSettings.softwareInfoEnabled') ?? false}
            onChange={(v) => onChange('statusReportingSettings.softwareInfoEnabled', v)}
          />
          <BooleanField
            label="Memory Info Enabled"
            description="Report memory information."
            value={getPath(config, 'statusReportingSettings.memoryInfoEnabled') ?? false}
            onChange={(v) => onChange('statusReportingSettings.memoryInfoEnabled', v)}
          />
          <BooleanField
            label="Network Info Enabled"
            description="Report network information."
            value={getPath(config, 'statusReportingSettings.networkInfoEnabled') ?? false}
            onChange={(v) => onChange('statusReportingSettings.networkInfoEnabled', v)}
          />
          <BooleanField
            label="Display Info Enabled"
            description="Report display information."
            value={getPath(config, 'statusReportingSettings.displayInfoEnabled') ?? false}
            onChange={(v) => onChange('statusReportingSettings.displayInfoEnabled', v)}
          />
          <BooleanField
            label="Hardware Status Enabled"
            description="Report hardware status (battery, CPU, etc)."
            value={getPath(config, 'statusReportingSettings.hardwareStatusEnabled') ?? false}
            onChange={(v) => onChange('statusReportingSettings.hardwareStatusEnabled', v)}
          />
          <BooleanField
            label="Power Management Events Enabled"
            description="Report power management events."
            value={getPath(config, 'statusReportingSettings.powerManagementEventsEnabled') ?? false}
            onChange={(v) => onChange('statusReportingSettings.powerManagementEventsEnabled', v)}
          />
          <BooleanField
            label="Common Criteria Mode Enabled"
            description="Report Common Criteria mode information."
            value={getPath(config, 'statusReportingSettings.commonCriteriaModeEnabled') ?? false}
            onChange={(v) => onChange('statusReportingSettings.commonCriteriaModeEnabled', v)}
          />
          <BooleanField
            label="Default Application Info Enabled"
            description="Report default application info status."
            value={getPath(config, 'statusReportingSettings.defaultApplicationInfoReportingEnabled') ?? false}
            onChange={(v) => onChange('statusReportingSettings.defaultApplicationInfoReportingEnabled', v)}
          />
          <BooleanField
            label="System Properties Enabled"
            description="Report system properties."
            value={getPath(config, 'statusReportingSettings.systemPropertiesEnabled') ?? false}
            onChange={(v) => onChange('statusReportingSettings.systemPropertiesEnabled', v)}
          />
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">Usage Log Types</label>
            <p className="text-xs text-gray-500 mb-3">
              Enable AMAPI usage log streams delivered via Pub/Sub notifications.
            </p>
            <div className="space-y-2">
              {[
                { value: 'SECURITY_LOGS', label: 'Security Logs' },
                { value: 'NETWORK_ACTIVITY_LOGS', label: 'Network Activity Logs' },
              ].map((opt) => {
                const current = asStringArray(getPath(config, 'usageLog.enabledLogTypes'));
                const checked = current.includes(opt.value);
                return (
                  <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...new Set([...current, opt.value])]
                          : current.filter((v) => v !== opt.value);
                        onChange('usageLog.enabledLogTypes', next);
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">Usage Logs Upload On Cellular</label>
            <p className="text-xs text-gray-500 mb-3">
              Allow selected log types to upload over mobile data instead of waiting for WiFi.
            </p>
            <div className="space-y-2">
              {[
                { value: 'SECURITY_LOGS', label: 'Security Logs' },
                { value: 'NETWORK_ACTIVITY_LOGS', label: 'Network Activity Logs' },
              ].map((opt) => {
                const current = asStringArray(getPath(config, 'usageLog.uploadOnCellularAllowed'));
                const checked = current.includes(opt.value);
                return (
                  <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...new Set([...current, opt.value])]
                          : current.filter((v) => v !== opt.value);
                        onChange('usageLog.uploadOnCellularAllowed', next);
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      );

    // ---------------------------------------------------------------
    // PERSONAL USAGE (WP only)
    // ---------------------------------------------------------------
    case 'personalUsage':
      return (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Personal Usage</h3>
          <p className="text-sm text-gray-500 mb-6">Configure personal usage policies for work profile deployments.</p>

          <EnumField
            label="Personal Play Store Mode"
            description="Controls which apps can be installed on the personal profile."
            value={getPath(config, 'personalUsagePolicies.personalPlayStoreMode') ?? 'PLAY_STORE_MODE_UNSPECIFIED'}
            onChange={(v) => onChange('personalUsagePolicies.personalPlayStoreMode', v)}
            options={[
              { value: 'PLAY_STORE_MODE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'BLACKLIST', label: 'Blacklist', description: 'All Play Store apps available except blacklisted.' },
              { value: 'BLOCKLIST', label: 'Blocklist', description: 'All Play Store apps available except blocked.' },
            ]}
          />
          <BooleanField
            label="Camera Disabled"
            description="Disable camera on the personal profile. Deprecated — use Camera Access below."
            value={getPath(config, 'personalUsagePolicies.cameraDisabled') ?? false}
            onChange={(v) => onChange('personalUsagePolicies.cameraDisabled', v)}
          />
          <EnumField
            label="Camera Access (Personal Profile)"
            description="Controls camera access on the personal profile. Replaces the deprecated Camera Disabled toggle."
            value={getPath(config, 'personalUsagePolicies.cameraAccessForPersonalProfile') ?? 'CAMERA_ACCESS_FOR_PERSONAL_PROFILE_UNSPECIFIED'}
            onChange={(v) => onChange('personalUsagePolicies.cameraAccessForPersonalProfile', v)}
            options={[
              { value: 'CAMERA_ACCESS_FOR_PERSONAL_PROFILE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'CAMERA_ACCESS_ALLOWED', label: 'Allowed' },
              { value: 'CAMERA_ACCESS_DISABLED', label: 'Disabled' },
            ]}
          />
          <EnumField
            label="Microphone Access (Personal Profile)"
            description="Controls microphone access on the personal profile."
            value={getPath(config, 'personalUsagePolicies.microphoneAccessForPersonalProfile') ?? 'MICROPHONE_ACCESS_FOR_PERSONAL_PROFILE_UNSPECIFIED'}
            onChange={(v) => onChange('personalUsagePolicies.microphoneAccessForPersonalProfile', v)}
            options={[
              { value: 'MICROPHONE_ACCESS_FOR_PERSONAL_PROFILE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'MICROPHONE_ACCESS_ALLOWED', label: 'Allowed' },
              { value: 'MICROPHONE_ACCESS_DISABLED', label: 'Disabled' },
            ]}
          />
          <BooleanField
            label="Screen Capture Disabled"
            description="Disable screen capture on the personal profile."
            value={getPath(config, 'personalUsagePolicies.screenCaptureDisabled') ?? false}
            onChange={(v) => onChange('personalUsagePolicies.screenCaptureDisabled', v)}
          />
          <NumberField
            label="Max Days With Work Off"
            description="Maximum days the work profile can remain off before the device is blocked."
            value={getPath(config, 'personalUsagePolicies.maxDaysWithWorkOff') ?? 0}
            onChange={(v) => onChange('personalUsagePolicies.maxDaysWithWorkOff', v)}
            min={0}
          />
          <RepeaterField
            label="Account Types With Management Disabled"
            description="Account types that users cannot manage in the personal profile (for example, com.google)."
            value={asStringArray(getPath(config, 'personalUsagePolicies.accountTypesWithManagementDisabled'))}
            onChange={(v) => onChange('personalUsagePolicies.accountTypesWithManagementDisabled', v)}
            defaultItem=""
            renderItem={(item, _index, onItemChange) => (
              <TextField
                label="Account Type"
                value={typeof item === 'string' ? item : ''}
                onChange={onItemChange}
                placeholder="com.example.account"
              />
            )}
          />
          <EnumField
            label="Personal Google Accounts"
            description="Controls whether personal Google accounts can be added to the personal profile."
            value={getPath(config, 'personalUsagePolicies.personalGoogleAccountsAllowed') ?? 'PERSONAL_GOOGLE_ACCOUNTS_ALLOWED_UNSPECIFIED'}
            onChange={(v) => onChange('personalUsagePolicies.personalGoogleAccountsAllowed', v)}
            options={[
              { value: 'PERSONAL_GOOGLE_ACCOUNTS_ALLOWED_UNSPECIFIED', label: 'Unspecified' },
              { value: 'PERSONAL_GOOGLE_ACCOUNTS_ALLOWED', label: 'Allowed' },
              { value: 'PERSONAL_GOOGLE_ACCOUNTS_DISALLOWED', label: 'Disallowed' },
            ]}
          />
          <RepeaterField
            label="Personal Applications"
            description="Per-app personal usage policies."
            value={getPath(config, 'personalUsagePolicies.personalApplications') ?? []}
            onChange={(v) => onChange('personalUsagePolicies.personalApplications', v)}
            defaultItem={{ packageName: '', installType: 'AVAILABLE' }}
            renderItem={(item, _index, onItemChange) => (
              <div className="space-y-2">
                <TextField
                  label="Package Name"
                  value={item.packageName ?? ''}
                  onChange={(v) => onItemChange({ ...item, packageName: v })}
                  placeholder="com.example.app"
                />
                <SelectField
                  label="Install Type"
                  value={item.installType ?? 'AVAILABLE'}
                  onChange={(v) => onItemChange({ ...item, installType: v })}
                  options={[
                    { value: 'AVAILABLE', label: 'Available' },
                    { value: 'FORCE_INSTALLED', label: 'Force Installed' },
                    { value: 'BLOCKED', label: 'Blocked' },
                  ]}
                />
              </div>
            )}
          />
          <RepeaterField
            label="Account Types With Management Disabled"
            description="Account types that users cannot manage (for example, com.google)."
            value={asStringArray(getPath(config, 'accountTypesWithManagementDisabled'))}
            onChange={(v) => onChange('accountTypesWithManagementDisabled', v)}
            defaultItem=""
            renderItem={(item, _index, onItemChange) => (
              <TextField
                label="Account Type"
                value={typeof item === 'string' ? item : ''}
                onChange={onItemChange}
                placeholder="com.example.account"
              />
            )}
          />
        </div>
      );

    // ---------------------------------------------------------------
    // KIOSK MODE (FM only)
    // ---------------------------------------------------------------
    case 'kioskMode':
      return (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Kiosk Mode</h3>
          <p className="text-sm text-gray-500 mb-6">Configure kiosk / dedicated device experience.</p>

          <BooleanField
            label="Kiosk Custom Launcher Enabled"
            description="Replace the home screen with the kiosk launcher."
            value={getPath(config, 'kioskCustomLauncherEnabled') ?? false}
            onChange={(v) => onChange('kioskCustomLauncherEnabled', v)}
          />
          <EnumField
            label="Status Bar"
            description="Controls the status bar in kiosk mode."
            value={getPath(config, 'kioskCustomization.statusBar') ?? 'STATUS_BAR_UNSPECIFIED'}
            onChange={(v) => onChange('kioskCustomization.statusBar', v)}
            options={[
              { value: 'STATUS_BAR_UNSPECIFIED', label: 'Unspecified' },
              { value: 'NOTIFICATIONS_AND_SYSTEM_INFO_ENABLED', label: 'Notifications & System Info' },
              { value: 'NOTIFICATIONS_AND_SYSTEM_INFO_DISABLED', label: 'Disabled' },
              { value: 'SYSTEM_INFO_ONLY', label: 'System Info Only' },
            ]}
          />
          <EnumField
            label="Power Button Actions"
            description="Controls power button behaviour in kiosk mode."
            value={getPath(config, 'kioskCustomization.powerButtonActions') ?? 'POWER_BUTTON_ACTIONS_UNSPECIFIED'}
            onChange={(v) => onChange('kioskCustomization.powerButtonActions', v)}
            options={[
              { value: 'POWER_BUTTON_ACTIONS_UNSPECIFIED', label: 'Unspecified' },
              { value: 'POWER_BUTTON_AVAILABLE', label: 'Available' },
              { value: 'POWER_BUTTON_BLOCKED', label: 'Blocked' },
            ]}
          />
          <EnumField
            label="Device Settings"
            description="Controls access to device settings in kiosk mode."
            value={getPath(config, 'kioskCustomization.deviceSettings') ?? 'DEVICE_SETTINGS_UNSPECIFIED'}
            onChange={(v) => onChange('kioskCustomization.deviceSettings', v)}
            options={[
              { value: 'DEVICE_SETTINGS_UNSPECIFIED', label: 'Unspecified' },
              { value: 'SETTINGS_ACCESS_ALLOWED', label: 'Allowed' },
              { value: 'SETTINGS_ACCESS_BLOCKED', label: 'Blocked' },
            ]}
          />
          <EnumField
            label="System Navigation"
            description="Controls navigation buttons in kiosk mode."
            value={getPath(config, 'kioskCustomization.systemNavigation') ?? 'SYSTEM_NAVIGATION_UNSPECIFIED'}
            onChange={(v) => onChange('kioskCustomization.systemNavigation', v)}
            options={[
              { value: 'SYSTEM_NAVIGATION_UNSPECIFIED', label: 'Unspecified' },
              { value: 'NAVIGATION_ENABLED', label: 'Enabled' },
              { value: 'NAVIGATION_DISABLED', label: 'Disabled' },
              { value: 'HOME_BUTTON_ONLY', label: 'Home Button Only' },
            ]}
          />
          <BooleanField
            label="System Error Warnings"
            description="Show crash and ANR dialogs in kiosk mode."
            value={getPath(config, 'kioskCustomization.systemErrorWarnings') !== 'ERROR_AND_WARNINGS_MUTED'}
            onChange={(v) => onChange('kioskCustomization.systemErrorWarnings', v ? 'ERROR_AND_WARNINGS_ENABLED' : 'ERROR_AND_WARNINGS_MUTED')}
          />
        </div>
      );

    // ---------------------------------------------------------------
    // COMPLIANCE RULES
    // ---------------------------------------------------------------
    case 'complianceRules':
      return (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Compliance Rules</h3>
          <p className="text-sm text-gray-500 mb-6">Define rules to enforce device compliance.</p>

          <RepeaterField
            label="Policy Enforcement Rules"
            description="Actions taken when a top-level policy cannot be applied. `blockAfterDays` must be less than `wipeAfterDays`."
            value={getPath(config, 'policyEnforcementRules') ?? []}
            onChange={(v) => onChange('policyEnforcementRules', v)}
            defaultItem={{
              settingName: '',
              blockAction: { blockAfterDays: 0, blockScope: 'BLOCK_SCOPE_UNSPECIFIED' },
              wipeAction: { wipeAfterDays: 1, preserveFrp: false },
            }}
            renderItem={(item, _index, onItemChange) => (
              <div className="space-y-2">
                <TextField
                  label="Setting Name"
                  description="Top-level policy field to enforce (for example `applications` or `passwordPolicies`)."
                  value={item.settingName ?? ''}
                  onChange={(v) => onItemChange({ ...item, settingName: v.trim() })}
                  placeholder="applications"
                />
                <NumberField
                  label="Block After Days"
                  description="0 blocks immediately. Must be less than Wipe After Days."
                  value={item.blockAction?.blockAfterDays ?? 0}
                  onChange={(v) => onItemChange({
                    ...item,
                    blockAction: { ...(item.blockAction ?? {}), blockAfterDays: Math.max(0, v) },
                  })}
                  min={0}
                />
                <SelectField
                  label="Block Scope"
                  value={item.blockAction?.blockScope ?? 'BLOCK_SCOPE_UNSPECIFIED'}
                  onChange={(v) => onItemChange({
                    ...item,
                    blockAction: { ...(item.blockAction ?? {}), blockScope: v },
                  })}
                  options={[
                    { value: 'BLOCK_SCOPE_UNSPECIFIED', label: 'Unspecified (Work Profile)' },
                    { value: 'BLOCK_SCOPE_WORK_PROFILE', label: 'Work Profile' },
                    { value: 'BLOCK_SCOPE_DEVICE', label: 'Device' },
                  ]}
                />
                <NumberField
                  label="Wipe After Days"
                  description="Must be greater than Block After Days."
                  value={item.wipeAction?.wipeAfterDays ?? 1}
                  onChange={(v) => onItemChange({
                    ...item,
                    wipeAction: { ...(item.wipeAction ?? {}), wipeAfterDays: Math.max(0, v) },
                  })}
                  min={0}
                />
                <BooleanField
                  label="Preserve FRP"
                  description="Preserve factory reset protection data when wiping a company-owned device."
                  value={item.wipeAction?.preserveFrp ?? false}
                  onChange={(v) => onItemChange({
                    ...item,
                    wipeAction: { ...(item.wipeAction ?? {}), preserveFrp: v },
                  })}
                />
              </div>
            )}
          />
          <TextField
            label="Short Support Message"
            description="A short message displayed when functionality is disabled by the admin."
            value={getPath(config, 'shortSupportMessage.defaultMessage') ?? ''}
            onChange={(v) => onChange('shortSupportMessage.defaultMessage', v)}
            placeholder="Contact your IT admin for help."
          />
          <TextField
            label="Long Support Message"
            description="A detailed message displayed in the device admin settings."
            value={getPath(config, 'longSupportMessage.defaultMessage') ?? ''}
            onChange={(v) => onChange('longSupportMessage.defaultMessage', v)}
            placeholder="For assistance, contact IT at support@example.com"
            multiline
          />
        </div>
      );

    // ---------------------------------------------------------------
    // CROSS-PROFILE
    // ---------------------------------------------------------------
    case 'crossProfile':
      return (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Cross-Profile</h3>
          <p className="text-sm text-gray-500 mb-6">Configure how work and personal profiles interact.</p>

          <EnumField
            label="Cross-Profile Copy/Paste"
            description="Controls copy-paste between work and personal profiles."
            value={getPath(config, 'crossProfilePolicies.crossProfileCopyPaste') ?? 'CROSS_PROFILE_COPY_PASTE_UNSPECIFIED'}
            onChange={(v) => onChange('crossProfilePolicies.crossProfileCopyPaste', v)}
            options={[
              { value: 'CROSS_PROFILE_COPY_PASTE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'COPY_FROM_WORK_TO_PERSONAL_DISALLOWED', label: 'Disallow Work to Personal' },
              { value: 'CROSS_PROFILE_COPY_PASTE_ALLOWED', label: 'Allowed' },
            ]}
          />
          <EnumField
            label="Cross-Profile Data Sharing"
            description="Controls data sharing between work and personal profiles."
            value={getPath(config, 'crossProfilePolicies.crossProfileDataSharing') ?? 'CROSS_PROFILE_DATA_SHARING_UNSPECIFIED'}
            onChange={(v) => onChange('crossProfilePolicies.crossProfileDataSharing', v)}
            options={[
              { value: 'CROSS_PROFILE_DATA_SHARING_UNSPECIFIED', label: 'Unspecified' },
              { value: 'CROSS_PROFILE_DATA_SHARING_DISALLOWED', label: 'Disallowed' },
              { value: 'DATA_SHARING_FROM_WORK_TO_PERSONAL_DISALLOWED', label: 'Disallow Work to Personal' },
              { value: 'CROSS_PROFILE_DATA_SHARING_ALLOWED', label: 'Allowed' },
            ]}
          />
          <BooleanField
            label="Show Work Contacts in Personal Profile"
            description="Allow work contacts to appear in personal profile contact searches."
            value={getPath(config, 'crossProfilePolicies.showWorkContactsInPersonalProfile') !== 'SHOW_WORK_CONTACTS_IN_PERSONAL_PROFILE_DISALLOWED'}
            onChange={(v) => onChange('crossProfilePolicies.showWorkContactsInPersonalProfile', v ? 'SHOW_WORK_CONTACTS_IN_PERSONAL_PROFILE_ALLOWED' : 'SHOW_WORK_CONTACTS_IN_PERSONAL_PROFILE_DISALLOWED')}
          />
          <EnumField
            label="Work Profile Widgets Default"
            description="Controls whether work profile widgets can be added to the personal profile home screen."
            value={getPath(config, 'crossProfilePolicies.workProfileWidgetsDefault') ?? 'WORK_PROFILE_WIDGETS_DEFAULT_UNSPECIFIED'}
            onChange={(v) => onChange('crossProfilePolicies.workProfileWidgetsDefault', v)}
            options={[
              { value: 'WORK_PROFILE_WIDGETS_DEFAULT_UNSPECIFIED', label: 'Unspecified' },
              { value: 'WORK_PROFILE_WIDGETS_DEFAULT_ALLOWED', label: 'Allowed' },
              { value: 'WORK_PROFILE_WIDGETS_DEFAULT_DISALLOWED', label: 'Disallowed' },
            ]}
          />
          <EnumField
            label="Cross-Profile App Functions"
            description="Controls whether apps can expose functions across work and personal profiles."
            value={getPath(config, 'crossProfilePolicies.crossProfileAppFunctions') ?? 'CROSS_PROFILE_APP_FUNCTIONS_UNSPECIFIED'}
            onChange={(v) => onChange('crossProfilePolicies.crossProfileAppFunctions', v)}
            options={[
              { value: 'CROSS_PROFILE_APP_FUNCTIONS_UNSPECIFIED', label: 'Unspecified' },
              { value: 'CROSS_PROFILE_APP_FUNCTIONS_ALLOWED', label: 'Allowed' },
              { value: 'CROSS_PROFILE_APP_FUNCTIONS_DISALLOWED', label: 'Disallowed' },
            ]}
          />
          <RepeaterField
            label="Personal Apps That Can Read Work Notifications"
            description="Personal-profile package names allowed to read work notifications."
            value={asStringArray(getPath(config, 'advancedSecurityOverrides.personalAppsThatCanReadWorkNotifications'))}
            onChange={(v) => onChange('advancedSecurityOverrides.personalAppsThatCanReadWorkNotifications', uniqueNonEmptyStrings(v))}
            defaultItem=""
            renderItem={(item, _index, onItemChange) => (
              <TextField
                label="Package Name"
                value={typeof item === 'string' ? item : ''}
                onChange={onItemChange}
                placeholder="com.example.notificationlistener"
              />
            )}
          />
        </div>
      );

    // ---------------------------------------------------------------
    // LOCATION
    // ---------------------------------------------------------------
    case 'location':
      return (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Location</h3>
          <p className="text-sm text-gray-500 mb-6">Configure location sharing and reporting.</p>

          <EnumField
            label="Location Mode"
            description="The degree of location detection enabled."
            value={getPath(config, 'locationMode') ?? 'LOCATION_MODE_UNSPECIFIED'}
            onChange={(v) => onChange('locationMode', v)}
            options={[
              { value: 'LOCATION_MODE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'HIGH_ACCURACY', label: 'High Accuracy', description: 'GPS, WiFi, and mobile networks.' },
              { value: 'SENSORS_ONLY', label: 'Sensors Only', description: 'GPS only.' },
              { value: 'BATTERY_SAVING', label: 'Battery Saving', description: 'WiFi and mobile networks only.' },
              { value: 'OFF', label: 'Off', description: 'Location turned off.' },
              { value: 'LOCATION_USER_CHOICE', label: 'User Choice' },
              { value: 'LOCATION_ENFORCED', label: 'Enforced' },
              { value: 'LOCATION_DISABLED', label: 'Disabled' },
            ]}
          />
          <BooleanField
            label="Share Location Disabled"
            description="Prevent sharing location data."
            value={getPath(config, 'shareLocationDisabled') ?? false}
            onChange={(v) => onChange('shareLocationDisabled', v)}
          />
        </div>
      );

    // ---------------------------------------------------------------
    // ADVANCED
    // ---------------------------------------------------------------
    case 'advanced':
      return (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Advanced</h3>
          <p className="text-sm text-gray-500 mb-6">Additional and less common policy settings.</p>

          <EnumField
            label="Enterprise Display Name Visibility"
            description="Control whether the enterprise display name is shown on the device."
            value={getPath(config, 'enterpriseDisplayNameVisibility') ?? 'ENTERPRISE_DISPLAY_NAME_VISIBILITY_UNSPECIFIED'}
            onChange={(v) => onChange('enterpriseDisplayNameVisibility', v)}
            options={[
              { value: 'ENTERPRISE_DISPLAY_NAME_VISIBILITY_UNSPECIFIED', label: 'Unspecified' },
              { value: 'ENTERPRISE_DISPLAY_NAME_VISIBLE', label: 'Visible' },
              { value: 'ENTERPRISE_DISPLAY_NAME_HIDDEN', label: 'Hidden' },
            ]}
          />
          <RepeaterField
            label="Persistent Preferred Activities"
            description="Default intent handlers. Do not use this for kiosk setup; use app role `KIOSK` instead."
            value={getPath(config, 'persistentPreferredActivities') ?? []}
            onChange={(v) => onChange('persistentPreferredActivities', v)}
            defaultItem={{ receiverActivity: '', actions: [], categories: [] }}
            renderItem={(item, _index, onItemChange) => (
              <div className="space-y-2">
                <TextField
                  label="Receiver Activity"
                  description="Component name or package name (for example `com.example/.MainActivity`)."
                  value={item.receiverActivity ?? ''}
                  onChange={(v) => onItemChange({ ...item, receiverActivity: v.trim() })}
                  placeholder="com.example.app/.MainActivity"
                />
                <RepeaterField
                  label="Intent Actions"
                  description="Optional action list to match. Empty means action is ignored."
                  value={asStringArray(item.actions)}
                  onChange={(actions) => onItemChange({ ...item, actions: uniqueNonEmptyStrings(actions) })}
                  defaultItem=""
                  renderItem={(action, __idx, onActionChange) => (
                    <TextField
                      label="Action"
                      value={typeof action === 'string' ? action : ''}
                      onChange={onActionChange}
                      placeholder="android.intent.action.MAIN"
                    />
                  )}
                />
                <RepeaterField
                  label="Intent Categories"
                  description="All categories requested by the intent must be present here to match."
                  value={asStringArray(item.categories)}
                  onChange={(categories) => onItemChange({ ...item, categories: uniqueNonEmptyStrings(categories) })}
                  defaultItem=""
                  renderItem={(categoryItem, __idx, onCategoryChange) => (
                    <TextField
                      label="Category"
                      value={typeof categoryItem === 'string' ? categoryItem : ''}
                      onChange={onCategoryChange}
                      placeholder="android.intent.category.DEFAULT"
                    />
                  )}
                />
              </div>
            )}
          />
          <RepeaterField
            label="Setup Actions"
            description="Actions shown during device setup. AMAPI allows at most one setup action."
            value={getPath(config, 'setupActions') ?? []}
            onChange={(v) => onChange('setupActions', v)}
            maxItems={1}
            defaultItem={{ title: { defaultMessage: '' }, description: { defaultMessage: '' }, launchApp: { packageName: '' } }}
            renderItem={(item, _index, onItemChange) => (
              <div className="space-y-2">
                <TextField
                  label="Title"
                  value={item.title?.defaultMessage ?? ''}
                  onChange={(v) => onItemChange({ ...item, title: { ...(item.title ?? {}), defaultMessage: v } })}
                  placeholder="Complete company setup"
                />
                <TextField
                  label="Description"
                  value={item.description?.defaultMessage ?? ''}
                  onChange={(v) => onItemChange({ ...item, description: { ...(item.description ?? {}), defaultMessage: v } })}
                  placeholder="Open the required app to finish setup steps"
                  multiline
                />
                <TextField
                  label="Launch App Package"
                  description="App must also be in Applications with installType `REQUIRED_FOR_SETUP` or setup can fail."
                  value={item.launchApp?.packageName ?? ''}
                  onChange={(v) => onItemChange({ ...item, launchApp: { ...(item.launchApp ?? {}), packageName: v.trim() } })}
                  placeholder="com.example.setup"
                />
              </div>
            )}
          />
          <EnumField
            label="Work Account Authentication Type"
            description="Controls whether a Google-authenticated work account is required during setup."
            value={getPath(config, 'workAccountSetupConfig.authenticationType') ?? 'AUTHENTICATION_TYPE_UNSPECIFIED'}
            onChange={(v) => onChange('workAccountSetupConfig.authenticationType', v)}
            options={[
              { value: 'AUTHENTICATION_TYPE_UNSPECIFIED', label: 'Unspecified' },
              { value: 'AUTHENTICATION_TYPE_NOT_ENFORCED', label: 'Not Enforced' },
              { value: 'GOOGLE_AUTHENTICATED', label: 'Google Authenticated' },
            ]}
          />
          <TextField
            label="Required Work Account Email"
            description="Only relevant when authentication type is `GOOGLE_AUTHENTICATED`."
            value={getPath(config, 'workAccountSetupConfig.requiredAccountEmail') ?? ''}
            onChange={(v) => onChange('workAccountSetupConfig.requiredAccountEmail', v.trim())}
            placeholder="user@company.com"
          />
        </div>
      );

    // ---------------------------------------------------------------
    // FALLBACK
    // ---------------------------------------------------------------
    default:
      return (
        <div className="py-8 text-center text-gray-400 text-sm">
          Select a category from the sidebar to configure policy settings.
        </div>
      );
  }
}
