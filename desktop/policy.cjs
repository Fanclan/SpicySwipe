'use strict';
const tinderHosts = new Set(['tinder.com', 'www.tinder.com']);
const loginHosts = new Set(['accounts.google.com', 'appleid.apple.com', 'www.facebook.com', 'm.facebook.com']);
function secureHost(value, hosts) { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && hosts.has(u.hostname); } catch { return false; } }
const isTinderURL = value => secureHost(value, tinderHosts);
const isLoginURL = value => isTinderURL(value) || secureHost(value, loginHosts);
function isTrustedUI(value, expected) { try { const u = new URL(value); u.hash = ''; return u.href === expected; } catch { return false; } }
function validateBounds(b, area) {
  if (!b || !['x','y','width','height'].every(k => Number.isFinite(b[k]) && b[k] >= 0)) throw Error('Invalid app view bounds.');
  const x = Math.min(Math.round(b.x), area.width), y = Math.min(Math.round(b.y), area.height);
  return { x, y, width: Math.max(0, Math.min(Math.round(b.width), area.width - x)), height: Math.max(0, Math.min(Math.round(b.height), area.height - y)) };
}
const allowedTinderAction = action => ['load', 'generate', 'record'].includes(action);
module.exports = { isTinderURL, isLoginURL, isTrustedUI, validateBounds, allowedTinderAction };
