import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const original=await readFile(new URL('../src/tts.js',import.meta.url),'utf8');
async function fixture(delay){
 let owner='A',release,started;const ready=new Promise(resolve=>started=resolve),events=[];
 const pause=()=>{started();return new Promise(resolve=>release=resolve);};
 const mocks={
  api:{async aiSpeak(){events.push('request');if(delay==='provider')await pause();return {audio:'AQID',mimeType:'audio/wav'};}},
  async getSettings(){return {lang:'en'};},conversationSessionLease(){const captured=owner;return ()=>captured===owner;},
  async setAudioModeAsync(){if(delay==='mode')await pause();},async writeAsStringAsync(){events.push('write');if(delay==='file')await pause();},cacheDirectory:'fixture://',EncodingType:{Base64:'base64'},
  createAudioPlayer(){events.push('create');return {play(){events.push('play');},pause(){events.push('pause');},remove(){events.push('remove');},addListener(){return {remove(){}};}}},
 };
 const key=`__tts_test_${Math.random()}`;globalThis[key]=mocks;const source=original.replace(/^import .*;$/gm,'');
 const module=await import(`data:text/javascript;base64,${Buffer.from(`const {createAudioPlayer,setAudioModeAsync,writeAsStringAsync,cacheDirectory,EncodingType,api,getSettings,conversationSessionLease}=globalThis[${JSON.stringify(key)}];\n${source}`).toString('base64')}`);delete globalThis[key];
 return {module,events,ready,release(){release();},switchAccount(){owner='B';}};
}
test('stopped or previous-account TTS cannot start playback after any asynchronous boundary',async()=>{
 for(const boundary of ['provider','mode','file'])for(const action of ['stop','switch']){
  const f=await fixture(boundary);const pending=f.module.speakText('private A fixture','fixture-token');await f.ready;
  if(action==='stop')f.module.stopSpeaking();else f.switchAccount();f.release();const result=await pending;
  assert.equal(result.cancelled,true,boundary+' '+action);assert.ok(!f.events.includes('create'));assert.ok(!f.events.includes('play'));
 }
});
test('current-account TTS still creates, plays, and stops its existing player',async()=>{
 const f=await fixture(null);assert.deepEqual(await f.module.speakText('hello fixture','fixture-token'),{ok:true});assert.ok(f.events.includes('play'));f.module.stopSpeaking();assert.deepEqual(f.events.slice(-2),['pause','remove']);
});
