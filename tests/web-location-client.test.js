const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const tick = () => new Promise(resolve => setImmediate(resolve));
const coords = {latitude: 12.25, longitude: -34.5, accuracy: 150};

async function fixture(t, readings) {
  const dom = new JSDOM(fs.readFileSync('desktop/index.html', 'utf8'), {
    url: 'https://workspace.example/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  t.after(() => w.close());
  const requests = [], attempts = [];
  const $ = selector => w.document.querySelector(selector);
  $('#tinder-frame').hidden = false;
  Object.defineProperty(w, 'isSecureContext', {value: true});
  Object.defineProperty(w.navigator, 'permissions', {
    value: {query: async () => ({state: readings[0] === 1 ? 'denied' : 'granted'})}
  });
  Object.defineProperty(w.navigator, 'geolocation', {value: {
    getCurrentPosition(success, fail, options) {
      const reading = readings[attempts.length];
      attempts.push(options);
      if (typeof reading === 'number') fail({code: reading});
      else if (reading) success({coords: reading, timestamp: Date.now()});
      else throw Error('Unexpected extra location attempt');
    }
  }});
  w.EventSource = class { addEventListener() {} };
  w.fetch = async (path, init) => {
    assert.equal(path, '/api/request');
    const request = JSON.parse(init.body);
    requests.push(request);
    return {ok: true, status: 200, json: async () => ({result: {shared: request.action === 'web:location'}})};
  };
  w.eval(fs.readFileSync('web/client.js', 'utf8'));
  await tick();
  const click = async selector => { $(selector).click(); await tick(); };
  return {$, attempts, click, shares: () => requests.filter(req => req.action === 'web:location').map(req => req.data)};
}

for (const code of [2, 3]) {
  test('location error ' + code + ' retries once and shares the successful browser reading', async t => {
    const f = await fixture(t, [code, coords]);
    assert.equal(f.attempts.length, 0);
    await f.click('#tinder-location');
    assert.equal(f.attempts.length, 2, 'retry after a temporary acquisition failure');
    assert.ok(f.attempts[0].maximumAge > 0 && f.attempts[0].maximumAge <= 120000);
    assert.equal(f.attempts[1].enableHighAccuracy, true);
    assert.deepEqual(f.shares(), [coords]);
  });
}

test('location permission denial does not start another device acquisition', async t => {
  const f = await fixture(t, [1]);
  await f.click('#tinder-location');
  assert.ok(f.attempts.length <= 1);
  assert.deepEqual(f.shares(), []);
  assert.equal(f.$('#tinder-location-fallback')?.hidden ?? true, true);
});

test('permission denial during a retry ends the location flow', async t => {
  const f = await fixture(t, [2, 1]);
  await f.click('#tinder-location');
  assert.equal(f.attempts.length, 2);
  assert.deepEqual(f.shares(), []);
  assert.equal(f.$('#tinder-location-fallback')?.hidden ?? true, true);
});

test('after failed readings, a person can explicitly share their own valid coordinates', async t => {
  const f = await fixture(t, [2, 2]);
  await f.click('#tinder-location');
  assert.equal(f.attempts.length, 2);
  assert.deepEqual(f.shares(), []);
  const form = f.$('#tinder-location-fallback');
  assert.ok(form && !form.hidden);
  const latitude = form.elements.namedItem('latitude'), longitude = form.elements.namedItem('longitude');
  for (const field of [latitude, longitude]) {
    assert.ok(field.labels.length || field.getAttribute('aria-label') || field.getAttribute('aria-labelledby'));
  }
  const submit = '#tinder-location-fallback button[type=submit]';
  await f.click(submit);
  assert.deepEqual(f.shares(), [], 'blank coordinates are not a point at zero, zero');
  latitude.value = '91';
  longitude.value = '-34.5678';
  await f.click(submit);
  assert.deepEqual(f.shares(), []);
  latitude.value = '0';
  await f.click(submit);
  assert.equal(f.shares().length, 1);
  const [position] = f.shares();
  assert.equal(position.latitude, 0);
  assert.equal(position.longitude, -34.57);
  assert.equal(position.accuracy, 1000);
  assert.equal(form.hidden, true);
  assert.equal(latitude.value, '');
  assert.equal(longitude.value, '');
});

test('canceling coordinate entry leaves the location unshared', async t => {
  const f = await fixture(t, [2, 3]);
  await f.click('#tinder-location');
  const form = f.$('#tinder-location-fallback');
  assert.ok(form && !form.hidden);
  form.elements.namedItem('latitude').value = '12.25';
  form.elements.namedItem('longitude').value = '-34.5';
  await f.click('#cancel-location-entry');
  assert.equal(form.hidden, true);
  assert.equal(form.elements.namedItem('latitude').value, '');
  assert.equal(form.elements.namedItem('longitude').value, '');
  assert.deepEqual(f.shares(), []);
});

test('closing Tinder clears unsubmitted coordinates', async t => {
  const f = await fixture(t, [2, 2]);
  await f.click('#tinder-location');
  const form = f.$('#tinder-location-fallback');
  assert.ok(form && !form.hidden);
  form.elements.namedItem('latitude').value = '12.25';
  f.$('#tinder-frame').hidden = true;
  await tick();
  assert.equal(form.hidden, true);
  assert.equal(form.elements.namedItem('latitude').value, '');
  assert.deepEqual(f.shares(), []);
});
