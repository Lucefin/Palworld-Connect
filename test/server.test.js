import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.NODE_ENV='test';
const dataDir=await mkdtemp(path.join(tmpdir(),'palconnect-'));
process.env.DATA_DIR=dataDir;
const {handler,endpoints}=await import('../server.js');
let server,base;
test.before(async()=>{server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`});
test.after(async()=>{await new Promise(r=>server.close(r));await rm(dataDir,{recursive:true,force:true})});

test('declares all 12 official endpoints',()=>assert.deepEqual(Object.keys(endpoints),['info','players','settings','metrics','gameData','announce','kick','ban','unban','save','shutdown','stop']));
test('health check works',async()=>{const r=await fetch(`${base}/api/health`);assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true})});
test('profiles can be created, normalized, updated and deleted',async()=>{
  let r=await fetch(`${base}/api/profiles`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Home',url:'localhost:8212',username:'admin',password:'secret'})});
  assert.equal(r.status,201);const p=await r.json();assert.equal(p.url,'http://localhost:8212/v1/api');assert.equal(p.hasPassword,true);assert.equal(p.password,undefined);
  r=await fetch(`${base}/api/profiles/${p.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Home 2',url:'http://localhost:8212/v1/api',username:'root'})});
  const updated=await r.json();assert.equal(updated.name,'Home 2');assert.equal(updated.hasPassword,true);
  r=await fetch(`${base}/api/profiles/${p.id}`,{method:'DELETE'});assert.equal(r.status,204);
  assert.deepEqual(await (await fetch(`${base}/api/profiles`)).json(),[]);
});
test('rejects malformed profiles',async()=>{const r=await fetch(`${base}/api/profiles`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(r.status,400)});
