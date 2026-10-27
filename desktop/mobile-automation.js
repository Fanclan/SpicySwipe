/* Guarded mobile automation controls. Device authorization stays in the main process. */
(function (global) {
  'use strict';
  const C = global.SSCore;
  const defaults = () => ({ mode: 'like', scrollMin: 1, scrollMax: 4, fractionMin: .25, fractionMax: .6, autoOpeners: false, autoSend: false, tone: 'friendly', language: 'en', length: 'short', instruction: '', swipe: C.swipeSettings({ randomizeTiming: true, minDelaySeconds: 15, maxDelaySeconds: 45, browsePhotos: true, scrollProfile: true, minPhotoSeconds: 2, maxPhotoSeconds: 5, breaksEnabled: true }) });
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function mount(root, { request, platform = 'hinge', notify = () => {}, prepareStart = null }) {
    let current = platform, connected = false, generation = 0, pending = 0, state = {}, error = '', draftKey = '', draftSource = '', starting = false;
    const forms = new Map(), hydrated = new Set();
    const title = () => current === 'bumble' ? 'Bumble' : 'Hinge';
    const button = (key, text, primary = false) => `<button type="button" data-mobile="${key}"${primary ? ' class="primary"' : ''}>${text}</button>`;
    const number = (key, text, min, max, step = 1) => `<label>${text}<input name="${key}" type="number" min="${min}" max="${max}" step="${step}" required></label>`;
    const check = (key, text, disabled = false) => `<label class="ma-check"><input name="${key}" type="checkbox"${disabled ? ' disabled' : ''}>${text}</label>`;
    const options = entries => entries.map(([key, name]) => `<option value="${escape(key)}">${escape(name)}</option>`).join('');
    root.classList.add('mobile-automation');
    root.innerHTML = `<section class="ma-card"><span class="eyebrow">MOBILE AUTOMATION</span><h2 data-mobile="title"></h2><p data-mobile="capability" class="ma-hint"></p>
      <div class="ma-actions">${button('read', 'Read screen')}${button('review', 'Review without liking')}</div>
      <div class="ma-context"><strong data-mobile="screen">No screen read</strong><pre data-mobile="context"></pre><p data-mobile="photo" class="ma-hint"></p></div>
      <p data-mobile="reason" role="status" aria-live="polite" class="ma-reason"></p>
      <div class="ma-actions">${button('like', 'Like selected photo', true)}${button('skip', 'Skip')}</div>
      <p class="ma-hint">Review varies the scroll depth and selects a full photo, with up to six bounded photo-search scrolls; it does not Like or Skip. Photo contents are not analyzed by AI. Final actions require a fresh recognized screen.</p></section>
      <form data-mobile="form" class="ma-card"><div class="ma-heading"><h3>Auto-like profiles</h3><div class="ma-actions">${button('quick', 'Quick preset')}${button('overnight', 'Overnight preset')}</div></div>
      <p data-mobile="preset-note" class="ma-hint">Presets fill the form. Save or Start applies your choices.</p>
      <div class="ma-fields">${number('maxSwipes', 'Profile limit', 1, 10000)}${number('sessionMinutes', 'Duration (minutes)', 1, 720)}${number('likeRatio', 'Like probability (0 to 1)', 0, 1, .05)}
      <label>Like mode<select name="mode"><option value="like">Plain Like</option><option value="comment">AI photo comment (opt in)</option></select></label></div>
      <p data-mobile="comment-note" class="ma-hint"></p>
      <details><summary>Timing, review and breaks</summary><div class="ma-checks">${check('randomizeTiming', 'Randomize waits')}${check('scrollProfile', 'Scroll through profile')}${check('browsePhotos', 'Dwell on visible photos')}</div>
      <div class="ma-fields">${number('delaySeconds', 'Fixed wait (seconds)', 3, 600)}${number('minDelaySeconds', 'Minimum wait (seconds)', 3, 600)}${number('maxDelaySeconds', 'Maximum wait (seconds)', 3, 600)}${number('scrollMin', 'Minimum scrolls', 0, 10)}${number('scrollMax', 'Maximum scrolls', 0, 10)}${number('fractionMin', 'Minimum scroll distance (%)', 20, 65)}${number('fractionMax', 'Maximum scroll distance (%)', 20, 65)}${number('minPhotoSeconds', 'Minimum review dwell (seconds)', 1, 30)}${number('maxPhotoSeconds', 'Maximum review dwell (seconds)', 1, 30)}</div>
      <div class="ma-checks">${check('breaksEnabled', 'Take breaks')}${check('allowBackground', 'Continue while app is hidden')}</div><div class="ma-fields">${number('breakEvery', 'Break after profiles', 1, 1000)}${number('breakMinSeconds', 'Minimum break (seconds)', 10, 1800)}${number('breakMaxSeconds', 'Maximum break (seconds)', 10, 1800)}</div>
      <p class="ma-hint">Background operation does not prevent computer sleep. Pausing retains the original session deadline.</p></details>
      <div class="ma-actions">${button('save', 'Save settings')}${button('start', 'Start session', true)}${button('resume', 'Resume session')}${button('pause', 'Pause')}${button('stop', 'Stop')}</div><p data-mobile="session" class="ma-session" role="status" aria-live="polite"></p>
      <details><summary>Draft options and automatic openers</summary><div class="ma-fields"><label>Tone<select name="tone">${options(C.tones.map(t => [t, t.charAt(0).toUpperCase() + t.slice(1)]))}</select></label><label>Language<select name="language">${options(Object.entries(C.languages))}</select></label><label>Length<select name="length"><option value="short">Short</option><option value="medium">Medium</option></select></label></div><label>Extra instruction<textarea name="instruction" rows="2" maxlength="1200"></textarea></label><div class="ma-checks">${check('autoOpeners', 'Generate openers for the open empty chat')}${check('autoSend', 'Send those openers automatically')}</div><p class="ma-hint">Open an empty Hinge chat, select your choices, then Save settings to arm its watcher. Generation and sending are separate opt-ins. Pause, Stop, or manual device input disarms it. Existing conversations require manual drafting.</p></details></form>
      <section class="ma-card"><h3>Draft from recognized context</h3><p class="ma-hint">Generation sends the profile or conversation text shown above to your configured AI provider. Check AI settings for provider and consent. No unseen photo contents are sent or inferred.</p>${button('generate', 'Generate draft', true)}<label>Editable draft<textarea name="draft" rows="4" maxlength="4000" placeholder="Read a recognized screen, then generate a draft."></textarea></label><div class="ma-actions">${button('copy', 'Copy')}${button('insert', 'Insert')}${button('send', 'Send')}</div><p class="ma-hint">Insert requires the same recognized conversation or Like composer and an empty field. Send requires verified inserted text in a recognized conversation. Android entry currently supports printable ASCII; use manual device entry for emoji or other characters.</p></section>`;
    const el = key => root.querySelector(`[data-mobile="${key}"]`);
    const field = key => root.querySelector(`[name="${key}"]`);
    const manual=root.firstElementChild,drafts=root.lastElementChild,form=el('form');
    const tools=document.createElement('details');tools.className='ma-manual';tools.innerHTML='<summary>Manual controls and profile details</summary>';tools.append(manual,drafts);root.prepend(form);root.append(tools);
    const sessionButtons=el('start').parentElement;form.insertBefore(sessionButtons,form.children[1]);sessionButtons.after(el('session'),el('reason'));
    const intro=document.createElement('p');intro.className='ma-hint';intro.textContent='Press Start session. Device setup, profile review and plain Likes run automatically.';sessionButtons.before(intro);
    const advanced=form.querySelector('details');advanced.querySelector('summary').after(field('likeRatio').closest('label'));advanced.append(el('quick').parentElement,el('save'));
    el('preset-note').textContent='Start uses your settings below. Plain Likes are the default.';
    const topNumbers = ['scrollMin', 'scrollMax', 'fractionMin', 'fractionMax'];
    const swipeNumbers = ['maxSwipes', 'sessionMinutes', 'likeRatio', 'delaySeconds', 'minDelaySeconds', 'maxDelaySeconds', 'minPhotoSeconds', 'maxPhotoSeconds', 'breakEvery', 'breakMinSeconds', 'breakMaxSeconds'];
    const swipeChecks = ['randomizeTiming', 'scrollProfile', 'browsePhotos', 'breaksEnabled', 'allowBackground'];
    function fill(config) {
      const d = defaults(), c = { ...d, ...config, swipe: { ...d.swipe, ...config?.swipe } };
      for (const key of ['mode', 'tone', 'language', 'length', 'instruction', ...topNumbers]) field(key).value = key.startsWith('fraction') ? Math.round(c[key] * 100) : c[key];
      for (const key of swipeNumbers) field(key).value = c.swipe[key];
      for (const key of swipeChecks) field(key).checked = c.swipe[key];
      field('autoOpeners').checked = c.autoOpeners; field('autoSend').checked = c.autoSend;
    }
    function collect(validate = false) {
      if (validate && !el('form').checkValidity()) throw Error('Check session limits and timing ranges.');
      const config = { ...defaults(), autoOpeners:field('autoOpeners').checked,autoSend:field('autoSend').checked&&field('autoOpeners').checked,swipe: {} };
      for (const key of ['mode', 'tone', 'language', 'length', 'instruction']) config[key] = field(key).value;
      for (const key of topNumbers) config[key] = Number(field(key).value) / (key.startsWith('fraction') ? 100 : 1);
      for (const key of swipeNumbers) config.swipe[key] = Number(field(key).value);
      for (const key of swipeChecks) config.swipe[key] = field(key).checked;
      if (validate) {
        const pairs = [[config.scrollMin, config.scrollMax, 'scroll count'], [config.fractionMin, config.fractionMax, 'scroll distance'], ...[['minDelaySeconds', 'maxDelaySeconds'], ['minPhotoSeconds', 'maxPhotoSeconds'], ['breakMinSeconds', 'breakMaxSeconds']].map(([a,b]) => [config.swipe[a], config.swipe[b], 'timing'])];
        for (const [a, b, name] of pairs) if (a > b) throw Error(`Minimum ${name} must not exceed maximum.`);
      }
      if(current==='bumble'){config.mode="like";config.autoOpeners=false;config.autoSend=false;}
      return config;
    }
    function clearContext() { state = {}; draftKey = ''; draftSource = ''; field('draft').value = ''; }
    function invalidate() { generation++; pending = 0; error = ''; clearContext(); render(); }
    function handleState(snapshot) {
      if (!snapshot || snapshot.platform !== current) return;
      state = connected ? snapshot : { ...snapshot, screen: null, draft: null, selectedPhoto: null };
      if (snapshot.config && !hydrated.has(current)) {
        if (!forms.has(current)) fill(snapshot.config);
        hydrated.add(current);
      }
      const screen = snapshot.screen, draft = connected && snapshot.draft?.identity === screen?.identity ? snapshot.draft : null;
      const nextKey = draft ? `${draft.identity}:${draft.contextRevision || ''}` : '';
      if (!draft) { field('draft').value = ''; draftSource = ''; draftKey = ''; }
      else if (nextKey !== draftKey || draft.text !== draftSource) { field('draft').value = draft.text || ''; draftSource = draft.text; draftKey = nextKey; }
      render();
    }
    async function call(action, data = {}, token = generation) {
      const selected = current;
      const result = await request(action, data);
      if (token !== generation || selected !== current) return null;
      if (result?.error && !result?.session) throw Error(typeof result.error === 'string' ? result.error : 'Mobile request failed.');
      handleState(result);
      return result;
    }
    async function run(work, urgent = false) {
      if (urgent) { starting=false; generation++; pending = 0; state = { ...state, screen: null, draft: null, busy: false }; field('draft').value = ''; draftKey = ''; draftSource = ''; }
      const token = generation;
      pending++; error = ''; render();
      try { await work(token); }
      catch (e) { if (token === generation) { error = e.message || String(e); notify(error, true); } }
      finally { if (token === generation) { pending = Math.max(0, pending - 1); render(); } }
    }
    const time = value => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    function render() {
      root.hidden = !['hinge', 'bumble'].includes(current);
      el('title').textContent = `${title()} manual tools`;
      el('capability').textContent = current === 'bumble' ? 'Bumble People uses ordinary Like and pass swipes. Unsupported screens pause automation. Comments are unavailable.' : 'Discover review and actions require recognized controls. Unsupported screens pause automation; use the device to resolve them.';
      const s = connected ? state.screen : null, controls = s?.controls || {}, session = state.session || {}, active = session.status === 'running', paused = session.status === 'paused';
      const available = control => Boolean(control && control.enabled !== false && control.disabled !== true);
      const recognized = Boolean(s?.identity && ['profile', 'like', 'conversation','likeOffer'].includes(s.kind));
      const idle = connected && !pending && !state.busy && !active;
      el('screen').textContent = s ? `${s.kind || 'Unknown screen'}${s.name ? ` · ${s.name}` : ''}` : connected ? 'Read the current screen to identify context' : 'Connect a device to read context';
      const context = s?.context || {}, history = Array.isArray(context.history) ? context.history.map(m => typeof m === 'string' ? m : `${m.speaker || m.role || 'Unknown speaker'}: ${m.text || m.content || ''}`).join('\n') : typeof context.history==='string'?context.history:'';
      el('context').textContent = [context.name, context.bio, history].filter(Boolean).join('\n\n');
      const photo = state.selectedPhoto;
      el('photo').textContent = s ? photo ? `Selected visible photo: ${photo.label || 'ready'}${photo.index !== undefined ? ` (position ${photo.index + 1})` : ''}` : `${s.photos?.length || 0} visible photo(s). Review selects a visible photo.` : '';
      el('reason').textContent = error || session.error || state.reason || s?.reason || '';
      const progress = `${session.count || 0} / ${session.limit || field('maxSwipes').value} issued profile actions`;
      el('session').textContent = `${session.status || 'idle'}${session.phase && session.phase !== session.status ? ` · ${session.phase}` : ''} · ${progress}${session.endsAt ? ` · deadline ${time(session.endsAt)}` : ''}${session.nextActionAt ? ` · next action ${time(session.nextActionAt)}` : ''}${session.completionReason ? ` · ${session.completionReason}` : ''}`;
      el('preset-note').textContent=state.openerArmed?'Empty-chat watcher armed. Pause or Stop disarms it.':el('preset-note').textContent.startsWith('Empty-chat watcher')?'Watcher stopped. Save settings to arm again.':el('preset-note').textContent;
      el('comment-note').textContent = field('mode').value === 'comment' ? 'AI comments are enabled by this choice. Selected profile text goes to your configured provider; unseen photo content is not described. Like submission must support an ordinary Like and a verified comment field.' : 'Plain Likes are selected. No AI comment is generated or sent with a Like.';
      const disable = (key, condition) => { el(key).disabled = condition; };
      disable('read', !connected || pending > 0 || state.busy || active);
      disable('review', !idle || !recognized || s.kind !== 'profile');
      disable('start', !['hinge','bumble'].includes(current) || (!connected&&!prepareStart) || pending>0 || state.busy || active || paused);
      el('start').textContent=starting?'Starting…':'Start session';
      disable('resume', !['hinge','bumble'].includes(current) || (!connected&&!prepareStart) || pending>0 || state.busy || active || !paused);
      el('resume').hidden = !paused; el('start').hidden = paused;
      disable('save', !idle); disable('like', !idle || !recognized || !['profile', 'like','likeOffer'].includes(s.kind) || !available(s.kind !== 'profile' ? controls.sendLike : controls.like));
      disable('skip', !idle || !recognized || s.kind !== 'profile' || !available(controls.skip));
      // Cancellation is always available, including while a read or AI request is pending.
      disable('pause', !connected&&!pending); disable('stop', !connected&&!pending);
      disable('generate', !idle || !recognized || s.kind==='likeOffer');
      el('like').textContent=current==='bumble'?'Like profile':s?.kind==='likeOffer'?'Send normal Like':'Like selected photo';
      field('mode').querySelector('[value=comment]').disabled=current==='bumble';
      const text = field('draft').value, draft = state.draft, bound = draft && draft.identity === s?.identity && recognized;
      disable('copy', !text.trim());
      disable('insert', !idle || !bound || !text.trim() || !['conversation', 'like'].includes(s?.kind) || !available(controls.composer) || Boolean(s.composerText?.trim()));
      disable('send', !idle || !bound || s?.kind !== 'conversation' || !available(controls.sendMessage) || !draft.inserted || text !== draft.text || s.composerText !== text);
      for (const input of el('form').querySelectorAll('input, select, textarea')) input.disabled = active || (['autoOpeners','autoSend'].includes(input.name) && current!=='hinge') || (input.name==='autoSend'&&!field('autoOpeners').checked);
      disable('quick', active); disable('overnight', active);
    }
    root.addEventListener('input', event => {
      if (event.target.name && event.target.name !== 'draft') forms.set(current, collect());
      render();
    });
    el('form').addEventListener('submit', event => event.preventDefault());
    root.addEventListener('click', event => {
      const target = event.target.closest('button[data-mobile]');
      if (!target || target.disabled) return;
      const action = target.dataset.mobile;
      if (action === 'quick' || action === 'overnight') {
        const config = collect();
        config.swipe = { ...config.swipe, maxSwipes: action === 'quick' ? 10 : 100, sessionMinutes: action === 'quick' ? 15 : 480, minDelaySeconds: 15, maxDelaySeconds: action === 'quick' ? 45 : 90, randomizeTiming: true, breaksEnabled: true, allowBackground: action === 'overnight' };
        fill(config); forms.set(current, config); el('preset-note').textContent = `${action === 'quick' ? 'Quick' : 'Overnight'} preset filled. Review settings, then click Start. Nothing has started.`; render(); return;
      }
      if (action === 'copy') {
        const token = generation, text = field('draft').value;
        Promise.resolve().then(() => { if (!global.navigator.clipboard?.writeText) throw Error('Clipboard is unavailable. Select and copy the draft manually.'); return global.navigator.clipboard.writeText(text); }).catch(e => { if (token === generation) { error = e.message; notify(error, true); render(); } }); return;
      }
      if (action === 'pause' || action === 'stop') { run(token => call(action, {}, token), true); return; }
      run(async token => {
        if(action==='start'||action==='resume'){starting=true;render();try{await prepareStart?.(()=>token===generation);if(token!==generation)return;}finally{if(token===generation){starting=false;render()}}}
        if (['save', 'start', 'generate', 'like', 'review'].includes(action)) {
          const config = collect(true); forms.set(current, config);
          await call('config', config, token);
          if (token !== generation) return;
          if (action === 'save') return;
        }
        const mapped = { read: 'context', resume: 'start', like: 'act', skip: 'act' }[action] || action;
        const data = action === 'like' || action === 'skip' ? { kind: action === 'like' ? 'like' : 'pass' } : ['insert', 'send'].includes(action) ? { text: field('draft').value } : {};
        await call(mapped, data, token);
      });
    });
    function setPlatform(next) {
      if (next === current) return;
      forms.set(current, collect()); current = next; invalidate(); fill(forms.get(current) || defaults()); render();
      if (['hinge', 'bumble'].includes(current)) run(token => call('status', {}, token));
    }
    function setConnected(value) { const next = value === true; if (connected && !next) invalidate(); connected = next; render(); }
    fill(defaults()); render();
    run(token => call('status', {}, token));
    return { setPlatform, setConnected, handleState, invalidate };
  }
  global.SSMobileAutomation = { mount };
})(globalThis);


