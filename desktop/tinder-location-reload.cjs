'use strict';
const {isTinderURL} = require('./policy.cjs');

// One in-memory handoff between two documents in the same hosted Tinder view.
// Location revocation must still reload a hung renderer, even without a checkpoint.
class TinderLocationReload {
  constructor({capture, restore, notify = () => {}, timeoutMs = 350}) {
    Object.assign(this, {capture, restore, notify, timeoutMs});
    this.pending = null;
  }

  discard() {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  reload(contents, captureEmpty, sourceDocumentId) {
    const url = contents.getURL();
    const previous = this.pending;
    if (previous && captureEmpty) return;
    const delivering = previous?.phase === 'restoring' || previous?.phase === 'retry';
    if (previous?.contents === contents && previous.url === url && !(previous.emptyCheck && (previous.phase === 'capture' || delivering))) {
      // Coalesce only until the document gets its first reload. Once it starts
      // loading, it may have created a location watcher under the old lease.
      if (previous.phase !== 'capture') this.reloadDocument(previous);
      return;
    }
    this.discard();
    if (!isTinderURL(url) || !/^\/app\/(recs|explore)(\/|$)/.test(new URL(url).pathname)) {
      if (!captureEmpty) contents.reload();
      return;
    }
    const request = {contents, url, phase:'capture', saved:null, emptyCheck:Boolean(captureEmpty), sourceDocumentId};
    if (previous?.emptyCheck && previous.contents === contents && previous.url === url) request.intent = previous.intent;
    this.pending = request;
    const reload = saved => {
      if (this.pending !== request || request.phase !== 'capture') return;
      clearTimeout(request.timer);
      if (contents.isDestroyed() || !isTinderURL(contents.getURL())) { this.discard(); return; }
      if (captureEmpty && (!saved || request.intent === 'stop' || request.url !== contents.getURL())) { this.discard(); return; }
      request.saved = request.url === contents.getURL() ? saved : null;
      this.reloadDocument(request);
    };
    request.timer = setTimeout(() => reload(null), this.timeoutMs);
    (captureEmpty || this.capture)().then(reload, () => reload(null));
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
      // Once the exact automatic reload has started, the next navigation still
      // invalidates it. A slow response or preload can finish this same navigation.
      if (request.emptyCheck) clearTimeout(request.timer);
    } else this.discard();
  }

  committed(contents, url, status) {
    const request = this.pending;
    if (request?.contents !== contents || request.phase !== 'loading') return;
    if (request.url === url && ((status >= 200 && status < 300) || status === 304)) request.phase = 'committed';
    else this.discard();
  }

  failed(contents, url) {
    const request = this.pending;
    if (request?.emptyCheck && request.contents === contents && request.url === url && request.phase === 'loading') this.discard();
  }

  userAction(action) {
    const request = this.pending;
    if (!request) return;
    if (action === 'pause' && request.intent !== 'stop') request.intent = 'pause';
    if (action === 'start') throw Error('Tinder is reloading. Wait for the session to reconnect.');
    if (action === 'stop' || action === 'discover') {
      request.intent = 'stop';
      if (request.emptyCheck) this.discard();
    }
  }

  ready(contents, documentId) {
    const request = this.pending;
    if (!request || request.contents !== contents) return;
    if (request.documentId && request.documentId !== documentId) { this.discard(); return; }
    if (request.phase !== 'committed' || (request.sourceDocumentId && documentId === request.sourceDocumentId)) return;
    if (!request.saved || request.url !== contents.getURL() || request.intent === 'stop') { this.discard(); return; }
    request.documentId = documentId;
    this.deliver(request);
  }

  async deliver(request) {
    if (this.pending !== request) return;
    if (request.contents.isDestroyed() || request.url !== request.contents.getURL()) { this.discard(); return; }
    const checkpoint = request.intent === 'pause'
      ? {...request.saved, session:{...request.saved.session, status:'paused'}}
      : request.saved;
    if (request.emptyCheck) request.phase = 'restoring';
    else this.discard();
    try {
      const session = await this.restore(checkpoint, request.documentId);
      if (this.pending !== request) return;
      this.discard();
      if (!session || session.runId !== checkpoint.session.runId) this.notify('The Tinder session changed during refresh. Check the current session.');
    } catch {
      if (this.pending !== request) return;
      // A lost reply may follow a successful restore. Preload accepts only the
      // pinned document and restore never starts a second budget in that document.
      request.phase = 'retry';
      request.timer = setTimeout(() => this.deliver(request), 5000);
      request.timer.unref();
    }
  }
}
module.exports = TinderLocationReload;
