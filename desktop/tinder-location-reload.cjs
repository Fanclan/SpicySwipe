'use strict';
const {isTinderURL} = require('./policy.cjs');

// One in-memory handoff between two documents in the same hosted Tinder view.
// Location revocation must still reload a hung renderer, even without a checkpoint.
class TinderLocationReload {
  constructor({capture, restore, timeoutMs = 350}) {
    Object.assign(this, {capture, restore, timeoutMs});
    this.pending = null;
  }

  discard() {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  reload(contents) {
    const url = contents.getURL();
    const previous = this.pending;
    if (previous?.contents === contents && previous.url === url) {
      // Coalesce only until the document gets its first reload. Once it starts
      // loading, it may have created a location watcher under the old lease.
      if (previous.phase !== 'capture') this.reloadDocument(previous);
      return;
    }
    this.discard();
    if (!isTinderURL(url) || !/^\/app\/(recs|explore)(\/|$)/.test(new URL(url).pathname)) {
      contents.reload();
      return;
    }
    const request = {contents, url, phase:'capture', saved:null};
    this.pending = request;
    const reload = saved => {
      if (this.pending !== request || request.phase !== 'capture') return;
      clearTimeout(request.timer);
      if (contents.isDestroyed() || !isTinderURL(contents.getURL())) { this.discard(); return; }
      request.saved = request.url === contents.getURL() ? saved : null;
      this.reloadDocument(request);
    };
    request.timer = setTimeout(() => reload(null), this.timeoutMs);
    this.capture().then(reload, () => reload(null));
  }

  reloadDocument(request) {
    clearTimeout(request.timer);
    request.phase = 'reload';
    // A failed or indefinitely hung navigation must never arm a much later page.
    request.timer = setTimeout(() => this.discard(), 30000);
    request.timer.unref();
    request.contents.reload();
  }

  navigating(contents, url, sameDocument) {
    const request = this.pending;
    if (!request || request.contents !== contents) return;
    if (request.phase === 'capture') {
      // A different navigation started before the requested reload. Still revoke.
      request.intent = 'stop';
    } else if (request.phase === 'reload' && !sameDocument && request.url === url) {
      request.phase = 'loading';
    } else this.discard();
  }

  committed(contents, url, status) {
    const request = this.pending;
    if (request?.contents !== contents || request.phase !== 'loading') return;
    if (request.url === url && ((status >= 200 && status < 300) || status === 304)) request.phase = 'committed';
    else this.discard();
  }

  userAction(action) {
    const request = this.pending;
    if (!request) return;
    if (action === 'pause' && request.intent !== 'stop') request.intent = 'pause';
    if (action === 'start') throw Error('Tinder is reloading after a location change. Wait for the session to reconnect.');
    if (action === 'stop' || action === 'discover') request.intent = 'stop';
  }

  ready(contents) {
    const request = this.pending;
    if (!request || request.phase !== 'committed' || request.contents !== contents) return;
    this.discard();
    if (!request.saved || request.url !== contents.getURL() || request.intent === 'stop') return;
    const checkpoint = request.saved;
    if (request.intent === 'pause') checkpoint.session.status = 'paused';
    this.restore(checkpoint);
  }
}
module.exports = TinderLocationReload;
