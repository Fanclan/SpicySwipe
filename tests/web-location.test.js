const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const WebLocation = require('../web/location.cjs');

const position = {latitude:0, longitude:-141.987654, accuracy:17};
const tinderURL = 'https://tinder.com/app/recs';

function fixture(t, sendCommand = async () => {}) {
  const debuggerClient = new EventEmitter();
  let attached = false;
  Object.assign(debuggerClient, {
    isAttached: () => attached,
    attach() { attached = true; },
    sendCommand,
    detach() { attached = false; this.emit('detach'); }
  });
  const contents = {getURL:() => tinderURL, isDestroyed:() => false, reload() {}, debugger:debuggerClient};
  const location = new WebLocation({getContents:() => contents});
  let check, request;
  location.attach({
    setPermissionCheckHandler(fn) { check = fn; },
    setPermissionRequestHandler(fn) { request = fn; }
  });
  function permission(wc = contents, kind = 'geolocation', url = tinderURL, isMainFrame = true) {
    const details = {requestingUrl:url, isMainFrame};
    let grant;
    request(wc,kind,allowed => { grant = allowed; },details);
    assert.equal(check(wc,kind,new URL(url).origin,details),grant);
    return grant;
  }
  t.after(() => location.stop());
  return {location,contents,permission};
}

test('only the hosted Tinder main frame can read the shared browser position',async t => {
  const {location,contents,permission} = fixture(t,async (command, data) => {
    assert.equal(command,'Emulation.setGeolocationOverride');
    assert.deepEqual(data,position);
  });
  const owner = {};
  assert.equal(permission(),false);
  await location.share(position,owner);
  assert.deepEqual(location.status(),{shared:true});
  assert.equal(permission(),true);
  assert.equal(permission(contents,'camera'),false);
  assert.equal(permission(contents,'geolocation',tinderURL,false),false);
  assert.equal(permission(contents,'geolocation','https://tinder.com.example.com'),false);
  assert.equal(permission({...contents}),false,'another view cannot inherit consent through the session');
  location.stop({});
  assert.equal(permission(),true,'an unrelated browser disconnect cannot revoke this share');
  location.stop(owner);
  assert.equal(permission(),false);
  assert.deepEqual(location.status(),{shared:false});
});

test('disconnecting during a pending override cannot grant location afterwards',async t => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const {location,permission} = fixture(t,() => pending);
  const owner = {};
  const sharing = location.share(position,owner);
  assert.equal(permission(),false);
  location.stop(owner);
  finish();
  await assert.rejects(sharing);
  assert.equal(permission(),false);
});

test('failed or out-of-range browser positions never grant permission',async t => {
  const {location,permission} = fixture(t,async () => { throw Error('renderer closed'); });
  for (const data of [{latitude:91},{longitude:-181},{accuracy:-1},{accuracy:NaN}]) {
    await assert.rejects(location.share({...position,...data},{}),/invalid location/i);
  }
  await assert.rejects(location.share(position,{}));
  assert.equal(permission(),false);
});
