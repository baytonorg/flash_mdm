import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const netlifyTomlPath = path.join(repoRoot, 'netlify.toml');
const functionsDir = path.join(repoRoot, 'netlify', 'functions');
const outputPath = path.join(repoRoot, 'public', 'openapi.json');

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function parseRedirects(toml) {
  const blocks = toml.split('[[redirects]]').slice(1);
  return blocks.map((block) => {
    const from = block.match(/^\s*from\s*=\s*"([^"]+)"/m)?.[1];
    const to = block.match(/^\s*to\s*=\s*"([^"]+)"/m)?.[1];
    return { from, to };
  }).filter((r) => r.from?.startsWith('/api/') && r.to?.includes('/.netlify/functions/'));
}

function extractFunctionNames(toPath) {
  const target = toPath.split('/.netlify/functions/')[1] ?? '';
  const normalized = target.split('/')[0];
  if (!normalized) return [];

  if (normalized.includes(':splat')) {
    const prefix = normalized.replace(':splat', '');
    const files = fs.readdirSync(functionsDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => f.replace(/\.ts$/, ''))
      .filter((name) => name.startsWith(prefix));
    return files;
  }

  return [normalized];
}

function defaultParamNameForSegment(segment) {
  if (!segment) return 'id';
  const normalized = segment.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  const special = {
    invites: 'token',
    resolve: 'token',
    users: 'user_id',
    role: 'role',
    access: 'access',
    operations: 'operation_id',
    versions: 'version',
    configs: 'config_id',
    secrets: 'secret_id',
    enrolment: 'enrollment_id',
    auth: 'action',
  };
  if (special[normalized]) return special[normalized];
  const singular = normalized.endsWith('ies')
    ? `${normalized.slice(0, -3)}y`
    : normalized.endsWith('s')
      ? normalized.slice(0, -1)
      : normalized;
  return `${singular.replace(/-/g, '_') || 'id'}_id`;
}

function toSnakeCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
}

function inferWildcardParamName(fromPath, starIndex) {
  const parts = fromPath.split('*');
  const before = parts.slice(0, starIndex).join('*');
  const after = parts[starIndex] ?? '';
  const prevSegments = before.split('/').filter(Boolean);
  const nextSegments = after.split('/').filter(Boolean);
  const prev = prevSegments[prevSegments.length - 1];
  const next = nextSegments[0];

  let candidate = defaultParamNameForSegment(prev);
  if (candidate === 'action' && next) candidate = defaultParamNameForSegment(next);
  if (candidate === 'id' && next) candidate = defaultParamNameForSegment(next);
  return candidate;
}

function convertRedirectPathToOpenApi(fromPath) {
  let starIndex = 0;
  return fromPath.replace(/\*/g, () => {
    starIndex += 1;
    const inferred = inferWildcardParamName(fromPath, starIndex);
    const suffix = starIndex === 1 ? '' : `_${starIndex}`;
    return `{${inferred}${suffix}}`;
  });
}

function redirectMatchesPath(fromPath, apiPath) {
  if (!fromPath || !apiPath) return false;
  const concreteApiPath = apiPath.replace(/\{[^}]+\}/g, 'x');
  if (!fromPath.includes('*')) return fromPath === concreteApiPath;
  const escaped = fromPath
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(concreteApiPath);
}

function redirectRoutesPathToFunction(redirect, apiPath, fnName) {
  if (!redirectMatchesPath(redirect.from, apiPath)) return false;
  if (!fnName) return true;

  const target = redirect.to?.split('/.netlify/functions/')[1] ?? '';
  const normalizedTarget = target.split('/')[0];
  if (!normalizedTarget) return false;

  if (normalizedTarget.includes(':splat')) {
    const fromPrefix = redirect.from.split('*')[0];
    const wildcardValue = apiPath.slice(fromPrefix.length).replace(/^\/+/, '');
    const firstSegment = wildcardValue.split('/').filter(Boolean)[0] ?? '';
    const targetFn = normalizedTarget.replace(':splat', firstSegment);
    return targetFn === fnName;
  }

  return normalizedTarget === fnName;
}

function isRoutedApiPath(apiPath, redirects, fnName) {
  return redirects.some((r) => redirectRoutesPathToFunction(r, apiPath, fnName));
}

function concreteAliasPathFromRedirect({ from, to }, fnName) {
  if (!from?.includes('*') || !to?.includes(':splat')) return null;
  const target = to.split('/.netlify/functions/')[1]?.split('/')[0] ?? '';
  if (!target.includes(':splat')) return null;
  const prefix = target.replace(':splat', '');
  if (!fnName.startsWith(prefix)) return null;
  const suffix = fnName.slice(prefix.length);
  if (!suffix) return null;
  return from.replace('*', suffix);
}

function concreteAliasesFromRedirect(redirect, functionNames) {
  return functionNames
    .map((fnName) => {
      const apiPath = concreteAliasPathFromRedirect(redirect, fnName);
      return apiPath ? { apiPath, fnName } : null;
    })
    .filter(Boolean);
}

function remapCommentPathToAliasAction(redirect, fnName, commentPath) {
  if (!redirect.from?.includes('*')) return null;
  let aliasBase = null;
  if (redirect.to?.includes(':splat')) {
    aliasBase = concreteAliasPathFromRedirect(redirect, fnName);
  } else {
    aliasBase = redirect.from.replace(/\/\*$/, '');
  }
  if (!aliasBase) return null;
  if (aliasBase.includes('*')) return null;
  if (redirectMatchesPath(redirect.from, commentPath)) return null;
  const aliasParts = aliasBase.split('/').filter(Boolean);
  const commentParts = commentPath.split('/').filter(Boolean);
  if (aliasParts.length < 2 || commentParts.length < 2) return null;
  if (aliasParts[0] !== 'api' || commentParts[0] !== 'api') return null;
  if (aliasParts[1] !== 'auth') return null;
  if (aliasParts[1] !== commentParts[1]) return null;
  const action = commentParts.at(-1);
  if (!action) return null;
  if (action.startsWith('{') && action.endsWith('}')) return null;
  if (action === aliasParts.at(-1)) return null;
  return `${aliasBase}/${action}`;
}

function inferMethodsFromSource(source) {
  const methods = new Set();
  for (const match of source.matchAll(/request\.method\s*===\s*'([A-Z]+)'/g)) {
    if (HTTP_METHODS.includes(match[1])) methods.add(match[1]);
  }
  for (const match of source.matchAll(/request\.method\s*!==\s*'([A-Z]+)'/g)) {
    if (HTTP_METHODS.includes(match[1])) methods.add(match[1]);
  }
  return [...methods];
}

function normalizeApiPath(rawPath) {
  return rawPath
    .split('?')[0]
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => `{${toSnakeCase(name)}}`);
}

function extractCommentedEndpoints(source) {
  const endpoints = [];
  for (const commentMatch of source.matchAll(/\/\/[^\n]*/g)) {
    const comment = commentMatch[0];
    const commentIndex = commentMatch.index ?? 0;
    for (const match of comment.matchAll(/(GET|POST|PUT|PATCH|DELETE|OPTIONS)\s+(\/api\/[^\s)]+)/g)) {
      const rawPath = match[2];
      const [rawNoQuery, rawQuery = ''] = rawPath.split('?');
      const queryParams = rawQuery
        .split('&')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const [name] = part.split('=');
          return name?.trim();
        })
        .filter(Boolean);
      for (const q of comment.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)=/g)) {
        queryParams.push(q[1]);
      }
      const nextEndpointOffset = (() => {
        const rest = source.slice(commentIndex + 1);
        const next = rest.match(/\/\/\s*(GET|POST|PUT|PATCH|DELETE|OPTIONS)\s+\/api\//);
        return next?.index != null ? commentIndex + 1 + next.index : source.length;
      })();
      const nearbyChunk = source.slice(commentIndex, Math.min(nextEndpointOffset, commentIndex + 5000));
      const bodyRequiredFields = [...nearbyChunk.matchAll(/!\s*body\.([a-zA-Z_][a-zA-Z0-9_]*)/g)]
        .map((m) => toSnakeCase(m[1]));
      endpoints.push({
        method: match[1],
        path: normalizeApiPath(rawNoQuery),
        queryParams: [...new Set(queryParams)],
        queryParamAlternatives: /\bOR\b/i.test(comment) && queryParams.length > 1,
        bodyRequiredFields: [...new Set(bodyRequiredFields)],
      });
    }
  }
  return endpoints;
}

function detectTag(apiPath) {
  const [, , segment] = apiPath.split('/');
  return segment || 'misc';
}

function pathParameters(apiPath) {
  const params = [];
  for (const match of apiPath.matchAll(/\{([^}]+)\}/g)) {
    params.push({
      name: match[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
  }
  return params;
}

function queryParameters(names = [], alternatives = false) {
  return names.map((name) => ({
    name,
    in: 'query',
    required: !alternatives,
    schema: { type: 'string' },
    description: alternatives
      ? 'Query parameter inferred from handler documentation comment (conditional/alternative requirement).'
      : 'Required query parameter (inferred from handler documentation comment).',
  }));
}

function pathTemplateSpecificityScore(apiPath) {
  return apiPath.split('/').filter(Boolean).reduce((score, segment) => {
    if (segment.startsWith('{') && segment.endsWith('}')) return score + 1;
    return score + 10;
  }, 0);
}

function canonicalizePathPlaceholders(apiPath) {
  const segments = apiPath.split('/');
  const seen = new Map();
  const canonical = segments.map((segment, index) => {
    const match = segment.match(/^\{([^}]+)\}$/);
    if (!match) return segment;
    let name = toSnakeCase(match[1]);
    const generic = new Set(['id', 'api_id']);
    if (generic.has(name)) {
      const prevLiteral = [...segments.slice(0, index)]
        .reverse()
        .find((s) => s && !s.startsWith('{'));
      if (segments[1] === 'api' && segments[2] === 'auth') {
        name = 'action';
      } else {
        name = defaultParamNameForSegment(prevLiteral);
      }
    }
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return `{${count === 0 ? name : `${name}_${count + 1}`}}`;
  });
  return canonical.join('/');
}

function classifyAuthRequirements(source) {
  const authModel = /requireSuperadmin\s*\(/.test(source)
    ? 'superadmin-session'
    : /requireSessionAuth\s*\(/.test(source)
      ? 'session-only'
      : /requireAuth\s*\(/.test(source)
        ? 'auth'
        : 'unknown';

  const apiKeyRejected = authModel !== 'auth' || (
    /auth\.authType\s*===\s*['"]api_key['"]/.test(source) &&
    /(Forbidden|API keys)/i.test(source)
  );

  const workspaceRoles = [...source.matchAll(/requireWorkspaceRole(?:ForAuth)?\s*\([^)]*?'(viewer|member|editor|admin|owner)'/g)].map((m) => m[1]);
  const environmentRoles = [...source.matchAll(/requireEnvironmentRole(?:ForAuth)?\s*\([^)]*?'(viewer|member|editor|admin|owner)'/g)].map((m) => m[1]);
  const workspacePerms = [...source.matchAll(/requireWorkspacePermission\s*\([^)]*?'([^']+)'/g)].map((m) => m[1]);
  const envResourcePerms = [...source.matchAll(/requireEnvironment(?:AccessScopeForResourcePermission|ResourcePermission)\s*\([^)]*?'([^']+)'\s*,\s*'([^']+)'/g)]
    .map((m) => `${m[1]}:${m[2]}`);
  const groupPerms = [...source.matchAll(/requireGroupPermission\s*\([^)]*?'([^']+)'/g)].map((m) => m[1]);

  return {
    authModel,
    apiKeyRejected,
    workspaceRoles: [...new Set(workspaceRoles)],
    environmentRoles: [...new Set(environmentRoles)],
    workspacePerms: [...new Set(workspacePerms)],
    envResourcePerms: [...new Set(envResourcePerms)],
    groupPerms: [...new Set(groupPerms)],
  };
}

function buildRequirementNotes(meta, operationHint) {
  const notes = [];
  if (!meta) return notes;
  if (meta.auth.authModel === 'session-only') notes.push('Auth: session cookie required (API keys rejected)');
  else if (meta.auth.authModel === 'superadmin-session') notes.push('Auth: superadmin session required (API keys rejected)');
  else if (meta.auth.authModel === 'auth') notes.push(`Auth: authenticated request required${meta.auth.apiKeyRejected ? ' (API keys rejected on this handler/flow)' : ' (session or API key, route-dependent)'}`);

  if (meta.auth.workspaceRoles.length) notes.push(`Workspace RBAC hints: ${meta.auth.workspaceRoles.map((r) => `${r}+`).join(', ')}`);
  if (meta.auth.environmentRoles.length) notes.push(`Environment RBAC hints: ${meta.auth.environmentRoles.map((r) => `${r}+`).join(', ')}`);
  if (meta.auth.workspacePerms.length) notes.push(`Workspace permissions checked: ${meta.auth.workspacePerms.join(', ')}`);
  if (meta.auth.envResourcePerms.length) notes.push(`Environment resource permissions checked: ${meta.auth.envResourcePerms.join(', ')}`);
  if (meta.auth.groupPerms.length) notes.push(`Group permissions checked: ${meta.auth.groupPerms.join(', ')}`);

  if (operationHint?.queryParams?.length) {
    notes.push(`Common ${operationHint.queryParamAlternatives ? 'query params (conditional/alternative)' : 'required query params'}: ${operationHint.queryParams.join(', ')}`);
  }
  if (operationHint?.bodyRequiredFields?.length) {
    notes.push(`Common required JSON body fields: ${operationHint.bodyRequiredFields.join(', ')}`);
  }
  return notes;
}

function mergeParameters(pathParams, inferredQueryParams) {
  const merged = [...pathParams];
  const seen = new Set(pathParams.map((p) => `${p.in}:${p.name}`));
  for (const p of inferredQueryParams) {
    const key = `${p.in}:${p.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
  }
  return merged;
}

function inferBodyFieldSchema(fieldName) {
  const name = String(fieldName).toLowerCase();
  if (name.endsWith('_ids')) return { type: 'array', items: { type: 'string' } };
  if (name.endsWith('_sections')) return { type: 'array', items: { type: 'string' } };
  if (name === 'locked' || name.startsWith('is_') || name.startsWith('has_') || name.endsWith('_enabled')) return { type: 'boolean' };
  if (name.includes('count') || name.includes('page') || name === 'version') return { type: 'integer' };
  return { type: 'string' };
}

function securityForAuthModel(authModel) {
  if (authModel === 'session-only' || authModel === 'superadmin-session') {
    return [{ sessionCookie: [] }];
  }
  return undefined;
}

function findCommentHint(sourceFunction, method, apiPath) {
  const meta = sourceFunction ? functionMeta.get(sourceFunction) : null;
  if (!meta) return null;
  const canonicalPath = canonicalizePathPlaceholders(apiPath);
  return meta.commented.find((ep) =>
    ep.method === method && canonicalizePathPlaceholders(ep.path) === canonicalPath
  ) ?? null;
}

function maybeAddPathOperation(pathsObj, { apiPath, method, sourceFunction, summary }) {
  const canonicalPath = canonicalizePathPlaceholders(apiPath);
  const methodKey = method.toLowerCase();
  if (!pathsObj[canonicalPath]) pathsObj[canonicalPath] = {};
  const existing = pathsObj[canonicalPath][methodKey];
  if (existing) return;
  pathsObj[canonicalPath][methodKey] = genericOperation({ method, apiPath: canonicalPath, sourceFunction, summary });
}

function collectCommentCandidatesForRedirect(redirect, functionNames) {
  const candidates = [];
  const seen = new Set();
  for (const fnName of functionNames) {
    const meta = functionMeta.get(fnName);
    if (!meta) continue;
    for (const endpoint of meta.commented) {
      let candidatePath = endpoint.path;
      if (!redirectMatchesPath(redirect.from, candidatePath)) {
        candidatePath = remapCommentPathToAliasAction(redirect, fnName, endpoint.path);
      }
      if (!candidatePath || !redirectRoutesPathToFunction(redirect, candidatePath, fnName)) continue;
      const key = `${endpoint.method} ${candidatePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ ...endpoint, path: candidatePath, fnName });
    }
  }
  return candidates.sort((a, b) => pathTemplateSpecificityScore(b.path) - pathTemplateSpecificityScore(a.path));
}

function genericOperation({ method, apiPath, sourceFunction, summary }) {
  const tag = detectTag(apiPath);
  const mutating = ['post', 'put', 'patch', 'delete'].includes(method.toLowerCase());
  const sourceMeta = sourceFunction ? functionMeta.get(sourceFunction) : null;
  const commentHint = findCommentHint(sourceFunction, method, apiPath);
  const requirementNotes = buildRequirementNotes(sourceMeta, commentHint);
  const baseDescription = sourceFunction ? `Implemented by Netlify function \`${sourceFunction}\`.` : undefined;
  const description = [baseDescription, ...requirementNotes.map((n) => `Requirement: ${n}`)]
    .filter(Boolean)
    .join('\n');
  const inferredBodyFields = mutating ? (commentHint?.bodyRequiredFields ?? []) : [];
  const inferredBodySchema = inferredBodyFields.length > 0
    ? {
      type: 'object',
      properties: Object.fromEntries(inferredBodyFields.map((f) => [f, inferBodyFieldSchema(f)])),
      required: inferredBodyFields,
      additionalProperties: true,
      description: 'Partially inferred request body schema from handler validation checks. Additional fields may be required or accepted.',
    }
    : {
      type: 'object',
      additionalProperties: true,
    };
  return {
    operationId: `${method.toLowerCase()}_${apiPath.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`,
    tags: [tag],
    summary: summary || `${method} ${apiPath}`,
    description: description || undefined,
    security: securityForAuthModel(sourceMeta?.auth.authModel),
    parameters: mergeParameters(pathParameters(apiPath), queryParameters(commentHint?.queryParams, commentHint?.queryParamAlternatives)),
    'x-flash-auth': sourceMeta?.auth ?? undefined,
    'x-flash-inferred': commentHint ? {
      queryParams: commentHint.queryParams ?? [],
      queryParamAlternatives: !!commentHint.queryParamAlternatives,
      bodyRequiredFields: commentHint.bodyRequiredFields ?? [],
    } : undefined,
    requestBody: mutating ? {
      required: inferredBodyFields.length > 0,
      content: {
        'application/json': {
          schema: inferredBodySchema,
        },
      },
    } : undefined,
    responses: {
      '200': {
        description: 'Success',
        content: {
          'application/json': {
            schema: { type: 'object', additionalProperties: true },
          },
        },
      },
      '400': { description: 'Bad request' },
      '401': { description: 'Unauthorized' },
      '403': { description: 'Forbidden' },
      '404': { description: 'Not found' },
      '500': { description: 'Server error' },
    },
  };
}

function methodsForFunction(fnName) {
  const methods = functionMeta.get(fnName)?.methods ?? [];
  return methods.length > 0 ? methods : ['GET'];
}

const functionFiles = fs.readdirSync(functionsDir).filter((f) => f.endsWith('.ts'));
const functionMeta = new Map();
for (const file of functionFiles) {
  const fullPath = path.join(functionsDir, file);
  const source = read(fullPath);
  functionMeta.set(file.replace(/\.ts$/, ''), {
    methods: inferMethodsFromSource(source),
    commented: extractCommentedEndpoints(source),
    auth: classifyAuthRequirements(source),
  });
}

const paths = {};
const redirects = parseRedirects(read(netlifyTomlPath));

for (const [fnName, meta] of functionMeta.entries()) {
  for (const endpoint of meta.commented) {
    if (!isRoutedApiPath(endpoint.path, redirects, fnName)) continue;
    maybeAddPathOperation(paths, {
      method: endpoint.method,
      apiPath: endpoint.path,
      sourceFunction: fnName,
      summary: endpoint.path.includes('?')
        ? `${endpoint.method} ${endpoint.path.split('?')[0]}`
        : undefined,
    });
  }
}

for (const redirect of redirects) {
  const functionNames = extractFunctionNames(redirect.to);
  const commentCandidates = collectCommentCandidatesForRedirect(redirect, functionNames);
  const concreteAliases = redirect.to.includes(':splat')
    ? concreteAliasesFromRedirect(redirect, functionNames)
    : [];

  for (const candidate of commentCandidates) {
    maybeAddPathOperation(paths, {
      method: candidate.method,
      apiPath: candidate.path,
      sourceFunction: candidate.fnName,
    });
  }

  for (const { apiPath: aliasPath, fnName: aliasFnName } of concreteAliases) {
    const methods = new Set(methodsForFunction(aliasFnName));
    for (const method of methods) {
      maybeAddPathOperation(paths, {
        method,
        apiPath: aliasPath,
        sourceFunction: aliasFnName,
      });
    }
  }

  // For explicit (non-wildcard) redirects, avoid over-emitting methods for
  // multiplexed handlers (e.g. one function serving /assign and /effective).
  // Prefer comment-matched methods on this exact path; only fall back to
  // inferred methods when the handler exposes a single method overall.
  if (!redirect.from.includes('*')) {
    const apiPath = convertRedirectPathToOpenApi(redirect.from);
    const canonicalApiPath = canonicalizePathPlaceholders(apiPath);
    const hasExistingOperation = Object.values(paths[canonicalApiPath] ?? {}).length > 0;
    if (hasExistingOperation) continue;

    for (const fnName of functionNames) {
      const exactPathCommentMethods = commentCandidates
        .filter((candidate) =>
          candidate.fnName === fnName
          && canonicalizePathPlaceholders(candidate.path) === canonicalApiPath
        )
        .map((candidate) => candidate.method);

      if (exactPathCommentMethods.length > 0) {
        for (const method of new Set(exactPathCommentMethods)) {
          maybeAddPathOperation(paths, {
            method,
            apiPath,
            sourceFunction: fnName,
          });
        }
        continue;
      }

      const inferredMethods = [...new Set(methodsForFunction(fnName))];
      if (inferredMethods.length !== 1) continue;
      for (const method of inferredMethods) {
        maybeAddPathOperation(paths, {
          method,
          apiPath,
          sourceFunction: fnName,
        });
      }
    }
  }

  // Skip generic wildcard placeholders when we found any concrete/commented templates.
  if (concreteAliases.length > 0 || commentCandidates.length > 0) continue;

  const apiPath = convertRedirectPathToOpenApi(redirect.from);
  const methods = new Set();
  for (const fnName of functionNames) {
    for (const method of methodsForFunction(fnName)) methods.add(method);
  }
  for (const method of methods.size ? methods : ['GET']) {
    maybeAddPathOperation(paths, {
      method,
      apiPath,
      sourceFunction: functionNames[0],
    });
  }
}

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Flash MDM API',
    version: '1.0.0',
    description: 'Route-complete OpenAPI specification generated from Netlify route mappings and handler sources. Endpoint request/response schemas are generic for legacy handlers unless explicitly documented.',
  },
  servers: [
    { url: 'https://flash-mdm.netlify.app' },
    { url: 'http://localhost:8888', description: 'Netlify Dev' },
  ],
  security: [
    { bearerAuth: [] },
    { apiKeyHeader: [] },
    { sessionCookie: [] },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Use a generated workspace/environment API key.',
      },
      apiKeyHeader: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      },
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'flash_session',
      },
    },
  },
  paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2) + '\n');
console.log(`Wrote ${outputPath}`);
