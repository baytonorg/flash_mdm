// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import pg from 'pg';
import { MIGRATIONS } from '../migrate.js';
import { closeDatabasePool } from '../_lib/db.js';
import handler, { hashPassword, loginAccountRateLimitBucket } from '../auth-login.js';
const url=process.env.LOGIN_LENGTH_TEST_DATABASE_URL;
(url?describe:describe.skip)('long-address login using real PostgreSQL and handler',()=>{
 let pool:pg.Pool;
 const address=(length:number)=>'a'.repeat(64)+'@'+'b'.repeat(63)+'.'+'c'.repeat(63)+'.'+'d'.repeat(length-193);
 beforeAll(async()=>{
  const parsed=new URL(url!);if(parsed.hostname!=='127.0.0.1'||parsed.pathname!=='/flash_login_length_fixture')throw new Error('Refusing non-disposable database');
  process.env.DATABASE_URL=url;process.env.NODE_ENV='development';pool=new pg.Pool({connectionString:url});
  for(const m of MIGRATIONS)await pool.query(m.sql);
 },30000);
 afterAll(async()=>{await closeDatabasePool();await pool?.end();});
 const call=(email:string,ip:string,password='synthetic-password')=>handler(new Request('http://localhost/api/auth/login',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':ip},body:JSON.stringify({email,password})}),{} as never);
 it('keeps existing short-address bucket identities and bounds long ones',()=>{
  for(const n of [20,239,240,254]){
   const email=n===20?'sample@fixture.test':address(n),bucket=loginAccountRateLimitBucket(email);
   expect(bucket.length).toBeLessThanOrEqual(255);
   if(n<=239)expect(bucket).toBe('auth:login:acct:'+email);else expect(bucket).toMatch(/^auth:login:acct-sha256:[a-f0-9]{64}$/);
   if(n>239)expect(bucket).not.toContain(email);
  }
 });
 it.each([239,240,254])('returns ordinary non-enumerating failure for an unknown %s-character address',async length=>{
  const r=await call(address(length),'fixture-'+length);expect(r.status).toBe(401);expect(await r.json()).toEqual({error:'Invalid email or password'});
 });
 it('normalises long address case/whitespace to the same existing throttle budget',async()=>{
  const email=address(241);
  for(let i=0;i<5;i++)expect((await call(i%2?'  '+email.toUpperCase()+'  ':email,'fixture-case-'+i)).status).toBe(401);
  const r=await call(email,'fixture-case-final');expect(r.status).toBe(429);expect(r.headers.get('retry-after')).toBeTruthy();
  expect((await pool.query('SELECT count(*)::int n FROM rate_limit_buckets WHERE id=$1',[loginAccountRateLimitBucket(email)])).rows[0].n).toBe(1);
 });
 it('does not reset an already exhausted short-address account budget',async()=>{
  const email='existing@fixture.invalid',id='auth:login:acct:'+email;
  await pool.query('INSERT INTO rate_limit_buckets(id,tokens,max_tokens,refill_rate,last_refill_at) VALUES($1,0,5,$2,now())',[id,5/900]);
  expect((await call(email,'fixture-existing')).status).toBe(429);
 });
 it('preserves an exhausted fitting Unicode bucket using PostgreSQL character semantics',async()=>{
  const email='😀'.repeat(223)+'@fixture.invalid',id='auth:login:acct:'+email;
  expect(Array.from(email)).toHaveLength(239);expect(email.length).toBeGreaterThan(239);
  expect(loginAccountRateLimitBucket(email)).toBe(id);
  await pool.query('INSERT INTO rate_limit_buckets(id,tokens,max_tokens,refill_rate,last_refill_at) VALUES($1,0,5,$2,now())',[id,5/900]);
  expect((await call(email,'fixture-unicode-existing')).status).toBe(429);
 });
 it('bounds the first over-limit Unicode identifier and preserves ordinary failure semantics',async()=>{
  const email='😀'.repeat(224)+'@fixture.invalid';expect(Array.from(email)).toHaveLength(240);
  expect(loginAccountRateLimitBucket(email)).toMatch(/^auth:login:acct-sha256:[a-f0-9]{64}$/);
  expect((await call(email,'fixture-unicode-long')).status).toBe(401);
 });
 it('serialises concurrent normalised long-address attempts into five permitted failures',async()=>{
  const email=address(242),results=await Promise.all(Array.from({length:8},(_,i)=>call(i%2?email.toUpperCase():email,'fixture-concurrent-'+i)));
  expect(results.map(r=>r.status).sort()).toEqual([401,401,401,401,401,429,429,429]);
 });
 it('authenticates an existing long-address synthetic account through the unchanged password/session flow',async()=>{
  const email=address(243);await pool.query('INSERT INTO users(email,password_hash) VALUES($1,$2)',[email,hashPassword('synthetic-password')]);
  const r=await call(email,'fixture-success');expect(r.status).toBe(200);expect(r.headers.get('set-cookie')).toContain('flash_session=');
  const body=await r.json();expect(body.user.email).toBe(email);expect((await pool.query('SELECT count(*)::int n FROM sessions')).rows[0].n).toBe(1);
 });
});
