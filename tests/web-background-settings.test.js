'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Service = require('../desktop/service.cjs');
const MobileConfig = require('../desktop/mobile-config.cjs');

async function fixture(t) {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spicy-background-'));
 t.after(() => fs.rm(dir, {recursive: true, force: true}));
 return path.join(dir, 'settings.json');
}

function background(settings) {
 const mobile = platform => MobileConfig.normalize(settings.mobileConfig?.[platform]).swipe.allowBackground;
 return [settings.swipeConfig.allowBackground, mobile('hinge'), mobile('bumble')];
}

test('fresh server sessions run in the background by default on all three platforms', async t => {
 const file = await fixture(t);
 const desktop = new Service({file});
 assert.deepEqual(background(await desktop.request('load')), [false, false, false]);
 const web = new Service({file, webMode: true});
 assert.deepEqual(background(await web.request('load')), [true, true, true]);
 await web.request('save', {swipeConfig: {maxSwipes: 42}, mobileConfig: {hinge: {mode: 'like'}}});
 const reopened = new Service({file, webMode: true});
 assert.deepEqual(background(await reopened.request('load')), [true, true, true]);
});

test('server migration fills only missing background preferences and preserves per-app opt-outs', async t => {
 const file = await fixture(t);
 await fs.writeFile(file, JSON.stringify({
  version: 1, credentials: {}, settings: {
   swipeConfig: {allowBackground: false, maxSwipes: 27},
   mobileConfig: {hinge: {swipe: {maxSwipes: 36}}, bumble: {swipe: {allowBackground: false}}}
  }
 }));
 const web = new Service({file, webMode: true});
 const migrated = await web.request('load');
 assert.deepEqual(background(migrated), [false, true, false]);
 assert.equal(migrated.swipeConfig.maxSwipes, 27);
 assert.equal(migrated.mobileConfig.hinge.swipe.maxSwipes, 36);
 await web.request('save', {mobileConfig: {hinge: {swipe: {allowBackground: false}}}});
 const reopened = new Service({file, webMode: true});
 assert.deepEqual(background(await reopened.request('load')), [false, false, false]);
});
