// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, symlink, chmod, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TraceWriter } from '../_lib/trace-writer.js';
import { buildTraceReport } from '../_lib/trace-reader.js';
import { writeTraceCheckpoint, traceComparisons, traceWindowBounds } from '../_lib/trace-checkpoints.js';

vi.mock('node:fs/promises', async original => {
  const real = await original<typeof import('node:fs/promises')>();
  return { ...real, lstat: vi.fn(real.lstat) };
});

const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const window = '2026-10-26';
const {from,to} = traceWindowBounds(window);
let directory: string;
let report: Awaited<ReturnType<typeof buildTraceReport>>;
beforeEach(async()=>{
  vi.mocked(lstat).mockImplementation(actualFs.lstat);
  directory=await mkdtemp(join(tmpdir(),'flash-checkpoint-owner-'));
  const writer=new TraceWriter({directory,component:'test',now:()=>new Date(+from+60000),minimumFreeBytes:0});
  writer.write({schema:1,time:new Date(+from+60000).toISOString(),event:'http.end',data:{status:200,outcome:'success'}});
  await writer.close();
  report=await buildTraceReport(directory,from,to);
});
afterEach(async()=>{vi.restoreAllMocks();await rm(directory,{recursive:true,force:true});});

async function retainSentinel() {
  const reports=join(directory,'reports');await mkdir(reports,{mode:0o700});
  const sentinel=join(reports,'2026-01-01.json');await writeFile(sentinel,'{"sentinel":"retained"}',{mode:0o600});
  return {reports,sentinel,before:await stat(sentinel)};
}

describe('checkpoint publication ownership',()=>{
  it('publishes service-readable private checkpoints under the matching owner',async()=>{
    expect(await writeTraceCheckpoint(directory,window,report)).toEqual({written:true});
    const reports=join(directory,'reports');
    expect((await stat(reports)).mode&0o777).toBe(0o700);
    for(const name of await readdir(reports)){
      const file=await stat(join(reports,name));
      expect(file.uid).toBe(process.geteuid?.());expect(file.mode&0o777).toBe(0o600);
    }
    expect(await traceComparisons(directory,to)).toMatchObject({seven_days:{windows_available:1,http_requests:1}});
  });

  it('rejects a different effective operator before creating a report directory',async()=>{
    const owner=(await stat(directory)).uid;
    vi.spyOn(process,'geteuid').mockReturnValue(owner+1);
    await expect(writeTraceCheckpoint(directory,window,report)).rejects.toThrow('Publish checkpoints as the owner');
    expect(await readdir(directory)).not.toContain('reports');
  });

  it('leaves older evidence unchanged when a different effective operator attempts publication',async()=>{
    const {reports,sentinel,before}=await retainSentinel();
    vi.spyOn(process,'geteuid').mockReturnValue((await stat(directory)).uid+1);
    await expect(writeTraceCheckpoint(directory,window,report)).rejects.toThrow('Publish checkpoints as the owner');
    expect(await readdir(reports)).toEqual(['2026-01-01.json']);
    expect(await readFile(sentinel,'utf8')).toBe('{"sentinel":"retained"}');
    expect((await stat(sentinel)).mtimeMs).toBe(before.mtimeMs);
  });

  it('rejects a mismatched reports owner before touching its candidates',async()=>{
    const {reports,sentinel,before}=await retainSentinel();
    vi.mocked(lstat).mockImplementation(async (...args: Parameters<typeof lstat>)=>{
      const value=await actualFs.lstat(args[0]);
      return args[0]===reports ? new Proxy(value,{get:(target,key)=>key==='uid'?Number(target.uid)+1:Reflect.get(target,key)}) : value;
    });
    await expect(writeTraceCheckpoint(directory,window,report)).rejects.toThrow('Checkpoint storage must be private and owned');
    expect(await readdir(reports)).toEqual(['2026-01-01.json']);
    expect(await readFile(sentinel,'utf8')).toBe('{"sentinel":"retained"}');
    expect((await stat(sentinel)).mtimeMs).toBe(before.mtimeMs);
  });

  it('rejects a symlink root without changing the real directory',async()=>{
    const link=directory+'-link';await symlink(directory,link);
    const before=await readdir(directory);
    try{await expect(writeTraceCheckpoint(link,window,report)).rejects.toThrow('Publish checkpoints as the owner');expect(await readdir(directory)).toEqual(before);}
    finally{await rm(link);}
  });

  it('rejects an existing public reports directory without changing its contents',async()=>{
    const {reports}=await retainSentinel();await chmod(reports,0o755);
    await expect(writeTraceCheckpoint(directory,window,report)).rejects.toThrow('Checkpoint storage must be private and owned');
    expect(await readdir(reports)).toEqual(['2026-01-01.json']);
  });
});
