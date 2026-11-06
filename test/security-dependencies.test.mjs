// Installed-package contracts: run npm ci --ignore-scripts before npm test.
// No native device or hosted/provider acceptance is implied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const lock = require('../package-lock.json').packages;
const from = name => createRequire(require.resolve(name + '/package.json'));

test('locked security fixes retain Expo54/RN0.81.5 and remove unsafe decoder/image-size chains', () => {
 assert.equal(lock['node_modules/expo'].version,'54.0.36');
 assert.equal(lock['node_modules/react-native'].version,'0.81.5');
 for(const path of Object.keys(lock))assert.ok(!/node_modules\/(image-size|decode-uri-component|query-string)$/.test(path),path);
 const expected={'@react-navigation/core':'7.24.0',metro:'0.83.8',browserslist:'4.29.5',compression:'1.8.2','fast-uri':'3.1.9',nanoid:'3.3.20','node-forge':'1.4.3',postcss:'8.5.32','source-map-js':'1.2.2',tar:'7.5.22',undici:'6.29.1','shell-quote':'1.11.0'};
 for(const [name,version]of Object.entries(expected))assert.equal(lock['node_modules/'+name].version,version);
});
test('actual React Navigation URL parse/stringify preserves route parameters without vulnerable query-string',async()=>{
 const base=dirname(require.resolve('@react-navigation/core/package.json'));
 const {getStateFromPath}=await import(pathToFileURL(join(base,'lib/module/getStateFromPath.js')));
 const {getPathFromState}=await import(pathToFileURL(join(base,'lib/module/getPathFromState.js')));
 const config={screens:{Project:'projects/:id'}};
 const state=getStateFromPath('/projects/bakery?name=Golden%20Crust&amount=12',config);
 assert.equal(state.routes[0].params.id,'bakery');assert.equal(state.routes[0].params.name,'Golden Crust');
 const restored=getStateFromPath(getPathFromState(state,config),config);assert.deepEqual(restored.routes[0].params,state.routes[0].params);
 assert.doesNotThrow(()=>getStateFromPath('/projects/bakery?malformed=%E0%A4%A',config));
});
test('Metro patched asset API reads real file and buffer dimensions while rejecting malformed images',async()=>{
 const assets=require(join(dirname(require.resolve('metro/package.json')),'src/Assets.js'));
 const dir=await mkdtemp(join(tmpdir(),'ozira-assets-'));
 try {
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=','base64');
  const file=join(dir,'pixel.png');await writeFile(file,bytes);
  assert.deepEqual(assets.getAssetSize('png',bytes,file),{width:1,height:1});
  const data=await assets.getAssetData(file,'pixel.png',[],null,'/assets');assert.equal(data.width,1);assert.equal(data.height,1);
  assert.throws(()=>assets.getAssetSize('png',Buffer.from('bad'),file));
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('both XML/plist consumers round-trip build configuration with patched branch APIs',()=>{
 for(const name of ['@expo/plist','plist']) {
  const imported=require(name),p=imported.default||imported,input={CFBundleName:'OZIRA',enabled:true,items:['bakery','studio']};
  assert.deepEqual(JSON.parse(JSON.stringify(p.parse(p.build(input)))),input);
  const xml=from(name)('@xmldom/xmldom');const document=new xml.DOMImplementation().createDocument(null,'root');
  const element=document.createElement('validName');
  assert.equal(element.nodeName,'validName');
  // Arbitrary invalid XML names are not validated by these APIs; callers must
  // constrain build configuration names. This checks compatibility, not XML hardening.
 }
});
test('all three brace-expansion branches retain minimatch behavior and bound nested adversarial patterns',()=>{
 const candidates=Object.keys(lock).filter(path=>/node_modules\/brace-expansion$/.test(path));
 assert.equal(candidates.length,4);
 for(const path of candidates){const module=require(join(process.cwd(),path));const expand=typeof module==='function'?module:module.expand;assert.deepEqual(expand('a{b,c}d'),['abd','acd']);}
 // Child timeout prevents a regression from hanging the complete test process.
 for(const path of candidates)execFileSync(process.execPath,['-e',`const m=require(${JSON.stringify(join(process.cwd(),path))});const f=typeof m==='function'?m:m.expand;try{f('{'.repeat(300)+'a,b'+'}'.repeat(300))}catch(e){if(!(e instanceof RangeError)&&!(/max|limit|depth/i.test(e.message)))throw e}`],{timeout:3000});
 const minimatch=require('minimatch');assert.equal(minimatch.minimatch('bakery.js','*.{js,ts}'),true);
});
test('Browserslist and both YAML consumer branches preserve build configuration APIs',()=>{
 const browsers=require('browserslist');assert.ok(browsers('last 1 chrome version').some(x=>x.startsWith('chrome ')));
 const adversarial=JSON.parse('{"toString":{"onekey":5},"chrome":{"100":50}}');assert.doesNotThrow(()=>browsers('defaults',{stats:adversarial}));
 for(const yaml of [require('js-yaml'),from('@expo/xcpretty')('js-yaml')]){
  const value=yaml.load('name: Bakery\nlist:\n  - one\n  - two\n');assert.equal(value.name,'Bakery');assert.deepEqual(yaml.load(yaml.dump(value)),value);
 }
});
test('PostCSS and source-map retain transforms and refuse arbitrary source map disclosure',async()=>{
 const postcss=require('postcss'),{SourceMapGenerator,SourceMapConsumer}=require('source-map-js');
 const dir=await mkdtemp(join(tmpdir(),'ozira-css-'));
 try {
  const secret=join(dir,'secret.map');await writeFile(secret,JSON.stringify({version:3,sources:['private.txt'],sourcesContent:['DO_NOT_DISCLOSE'],names:[],mappings:''}));
  const result=await postcss([]).process('a{color:red}\n/*# sourceMappingURL='+secret+' */',{map:true});
  assert.ok(!JSON.stringify({css:result.css,map:result.map?.toJSON()}).includes('DO_NOT_DISCLOSE'));
  const generator=new SourceMapGenerator({file:'out.js'});generator.addMapping({generated:{line:1,column:0},original:{line:3,column:2},source:'input.js'});
  const consumer=new SourceMapConsumer(generator.toJSON());assert.equal(consumer.originalPositionFor({line:1,column:0}).line,3);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('AJV/fast-uri and nanoid runtime generators preserve supported APIs',()=>{
 const uri=require('fast-uri');assert.equal(uri.normalize('https://EXAMPLE.com/a'),'https://example.com/a');
 const Ajv=require('ajv'),ajv=new Ajv();const validate=ajv.compile({type:'object',properties:{name:{type:'string'}},required:['name']});assert.equal(validate({name:'Bakery'}),true);assert.equal(validate({name:1}),false);
 const {nanoid,customAlphabet}=require('nanoid');assert.equal(nanoid(21).length,21);assert.equal(customAlphabet('abc',8)().length,8);
 execFileSync(process.execPath,['-e',`const {customAlphabet}=require('nanoid');try{const result=customAlphabet('abc',0)();if(result!=='')throw Error('unexpected result')}catch(e){if(!(e instanceof RangeError))throw e}`],{cwd:process.cwd(),timeout:3000});
});
test('Forge crypto/build certificate primitives and tar archive APIs remain compatible',async()=>{
 const forge=require('node-forge');const der=forge.asn1.oidToDer('1.2.840.113549.1.1.11');assert.equal(forge.asn1.derToOid(der),'1.2.840.113549.1.1.11');
 const asn1=forge.asn1.create(forge.asn1.Class.UNIVERSAL,forge.asn1.Type.OCTETSTRING,false,'fixture');assert.equal(forge.asn1.fromDer(forge.asn1.toDer(asn1)).value,'fixture');
 const pem=forge.pem.encode({type:'TEST',body:'fixture'});assert.equal(forge.pem.decode(pem)[0].body,'fixture');
 const tar=require('tar'),dir=await mkdtemp(join(tmpdir(),'ozira-tar-'));
 try{await writeFile(join(dir,'input.txt'),'bakery');await tar.c({cwd:dir,file:join(dir,'archive.tar')},['input.txt']);const entries=[];await tar.t({file:join(dir,'archive.tar'),onentry:entry=>entries.push(entry.path)});assert.deepEqual(entries,['input.txt']);}finally{await rm(dir,{recursive:true,force:true});}
});
test('Undici request API works with network disabled using MockAgent',async()=>{
 const {MockAgent,request}=require('undici');const agent=new MockAgent();agent.disableNetConnect();agent.get('https://fixture.invalid').intercept({path:'/health'}).reply(200,{ok:true});
 try{const response=await request('https://fixture.invalid/health',{dispatcher:agent});assert.deepEqual(await response.body.json(),{ok:true});}finally{await agent.close();}
});
test('compression middleware retains gzip response behavior with isolated stream doubles',async()=>{
 const {Writable}=require('node:stream'),{EventEmitter}=require('node:events'),{gunzipSync}=require('node:zlib');
 const chunks=[];class Response extends Writable{constructor(){super();this.headers={};this.statusCode=200;this.headersSent=false;}setHeader(k,v){this.headers[k.toLowerCase()]=v;}getHeader(k){return this.headers[k.toLowerCase()];}removeHeader(k){delete this.headers[k.toLowerCase()];}writeHead(){this.headersSent=true;} _write(chunk,encoding,callback){chunks.push(Buffer.from(chunk));callback();}}
 const req=new EventEmitter();req.headers={'accept-encoding':'gzip'};req.method='GET';req.httpVersionMajor=1;req.httpVersionMinor=1;
 const res=new Response();res.setHeader('Content-Type','text/plain');const finished=new Promise((resolve,reject)=>res.on('finish',resolve).on('error',reject));
 require('compression')({threshold:0})(req,res,()=>{res.writeHead(200);res.end('bakery '.repeat(300));});await finished;
 assert.equal(res.getHeader('Content-Encoding'),'gzip');assert.equal(gunzipSync(Buffer.concat(chunks)).toString(),'bakery '.repeat(300));
});
