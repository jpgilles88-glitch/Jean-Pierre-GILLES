import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../netlify/functions/api.mjs';
test('comptes et listes : sessions, isolation, conflits, déconnexion et mots de passe', async()=>{
  const records=new Map(); let revision=0;
  const store={
    async get(key){return records.has(key)?structuredClone(records.get(key).data):null},
    async getWithMetadata(key){return records.has(key)?structuredClone(records.get(key)):null},
    async setJSON(key,data,options={}){
      const old=records.get(key);
      if((options.onlyIfNew&&old)||(options.onlyIfMatch&&options.onlyIfMatch!==old?.etag))return {modified:false};
      const etag=String(++revision);records.set(key,{data:structuredClone(data),etag});return {modified:true,etag};
    },
    async delete(key){records.delete(key)}
  };
  const handler=createHandler(()=>store,{});
  async function call(path,method='GET',body,cookie='',headers={}){
    const res=await handler(new Request('https://marche.test/api/customer/'+path,{method,headers:{cookie,...headers},...(body?{body:JSON.stringify(body)}:{})}),{ip:'test'});
    return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
  }
  const person={name:'Alice',email:'alice@example.com',password:'a-long-password-123'};
  assert.equal((await call('lists')).status,401);
  assert.equal((await call('register','POST',{...person,password:'short'})).status,400);
  const registered=await call('register','POST',person);
  assert.equal(registered.status,200);const alice=registered.cookie;
  assert.equal((await call('session','GET',null,alice)).data.user.name,'Alice');
  assert.ok(!JSON.stringify([...records.values()]).includes(person.password));
  const bob=(await call('register','POST',{...person,email:'bob@example.com',name:'Bob'})).cookie;
  const first=await call('lists','GET',null,alice);
  const list={name:'Ma semaine',items:[{id:'tomates',count:2}]};
  const saved=await call('lists','POST',list,alice,{'if-match':first.data.revision});
  assert.equal(saved.data.lists.length,1);
  assert.equal((await call('lists','GET',null,bob)).data.lists.length,0);
  assert.equal((await call('lists','POST',list,alice,{'if-match':first.data.revision})).status,409);
  assert.equal((await call('lists','POST',{...list,items:[{id:'tomates',count:-1}]},alice,{'if-match':saved.data.revision})).status,400);
  assert.equal((await call('login','POST',{...person,password:'wrong-password-123'})).status,401);
  const login=await call('login','POST',person);assert.equal(login.status,200);
  assert.equal((await call('lists','GET',null,login.cookie)).data.lists.length,1);
  assert.equal((await call('lists/'+saved.data.lists[0].id,'DELETE',null,alice,{'if-match':saved.data.revision})).data.lists.length,0);
  await call('session','DELETE',null,alice);
  assert.equal((await call('lists','GET',null,alice)).status,401);
  assert.equal((await call('lists','GET',null,bob)).status,200);
});
