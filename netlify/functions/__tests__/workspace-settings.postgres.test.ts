// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { MIGRATIONS } from '../migrate.js';
import { closeDatabasePool } from '../_lib/db.js';
import { hashToken } from '../_lib/crypto.js';
import handler from '../workspace-crud.js';

const url = process.env.WORKSPACE_SETTINGS_TEST_DATABASE_URL;
(url ? describe : describe.skip)('workspace settings through real PostgreSQL and HTTP handlers', () => {
  let pool: pg.Pool;
  const workspace = crypto.randomUUID(), other = crypto.randomUUID(), environment = crypto.randomUUID();
  const owner = crypto.randomUUID(), scoped = crypto.randomUUID(), outsider = crypto.randomUUID(), platform = crypto.randomUUID();
  const stored = {flashagent:{openai_api_key_enc:'inert-fixture-envelope'},future_secret:'inert-fixture-envelope',device_health:{stale_after_days:14},rbac:{permission_matrix:{workspace:{manage_settings:'owner'},audit:{read:'admin'}}}};
  const projected = {device_health:stored.device_health,rbac:stored.rbac};
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/flash_workspace_settings_fixture') throw new Error('Refusing non-disposable database');
    process.env.DATABASE_URL=url; process.env.NODE_ENV='development';
    pool=new pg.Pool({connectionString:url});
    for (const m of MIGRATIONS) await pool.query(m.sql);
    for (const [id,superadmin] of [[owner,false],[scoped,false],[outsider,false],[platform,true]] as const) {
      await pool.query('INSERT INTO users(id,email,is_superadmin) VALUES($1,$2,$3)',[id,id+'@fixture.invalid',superadmin]);
      await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')",[id,hashToken('fixture-'+id)]);
    }
    await pool.query("INSERT INTO workspaces(id,name,settings) VALUES($1,'Fixture',$3),($2,'Other',$3)",[workspace,other,stored]);
    await pool.query("INSERT INTO workspace_memberships(workspace_id,user_id,role,access_scope) VALUES($1,$2,'owner','workspace'),($1,$3,'member','scoped')",[workspace,owner,scoped]);
    await pool.query("INSERT INTO environments(id,workspace_id,name) VALUES($1,$2,'Fixture')",[environment,workspace]);
    for (const scope of ['workspace','environment']) await pool.query("INSERT INTO api_keys(name,scope_type,workspace_id,environment_id,role,token_hash,token_enc,token_prefix,created_by_user_id) VALUES('Fixture',$1,$2,$3,'viewer',$4,'inert-fixture-envelope','fixture',$5)",[scope,workspace,scope==='environment'?environment:null,hashToken('fixture-key-'+scope),owner]);
  },30000);
  afterAll(async () => {await closeDatabasePool();await pool?.end();});
  async function call(path:string,principal:string,key=false) {
    return handler(new Request('http://localhost'+path,{headers:key?{authorization:'Bearer fixture-key-'+principal}:{cookie:'flash_session=fixture-'+principal}}),{} as never);
  }
  for (const [name,id] of [['owner',owner],['scoped member',scoped],['platform admin',platform]]) {
    it('projects list settings for '+name,async()=>{
      const r=await call('/api/workspaces/list',id);expect(r.status).toBe(200);
      const body=await r.json();expect(body.workspaces.length).toBe(id===platform?2:1);
      for(const row of body.workspaces) expect(row.settings).toEqual(projected);
      expect(JSON.stringify(body)).not.toContain('inert-fixture-envelope');
    });
  }
  it.each(['/api/workspaces','/.netlify/functions/workspace-crud'])('projects alternate list %s',async path=>{
    const r=await call(path,scoped);expect(r.status).toBe(200);expect((await r.json()).workspaces[0].settings).toEqual(projected);
  });
  it('projects workspace-key list without granting cross-workspace access',async()=>{
    const r=await call('/api/workspaces/list','workspace',true);expect(r.status).toBe(200);
    const body=await r.json();expect(body.workspaces).toHaveLength(1);expect(body.workspaces[0]).toMatchObject({id:workspace,settings:projected});
    expect(body.workspaces[0].settings).toEqual(projected);
    expect((await call('/api/workspaces/'+other,'workspace',true)).status).toBe(403);
  });
  it('rejects environment-key list and detail without widening scope',async()=>{
    expect((await call('/api/workspaces/list','environment',true)).status).toBe(403);
    expect((await call('/api/workspaces/'+workspace,'environment',true)).status).toBe(403);
  });
  it('projects human and workspace-key detail',async()=>{
    for(const [id,key] of [[owner,false],['workspace',true]] as const){const r=await call('/api/workspaces/'+workspace,id,key);expect(r.status).toBe(200);expect((await r.json()).workspace.settings).toEqual(projected);}
  });
  it('denies outsiders and unauthenticated detail and leaves stored settings intact',async()=>{
    expect((await call('/api/workspaces/'+workspace,outsider)).status).toBe(403);
    expect((await call('/api/workspaces/'+other,owner)).status).toBe(403);
    expect((await handler(new Request('http://localhost/api/workspaces/list'),{} as never)).status).toBe(401);
    expect((await pool.query('SELECT settings FROM workspaces WHERE id=$1',[workspace])).rows[0].settings).toEqual(stored);
  });
});
