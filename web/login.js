'use strict';
(() => {
  const form = document.querySelector('#signin');
  const password = document.querySelector('#password');
  const toggle = document.querySelector('#reveal');
  const submit = document.querySelector('#submit');
  const label = submit.querySelector('span');
  const feedback = document.querySelector('#feedback');

  toggle.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    password.focus();
  });

  password.addEventListener('input', () => {
    feedback.textContent = '';
    password.removeAttribute('aria-invalid');
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    label.textContent = 'Signing in…';
    feedback.textContent = '';
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({password: password.value}),
        credentials: 'same-origin'
      });
      if (response.ok) {
        location.replace('/');
        return;
      }
      if (response.status === 401) {
        password.setAttribute('aria-invalid', 'true');
        feedback.textContent = 'That password didn’t match. Please try again.';
        password.focus();
        password.select();
      } else if (response.status === 429) {
        feedback.textContent = 'Too many attempts. Wait a few minutes before trying again.';
      } else {
        feedback.textContent = 'Sign-in is unavailable right now. Try again shortly.';
      }
    } catch {
      feedback.textContent = 'Couldn’t reach your workspace. Check your connection and try again.';
    } finally {
      submit.disabled = false;
      form.removeAttribute('aria-busy');
      label.textContent = 'Sign in';
    }
  });
})();
