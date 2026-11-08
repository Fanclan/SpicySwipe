'use strict';
const {isTinderURL} = require('../desktop/policy.cjs');

class WebLocation {
  constructor({getContents, reload = contents => contents.reload()}) {
    this.getContents = getContents;
    this.reload = reload;
    this.active = null;
  }

  attach(session) {
    const allowed = (contents, permission, origin, details) =>
      this.active?.ready === true && contents === this.active.contents &&
      contents === this.getContents() && !contents.isDestroyed() &&
      permission === 'geolocation' && details?.isMainFrame === true &&
      isTinderURL(contents.getURL()) && isTinderURL(origin);
    session.setPermissionRequestHandler((wc, permission, done, details) =>
      done(allowed(wc, permission, details?.requestingUrl, details)));
    session.setPermissionCheckHandler(allowed);
  }

  status() { return {shared:this.active?.ready === true}; }

  async share({latitude, longitude, accuracy}, owner) {
    if (![latitude, longitude, accuracy].every(Number.isFinite) ||
        Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0)
      throw Error('Your browser returned an invalid location. Try again.');
    const wc = this.getContents();
    if (!wc || wc.isDestroyed() || !isTinderURL(wc.getURL()))
      throw Error('Open Tinder and finish any sign-in step before sharing your location.');
    this.stop(undefined, false);
    if (wc.debugger.isAttached()) throw Error('Close the Tinder developer tools and try again.');
    const lease = {contents:wc, owner, ready:false};
    wc.debugger.attach('1.3');
    this.active = lease;
    const detached = () => {
      if (this.active === lease) {
        this.active = null;
        clearTimeout(lease.timer);
        if (lease.ready && !wc.isDestroyed() && isTinderURL(wc.getURL())) this.reload(wc);
      }
    };
    wc.debugger.once('detach', detached);
    try {
      await wc.debugger.sendCommand('Emulation.setGeolocationOverride', {latitude, longitude, accuracy});
      if (this.active !== lease || wc.isDestroyed() || !isTinderURL(wc.getURL()))
        throw Error('Location sharing was interrupted.');
      lease.ready = true;
      lease.timer = setTimeout(() => this.stop(), 15 * 60 * 1000);
      lease.timer.unref();
      this.reload(wc);
      return this.status();
    } catch {
      if (this.active === lease) this.stop();
      throw Error('Could not share location with Tinder. Reopen Tinder and try again.');
    }
  }

  stop(owner, reload = true) {
    const lease = this.active;
    if (!lease || (owner !== undefined && owner !== lease.owner)) return this.status();
    this.active = null;
    clearTimeout(lease.timer);
    const wc = lease.contents;
    if (!wc.isDestroyed()) {
      if (wc.debugger.isAttached()) wc.debugger.detach();
      if (reload && lease.ready && isTinderURL(wc.getURL())) this.reload(wc);
    }
    return this.status();
  }
}
module.exports = WebLocation;
