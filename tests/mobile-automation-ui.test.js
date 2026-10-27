const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(r => setImmediate(r));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const control = { bounds: { x: 1, y: 1, width: 50, height: 50 } };
const snapshot = (patch = {}) => ({ platform: 'hinge', session: { status: 'idle', phase: 'idle', count: 0, limit: 30, error: '', endsAt: null, nextActionAt: null }, screen: { kind: 'profile', name: 'Example', identity: 'profile-1', reason: '', context: { name: 'Example', bio: 'Likes hiking', history: [] }, photos: [{ key: 'photo-1' }], controls: { like: control, skip: control, sendLike: null, comment: null, composer: null, sendMessage: null }, composerText: '', emptyConversation: false }, config: null, draft: null, selectedPhoto: null, busy: false, reason: '', ...patch });
async function fixture(t, options = {}) {
  const dom = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, calls = [], notes = [], copied = [];
  let respond = () => snapshot();
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async text => copied.push(text) } });
  w.eval(fs.readFileSync('shared/core.js', 'utf8'));
  if (fs.existsSync('desktop/mobile-automation.js')) w.eval(fs.readFileSync('desktop/mobile-automation.js', 'utf8'));
  assert.equal(typeof w.SSMobileAutomation?.mount, 'function', 'mobile automation mount must be available');
  const root = w.document.querySelector('#root');
  const ui = w.SSMobileAutomation.mount(root, { platform: 'hinge', ...options, request: async (action, data) => { calls.push({ action, data }); return respond(action, data); }, notify: (...args) => notes.push(args) });
  await tick();
  const el = key => root.querySelector(`[data-mobile="${key}"]`);
  const field = key => root.querySelector(`[name="${key}"]`);
  const input = (key, value) => { const e = field(key); if (e.type === 'checkbox') e.checked = value; else e.value = value; e.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const click = async key => { el(key).click(); await tick(); };
  ui.setConnected(true); ui.handleState(snapshot());
  return { w, root, ui, calls, notes, copied, el, field, input, click, respond: fn => { respond = fn; } };
}
test('mount reads status without writing or starting and defaults to plain Likes', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.calls.map(c => c.action), ['status']);
  assert.equal(f.field('mode').value, 'like');
  assert.equal(f.field('autoOpeners').checked, false);
  assert.equal(f.field('autoSend').checked, false);
  assert.equal(f.field('autoOpeners').disabled, false);
});
test('Start saves edited settings and starts only after an explicit click', async t => {
  const f = await fixture(t);
  f.input('maxSwipes', '12'); f.input('mode', 'comment');
  assert.equal(f.calls.filter(c => c.action === 'start').length, 0);
  await f.click('start');
  assert.deepEqual(f.calls.slice(-2).map(c => c.action), ['config', 'start']);
  assert.equal(f.calls.at(-2).data.swipe.maxSwipes, 12);
  assert.equal(f.calls.at(-2).data.mode, 'comment');
});
test('session events preserve unsaved timing and edited drafts', async t => {
  const f = await fixture(t);
  f.input('minDelaySeconds', '31');
  const s = snapshot({ draft: { text: 'A first hello', identity: 'profile-1', inserted: false } });
  f.ui.handleState(s); f.input('draft', 'My edited hello'); f.ui.handleState({ ...s, busy: true });
  assert.equal(f.field('minDelaySeconds').value, '31');
  assert.equal(f.field('draft').value, 'My edited hello');
});
test('late context result cannot restore an old platform view', async t => {
  const f = await fixture(t), gate = deferred(); f.respond(action => action === 'context' ? gate.promise : snapshot({ platform: 'bumble', screen: null }));
  await f.click('read'); f.ui.setPlatform('bumble'); await tick();
  gate.resolve(snapshot()); await tick();
  assert.equal(f.root.textContent.includes('Likes hiking'), false);
  assert.match(f.el('capability').textContent, /Bumble.*not.*verified|Bumble.*unsupported/i);
  assert.equal(f.el('start').disabled, false);
});
test('disconnect invalidates a pending draft and context result', async t => {
  const f = await fixture(t), gate = deferred(); f.respond(() => gate.promise);
  await f.click('generate'); f.ui.setConnected(false); gate.resolve(snapshot({ draft: { text: 'Late draft', identity: 'profile-1' } })); await tick();
  assert.equal(f.field('draft').value, ''); assert.equal(f.el('insert').disabled, true);
  assert.equal(f.el('start').disabled, true);
});
test('pending requests disable device mutations while Pause and Stop stay responsive', async t => {
  const f = await fixture(t), gate = deferred(); f.respond(action => action === 'review' ? gate.promise : snapshot());
  await f.click('review');
  assert.equal(f.el('like').disabled, true); assert.equal(f.el('start').disabled, true);
  assert.equal(f.el('pause').disabled, false); assert.equal(f.el('stop').disabled, false);
  await f.click('stop'); gate.resolve(snapshot({ draft: { text: 'stale', identity: 'profile-1' } })); await tick();
  assert.ok(f.calls.some(c => c.action === 'stop')); assert.equal(f.field('draft').value, '');
});
test('unrecognized screens disable actions and show controller reason as plain text', async t => {
  const f = await fixture(t); f.ui.handleState(snapshot({ screen: { kind: 'unsupported', reason: '<img src=x> Unsupported confirmation', controls: {}, context: {} } }));
  for (const key of ['like', 'skip', 'insert', 'send', 'generate']) assert.equal(f.el(key).disabled, true, key);
  assert.match(f.el('reason').textContent, /Unsupported confirmation/); assert.equal(f.root.querySelector('img'), null);
});
test('Copy reads the current edited draft and Insert submits that same text', async t => {
  const f = await fixture(t), s = snapshot(); s.screen.kind = 'conversation'; s.screen.controls.composer = control; s.draft = { text: 'Original', identity: 'profile-1', inserted: false };
  f.ui.handleState(s); f.input('draft', 'Edited hello'); await f.click('copy'); await f.click('insert');
  assert.deepEqual(f.copied, ['Edited hello']); assert.equal(f.calls.find(c => c.action === 'insert').data.text, 'Edited hello');
});
test('Send needs a verified inserted draft and disables after editing', async t => {
  const f = await fixture(t), s = snapshot(); s.screen.kind = 'conversation'; s.screen.controls.composer = control; s.screen.controls.sendMessage = control; s.screen.composerText = 'Verified hello'; s.draft = { text: 'Verified hello', identity: 'profile-1', inserted: true };
  f.ui.handleState(s); assert.equal(f.el('send').disabled, false);
  f.input('draft', 'Changed'); assert.equal(f.el('send').disabled, true);
});
test('presets fill settings without sending config or starting', async t => {
  const f = await fixture(t), n = f.calls.length; await f.click('overnight');
  assert.equal(f.calls.length, n); assert.equal(f.field('sessionMinutes').value, '480'); assert.equal(f.field('mode').value, 'like');
  assert.match(f.el('preset-note').textContent, /Start/);
});
test('paused Resume retains session settings and never saves form changes', async t => {
  const f = await fixture(t); f.ui.handleState(snapshot({ session: { status: 'paused', phase: 'paused', count: 2, limit: 30, endsAt: Date.now() + 20000 } })); f.input('maxSwipes', '10');
  await f.click('resume'); assert.equal(f.calls.at(-1).action, 'start'); assert.equal(f.calls.filter(c => c.action === 'config').length, 0);
});
test('request errors notify without reporting a fabricated completion', async t => {
  const f = await fixture(t); f.respond(() => { throw Error('Read failed'); }); await f.click('read');
  assert.ok(f.notes.some(n => n[0].includes('Read failed'))); assert.match(f.el('reason').textContent, /Read failed/);
});
test('manual Like applies the selected comment mode before acting', async t => {
  const f = await fixture(t); f.input('mode', 'comment'); await f.click('like');
  assert.deepEqual(f.calls.slice(-2).map(c => c.action), ['config', 'act']);
  assert.equal(f.calls.at(-2).data.mode, 'comment'); assert.equal(f.calls.at(-1).data.kind, 'like');
});
test('Review applies edited random scroll settings before reviewing', async t => {
  const f = await fixture(t); f.input('scrollMin', '2'); f.input('scrollMax', '3'); await f.click('review');
  assert.deepEqual(f.calls.slice(-2).map(c => c.action), ['config', 'review']);
  assert.equal(f.calls.at(-2).data.scrollMin, 2); assert.equal(f.calls.at(-2).data.scrollMax, 3);
});
test('disconnected events cannot restore device context upon reconnect', async t => {
  const f = await fixture(t); f.ui.setConnected(false); f.ui.handleState(snapshot()); f.ui.setConnected(true);
  assert.equal(f.el('like').disabled, true); assert.equal(f.el('start').disabled, false, 'Start performs its own fresh backend validation'); assert.equal(f.el('context').textContent, '');
});
test('explicitly disabled recognized controls never enable device actions', async t => {
  const f = await fixture(t), s = snapshot(); s.screen.controls.like = { ...control, enabled: false }; s.screen.controls.skip = { ...control, disabled: true };
  f.ui.handleState(s); assert.equal(f.el('like').disabled, true); assert.equal(f.el('skip').disabled, true); assert.equal(f.el('start').disabled, false, 'Start performs its own fresh backend validation');
});

test('verified conversation string history is visible before generation',async t=>{
 const f=await fixture(t);f.ui.handleState(snapshot({screen:{kind:'conversation',identity:'chat',name:'Sample',context:{history:'Match time\nStart the chat with Sample'},controls:{}}}));assert.match(f.el('context').textContent,/Match time/);
});
test('opener generation and sending are separate explicit opt-ins',async t=>{
 const f=await fixture(t);f.input('autoOpeners',true);await f.click('save');assert.equal(f.calls.at(-1).data.autoOpeners,true);assert.equal(f.calls.at(-1).data.autoSend,false);
 f.input('autoSend',true);await f.click('save');assert.equal(f.calls.at(-1).data.autoSend,true);
});
test('known Rose sheet offers a normal Like only, with no session or draft actions',async t=>{
 const f=await fixture(t);f.ui.handleState(snapshot({screen:{kind:'likeOffer',identity:'offer',context:{},controls:{sendLike:control},reason:'Rose offer'}}));assert.equal(f.el('like').disabled,false);assert.match(f.el('like').textContent,/normal Like/i);for(const key of['review','skip','generate','insert','send'])assert.equal(f.el(key).disabled,true,key);
});

test('Start is primary and manual controls are collapsed by default',async t=>{const f=await fixture(t);assert.equal(f.root.firstElementChild,f.el('form'));assert.ok(f.el('read').closest('details'));assert.equal(f.el('read').closest('details').open,false);assert.equal(f.el('start').closest('details'),null);});
test('Start needs no manual screen read or preselected photo',async t=>{const f=await fixture(t);f.ui.handleState(snapshot({screen:null}));assert.equal(f.el('start').disabled,false);await f.click('start');assert.deepEqual(f.calls.slice(-2).map(c=>c.action),['config','start']);});
test('Start waits for connection preparation then starts once, with Stop canceling pending setup',async t=>{let valid;const gate=deferred();const f=await fixture(t,{prepareStart:async check=>{valid=check;await gate.promise}});f.ui.setConnected(false);await f.click('start');assert.equal(typeof valid,'function');assert.equal(f.calls.some(c=>c.action==='start'),false);assert.equal(f.el('stop').disabled,false);await f.click('stop');gate.resolve();await tick();assert.equal(valid(),false);assert.equal(f.calls.some(c=>c.action==='start'),false);});
test('disconnected Start connects and starts once without manual review',async t=>{const gate=deferred();const f=await fixture(t,{prepareStart:async()=>gate.promise});f.ui.setConnected(false);await f.click('start');f.ui.setConnected(true);gate.resolve();await tick();assert.deepEqual(f.calls.filter(c=>['config','start','review','context'].includes(c.action)).map(c=>c.action),['config','start']);});

test('Bumble Start is enabled and only applies plain Likes with comments and openers unavailable',async t=>{const f=await fixture(t);f.ui.setPlatform('bumble');await tick();f.respond(action=>snapshot({platform:'bumble',screen:null}));assert.equal(f.el('start').disabled,false);assert.equal(f.field('mode').querySelector('[value="comment"]').disabled,true);f.field('mode').value='comment';await f.click('start');const config=f.calls.findLast(c=>c.action==='config');assert.equal(config.data.mode,'like');assert.equal(config.data.autoOpeners,false);assert.equal(config.data.autoSend,false);assert.equal(f.calls.findLast(c=>c.action==='start').action,'start');});
