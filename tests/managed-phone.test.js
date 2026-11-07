const test = require('node:test');
const assert = require('node:assert/strict');
const { ManagedPhone, phones, usesManagedPhone } = require('../desktop/managed-phone.cjs');

function fixture(platform) {
  const calls = [];
  const device = {
    boot: {phase:'waiting'}, installed:false, serial:null,
    async managedBoot(serial, avd) {
      assert.deepEqual({serial, avd}, phones[platform]);
      return this.boot;
    },
    async select(serial) { this.serial = serial; calls.push('select'); },
    async isAppInstalled() { return this.installed; },
    async openStore(app) { calls.push('store ' + app); },
    async openApp(app) { calls.push('open ' + app); }
  };
  return {phone:new ManagedPhone(platform,device), device, calls};
}

test('each managed phone waits for its assigned device and opens the store once until installation', async () => {
  assert.notEqual(phones.hinge.serial, phones.bumble.serial);
  for (const platform of Object.keys(phones)) {
    const {phone,device,calls} = fixture(platform);
    const prepare = () => phone.prepare(() => true);
    assert.equal((await prepare()).ready, false);
    assert.deepEqual(calls, []);
    device.boot = {phase:'ready',bootId:'boot-1'};
    assert.equal((await prepare()).needsInstall, true);
    await prepare();
    assert.deepEqual(calls, ['select', 'store ' + platform]);
    device.installed = true;
    assert.equal((await prepare()).needsInstall, false);
    await prepare();
    assert.deepEqual(calls, ['select', 'store ' + platform, 'open ' + platform]);
    device.boot.bootId = 'boot-2';
    await prepare();
    assert.equal(calls.filter(c => c === 'open ' + platform).length, 2);
  }
});

test('changing the device while Android starts cancels the pending launch', async () => {
  const {phone,device,calls} = fixture('hinge');
  let current = true;
  device.managedBoot = async () => { current = false; return {phase:'ready',bootId:'1'}; };
  await assert.rejects(phone.prepare(() => current), /selection changed/);
  assert.deepEqual(calls, []);
});

test('reconnecting to the same boot leaves an in-progress sign-in on screen', async () => {
  const {phone,device,calls} = fixture('hinge');
  const prepare = () => phone.prepare(() => true);
  device.boot = {phase:'ready',bootId:'same-boot'};
  await prepare();
  device.boot = {phase:'waiting'};
  assert.equal((await prepare()).ready, false);
  device.boot = {phase:'ready',bootId:'same-boot'};
  assert.equal((await prepare()).ready, true);
  assert.deepEqual(calls, ['select','store hinge']);
});

test('defaults use distinct managed phones and preserve legacy device overrides', () => {
  assert.equal(usesManagedPhone('hinge', undefined, false), false);
  assert.equal(usesManagedPhone('hinge', undefined, true), true);
  assert.equal(usesManagedPhone('hinge', {preferredSerial:'usb-device'}, true), false);
  assert.equal(usesManagedPhone('hinge', {preferredSerial:phones.hinge.serial}, true), true);
  assert.equal(usesManagedPhone('hinge', {deviceChoice:'managed'}, true), true);
  assert.equal(usesManagedPhone('hinge', {deviceChoice:'custom'}, true), false);
});
