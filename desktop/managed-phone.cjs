'use strict';

const phones = Object.freeze({
  hinge: { serial: 'emulator-5554', avd: 'SpicySwipe_Phone_API_36' },
  bumble: { serial: 'emulator-5556', avd: 'SpicySwipe_Bumble_API_36' }
});

function usesManagedPhone(platform, preferences, enabled) {
  if (!enabled) return false;
  if (preferences?.deviceChoice === 'managed') return true;
  if (preferences?.deviceChoice === 'custom') return false;
  // Preserve an external device chosen on a previous installation.
  return !preferences?.preferredSerial || preferences.preferredSerial === phones[platform].serial;
}

class ManagedPhone {
  constructor(platform, device, readLocationReceipt) {
    this.platform = platform;
    this.device = device;
    this.readLocationReceipt = readLocationReceipt;
    this.opened = null;
  }

  async prepare(isCurrent) {
    const { serial, avd } = phones[this.platform];
    const check = () => {
      if (!isCurrent()) throw Error('Android device selection changed. Reopen the phone to continue.');
    };
    check();
    const boot = await this.device.managedBoot(serial, avd);
    check();
    if (boot.phase !== 'ready') {
      return { ready: false, phase: boot.phase, detail: boot.detail, serial, needsInstall: false };
    }
    if (this.readLocationReceipt) {
      const applied = await this.readLocationReceipt(serial);
      check();
      if (!applied || applied !== boot.bootId) return {ready:false, phase:'booting', serial, needsInstall:false,
        detail:'Waiting for the managed phone to accept its configured city location.'};
    }
    if (this.device.serial !== serial) {
      await this.device.select(serial);
      check();
      this.opened = null;
    }
    const installed = await this.device.isAppInstalled(this.platform);
    check();
    const target = installed ? 'app' : 'store';
    // Polling during Play sign-in must leave the current activity untouched.
    if (this.opened?.bootId !== boot.bootId || this.opened?.target !== target) {
      if (installed) await this.device.openApp(this.platform);
      else await this.device.openStore(this.platform);
      check();
      this.opened = { bootId: boot.bootId, target };
    }
    return { ready: true, phase: target, serial, needsInstall: !installed,
      detail: installed ? 'Your app is open.' : 'Sign in to Google Play on this phone and install the app.' };
  }
}

module.exports = { phones, usesManagedPhone, ManagedPhone };
