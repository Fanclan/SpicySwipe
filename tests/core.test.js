const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = fs.existsSync('shared/core.js') ? require('../shared/core.js') : {};
test('migration preserves keys, consent, selected provider and historical counts', () => {
  assert.equal(typeof core.migrate, 'function');
  const result = core.migrate({activeAI:'claude', anthropicApiKey:'secret', sidebarConsentGiven:true, allTimeAnalytics:{swipes:42}, swipeConfig:{maxSwipes:12}});
  assert.equal(result.activeAI,'claude'); assert.equal(result.anthropicApiKey,'secret');
  assert.equal(result.sidebarConsentGiven,true); assert.equal(result.allTimeAnalytics.swipes,42);
  assert.equal(result.swipeConfig.maxSwipes,12); assert.equal(result.swipeConfig.likeRatio,0.7);
  assert.equal(result.messagingConfig.autoSend,false);
  assert.deepEqual(core.migrate(result),result);
});
test('legacy Gemini aliases and keys migrate without erasing other preferences', () => {
  assert.equal(typeof core.migrate, 'function');
  const result=core.migrate({activeAI:'gemini-pro',geminiProApiKey:'legacy',theme:'dark',messageSettings:{tone:'casual'}});
  assert.equal(result.activeAI,'gemini'); assert.equal(result.geminiApiKey,'legacy');
  assert.equal(result.theme,'dark'); assert.equal(result.messagingConfig.tone,'casual');
});
test('invalid session settings are bounded and zero like ratio is preserved', () => {
  assert.equal(typeof core.migrate, 'function');
  const result=core.migrate({swipeConfig:{maxSwipes:-3,likeRatio:0,delaySeconds:0}});
  assert.equal(result.swipeConfig.maxSwipes,1); assert.equal(result.swipeConfig.likeRatio,0);
  assert.ok(result.swipeConfig.delaySeconds>=3);
});
test('Ollama endpoints accept LAN hosts and ports but refuse credentials and non-root URLs', () => {
  assert.equal(typeof core.localURL, 'function');
  assert.equal(core.localURL('http://localhost:11434/'),'http://localhost:11434');
  for(const url of ['http://192.168.1.50:11434','http://ollama.local:8080','https://models.home','http://[fd00::1]:11434']) assert.equal(core.localURL(url),url);
  for(const url of ['http://user:pass@localhost:11434','http://localhost:11434/api','http://host/?key=secret','http://host/#fragment','file:///tmp/model']) assert.throws(()=>core.localURL(url));
});
test('revocation and key removal remain effective with legacy aliases present',()=>{
 const migrated=core.migrate({consentGiven:true,geminiProApiKey:'legacy'});
 const removed=core.migrate({...migrated,sidebarConsentGiven:false,geminiApiKey:''});
 assert.equal(removed.sidebarConsentGiven,false);assert.equal(removed.geminiApiKey,'');
});
test('extended session settings normalize ranges and preserve long sessions',()=>{
 const s=core.migrate({swipeConfig:{maxSwipes:500,sessionMinutes:480,minDelaySeconds:40,maxDelaySeconds:5,minPhotoSeconds:8,maxPhotoSeconds:2,breakMinSeconds:300,breakMaxSeconds:60,maxPhotos:50,allowBackground:true}}).swipeConfig;
 assert.equal(s.maxSwipes,500);assert.equal(s.sessionMinutes,480);assert.equal(s.maxDelaySeconds,40);assert.equal(s.maxPhotoSeconds,8);assert.equal(s.breakMaxSeconds,300);assert.equal(s.maxPhotos,10);assert.equal(s.allowBackground,true);
 assert.equal(core.migrate({}).swipeConfig.allowBackground,false);assert.deepEqual(core.migrate({swipeConfig:s}).swipeConfig,s);
});
