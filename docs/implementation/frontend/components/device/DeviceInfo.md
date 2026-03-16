# `src/components/device/DeviceInfo.tsx`

> Comprehensive device information view that extracts and displays hardware, software, network, security, management, enrolment, display, memory, power, and application data from the AMAPI snapshot, including interactive charts.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DeviceInfo` | `default function` | Renders the full device info dashboard |
| `DeviceInfoProps` | `interface` | Props type for the component |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `device` | `Device` | Yes | Device object containing top-level fields and a raw AMAPI `snapshot` |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `isRecord` | 90-92 | Type guard to check if a value is a plain object |
| `getPathValue` | 94-110 | Traverses a nested object/array by dot-separated path string |
| `extractSnapshotValue` | 112-120 | Attempts multiple snapshot paths and returns the first non-null scalar |
| `formatScalar` | 122-127 | Converts primitive values to string or returns null |
| `formatDateTime` | 129-142 | Parses and formats a date value to locale string |
| `parseNumeric` | 144-151 | Parses a string or number into a finite number |
| `formatBytes` | 153-165 | Formats byte counts into human-readable units (KB/MB/GB/TB) |
| `formatBoolean` | 167-170 | Converts boolean to "Yes"/"No" |
| `prettyKey` | 172-177 | Converts camelCase/snake_case keys to Title Case labels |
| `safeArray` | 179-181 | Safely casts an unknown value to a typed array |
| `parseJsonString` | 183-191 | Attempts to parse a JSON string into a record |
| `countBy` | 193-201 | Groups and counts string occurrences, returns sorted label/count pairs |
| `InfoRow` | 203-212 | Renders a label-value row with N/A fallback |
| `Section` | 214-234 | Card wrapper with icon and title |
| `ChartCard` | 236-243 | Card wrapper for chart content with fixed height |
| `CodeBlock` | 245-251 | Renders a preformatted code block |

## Dependencies (imports from project)

None (only uses external libraries: `react-chartjs-2`, `chart.js`, `lucide-react`).

## Key Logic

This is the largest device component. It takes a `Device` object with an embedded AMAPI snapshot and extracts data into organized sections: Hardware, Software, Network, Security & Storage, Management, Enrolment, Displays, and System Properties. It uses `getPathValue` to safely traverse deeply nested snapshot fields. Three Chart.js charts are conditionally rendered: a memory/storage line chart from `memoryEvents`, a battery level line chart from `powerManagementEvents`, and an app source bar chart from `applicationReports`. The component also parses `enrollmentTokenData` as JSON when possible and renders it in a code block. All sections gracefully handle missing data with "N/A" placeholders.
