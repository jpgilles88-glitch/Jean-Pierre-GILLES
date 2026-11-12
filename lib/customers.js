import { randomBytes, createHash, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
const hash = value => createHash('sha256').update(value).digest('hex');
const cookie = (token, age = 2592000) => `herblay_customer=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`;
const profile = user => ({ name: user.name, email: user.email });
export async function customerHandler(req, path, store, context, json) {
  const method = req.method;
  if (Number(req.headers.get('content-length')) > 50000) return json({error:'Requête trop volumineuse'},413);
  const token = (req.headers.get('cookie') || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('herblay_customer='))?.slice(17);
  const sessionKey = token && /^[a-f0-9]{64}$/.test(token) ? 'customer-session/'+hash(token) : null;
  const session = sessionKey ? await store.get(sessionKey,{type:'json'}) : null;
  const userKey = session && session.until > Date.now() ? session.userKey : null;
  const current = userKey ? await store.getWithMetadata(userKey,{type:'json'}) : null;
  if (path[0] === 'session' && method === 'GET') return json({user:current ? profile(current.data) : null});
  if (path[0] === 'session' && method === 'DELETE') {
    if (sessionKey) await store.delete(sessionKey);
    return json({ok:true},200,{'Set-Cookie':cookie('',0)});
  }
  if (['register','login'].includes(path[0]) && method === 'POST') {
    const rateKey='customer-rate/'+hash(context.ip || 'unknown');
    let allowed=false;
    for(let i=0;i<5;i++) {
      const old=await store.getWithMetadata(rateKey,{type:'json'});
      const rate=old?.data.until>Date.now()?old.data:{count:0,until:Date.now()+900000};
      if(rate.count>=15) return json({error:'Trop de tentatives. Réessayez dans 15 minutes.'},429);
      const saved=await store.setJSON(rateKey,{...rate,count:rate.count+1},old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
      if(saved.modified){allowed=true;break;}
    }
    if(!allowed) return json({error:'Réessayez dans un instant'},429);
    const body=await req.json();
    const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof body.password!=='string'||body.password.length<12||body.password.length>128) return json({error:'Email valide et mot de passe de 12 à 128 caractères requis.'},400);
    const key='customer/'+hash(email);
    let user=await store.get(key,{type:'json'});
    if(path[0]==='register') {
      const name=typeof body.name==='string'?body.name.trim():'';
      if(!name||name.length>100) return json({error:'Nom requis (100 caractères maximum)'},400);
      const salt=randomBytes(16).toString('hex');
      const password=(await scrypt(body.password,salt,64)).toString('hex');
      const created={name,email,salt,password,lists:[]};
      const saved=await store.setJSON(key,created,{onlyIfNew:true});
      if(!saved.modified) return json({error:'Inscription impossible avec cet email. Essayez de vous connecter.'},409);
      user=created;
    } else {
      const password=await scrypt(body.password,user?.salt || 'missing-account-salt',64);
      if(!user || !timingSafeEqual(password,Buffer.from(user.password,'hex'))) return json({error:'Email ou mot de passe incorrect'},401);
    }
    const token=randomBytes(32).toString('hex');
    await store.setJSON('customer-session/'+hash(token),{userKey:key,until:Date.now()+2592000000});
    return json({user:profile(user)},200,{'Set-Cookie':cookie(token)});
  }
  if(!current) return json({error:'Connectez-vous à votre compte client'},401);
  if(path[0]==='lists') {
    if(method==='GET') return json({lists:current.data.lists,revision:current.etag});
    if(!['POST','DELETE'].includes(method)) return json({error:'Méthode refusée'},405);
    if(req.headers.get('if-match')!==current.etag) return json({error:'Vos listes ont changé. Actualisez puis réessayez.'},409);
    const user=current.data;
    if(method==='DELETE') {
      user.lists=user.lists.filter(l=>l.id!==path[1]);
    } else {
      const body=await req.json();
      if(typeof body.name!=='string'||!body.name.trim()||body.name.length>80||!Array.isArray(body.items)||!body.items.length||body.items.length>100||body.items.some(i=>typeof i.id!=='string'||i.id.length>100||!Number.isInteger(i.count)||i.count<1||i.count>1000000)||new Set(body.items.map(i=>i.id)).size!==body.items.length) return json({error:'Nom et produits valides requis (100 produits maximum)'},400);
      if(user.lists.length>=30) return json({error:'30 listes maximum. Supprimez une ancienne liste.'},400);
      user.lists.push({id:randomBytes(16).toString('hex'),name:body.name.trim(),items:body.items.map(({id,count})=>({id,count}))});
    }
    const saved=await store.setJSON(userKey,user,{onlyIfMatch:current.etag});
    if(!saved.modified) return json({error:'Vos listes ont changé. Actualisez puis réessayez.'},409);
    return json({lists:user.lists,revision:saved.etag});
  }
  return json({error:'Introuvable'},404);
}
