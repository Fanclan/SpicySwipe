const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(r => setImmediate(r));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const control = { bounds: { x: 1, y: 1, width: 50, height: 50 } };
const snapshot = (patch = {}) => ({ platform: 'hinge', session: { status: 'idle', phase: 'idle', count: 0, limit: 30, error: '', endsAt: null, nextActionAt: null }, screen: { kind: 'profile', name: 'Example', identity: 'profile-1', reason: '', context: { name: 'Example', bio: 'Likes hiking', history: [] }, photos: [{ key: 'photo-1' }], controls: { like: control, skip: control, sendLike: null, comment: null, composer: null, sendMessage: null }, composerText: '', emptyConversation: false }, config: null, draft: null, selectedPhoto: null, busy: false, reason: '', ...patch });
async function fixture(t, options = {}, withWebClient = false) {
  const html = withWebClient ? fs.readFileSync('desktop/index.html', 'utf8') : '<div id="root"></div>';
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, calls = [], notes = [], copied = [];
  let respond = () => snapshot();
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async text => copied.push(text) } });
  w.eval(fs.readFileSync('shared/core.js', 'utf8'));
  if (fs.existsSync('desktop/mobile-automation.js')) w.eval(fs.readFileSync('desktop/mobile-automation.js', 'utf8'));
  assert.equal(typeof w.SSMobileAutomation?.mount, 'function', 'mobile automation mount must be available');
  let events;
  if (withWebClient) {
    w.EventSource = class extends w.EventTarget { constructor() { super(); events = this; } };
    w.fetch = async () => ({ ok: true, json: async () => ({ result: {} }) });
    w.eval(fs.readFileSync('web/client.js', 'utf8'));
    if (withWebClient === 'offline') events.dispatchEvent(new w.Event('error'));
  }
  const root = w.document.querySelector(withWebClient ? '#mobile-automation' : '#root');
  const ui = w.SSMobileAutomation.mount(root, { platform: 'hinge', ...options, request: async (action, data) => { calls.push({ action, data }); return respond(action, data); }, notify: (...args) => notes.push(args) });
  await tick();
  const el = key => root.querySelector(`[data-mobile="${key}"]`);
  const field = key => root.querySelector(`[name="${key}"]`);
  const input = (key, value) => { const e = field(key); if (e.type === 'checkbox') e.checked = value; else e.value = value; e.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const click = async key => { el(key).click(); await tick(); };
  ui.setConnected(true); ui.handleState(snapshot());
  return { w, root, ui, calls, notes, copied, events, el, field, input, click, respond: fn => { respond = fn; } };
}
test('web Quick preset preserves the phone background setting',async t=>{
  const f=await fixture(t,{web:true});
  for(const value of [true,false]){
    f.input('allowBackground',value);
    await f.click('quick');
    assert.equal(f.field('allowBackground').checked,value);
  }
});
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
test('each phone can save and start with just one session limit, or with both', async t => {
  const f = await fixture(t, {web:true});
  for (const platform of ['hinge','bumble']) {
    f.respond(() => snapshot({platform}));
    f.ui.setPlatform(platform); await tick();
    for (const [profiles, minutes] of [[1000,null],[null,45],[50,25]]) {
      f.input('maxSwipes', profiles ?? ''); f.input('sessionMinutes', minutes ?? '');
      await f.click('start');
      assert.deepEqual(f.calls.slice(-2).map(c => c.action), ['config','start']);
      const config = f.calls.at(-2).data;
      assert.equal(config.swipe.maxSwipes, profiles);
      assert.equal(config.swipe.sessionMinutes, minutes);
    }
  }
});
test('mobile rejects two empty limits and preserves an optional limit when switching tabs', async t => {
  const f = await fixture(t);
  f.input('maxSwipes',''); f.input('sessionMinutes','');
  for (const action of ['save','start']) {
    await f.click(action);
    assert.deepEqual(f.calls.map(c=>c.action), ['status']);
    assert.match(f.el('reason').textContent,/profile limit.*time limit/i);
  }
  f.input('maxSwipes',1000);
  f.ui.setPlatform('bumble'); await tick(); f.ui.setPlatform('hinge'); await tick();
  assert.equal(f.field('sessionMinutes').value,'');
  assert.equal(f.field('maxSwipes').value,'1000');
  await f.click('quick');
  assert.equal(f.field('sessionMinutes').value,'15');
  await f.click('save');
  assert.equal(f.calls.at(-1).data.swipe.sessionMinutes,15);
});
test('mobile status respects the active session limits while waiting for profiles', async t => {
  const f=await fixture(t);
  const base={status:'running',phase:'waiting for profiles',count:12,nextActionAt:Date.now()+300000};
  const screen={kind:'empty',controls:{},context:{}};
  f.ui.handleState(snapshot({screen,session:{...base,limit:null,endsAt:Date.now()+60000}}));
  assert.match(f.el('session').textContent,/12 issued profile actions/);
  assert.match(f.el('session').textContent,/deadline/);
  f.ui.handleState(snapshot({screen,session:{...base,limit:1000,endsAt:null}}));
  assert.match(f.el('session').textContent,/12 \/ 1000/);
  assert.doesNotMatch(f.el('session').textContent+' '+f.el('reason').textContent,/deadline/i);
});
test('Hinge distinguishes a held profile, a Discover reopen check, and a verified empty feed',async t=>{
  const f=await fixture(t),session={status:'running',count:26,limit:1000,nextActionAt:Date.now()+30000};
  const empty={kind:'empty',context:{},controls:{}};
  for(const [phase,kind,expected] of [
    ['waiting for another profile','profile','No verified Like target on this profile'],
    ['waiting to reopen Discover','like','Waiting to reopen Discover'],
    ['waiting for profiles','empty','No profiles available'],
    ['waiting for another profile','empty','No profiles available'],
    ['waiting to reopen Discover','empty','No profiles available']
  ]){
    const screen=kind==='empty'?empty:{...snapshot().screen,kind};
    f.ui.handleState(snapshot({screen,session:{...session,phase}}));
    const status=f.el('session').textContent;
    assert.ok(status.startsWith(expected),status);
    assert.match(status,/26 \/ 1000 issued profile actions.*Next check/);
    assert.doesNotMatch(status,/deadline|next action/i);
    if(kind==='empty')assert.match(f.el('reason').textContent,/Waiting for new profiles/);
  }
});
test('Hinge held-profile labels apply only to running Hinge sessions',async t=>{
  const f=await fixture(t),session={phase:'waiting for another profile',count:7,limit:null,endsAt:Date.now()+60000};
  f.ui.handleState(snapshot({session:{...session,status:'paused'}}));
  assert.match(f.el('session').textContent,/paused.*7 issued profile actions.*deadline/);
  assert.doesNotMatch(f.el('session').textContent,/No verified Like target/);
  f.ui.setPlatform('bumble');await tick();
  f.ui.handleState(snapshot({platform:'bumble',session:{...session,status:'running'}}));
  assert.match(f.el('session').textContent,/running.*7 issued profile actions.*deadline/);
  assert.doesNotMatch(f.el('session').textContent,/No verified Like target/);
});
test('an invalid mobile start leaves both its device and saved settings alone',async t=>{
  let preparations=0;
  const f=await fixture(t,{prepareStart:async()=>{preparations++;}});
  f.input('maxSwipes','');f.input('sessionMinutes','');
  await f.click('start');
  assert.equal(preparations,0);
  assert.deepEqual(f.calls.map(c=>c.action),['status']);
  assert.match(f.el('reason').textContent,/profile limit.*time limit/i);
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

test('recovery phases clearly show checks rather than implying active Likes',async t=>{const f=await fixture(t);for(const phase of ['verifying previous action','recovering screen','waiting for supported screen','checking swipe result']){f.ui.handleState(snapshot({session:{status:'running',phase,count:7,limit:1000,endsAt:Date.now()+60000,nextActionAt:Date.now()+30000}}));const text=f.el('session').textContent;assert.doesNotMatch(text,/running/i);assert.match(text,/Next check/);assert.match(text,/7 \/ 1000/);assert.equal(f.el('like').disabled,true);}});

test('manual Hinge Like can use a verified prompt when no photo Like is available', async t => {
  const f = await fixture(t), state = snapshot();
  state.screen.photos = [];
  state.screen.controls.like = null;
  state.screen.prompts = [{ text: 'Example prompt', like: { ...control, enabled: false } }];
  f.ui.handleState(state);
  assert.equal(f.el('like').disabled, true);
  state.screen.prompts[0].like = control;
  f.ui.handleState(state);
  assert.equal(f.el('like').disabled, false);
  assert.match(f.el('like').textContent, /prompt/i);
  await f.click('like');
  assert.equal(f.calls.at(-1).action, 'act');
  assert.equal(f.calls.at(-1).data.kind, 'like');
});

function heldHingeCard(token = 'offer-a', name = 'Example', expiresAt = Date.now() + 60000) {
  const s = snapshot();
  s.session = { status: 'running', phase: 'verifying previous action', count: 74, limit: 1000 };
  s.screen.name = name;
  s.screen.screenKey = 'card-' + token;
  s.pendingSkipOffer = { token, name, expiresAt };
  return s;
}

test('one-card Skip requires a named review and explicit confirmation; Cancel and double-click never issue a second action', async t => {
  const f = await fixture(t, { web: true });
  const name = 'Alex <img src=x>', s = heldHingeCard('opaque-token', name), gate = deferred();
  f.ui.handleState(s);
  assert.equal(f.el('review-skip').closest('details'), null);
  assert.equal(f.el('review-skip').textContent, 'Skip this card and continue');
  assert.equal(f.el('skip').disabled, true, 'ordinary manual Skip stays disabled during a run');
  await f.click('review-skip');
  assert.equal(f.el('skip-review').hidden, false);
  assert.ok(f.el('skip-review').textContent.includes(name));
  assert.match(f.el('skip-review').textContent, /1 (additional )?profile|one (additional )?profile/i);
  assert.equal(f.root.querySelector('img'), null);
  assert.equal(f.w.document.activeElement, f.el('cancel-skip'));
  await f.click('cancel-skip');
  assert.equal(f.el('skip-review').hidden, true);
  assert.equal(f.w.document.activeElement, f.el('review-skip'));
  assert.deepEqual(f.calls.map(call => call.action), ['status']);
  await f.click('review-skip');
  f.respond(() => gate.promise);
  f.el('confirm-skip').click();
  f.el('confirm-skip').click();
  assert.deepEqual(f.calls.map(call => call.action), ['status', 'confirmPendingSkip']);
  assert.deepEqual({ ...f.calls.at(-1).data }, { token: 'opaque-token' });
  gate.resolve(s); await tick();
  f.ui.handleState(s);
  await f.click('review-skip'); await f.click('confirm-skip');
  assert.equal(f.calls.length, 2, 'a repeated stale snapshot cannot re-arm a consumed offer');
});

test('a changed Hinge card cancels review even if the earlier card returns', async t => {
  const f = await fixture(t), a = heldHingeCard('a', 'Alex'), b = heldHingeCard('b', 'Alex');
  f.ui.handleState(a); await f.click('review-skip');
  f.ui.handleState(b);
  assert.equal(f.el('skip-review').hidden, true);
  f.ui.handleState(a);
  await f.click('confirm-skip');
  assert.deepEqual(f.calls.map(call => call.action), ['status']);
  f.ui.handleState(b); await f.click('review-skip');
  const changed = { ...b, screen: { ...b.screen, screenKey: 'different-content' } };
  f.ui.handleState(changed);
  await f.click('confirm-skip');
  assert.deepEqual(f.calls.map(call => call.action), ['status']);
});

test('one-card Skip expires locally while confirmation is open', async t => {
  const f = await fixture(t);
  let now = Date.now(), expire;
  f.w.Date.now = () => now;
  f.w.setTimeout = (callback, delay) => { assert.equal(delay, 60000); expire = callback; return 1; };
  for (const delayedTimer of [false, true]) {
    const s = heldHingeCard('offer-' + now, 'Alex', now + 60000);
    f.ui.handleState(s); await f.click('review-skip');
    assert.equal(f.el('skip-review').hidden, false);
    now += 60000;
    if (!delayedTimer) expire();
    await f.click('confirm-skip');
    assert.equal(f.el('skip-review').hidden, true);
    assert.match(f.el('skip-notice').textContent, /expired/i);
  }
  assert.deepEqual(f.calls.map(call => call.action), ['status']);
});

test('one-card Skip closes on platform switch, device or stream disconnect, and leaving the page', async t => {
  const f = await fixture(t, { web: true });
  const s = heldHingeCard();
  for (const leave of [
    () => { f.ui.setPlatform('bumble'); f.ui.setPlatform('hinge'); },
    () => { f.ui.setConnected(false); f.ui.handleState(s); f.ui.setConnected(true); },
    () => f.w.dispatchEvent(new f.w.Event('spicy-mobile-stream-reset')),
    () => f.w.document.dispatchEvent(new f.w.Event('visibilitychange')),
  ]) {
    f.ui.handleState(s); await f.click('review-skip');
    assert.equal(f.el('skip-review').hidden, false);
    leave(); await tick();
    assert.equal(f.el('skip-review').hidden, true);
    f.ui.handleState(s); await f.click('confirm-skip');
  }
  assert.equal(f.calls.some(call => ['confirmPendingSkip', 'act'].includes(call.action)), false);
});

test('only a connected running Hinge profile with an eligible offer can open one-card review', async t => {
  const f = await fixture(t), s = heldHingeCard();
  for (const patch of [
    { pendingSkipOffer: null }, { session: { status: 'paused' } },
    { screen: { ...s.screen, kind: 'likeOffer' } }, { screen: { ...s.screen, controls: {} } },
    { pendingSkipOffer: { ...s.pendingSkipOffer, name: 'Different' } },
  ]) {
    f.ui.handleState({ ...s, ...patch });
    assert.equal(f.el('review-skip').disabled, true);
    await f.click('review-skip'); await f.click('confirm-skip');
  }
  f.ui.setPlatform('bumble'); await tick();
  f.ui.handleState({ ...s, platform: 'bumble' });
  assert.equal(f.el('review-skip').disabled, true);
  assert.equal(f.calls.some(call => ['confirmPendingSkip', 'act'].includes(call.action)), false);
});

test('one-card review survives a routine same-card read with Confirm disabled while busy', async t => {
  const f = await fixture(t), s = heldHingeCard();
  f.ui.handleState(s); await f.click('review-skip');
  f.ui.handleState({ ...s, busy: true });
  assert.equal(f.el('skip-review').hidden, false);
  assert.equal(f.el('confirm-skip').disabled, true);
  await f.click('confirm-skip');
  assert.deepEqual(f.calls.map(call => call.action), ['status']);
  f.ui.handleState(s);
  assert.equal(f.el('confirm-skip').disabled, false);
  f.ui.handleState({ ...s, busy: true, pendingSkipOffer: null });
  assert.equal(f.el('skip-review').hidden, true, 'a real revocation is final, even while busy');
  f.ui.handleState(s); await f.click('confirm-skip');
  assert.deepEqual(f.calls.map(call => call.action), ['status']);
});

test('web EventSource disconnect revokes one-card review and reopening needs a fresh snapshot and choice', async t => {
  const f = await fixture(t, { web: true }, true), s = heldHingeCard();
  f.ui.handleState(s); await f.click('review-skip');
  f.events.dispatchEvent(new f.w.Event('open'));
  assert.equal(f.el('skip-review').hidden, false);
  f.events.dispatchEvent(new f.w.Event('error'));
  assert.equal(f.el('skip-review').hidden, true);
  f.ui.handleState(s);
  assert.equal(f.el('review-skip').disabled, true, 'a late snapshot during disconnect stays unusable');
  f.events.dispatchEvent(new f.w.Event('open'));
  assert.equal(f.el('review-skip').disabled, true);
  f.ui.handleState(s);
  assert.equal(f.el('review-skip').disabled, false);
  await f.click('confirm-skip');
  assert.deepEqual(f.calls.map(call => call.action), ['status']);
});

test('one-card review stays unavailable if the event stream dropped before mobile controls mounted', async t => {
  const f = await fixture(t, { web: true }, 'offline'), s = heldHingeCard();
  f.ui.handleState(s);
  assert.equal(f.el('review-skip').disabled, true);
  f.events.dispatchEvent(new f.w.Event('open'));
  f.ui.handleState(s);
  assert.equal(f.el('review-skip').disabled, false);
});
