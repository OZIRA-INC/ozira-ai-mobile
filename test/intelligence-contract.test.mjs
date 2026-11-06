import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');
const load = code => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const contract = await load(await source('src/conversationContract.js'));
const { numberedLines } = await load(await source('src/markdownLines.js'));
const base = 'https://ozira-ai-production.up.railway.app';
const response = {reply:'Your bakery website and logo', images:[{id:'logo',url:'/img/logo.png'}],metadata:{tool:{name:'web_build',status:'completed'},webBuild:{projectId:'bakery',projectName:'Bakery',url:'https://www.ozira.et/site/0123456789abcdef0123456789abcdef',files:['index.html','styles.css'],html:'<script>bad()</script>'}}};

test('ordinary composite response retains safe image and website through JSON/request contracts', () => {
  const message = contract.assistantMessage(response,base);
  const restored = contract.conversationMessage(JSON.parse(JSON.stringify(message)),base);
  assert.equal(restored.image,`${base}/img/logo.png`);
  assert.equal(restored.metadata.webBuild.projectId,'bakery');
  assert.equal(restored.metadata.webBuild.html,response.metadata.webBuild.html);
  assert.deepEqual(contract.requestMessages([restored],base)[0].metadata,restored.metadata);
  assert.equal(contract.projectReference('../venture'),null);
});
test('artifact validation rejects executable, foreign, authenticated, traversal and environment-crossing URLs', () => {
  for (const url of ['javascript:alert(1)','https://evil.test/site/abcdefgh','https://u:p@www.ozira.et/site/abcdefgh','/site/abcdefgh?run=x']) assert.equal(contract.ownedAssetUrl(url,base,'website'),null);
  assert.equal(contract.ownedAssetUrl('https://www.ozira.et/site/abcdefgh','https://staging.example','website'),null);
  const result = contract.messageMetadata({webBuild:{...response.metadata.webBuild,files:['../secret','x\\..\\secret','/root','index.html']}},base);
  assert.deepEqual(result.webBuild.files,['index.html']);
  assert.equal(contract.conversationMessage({role:'system',content:'bad'},base),null);
});
test('ordered lists increment repeated ones across blanks, nested lists, and leave code untouched', () => {
  assert.equal(numberedLines('1. First\n\n1. Second\n  1. Child\n  1. Child two\n1. Third'),'1. First\n\n2. Second\n  1. Child\n  2. Child two\n3. Third');
  assert.equal(numberedLines('4. Four\n1. Five\nParagraph\n1. New'),'4. Four\n5. Five\nParagraph\n1. New');
  assert.equal(numberedLines('```md\n1. Code\n1. Code\n```'),'```md\n1. Code\n1. Code\n```');
  for(let end=0;end<40;end++) assert.equal(typeof numberedLines('1. Streaming\n1. Next'.slice(0,end)),'string');
});

async function storeFixture() {
  const files = new Map([['ozira-store.json',JSON.stringify({conversations:{legacy:{id:'legacy',messages:[{role:'user',content:'UNOWNED SECRET'}]}},order:['legacy']})]]);
  const server = new Map(); let offline=false, pending;
  class File { constructor(_,name){this.name=name;} get exists(){return files.has(this.name);} async text(){return files.get(this.name);} create(){files.set(this.name,'');} write(value){files.set(this.name,value);} }
  const api={
    async saveConversation(c){if(offline)throw Error('offline');const id=c.id||'remote';server.set(id,{...c,id});return {id};},
    async getConversation(id){if(pending)return pending();if(offline)throw Error('offline');return {conversation:server.get(id)};},
    async conversations(){if(offline)throw Error('offline');return {conversations:[...server.values()].map(({id,title,projectId})=>({id,title,projectId}))};},
    async conversationMeta(){},async folders(){return {folders:[]};}
  };
  const key=`__mobile_test_${Math.random()}`;
  globalThis[key]={Paths:{document:'test'},File,api,config:{API_BASE:base},...contract};
  let code=await source('src/localStore.js');
  code=code.replace(/^import .*;$/gm,'');
  const module=await load(`const {Paths,File,api,config,conversationMessage,projectReference}=globalThis[${JSON.stringify(key)}];\n${code}`);
  delete globalThis[key];
  return {module,files,server,setOffline(value){offline=value;},setPending(value){pending=value;}};
}
test('actual localStore saves/reopens project artifact online, list summaries and offline',async()=>{
 const f=await storeFixture(),s=f.module;s.setConversationOwner('accountA');
 await s.saveConversation({id:'local',title:'Bakery',projectId:'bakery',messages:[contract.assistantMessage(response,base)]});
 await s.listConversations();
 assert.equal((await s.getCachedConversation('local')).messages.length,1);
 const online=await s.getConversation('local');assert.equal(online.projectId,'bakery');assert.equal(online.messages[0].metadata.webBuild.projectId,'bakery');
 f.setOffline(true);const offline=await s.getConversation('local');assert.equal(offline.messages[0].image,`${base}/img/logo.png`);
});
test('logout/account switch excludes unowned legacy and other account caches',async()=>{
 const f=await storeFixture(),s=f.module;s.setConversationOwner('accountA');f.setOffline(true);
 await s.saveConversation({id:'private',messages:[{role:'user',content:'A SECRET'}]});
 s.setConversationOwner('accountB');assert.deepEqual(await s.listConversations(),[]);assert.equal(await s.getCachedConversation('private'),null);assert.equal(await s.getCachedConversation('legacy'),null);
 s.setConversationOwner(null);await assert.rejects(s.getCachedConversation('private'),{code:'ACCOUNT_CHANGED'});
 s.setConversationOwner('accountA');assert.equal((await s.getCachedConversation('private')).messages[0].content,'A SECRET');
 assert.ok(!f.files.get('ozira-account-accountB.json')?.includes('A SECRET'));
});
test('in-flight previous-account response cannot enter next account cache',async()=>{
 const f=await storeFixture(),s=f.module;s.setConversationOwner('accountA');let release,started;
 const ready=new Promise(resolve=>started=resolve);f.setPending(()=>{started();return new Promise(resolve=>release=resolve);});
 const request=s.getConversation('secret');await ready;s.setConversationOwner('accountB');release({conversation:{id:'secret',messages:[{role:'user',content:'A SECRET'}]}});
 await assert.rejects(request,{code:'ACCOUNT_CHANGED'});assert.equal(await s.getCachedConversation('secret'),null);
});
test('API request snapshots account token before asynchronous device lookup',async()=>{
 let release,started;const ready=new Promise(resolve=>started=resolve);const calls=[];
 const fixture={ownedAssetUrl:contract.ownedAssetUrl,documentArtifact:contract.documentArtifact,config:{API_BASE:base},AsyncStorage:{getItem(){started();return new Promise(resolve=>release=resolve);},async setItem(){}},Platform:{OS:'ios'},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({})};}};
 const key=`__api_test_${Math.random()}`;globalThis[key]=fixture;
 const code=(await source('src/api.js')).replace(/^import .*;$/gm,'');
 const apiModule=await load(`const {config,AsyncStorage,Platform,fetch,documentArtifact,ownedAssetUrl}=globalThis[${JSON.stringify(key)}];\n${code}`);delete globalThis[key];
 apiModule.setToken('account-A-test-token');const request=apiModule.api.chat({messages:[]});await ready;apiModule.setToken('account-B-test-token');release('device-test');await request;
 assert.equal(calls[0].options.headers.authorization,'Bearer account-A-test-token');
});
test('direct A→B switch invalidates deferred chat/image/research updates before autosave',async()=>{
 const f=await storeFixture(),s=f.module;s.setConversationOwner('accountA');
 for(const mode of ['chat','image','research','vision']) {
   s.setConversationOwner('accountA');const current=s.conversationSessionLease();let release;
   const response=new Promise(resolve=>release=resolve);let rendered=[],saved=false;
   const completion=response.then(async value=>{if(!current())return;rendered=[value];await s.saveConversation({id:mode,messages:rendered});saved=true;});
   s.setConversationOwner('accountB');release({role:'assistant',content:'A PRIVATE'});await completion;
   assert.deepEqual(rendered,[]);assert.equal(saved,false);assert.equal(await s.getCachedConversation(mode),null);
 }
 const screen=await source('src/screens/ChatConversationScreen.js'),nav=await source('src/navigation/RootNavigator.js');
 assert.match(nav,/<AppStack key=\{ownerId\}/);assert.match(screen,/const setMessages = value => \{ if \(currentSession\(\)\)/);
 assert.match(screen,/if \(!currentSession\(\) \|\| !dirtyRef.current\) return/);assert.match(screen,/abortRef.current\?\.abort\(\)/);
});
test('same-account conversation navigation tears down actual deferred send handlers before another chat can receive them', async()=>{
 const screen=await source('src/screens/ChatConversationScreen.js');
 assert.match(screen,/<ChatConversationContent key=\{props\.route\.params\?\.conversationId \|\| props\.route\.key\}/);
 const start=screen.indexOf('  async function send('),end=screen.indexOf('\n  return (',start);
 assert.ok(start>0&&end>start);
 const implementation=screen.slice(start,end).trim();
 for(const mode of ['chat','image','research','vision']) {
   let mounted=true,release;const updates=[],notifications=[],requests=[];
   const deferred=new Promise(resolve=>release=resolve);
   const noop=()=>{};
   const scope={
     currentSession:()=>mounted,input:'request',attachment:mode==='vision'?{kind:'photo',base64:'AQID',mimeType:'image/png'}:null,
     research:mode==='research',busy:false,imageMode:mode==='image',messages:[],editIdx:null,editSource:null,
     setInput:noop,setAttachment:noop,dirtyRef:{current:false},setEditIdx:noop,setMessages:value=>updates.push(value),
     scrollDown:noop,setBusy:noop,AbortController,abortRef:{current:null},route:{params:{}},isImageRequest:()=>false,
     imageFromDataUrl:()=>null,setImageMode:noop,token:'same-account',mode:'fast',effort:'quick',lang:'en',projectId:'ventureA',convId:'conversationA',
     requestMessages:contract.requestMessages,assistantMessage:contract.assistantMessage,config:{API_BASE:base},absUrl:value=>new URL(value,base).href,
     api:{chat:payload=>{requests.push(payload);return deferred;},image:()=>{throw Error('Unscoped image route must not be used');},imageEdit:()=>deferred,aiResearch:()=>deferred,aiVision:()=>deferred},
     setEditSource:noop,notify:(...args)=>notifications.push(args),t:value=>value,speakText:noop,
   };
   // Execute the actual screen handler, not a recreated completion callback.
   const send=Function(...Object.keys(scope),'return '+implementation)(...Object.values(scope));
   const pending=send('Create something',false);assert.equal(updates.length,1);assert.equal(updates[0].at(-1).pending,true);
   if(mode==='image') {
     assert.equal(requests[0].projectId,'ventureA');assert.equal(requests[0].conversationId,'conversationA');
     assert.equal(requests[0].skill,'image');assert.equal(requests[0].messages[0].content,'Create something');
   }
   // A keyed conversation remount runs this existing teardown before B owns UI.
   mounted=false;scope.abortRef.current.abort();
   release({...response,reply:'PRIVATE A',configured:true,text:'PRIVATE A',images:[{id:'A',url:'/img/a.png'}]});await pending;
   assert.equal(updates.length,1,mode+' must not render or autosave the old reply in conversation B');
   assert.equal(notifications.length,0);
   if(mode==='image') {
     // The same actual handler also retains composite metadata on normal success.
     mounted=true;await send('Create something',false);
     assert.equal(updates.at(-1).at(-1).metadata.webBuild.projectId,'bakery');
   }
 }
});
const document={id:'doc_test',format:'pdf',mimeType:'application/pdf',fileName:'report.pdf',byteLength:4,downloadUrl:'/api/documents/doc_test'};
test('document metadata survives save contract; downloads require auth and reject errors without exposing bearer URL',async()=>{
 const normalized=contract.conversationMessage({role:'assistant',content:'Report',metadata:{document}},base);
 assert.equal(JSON.parse(JSON.stringify(normalized)).metadata.document.fileName,'report.pdf');
 const chatResponse=contract.assistantMessage({reply:'Report ready',documents:[{...document,downloadUrl:'https://evil.test/file'},document],metadata:{tool:{name:'document_generate',status:'completed'}}},base);
 assert.equal(chatResponse.metadata.document.id,document.id);assert.equal(chatResponse.metadata.tool.name,'document_generate');
 const f=await storeFixture();f.module.setConversationOwner('documentOwner');await f.module.saveConversation({id:'docchat',messages:[chatResponse]});
 assert.equal((await f.module.getConversation('docchat')).messages[0].metadata.document.fileName,'report.pdf');
 assert.equal(contract.documentArtifact({...document,downloadUrl:'https://evil.test/file'}),null);
 let status=200;const calls=[];
 const fixture={ownedAssetUrl:contract.ownedAssetUrl,documentArtifact:contract.documentArtifact,config:{API_BASE:base},AsyncStorage:{async getItem(){return 'existing-device-test';},async setItem(){}},Platform:{OS:'ios'},fetch:async(url,options)=>{calls.push({url,options});return {ok:status===200,status,headers:{get:()=>document.mimeType},arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer};}};
 const key=`__doc_test_${Math.random()}`;globalThis[key]=fixture;
 const code=(await source('src/api.js')).replace(/^import .*;$/gm,'');const module=await load(`const {config,AsyncStorage,Platform,fetch,documentArtifact,ownedAssetUrl}=globalThis[${JSON.stringify(key)}];\n${code}`);delete globalThis[key];
 await assert.rejects(module.downloadDocument(document),/Sign in/);
 const downloaded=await module.downloadDocument(document,'test-owner-token');assert.equal(downloaded.bytes.length,4);
 assert.equal(calls[0].url,base+document.downloadUrl);assert.equal(calls[0].options.headers.authorization,'Bearer test-owner-token');assert.equal(calls[0].options.redirect,'error');
 status=401;await assert.rejects(module.downloadDocument(document,'expired-test-token'),/401/);
});
test('private HTML export writes opaque source and removes temporary file; stale account never shares',async()=>{
 const events=[];let fail=false;
 class File {constructor(_,name){this.uri='file:///'+name;}create(){events.push('create');}write(data){events.push(data);}delete(){events.push('delete');}}
 const fixture={File,Paths:{cache:'cache'},Sharing:{async isAvailableAsync(){return true;},async shareAsync(uri,options){events.push({uri,options});if(fail)throw Error('chooser failed');}}};
 const key=`__export_test_${Math.random()}`;globalThis[key]=fixture;
 const code=(await source('src/artifactFiles.js')).replace(/^import .*;$/gm,'');const module=await load(`const {File,Paths,Sharing}=globalThis[${JSON.stringify(key)}];\n${code}`);delete globalThis[key];
 const html='<html><script>opaque source only</script></html>';
 await module.shareArtifactFile('website.html',html,'text/html',()=>true);assert.equal(events[1],html);assert.equal(events[2].options.mimeType,'text/html');assert.equal(events.at(-1),'delete');
 events.length=0;await module.shareArtifactFile('website.html',html,'text/html',()=>false);assert.deepEqual(events,[]);
 fail=true;await assert.rejects(module.shareArtifactFile('report.pdf',new Uint8Array([1]),'application/pdf',()=>true),/chooser failed/);assert.equal(events.at(-1),'delete');
});
test('private generated images use only configured gateway bearer headers, snapshot account and reject 401',async()=>{
 let status=200,release;const calls=[];
 const fixture={ownedAssetUrl:contract.ownedAssetUrl,documentArtifact:contract.documentArtifact,config:{API_BASE:base},AsyncStorage:{async getItem(){return 'existing-device-test';},async setItem(){}},Platform:{OS:'ios'},fetch:async(url,options)=>{calls.push({url,options});if(release===undefined)await new Promise(resolve=>release=resolve);return {ok:status===200,status,headers:{get:()=> 'image/png'},arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};}};
 const key=`__private_image_test_${Math.random()}`;globalThis[key]=fixture;
 const code=(await source('src/api.js')).replace(/^import .*;$/gm,'');const module=await load(`const {config,AsyncStorage,Platform,fetch,documentArtifact,ownedAssetUrl}=globalThis[${JSON.stringify(key)}];\n${code}`);delete globalThis[key];
 module.setToken('owner-A-test');assert.equal(module.generatedImageSource('/img/private.png').uri,undefined);
 await module.prepareDeviceIdentity();const sourceA=module.generatedImageSource('/img/private.png');assert.equal(sourceA.headers.authorization,'Bearer owner-A-test');assert.equal(sourceA.uri,base+'/img/private.png');assert.equal(sourceA.cache,'reload');assert.equal(sourceA.headers['x-ozira-device-id'],'existing-device-test');assert.match(sourceA.headers['x-ozira-device-label'],/iPhone/);
 for(const url of ['https://foreign.test/img/a.png','https://staging.example/img/a.png','data:image/png;base64,AQID','/api/profile'])assert.equal(module.generatedImageSource(url).headers,undefined);
 const alias=module.generatedImageSource('https://www.ozira.et/img/private.png');assert.equal(new URL(alias.uri).origin,new URL(base).origin);
 const pending=module.downloadGeneratedImage('/img/private.png');module.setToken('owner-B-test');await Promise.resolve();release();const result=await pending;assert.equal(result.mimeType,'image/png');assert.equal(calls[0].options.headers.authorization,'Bearer owner-A-test');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.cache,'no-store');
 assert.equal(module.generatedImageSource('/img/private.png').headers.authorization,'Bearer owner-B-test');
 await assert.rejects(module.downloadGeneratedImage('https://foreign.test/img/a.png'),/outside/);assert.equal(calls.length,1);
 status=401;await assert.rejects(module.downloadGeneratedImage('/img/private.png'),/401/);
 const screen=await source('src/screens/ChatConversationScreen.js'),library=await source('src/screens/LibraryScreen.js');
 assert.match(screen,/source=\{generatedImageSource\(viewerImage.url, token\)\}/);assert.match(library,/source=\{generatedImageSource\(img.url, token\)\}/);
});
test('image download waits for the existing shared device identity while retaining original account token',async()=>{
 let release,reads=0,writes=0;const calls=[];
 const fixture={ownedAssetUrl:contract.ownedAssetUrl,documentArtifact:contract.documentArtifact,config:{API_BASE:base},AsyncStorage:{getItem(){reads++;return new Promise(resolve=>release=resolve);},async setItem(){writes++;}},Platform:{OS:'android'},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,headers:{get:()=> 'image/png'},arrayBuffer:async()=>new Uint8Array([1]).buffer};}};
 const key=`__image_device_test_${Math.random()}`;globalThis[key]=fixture;const code=(await source('src/api.js')).replace(/^import .*;$/gm,'');
 const module=await load(`const {config,AsyncStorage,Platform,fetch,documentArtifact,ownedAssetUrl}=globalThis[${JSON.stringify(key)}];\n${code}`);delete globalThis[key];
 module.setToken('before-device-lookup');const pending=module.downloadGeneratedImage('/img/private.png');const sameInit=module.prepareDeviceIdentity();
 module.setToken('after-device-lookup');assert.equal(module.generatedImageSource('/img/private.png').uri,undefined);assert.equal(calls.length,0);release('persisted-device-identity');await Promise.all([pending,sameInit]);
 assert.equal(reads,1);assert.equal(writes,0);assert.equal(calls[0].options.headers.authorization,'Bearer before-device-lookup');assert.equal(calls[0].options.headers['x-ozira-device-id'],'persisted-device-identity');assert.match(calls[0].options.headers['x-ozira-device-label'],/Android/);
 assert.equal(module.generatedImageSource('/img/private.png').headers.authorization,'Bearer after-device-lookup');
 const nav=await source('src/navigation/RootNavigator.js');assert.match(nav,/if \(loading \|\| !deviceReady\)/);assert.match(nav,/prepareDeviceIdentity\(\).then/);
});
