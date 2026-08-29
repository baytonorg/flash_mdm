import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const repoRoot = process.cwd();

function readText(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractGeneratedServer(): string {
  const installer = readText('install.sh');
  const match = installer.match(/cat > "\$RELEASE_DIR\/server\.ts" << 'SERVEREOF'\n([\s\S]*?)\nSERVEREOF/);
  if (!match) {
    throw new Error('Could not find generated server.ts heredoc in install.sh');
  }
  return match[1];
}

function extractGeneratedWorker(): string {
  const installer = readText('install.sh');
  const match = installer.match(/cat > "\$RELEASE_DIR\/worker\.ts" << 'WORKEREOF'\n([\s\S]*?)\nWORKEREOF/);
  if (!match) throw new Error('Could not find generated worker.ts heredoc in install.sh');
  return match[1];
}

function parseNetlifyRedirects() {
  const toml = readText('netlify.toml');
  const blocks = [...toml.matchAll(/\[\[redirects\]\]([\s\S]*?)(?=\n\[\[|$)/g)].map((match) => match[1]);
  return blocks
    .map((block) => ({
      from: block.match(/from\s*=\s*"([^"]+)"/)?.[1],
      to: block.match(/to\s*=\s*"([^"]+)"/)?.[1],
      status: block.match(/status\s*=\s*(\d+)/)?.[1],
    }))
    .filter((redirect): redirect is { from: string; to: string; status: string } =>
      Boolean(redirect.from && redirect.to && redirect.status)
    );
}

function handlerFromFunctionTarget(target: string): string | null {
  return target.match(/^\/\.netlify\/functions\/([^/:]+)/)?.[1] ?? null;
}

function parseServerImports(server: string): Map<string, string> {
  return new Map(
    [...server.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+'\.\/netlify\/functions\/([^']+)\.js';/g)]
      .map((match) => [match[1], match[2]])
  );
}

function parseServerRoutes(server: string, imports: Map<string, string>): Map<string, string> {
  return new Map(
    [...server.matchAll(/app\.all\('([^']+)'\s*,\s*h\(([A-Za-z_$][\w$]*)\)\);/g)]
      .map((match) => {
        const fn = imports.get(match[2]);
        if (!fn) throw new Error(`Route ${match[1]} references unknown handler ${match[2]}`);
        return [match[1], fn];
      })
  );
}

function parseDynamicDelegates(serverOrFunctionSource: string): Set<string> {
  return new Set(
    [...serverOrFunctionSource.matchAll(/import\('\.\/([^']+)\.js'\)/g)]
      .map((match) => match[1])
  );
}

function parseCronEndpoints(): string[] {
  const installer = readText('install.sh');
  const block = installer.match(/CRON_BLOCK="([\s\S]*?)"\n\n# Add cron jobs/)?.[1];
  if (!block) throw new Error('Could not find CRON_BLOCK in install.sh');
  return [...block.matchAll(/run-vps-scheduled\.sh ([A-Za-z0-9-]+)/g)].map((match) => `/api/${match[1]}`);
}

describe('VPS server parity', () => {
  const server = extractGeneratedServer();
  const imports = parseServerImports(server);
  const routes = parseServerRoutes(server, imports);
  const redirects = parseNetlifyRedirects();

  it('keeps every Netlify API redirect mapped to the same VPS handler', () => {
    const apiRedirects = redirects
      .filter((redirect) => redirect.status === '200')
      .filter((redirect) => redirect.from.startsWith('/api/') || redirect.from.startsWith('/.netlify/functions/'));

    const mismatches = apiRedirects
      .map((redirect) => {
        const expectedHandler = handlerFromFunctionTarget(redirect.to);
        if (!expectedHandler) return `${redirect.from}: unsupported target ${redirect.to}`;
        const actualHandler = routes.get(redirect.from);
        if (!actualHandler) return `${redirect.from}: missing VPS route for ${expectedHandler}`;
        if (actualHandler !== expectedHandler) {
          return `${redirect.from}: VPS uses ${actualHandler}, Netlify uses ${expectedHandler}`;
        }
        return null;
      })
      .filter(Boolean);

    expect(mismatches).toEqual([]);
  });

  it('exposes every cron endpoint through the VPS server', () => {
    expect(parseCronEndpoints().map((endpoint) => [endpoint, routes.get(endpoint)])).toEqual([
      ['/api/workflow-cron-scheduled', 'workflow-cron-scheduled'],
      ['/api/geofence-check-scheduled', 'geofence-check-scheduled'],
      ['/api/sync-reconcile-scheduled', 'sync-reconcile-scheduled'],
      ['/api/licensing-reconcile-scheduled', 'licensing-reconcile-scheduled'],
      ['/api/cleanup-scheduled', 'cleanup-scheduled'],
    ]);
  });

  it('runs scheduled device reconciliation through the shared Netlify handler', () => {
    expect(imports.get('syncReconcileScheduled')).toBe('sync-reconcile-scheduled');
    expect(routes.get('/api/sync-reconcile-scheduled')).toBe('sync-reconcile-scheduled');
    expect(parseCronEndpoints()).toContain('/api/sync-reconcile-scheduled');
  });

  it('keeps internally fetched Netlify function paths available on VPS', () => {
    const sources = readdirSync(path.join(repoRoot, 'netlify/functions'))
      .filter((file) => file.endsWith('.ts') && !file.startsWith('.'))
      .map((file) => readText(`netlify/functions/${file}`))
      .join('\n');
    const internallyFetched = new Set(
      [...sources.matchAll(/fetch\([^)]*?\/\.netlify\/functions\/([A-Za-z0-9-]+)/gs)]
        .map((match) => `/.netlify/functions/${match[1]}`)
    );

    const missing = [...internallyFetched].filter((internalPath) => !routes.has(internalPath));
    expect(missing).toEqual([]);
  });

  it('routes authenticated internal function paths through Caddy before the static fallback', () => {
    const installer = readText('install.sh');
    const internalRoute = installer.indexOf('handle /.netlify/functions/*');
    const staticFallback = installer.indexOf('handle {', internalRoute);

    expect(internalRoute).toBeGreaterThan(-1);
    expect(staticFallback).toBeGreaterThan(internalRoute);
    expect(installer.slice(internalRoute, staticFallback)).toContain('reverse_proxy localhost:3000');
  });

  it('generates an autonomous worker and a restartable VPS service', () => {
    const installer = readText('install.sh');
    const worker = extractGeneratedWorker();

    expect(worker).toContain("runLoop('queue'");
    expect(worker).toContain("runLoop('deployments'");
    expect(worker).toContain("import syncProcessBackground");
    expect(worker).toContain("import deploymentJobsBackground");
    expect(installer).toContain('/etc/systemd/system/flashmdm-worker.service');
    expect(installer).toContain('Environment=FLASH_RUNTIME=vps');
    expect(installer).toContain('sudo systemctl restart flashmdm-worker');
  });

  it('runs command-result and keyed-app-state processing through the shared handler', () => {
    const worker = extractGeneratedWorker();
    const handler = readText('netlify/functions/sync-process-background.ts');

    expect(worker).toContain(
      "import syncProcessBackground from './netlify/functions/sync-process-background.js'"
    );
    expect(worker).toContain("runLoop('queue', () => syncProcessBackground(");
    expect(handler).toContain("import { classifyAmapiCommandOperation }");
    expect(handler).toContain("typeof state.data === 'string'");
  });

  it('generates syntactically valid server and worker TypeScript', () => {
    for (const source of [server, extractGeneratedWorker()]) {
      const result = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
        reportDiagnostics: true,
      });
      const errors = (result.diagnostics ?? [])
        .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      expect(errors).toEqual([]);
    }
  });

  it('keeps every Caddy-routed internal handler behind internal caller authentication', () => {
    for (const functionName of [
      'deployment-jobs-background',
      'sync-process-background',
      'workflow-evaluate-background',
    ]) {
      const source = readText(`netlify/functions/${functionName}.ts`);
      expect(source).toContain("import { requireInternalCaller }");
      expect(source).toContain('requireInternalCaller(request)');
    }
  });

  it('retains cron failures and prevents overlapping scheduled runs', () => {
    const runner = readText('scripts/run-vps-scheduled.sh');
    expect(runner).toContain('flock -n');
    expect(runner).toContain('curl --fail');
    expect(runner).toContain('logger -t flashmdm-cron');
    expect(runner).not.toContain('/dev/null 2>&1');
  });

  it('keeps all function files reachable by redirect, cron, internal route, or explicit delegate', () => {
    const functionFiles = readdirSync(path.join(repoRoot, 'netlify/functions'))
      .filter((file) => file.endsWith('.ts') && !file.startsWith('.'))
      .map((file) => file.replace(/\.ts$/, ''));
    const netlifyTargets = redirects
      .map((redirect) => handlerFromFunctionTarget(redirect.to))
      .filter((handler): handler is string => Boolean(handler));
    const routedHandlers = [...routes.values()];
    const dynamicDelegates = new Set<string>();

    for (const file of functionFiles) {
      for (const delegate of parseDynamicDelegates(readText(`netlify/functions/${file}.ts`))) {
        dynamicDelegates.add(delegate);
      }
    }

    const reachable = new Set([...netlifyTargets, ...routedHandlers, ...dynamicDelegates]);
    const unreachable = functionFiles.filter((file) => !reachable.has(file));

    expect(unreachable).toEqual([]);
  });

  it('declares the runtime packages required by the generated VPS server', () => {
    const packageJson = JSON.parse(readText('package.json')) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies).toEqual(
      expect.objectContaining({
        '@hono/node-server': expect.any(String),
        dotenv: expect.any(String),
        hono: expect.any(String),
        tsx: expect.any(String),
      })
    );
  });
});
