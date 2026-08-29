import { AMAPI_POLICY_DISCOVERY_SCHEMA } from './amapi-policy-discovery-schema.js';

type DiscoveryDescriptor = {
  readonly $ref?: string;
  readonly type?: string;
  readonly format?: string;
  readonly enum?: readonly string[];
  readonly items?: DiscoveryDescriptor;
  readonly additionalProperties?: DiscoveryDescriptor;
  readonly properties?: Readonly<Record<string, DiscoveryDescriptor>>;
};

const schemas = AMAPI_POLICY_DISCOVERY_SCHEMA.schemas as Readonly<Record<string, DiscoveryDescriptor>>;

export const AMAPI_POLICY_DISCOVERY_REVISION = AMAPI_POLICY_DISCOVERY_SCHEMA.revision;
export const AMAPI_POLICY_DISCOVERY_SOURCE = AMAPI_POLICY_DISCOVERY_SCHEMA.source;

export function validateAmapiPolicyAgainstDiscovery(payload: unknown): string[] {
  const errors: string[] = [];
  validateValue(payload, { $ref: AMAPI_POLICY_DISCOVERY_SCHEMA.root }, '', errors);
  return errors;
}

export function isAmapiPolicyDiscoveryPath(path: string): boolean {
  const segments = path.split('.').filter(Boolean);
  let descriptor: DiscoveryDescriptor = { $ref: AMAPI_POLICY_DISCOVERY_SCHEMA.root };
  for (const segment of segments) {
    descriptor = resolveDescriptor(descriptor);
    const child = descriptor.properties?.[segment];
    if (!child) return false;
    descriptor = child;
  }
  return true;
}

function resolveDescriptor(descriptor: DiscoveryDescriptor): DiscoveryDescriptor {
  if (!descriptor.$ref) return descriptor;
  const resolved = schemas[descriptor.$ref];
  if (!resolved) throw new Error(`Pinned AMAPI schema is missing ${descriptor.$ref}`);
  return resolved;
}

function validateValue(value: unknown, rawDescriptor: DiscoveryDescriptor, path: string, errors: string[]): void {
  const descriptor = resolveDescriptor(rawDescriptor);
  const label = path || 'policy';

  if (descriptor.type === 'any') return;
  if (descriptor.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${label} must be an object according to AMAPI Discovery revision ${AMAPI_POLICY_DISCOVERY_REVISION}`);
      return;
    }
    const objectValue = value as Record<string, unknown>;
    if (descriptor.additionalProperties) {
      for (const [key, child] of Object.entries(objectValue)) {
        validateValue(child, descriptor.additionalProperties, joinPath(path, key), errors);
      }
      return;
    }
    for (const [key, child] of Object.entries(objectValue)) {
      const childDescriptor = descriptor.properties?.[key];
      const childPath = joinPath(path, key);
      if (!childDescriptor) {
        errors.push(`${childPath} is not defined in AMAPI Discovery revision ${AMAPI_POLICY_DISCOVERY_REVISION}`);
        continue;
      }
      validateValue(child, childDescriptor, childPath, errors);
    }
    return;
  }
  if (descriptor.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${label} must be an array according to AMAPI Discovery revision ${AMAPI_POLICY_DISCOVERY_REVISION}`);
      return;
    }
    if (descriptor.items) {
      value.forEach((child, index) => validateValue(child, descriptor.items!, `${label}[${index}]`, errors));
    }
    return;
  }
  if (descriptor.type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${label} must be a boolean according to AMAPI Discovery revision ${AMAPI_POLICY_DISCOVERY_REVISION}`);
    return;
  }
  if (descriptor.type === 'integer' && (!Number.isInteger(value) || typeof value !== 'number')) {
    errors.push(`${label} must be an integer according to AMAPI Discovery revision ${AMAPI_POLICY_DISCOVERY_REVISION}`);
    return;
  }
  if (descriptor.type === 'string') {
    const compatibleInt64 = descriptor.format === 'int64'
      && ((typeof value === 'number' && Number.isSafeInteger(value))
        || (typeof value === 'string' && /^-?\d+$/.test(value)));
    if (typeof value !== 'string' && !compatibleInt64) {
      errors.push(`${label} must be a string according to AMAPI Discovery revision ${AMAPI_POLICY_DISCOVERY_REVISION}`);
      return;
    }
  }
  if (descriptor.enum && !descriptor.enum.includes(value as string)) {
    errors.push(`${label}=${JSON.stringify(value)} is not a valid AMAPI value in Discovery revision ${AMAPI_POLICY_DISCOVERY_REVISION}`);
  }
}

function joinPath(parent: string, child: string): string {
  return parent ? `${parent}.${child}` : child;
}
