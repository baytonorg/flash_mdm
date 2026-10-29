import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import {
  PLATFORM_UPDATE_TARGET_LABELS,
  PLATFORM_UPDATE_TARGETS,
  buildSystemUpdateMigrationCandidates,
  createDefaultUucRule,
  dateToInput,
  daysToDuration,
  describeUucRule,
  durationToDays,
  getEffectiveControlOverview,
  getRuleEditorIssues,
  getRuleEditorWarnings,
  getUucRuleDisplayName,
  getUucRules,
  hasConfiguredSystemUpdate,
  inputToDate,
  isOsTarget,
  isTargetShadowed,
  type MigrationPreview,
  type PlatformUpdateTargetType,
  type UucPredicate,
  type UucRule,
  type UucStage,
} from '@/components/policy/platformUpdates';

interface PlatformUpdatesSectionProps {
  config: Record<string, unknown>;
  onChange: (path: string, value: unknown) => void;
}

const DAYS = [
  ['MONDAY', 'Mon'],
  ['TUESDAY', 'Tue'],
  ['WEDNESDAY', 'Wed'],
  ['THURSDAY', 'Thu'],
  ['FRIDAY', 'Fri'],
  ['SATURDAY', 'Sat'],
  ['SUNDAY', 'Sun'],
] as const;

const CONTROL_LABELS = {
  systemUpdate: 'System update policy',
  uuc: 'Unified update controls',
  default: 'Update client default',
} as const;

function updatePredicate(rule: UucRule, key: keyof UucPredicate, value: unknown): UucRule {
  const predicate = { ...(rule.predicate ?? {}) } as Record<string, unknown>;
  if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) delete predicate[key];
  else predicate[key] = value;
  return {
    ...rule,
    predicate: Object.keys(predicate).length > 0 ? predicate as UucPredicate : undefined,
  };
}

function HourSelect({
  label,
  emptyLabel,
  value,
  onChange,
}: {
  label: string;
  emptyLabel: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
      <select
        aria-label={label}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      >
        <option value="">{emptyLabel}</option>
        {Array.from({ length: 24 }, (_, hour) => (
          <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>
        ))}
      </select>
    </div>
  );
}

function createDuplicateRuleId(rule: UucRule, rules: UucRule[]): string {
  const existing = new Set(rules.map((candidate) => candidate.id?.trim()).filter(Boolean));
  const base = `${rule.id?.trim() || 'update-rule'}-copy`;
  let candidate = base.slice(0, 64);
  let suffix = 2;
  while (existing.has(candidate)) {
    const suffixText = `-${suffix}`;
    candidate = `${base.slice(0, 64 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  return candidate;
}

function UucRuleEditor({
  rule,
  index,
  rules,
  config,
  onUpdate,
  onMove,
  onDuplicate,
  onRemove,
}: {
  rule: UucRule;
  index: number;
  rules: UucRule[];
  config: Record<string, unknown>;
  onUpdate: (rule: UucRule) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const issues = getRuleEditorIssues(rule, index, rules);
  const warnings = getRuleEditorWarnings(rule);
  const targetTypes = new Set((rule.targets ?? []).map((target) => target.targetType));
  const hasOsTarget = (rule.targets ?? []).some((target) => isOsTarget(target.targetType));
  const singleApp = (rule.targets ?? []).find((target) => target.targetType === 'SINGLE_APP');

  const toggleTarget = (targetType: PlatformUpdateTargetType, checked: boolean) => {
    const nextTargets = checked
      ? [...(rule.targets ?? []), targetType === 'SINGLE_APP'
        ? { targetType, singleApp: { packageName: '' } }
        : { targetType }]
      : (rule.targets ?? []).filter((target) => target.targetType !== targetType);
    let outcome = rule.outcome;
    if (outcome?.outcomeType === 'USER_PROMPT' && !nextTargets.some((target) => isOsTarget(target.targetType))) {
      outcome = { outcomeType: 'OUTCOME_TYPE_UNSPECIFIED' };
    }
    const nextHasOsTarget = nextTargets.some((target) => isOsTarget(target.targetType));
    onUpdate({ ...rule, targets: nextTargets, stages: nextHasOsTarget ? rule.stages : undefined, outcome });
  };

  const toggleStage = (stage: UucStage, checked: boolean) => {
    const stages = checked
      ? [...(rule.stages ?? []), stage]
      : (rule.stages ?? []).filter((candidate) => candidate !== stage);
    onUpdate({ ...rule, stages: stages.length ? stages : undefined });
  };

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Rule {index + 1}</p>
          <p className="mt-1 text-sm font-medium text-gray-900">{getUucRuleDisplayName(rule, index)}</p>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-gray-400">Configuration summary</p>
          <p className="mt-1 text-sm text-gray-600">{describeUucRule(rule)}</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={`Move rule ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:text-gray-200"><ArrowUp className="h-4 w-4" /></button>
          <button type="button" aria-label={`Move rule ${index + 1} down`} disabled={index === rules.length - 1} onClick={() => onMove(1)} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:text-gray-200"><ArrowDown className="h-4 w-4" /></button>
          <button type="button" aria-label={`Duplicate rule ${index + 1}`} disabled={rules.length >= 100} onClick={onDuplicate} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:text-gray-200"><Copy className="h-4 w-4" /></button>
          <button type="button" aria-label={`Delete rule ${index + 1}`} onClick={onRemove} className="rounded p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <p className="font-semibold">Rule needs attention</p>
          <ul className="mt-1 list-disc pl-4">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-semibold">Behaviour to review</p>
          <ul className="mt-1 list-disc pl-4">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-900">Rule name</label>
          <input
            aria-label={`Rule ${index + 1} name`}
            value={getUucRuleDisplayName(rule, index)}
            maxLength={120}
            onChange={(event) => onUpdate({ ...rule, _flashName: event.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <p className="mt-1 text-xs text-gray-500">For admins in Flash. The AMAPI rule ID is generated and kept stable automatically.</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-900">Outcome</label>
          <select
            aria-label={`Rule ${index + 1} outcome`}
            value={rule.outcome?.outcomeType ?? 'OUTCOME_TYPE_UNSPECIFIED'}
            onChange={(event) => onUpdate({
              ...rule,
              outcome: { outcomeType: event.target.value as UucRule['outcome']['outcomeType'] },
            })}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            <option value="OUTCOME_TYPE_UNSPECIFIED">Choose an outcome</option>
            <option value="BLOCK">Block</option>
            <option value="USER_PROMPT" disabled={!hasOsTarget}>User prompt (OS targets only)</option>
            <option value="FORCE">Force</option>
          </select>
          <p className="mt-1 text-xs text-gray-500">Force starts the evaluated action immediately. User prompt is effective only for OS targets. Block and user prompt remain subject to Android's maximum deferral limits.</p>
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-gray-900">Targets</legend>
        <p className="mt-1 text-xs text-gray-500">Choose one or more unique targets. Effectiveness is calculated per target.</p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {PLATFORM_UPDATE_TARGETS.map((targetType) => {
            const shadowed = isTargetShadowed(config, targetType);
            return (
              <label key={targetType} className={clsx('flex items-start gap-2 rounded-lg border p-2.5 text-sm', shadowed ? 'border-amber-200 bg-amber-50' : 'border-gray-200')}>
                <input type="checkbox" checked={targetTypes.has(targetType)} onChange={(event) => toggleTarget(targetType, event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent" />
                <span>
                  <span className="font-medium text-gray-800">{PLATFORM_UPDATE_TARGET_LABELS[targetType]}</span>
                  {shadowed && <span className="mt-0.5 block text-xs text-amber-700">Shadowed by System update policy</span>}
                </span>
              </label>
            );
          })}
        </div>
        {targetTypes.has('SINGLE_APP') && (
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-gray-700">Google system-service package name</label>
            <input
              aria-label={`Rule ${index + 1} single app package name`}
              value={singleApp?.singleApp?.packageName ?? ''}
              onChange={(event) => onUpdate({
                ...rule,
                targets: rule.targets.map((target) => target.targetType === 'SINGLE_APP'
                  ? { ...target, singleApp: { packageName: event.target.value.trim() } }
                  : target),
              })}
              placeholder="com.google.android.webview"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <p className="mt-1 text-xs text-gray-500">One package per rule. Google does not publish a fixed package list, so enter the app's package name. AMAPI checks that it belongs to Google system services when the policy is saved. Use another rule for another app.</p>
          </div>
        )}
      </fieldset>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-gray-900">Evaluation stages</legend>
        <p className="mt-1 text-xs text-gray-500">Optional. Empty means all stages. Stages are honoured only for OEM OS targets. Apply-stage control is best-effort and cannot prevent every user-initiated reboot or immediately applied update.</p>
        <div className="mt-2 flex flex-wrap gap-4">
          {(['STAGE_DOWNLOAD', 'STAGE_APPLY'] as UucStage[]).map((stage) => (
            <label key={stage} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" disabled={!hasOsTarget} checked={rule.stages?.includes(stage) ?? false} onChange={(event) => toggleStage(stage, event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50" />
              {stage === 'STAGE_DOWNLOAD' ? 'Download' : 'Apply'}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <legend className="px-1 text-sm font-medium text-gray-900">Conditions (all must match)</legend>
        <p className="mb-3 text-xs text-gray-500">Leave all conditions blank to apply this rule at all times.</p>

        <div>
          <p className="text-xs font-medium text-gray-700">Days of week</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {DAYS.map(([value, label]) => (
              <label key={value} className="flex items-center gap-1.5 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={rule.predicate?.daysOfWeek?.includes(value) ?? false}
                  onChange={(event) => {
                    const days = event.target.checked
                      ? [...(rule.predicate?.daysOfWeek ?? []), value]
                      : (rule.predicate?.daysOfWeek ?? []).filter((day) => day !== value);
                    onUpdate(updatePredicate(rule, 'daysOfWeek', days));
                  }}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-accent focus:ring-accent"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <HourSelect label="Start time (included)" emptyLabel="Start of day" value={rule.predicate?.timeOfDayLowerBound?.hours} onChange={(hours) => onUpdate(updatePredicate(rule, 'timeOfDayLowerBound', hours === undefined ? undefined : { hours }))} />
          <HourSelect label="End time (not included)" emptyLabel="End of day" value={rule.predicate?.timeOfDayUpperBound?.hours} onChange={(hours) => onUpdate(updatePredicate(rule, 'timeOfDayUpperBound', hours === undefined ? undefined : { hours }))} />
        </div>
        <p className="mt-1 text-xs text-gray-500">Uses the device's local time and whole hours. Overnight periods need two rules: one before midnight and one after midnight.</p>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Start date</label>
            <input aria-label={`Rule ${index + 1} start date`} type="date" value={dateToInput(rule.predicate?.dateLowerBound)} onChange={(event) => onUpdate(updatePredicate(rule, 'dateLowerBound', inputToDate(event.target.value)))} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">End date</label>
            <input aria-label={`Rule ${index + 1} end date`} type="date" value={dateToInput(rule.predicate?.dateUpperBound)} onChange={(event) => onUpdate(updatePredicate(rule, 'dateUpperBound', inputToDate(event.target.value)))} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-500">Dates are evaluated in the device's local time zone.</p>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Available for at least (days)</label>
            <input aria-label={`Rule ${index + 1} minimum update age`} placeholder="No minimum" type="number" min={0} step={1} value={durationToDays(rule.predicate?.updateAgeLowerBound)} onChange={(event) => {
              if (event.target.value === '') return onUpdate(updatePredicate(rule, 'updateAgeLowerBound', undefined));
              const days = Number(event.target.value);
              const duration = daysToDuration(days);
              if (duration) onUpdate(updatePredicate(rule, 'updateAgeLowerBound', duration));
            }} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Available for at most (days)</label>
            <input aria-label={`Rule ${index + 1} maximum update age`} placeholder="No maximum" type="number" min={0} step={1} value={durationToDays(rule.predicate?.updateAgeUpperBound)} onChange={(event) => {
              if (event.target.value === '') return onUpdate(updatePredicate(rule, 'updateAgeUpperBound', undefined));
              const days = Number(event.target.value);
              const duration = daysToDuration(days);
              if (duration) onUpdate(updatePredicate(rule, 'updateAgeUpperBound', duration));
            }} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
            <p className="mt-1 text-xs text-gray-500">Leave blank for no maximum. Android also treats zero as no maximum.</p>
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-500">Update age is the time the specific update has been available to this device, in whole 24-hour days.</p>
      </fieldset>
    </article>
  );
}

export default function PlatformUpdatesSection({ config, onChange }: PlatformUpdatesSectionProps) {
  const rules = getUucRules(config);
  const overview = getEffectiveControlOverview(config);
  const systemUpdateConfigured = hasConfiguredSystemUpdate(config);
  const systemUpdateType = config.systemUpdate && typeof config.systemUpdate === 'object' && !Array.isArray(config.systemUpdate)
    ? (config.systemUpdate as Record<string, unknown>).type
    : undefined;
  const [migrationPreview, setMigrationPreview] = useState<MigrationPreview | null>(null);
  const hasShadowedTargets = useMemo(() => rules.some((rule) =>
    rule.targets?.some((target) => isTargetShadowed(config, target.targetType))), [config, rules]);

  const setRules = (next: UucRule[]) => {
    if (next.length === 0) onChange('unifiedUpdatePolicy', undefined);
    else onChange('unifiedUpdatePolicy.rules', next);
  };

  const updateRule = (index: number, nextRule: UucRule) => {
    const next = [...rules];
    next[index] = nextRule;
    setRules(next);
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900">Platform Updates</h3>
      <p className="mt-1 text-sm text-gray-500">Control OEM OS, Google Play system, and Google system-service updates.</p>

      <section className="mt-5 rounded-xl border border-teal-200 bg-teal-50 p-4">
        <h4 className="text-sm font-semibold text-teal-950">Which control should I use?</h4>
        <ul className="mt-2 list-disc space-y-2 pl-4 text-xs text-teal-950">
          <li><span className="font-semibold">OEM over-the-air updates, including OS upgrades and security-patch level updates:</span> configure System update policy below.</li>
          <li><span className="font-semibold">Google Play system updates (Mainline) and Google system services:</span> create UUC rules for those targets.</li>
          <li><span className="font-semibold">Fine-grained OEM update rules on supported company-owned devices:</span> create UUC rules for major OS updates or minor and security-patch updates, then clear System update policy.</li>
        </ul>
        <p className="mt-3 text-xs font-medium text-teal-950">Using both is valid, but the controls are not combined. System update policy controls OEM updates, including security-patch level updates. UUC can still control Mainline and Google system services. UUC rules for OEM updates have no effect until System update policy is cleared.</p>
      </section>

      <section className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <h4 className="text-sm font-semibold text-blue-950">Device eligibility</h4>
        <p className="mt-1 text-xs text-blue-900">UUC is supported only on company-owned devices. Fully managed devices need Android 13 or later for Google targets and Google OTA OS updates. COPE devices need Android 15 or later. OS updates from other OEMs need Android 17 or later in either management mode.</p>
        <p className="mt-2 text-xs text-blue-800">Policies are not enforced during setup, and early updates can begin before Android Device Policy receives the policy.</p>
      </section>

      <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h4 className="text-sm font-semibold text-amber-950">Important behaviour</h4>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-900">
          <li>Mainline is controlled as one update. UUC governs only the start of its download and cannot stop a download that has already begun.</li>
          <li>For updates delivered through Google Play, Block stops automatic updates only. Users can still update manually. Google Play Store and Android Device Policy updates are exempt.</li>
          <li>OEM updates can bundle Mainline modules and Google system services, so applying the OEM update can also update those components.</li>
          <li>Apply-stage control is best-effort. Some updates apply immediately after download, and a user-initiated reboot can apply a downloaded update.</li>
        </ul>
      </section>

      <section className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <h4 className="text-sm font-semibold text-gray-900">Effective control overview</h4>
        <p className="mt-1 text-xs text-gray-500">Configured policy authority by target. Device, Android version, management mode and OEM support can further limit UUC.</p>
        <div className="mt-3 grid gap-2">
          {overview.map((row) => (
            <div key={row.targetType} className="grid gap-1 rounded-lg border border-gray-200 bg-white p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div>
                <p className="text-sm font-medium text-gray-900">{row.label}</p>
                <p className="text-xs text-gray-500">{row.detail}</p>
              </div>
              <span className={clsx('w-fit rounded-full px-2 py-1 text-xs font-medium',
                row.control === 'systemUpdate' ? 'bg-amber-100 text-amber-800' :
                  row.control === 'uuc' ? 'bg-teal-100 text-teal-800' : 'bg-gray-100 text-gray-600')}
              >{CONTROL_LABELS[row.control]}</span>
            </div>
          ))}
        </div>
      </section>

      {systemUpdateConfigured && rules.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 flex-none" /><div>
            <p className="font-semibold">System update policy and UUC coexist</p>
            <p className="mt-1 text-xs">This is valid, but the settings do not layer or refine one another. System update policy remains authoritative for OEM OS targets. UUC targets are marked individually where shadowed.</p>
            {hasShadowedTargets && <p className="mt-1 text-xs font-medium">At least one UUC rule is partly or fully shadowed.</p>}
            {systemUpdateType === 'WINDOWED' && <p className="mt-1 text-xs">Windowed system update policy also affects Google Play app update timing.</p>}
          </div></div>
        </div>
      )}

      <section className="mt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold text-gray-900">Unified Update Controls</h4>
            <p className="mt-1 text-xs text-gray-500">Up to 100 ordered rules. Android Device Policy applies the first matching predicate for each update target and stage.</p>
          </div>
          <button type="button" disabled={rules.length >= 100} onClick={() => setRules([...rules, createDefaultUucRule(rules.length, rules)])} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:bg-gray-300"><Plus className="h-4 w-4" />Add rule</button>
        </div>

        <div className="mt-4 grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 md:grid-cols-3">
          <div className="md:col-span-3">
            <p className="font-semibold text-gray-800">Maximum delay after an update becomes available</p>
            <p className="mt-1">Android limits how long Block, and User prompt where supported, can delay each type of update.</p>
          </div>
          <div><span className="block font-semibold text-gray-800">Up to 5 days</span>Google system services and individual Google system apps</div>
          <div><span className="block font-semibold text-gray-800">Up to 25 days</span>Google Play system updates and OS updates without an API-level change</div>
          <div><span className="block font-semibold text-gray-800">Up to 180 days, or 90 days on COPE</span>OS updates with an API-level change</div>
          <p className="md:col-span-3">When the limit is reached, Block and User prompt stop delaying the update and the update client resumes its normal behaviour. The timer restarts when the device discovers a new update. For updates delivered through Google Play, Block prevents automatic updates only.</p>
        </div>

        {systemUpdateConfigured && (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-blue-900">Migration assistant</p>
                <p className="text-xs text-blue-800">Generate review-only candidates. Nothing clears System update policy automatically.</p>
              </div>
              <button type="button" onClick={() => setMigrationPreview(buildSystemUpdateMigrationCandidates(config))} className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-100">Generate candidate rules</button>
            </div>
            {migrationPreview && (
              <div className="mt-3 rounded border border-blue-200 bg-white p-3">
                <p className="text-xs font-semibold text-gray-900">Candidate preview</p>
                {migrationPreview.warnings.map((warning) => <p key={warning} className="mt-1 text-xs text-amber-700">{warning}</p>)}
                {migrationPreview.rules.map((rule, index) => <p key={rule.id} className="mt-2 text-xs text-gray-700"><span className="font-medium">{getUucRuleDisplayName(rule, index)}:</span> {describeUucRule(rule)}</p>)}
                {migrationPreview.rules.length > 0 && (
                  <button type="button" disabled={rules.length + migrationPreview.rules.length > 100} onClick={() => { setRules([...rules, ...migrationPreview.rules]); setMigrationPreview(null); }} className="mt-3 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:bg-gray-300">Add candidates for editing</button>
                )}
              </div>
            )}
          </div>
        )}

        {rules.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-gray-300 py-8 text-center text-sm text-gray-400">No UUC rules configured. Update clients use their normal behaviour, subject to System update policy where applicable.</div>
        ) : (
          <div className="mt-4 space-y-4">
            {rules.map((rule, index) => (
              <UucRuleEditor
                key={`${rule.id}-${index}`}
                rule={rule}
                index={index}
                rules={rules}
                config={config}
                onUpdate={(nextRule) => updateRule(index, nextRule)}
                onMove={(direction) => {
                  const destination = index + direction;
                  if (destination < 0 || destination >= rules.length) return;
                  const next = [...rules];
                  [next[index], next[destination]] = [next[destination], next[index]];
                  setRules(next);
                }}
                onDuplicate={() => {
                  if (rules.length >= 100) return;
                  const copy = structuredClone(rule);
                  copy.id = createDuplicateRuleId(rule, rules);
                  copy._flashName = `${getUucRuleDisplayName(rule, index)} copy`;
                  setRules([...rules.slice(0, index + 1), copy, ...rules.slice(index + 1)]);
                }}
                onRemove={() => setRules(rules.filter((_, candidateIndex) => candidateIndex !== index))}
              />
            ))}
          </div>
        )}
      </section>

      {systemUpdateConfigured && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-red-900">Clear System update policy</p>
              <p className="text-xs text-red-700">Separate explicit action. OEM UUC targets cannot become authoritative until this field is absent and the device supports them.</p>
            </div>
            <button type="button" onClick={() => {
              if (!window.confirm('Clear System update policy? Review UUC coverage first. This changes which policy controls OEM OS updates.')) return;
              onChange('systemUpdate', undefined);
            }} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">Clear System update policy</button>
          </div>
        </div>
      )}
    </div>
  );
}
