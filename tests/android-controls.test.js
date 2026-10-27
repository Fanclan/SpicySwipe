const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(r => setImmediate(r));
function fixture(t) {
  const dom = new JSDOM('<img id="screen"><textarea id="keyboard"></textarea><input id="other">', { runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window, image = w.document.querySelector('img'), keyboard = w.document.querySelector('textarea'), calls = [], errors = [];
  let active = true, epoch = 1, send = async () => {};
  Object.defineProperties(image, { naturalWidth: { value: 1080 }, naturalHeight: { value: 2400 } });
  image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 216, height: 480 });
  w.eval(fs.readFileSync('desktop/android-controls.js', 'utf8'));
  const controls = w.SSAndroidControls.create({ image, keyboard, active: () => active, epoch: () => epoch,
    send: async (action, data) => { calls.push({ action, data: { ...data } }); return send(action, data); },
    onError: e => errors.push(e.message) });
  const key = key => keyboard.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  return { w, image, keyboard, controls, calls, errors, key, setActive: v => active = v, invalidate: () => epoch++, setSend: fn => send = fn };
}

test('clicking the display focuses keyboard and types/navigation stay in order', async t => {
  const f = fixture(t);
  f.image.dispatchEvent(new f.w.MouseEvent('click', { clientX: 100, clientY: 100 }));
  assert.equal(f.w.document.activeElement, f.keyboard);
  f.key('a'); f.key('b'); f.key('Backspace'); f.key('Enter'); f.key('Tab');
  await tick();
  assert.deepEqual(f.calls.map(c => c.action), ['android:tap', 'android:type', 'android:key', 'android:key', 'android:key']);
  assert.equal(f.calls[1].data.text, 'ab');
  assert.deepEqual(f.calls.slice(2).map(c => c.data.key), ['Backspace', 'Enter', 'Tab']);
});

test('typing never captures keys in the workspace or an inactive device preview', async t => {
  const f = fixture(t);
  f.w.document.querySelector('input').focus(); f.key('a');
  f.keyboard.focus(); f.setActive(false); f.key('b');
  await tick(); assert.equal(f.calls.length, 0);
});

test('paste stays literal, clears the local field, and does not synthesize Enter', async t => {
  const f = fixture(t); f.keyboard.focus();
  const event = new f.w.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'test@example.com 100%s' } });
  f.keyboard.dispatchEvent(event); await tick();
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(f.calls, [{ action: 'android:type', data: { text: 'test@example.com 100%s' } }]);
  assert.equal(f.keyboard.value, '');
});

test('unsupported Unicode and multiline paste report an error without partial typing', async t => {
  const f = fixture(t); f.keyboard.focus();
  f.key('é');
  const event = new f.w.Event('paste', { cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'one\ntwo' } });
  f.keyboard.dispatchEvent(event); await tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.errors.length, 2);
});

test('queued input is discarded when the selected device/context changes', async t => {
  const f = fixture(t); let finish;
  f.setSend(() => new Promise(r => finish = r));
  f.keyboard.focus(); f.key('a'); await tick(); f.key('b'); f.invalidate();
  finish(); await tick();
  assert.equal(f.calls.length, 1);
  assert.match(f.errors[0], /changed|inactive/);
});

test('an input error clears the remaining queue instead of submitting it later', async t => {
  const f = fixture(t); let fail;
  f.setSend(() => new Promise((_, reject) => fail = reject));
  f.keyboard.focus(); f.key('a'); await tick(); f.key('b'); f.key('Enter');
  fail(Error('Disconnected')); await tick();
  assert.equal(f.calls.length, 1);
});
