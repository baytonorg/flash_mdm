// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { MIGRATIONS } from '../migrate';
import { closeDatabasePool } from '../_lib/db';
import { hashToken } from '../_lib/crypto';
import users from '../workspace-users';
import groups from '../group-crud';
import environments from '../environment-crud';
import rbac from '../roles-rbac';
import invite from '../workspace-invite';
import { sendEmail } from '../_lib/resend';

vi.mock('../_lib/resend.js', async original => ({
  ...await original<typeof import('../_lib/resend.js')>(), sendEmail: vi.fn(),
}));
const db = process.env.USER_CONTROLS_TEST_DATABASE_URL;
const suite = db ? describe : describe.skip;

suite('User management controls match the invitation and access handlers', () => {
  let pool: pg.Pool;
  let workspace: string, env: string, parent: string, child: string, sibling: string, viewer: string, actor: string, target: string;
  const request = (path: string, body?: object, method = 'GET') => new Request('http://localhost' + path, {
    method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Cookie: 'flash_session=fixture-invite-only' },
    body: body && JSON.stringify(body),
  });
  const controls = async (environment = env) => {
    const response = await users(request('/api/workspaces/users?view=controls&workspace_id=' + workspace + '&environment_id=' + environment), {} as never);
    expect(response.status).toBe(200);
    return response.json();
  };
  const offer = (role: string, environment_ids: string[], group_ids: string[]) => invite(request('/api/workspaces/invite', {
    workspace_id: workspace, role, email: 'invitee@example.invalid', environment_ids, group_ids,
  }, 'POST'), {} as never);
  const groupGrant = (id: string, role: string) => pool.query('INSERT INTO group_memberships(group_id,user_id,role) VALUES($1,$2,$3)', [id,actor,role]);
  const envGrant = (role: string) => pool.query('INSERT INTO environment_memberships(environment_id,user_id,role) VALUES($1,$2,$3)', [env,actor,role]);

  beforeAll(async () => {
    const url = new URL(db!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/flash_user_controls_fixture') throw Error('Disposable user-controls database required');
    process.env.DATABASE_URL = db; process.env.NODE_ENV = 'development'; process.env.URL = 'http://localhost';
    process.env.RESEND_API_KEY = 'synthetic-local-mail-mock';
    pool = new pg.Pool({ connectionString: db });
    for (const migration of MIGRATIONS) await pool.query(migration.sql);
  });
  beforeEach(async () => {
    vi.mocked(sendEmail).mockClear();
    await pool.query('TRUNCATE workspaces, users CASCADE');
    const owner = crypto.randomUUID();
    [workspace, env, parent, child, sibling, viewer, actor, target] = Array.from({ length: 8 }, () => crypto.randomUUID());
    await pool.query(`INSERT INTO users(id,email) VALUES ($1,'owner@example.invalid'),($2,'actor@example.invalid'),($3,'target@example.invalid')`, [owner,actor,target]);
    await pool.query("INSERT INTO workspaces(id,name) VALUES($1,'Invite fixture')", [workspace]);
    await pool.query(`INSERT INTO workspace_memberships(workspace_id,user_id,role,access_scope)
      VALUES($1,$2,'owner','workspace'),($1,$3,'viewer','scoped'),($1,$4,'member','scoped')`, [workspace,owner,actor,target]);
    await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '10 days')", [hashToken('fixture-invite-only'),actor]);
    await pool.query("INSERT INTO environments(id,workspace_id,name) VALUES($1,$2,'Invite environment')", [env,workspace]);
    await pool.query(`INSERT INTO groups(id,environment_id,parent_group_id,name) VALUES
      ($1,$5,NULL,'Managed parent'),($2,$5,$1,'Managed child'),($3,$5,NULL,'Separate group'),($4,$5,$1,'Viewer child')`,
      [parent,child,sibling,viewer,env]);
    await pool.query(`INSERT INTO group_closures(ancestor_id,descendant_id,depth)
      VALUES ($1,$1,0),($2,$2,0),($3,$3,0),($4,$4,0),($1,$2,1),($1,$4,1)`, [parent,child,sibling,viewer]);
    await pool.query("INSERT INTO group_memberships(group_id,user_id,role) VALUES($1,$2,'member')", [parent,target]);
  });
  afterAll(async () => { await closeDatabasePool(); await pool?.end(); });

  it('offers only direct and inherited manageable groups, and persists a successful scoped invitation', async () => {
    await groupGrant(parent,'admin'); await groupGrant(viewer,'viewer');
    expect(await controls()).toEqual({ workspace_invite:null, environment_invite:null, workspace_manage:null, environment_manage:null,
      group_invites:{[parent]:'admin',[child]:'admin'} });
    expect((await offer('member',[env],[])).status).toBe(403);
    expect((await offer('owner',[],[child])).status).toBe(403);
    expect((await offer('member',[],[sibling])).status).toBe(403);
    expect((await offer('member',[],[child])).status).toBe(201);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((await pool.query('SELECT role,environment_ids,group_ids FROM user_invites')).rows)
      .toEqual([{ role:'member',environment_ids:[],group_ids:[child] }]);
  });
  it('keeps workspace, direct environment, nearest group and sibling ceilings independent', async () => {
    await pool.query("UPDATE workspace_memberships SET role='owner',access_scope='workspace' WHERE user_id=$1", [actor]);
    await envGrant('viewer'); await groupGrant(parent,'owner'); await groupGrant(child,'admin');
    expect(await controls()).toEqual({ workspace_invite:'owner', workspace_manage:'owner', environment_invite:null, environment_manage:null,
      group_invites:{[parent]:'owner',[child]:'admin',[viewer]:'owner'} });
    expect((await offer('owner',[],[child])).status).toBe(403);
    expect((await offer('owner',[],[parent])).status).toBe(201);
  });
  it('uses the environment role even when the scoped workspace label says owner', async () => {
    await pool.query("UPDATE workspace_memberships SET role='owner' WHERE user_id=$1", [actor]);
    await envGrant('admin');
    expect(await controls()).toMatchObject({ workspace_invite:null, workspace_manage:null, environment_invite:'admin', environment_manage:'admin',
      group_invites:{[sibling]:'admin'} });
    expect((await offer('owner',[env],[])).status).toBe(403);
    expect((await offer('member',[env],[])).status).toBe(201);
  });
  it('enforces an owner-only group override for a group-only admin with a separate direct owner grant', async () => {
    await groupGrant(parent,'admin'); await groupGrant(child,'owner');
    await pool.query(`UPDATE environments SET enterprise_features='{"rbac":{"permission_matrix":{"group":{"manage_users":"owner"}}}}' WHERE id=$1`,[env]);
    expect((await controls()).group_invites).toEqual({[child]:'owner'});
    expect((await offer('member',[],[parent])).status).toBe(403);
    expect((await offer('owner',[],[child])).status).toBe(201);
  });
  it('permits environment management independently of a stricter workspace ceiling', async () => {
    await pool.query("UPDATE workspace_memberships SET role='admin',access_scope='workspace' WHERE user_id=$1",[actor]);
    await pool.query(`UPDATE workspaces SET settings='{"rbac":{"permission_matrix":{"workspace":{"manage_users":"owner"},"invite":{"write":"owner"}}}}' WHERE id=$1`,[workspace]);
    expect(await controls()).toMatchObject({workspace_invite:null,workspace_manage:null,environment_manage:'admin',environment_invite:'admin'});
  });
  it('allows a genuine superadmin without a membership in the workspace', async () => {
    await pool.query('UPDATE users SET is_superadmin=true WHERE id=$1',[actor]);
    await pool.query('DELETE FROM workspace_memberships WHERE user_id=$1',[actor]);
    expect(await controls()).toMatchObject({workspace_manage:'owner',workspace_invite:'owner',environment_manage:'owner',environment_invite:'owner',
      group_invites:{[parent]:'owner',[child]:'owner',[sibling]:'owner'}});
    expect((await offer('owner',[env],[])).status).toBe(201);
  });
  it.runIf(process.env.CHROME_PATH && process.env.PLAYWRIGHT_MODULE)('accepts a real browser group invite with only email delivery stubbed', async () => {
    await groupGrant(parent,'admin');
    await groupGrant(viewer,'viewer');
    const { inspectUserManagement } = await import('../../../scripts/qa/user-management-browser.mjs');
    await inspectUserManagement({ actor, workspace, env, child, handlers: {
      '/api/workspaces/users': users, '/api/groups/list': groups, '/api/workspaces/invite': invite,
      '/api/environments/list': environments, '/api/roles/rbac': rbac,
    }, allowEnvironmentManager: async () => {
      await envGrant('admin');
      await pool.query("UPDATE workspace_memberships SET role='owner' WHERE user_id=$1", [actor]);
    }, removeActorGrants: async () => {
      await pool.query('DELETE FROM environment_memberships WHERE user_id=$1', [actor]);
      await pool.query('DELETE FROM group_memberships WHERE user_id=$1', [actor]);
    } });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect((await pool.query('SELECT role,environment_ids,group_ids FROM user_invites')).rows).toEqual([
      {role:'admin', environment_ids:[], group_ids:[child]}, {role:'admin', environment_ids:[], group_ids:[child]},
    ]);
  }, 90000);

  it('returns no environment/group controls for another workspace', async () => {
    await groupGrant(parent,'owner');
    const elsewhere = (await pool.query("INSERT INTO workspaces(name) VALUES('Another workspace') RETURNING id")).rows[0].id;
    const otherEnvironment = (await pool.query("INSERT INTO environments(workspace_id,name) VALUES($1,'Other environment') RETURNING id",[elsewhere])).rows[0].id;
    expect(await controls(otherEnvironment)).toEqual({workspace_manage:null,workspace_invite:null,environment_manage:null,environment_invite:null,group_invites:{}});
  });
});
