import { AsyncLocalStorage } from 'node:async_hooks';

// Receipt probes report bounded aggregate outcomes instead of recursively
// generating several database trace spans for every original audit write.
const diagnostic = new AsyncLocalStorage<boolean>();
export const isDatabaseDiagnostic = () => diagnostic.getStore() === true;
export function runDatabaseDiagnostic<T>(fn: () => Promise<T>): Promise<T> {
  return diagnostic.run(true, fn);
}
