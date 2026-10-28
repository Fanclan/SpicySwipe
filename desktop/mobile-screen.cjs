'use strict';
const { createHash } = require('node:crypto');
const PACKAGE = 'co.hinge.app';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const profileContentLabels = new Set(['Like','Like photo','Like prompt','Like video','Like video prompt','Like photo prompt','Unmute video','Play Voice Prompt','Like voice prompt','Show caption','Hide caption']);
const blankControls = () => ({ skip: null, like: null, sendLike: null, comment: null, composer: null, sendMessage: null });
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
function decode(value) {
 if (/[<]/.test(value) || /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/.test(value)) throw new Error('Invalid XML attribute.');
 return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, (_, code) => {
  if (code[0] !== '#') return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[code];
  const number = code[1] === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
  if (!(number === 9 || number === 10 || number === 13 || (number >= 32 && number <= 0xd7ff) || (number >= 0xe000 && number <= 0xfffd) || (number >= 0x10000 && number <= 0x10ffff))) throw new Error('Invalid XML character.');
  return String.fromCodePoint(number);
 });
}
function parse(xml) {
 if (typeof xml !== 'string' || !xml.length || Buffer.byteLength(xml) > 2 * 1024 * 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(xml)) throw new Error('Invalid or oversized Android hierarchy.');
 let source = xml.trim().replace(/^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?(?:\s+standalone=["'](?:yes|no)["'])?\s*\?>/i, '');
 const stack = [], nodes = []; let position = 0, roots = 0;
 while (position < source.length) {
  const rest = source.slice(position); const whitespace = /^\s+/.exec(rest);
  if (whitespace) { position += whitespace[0].length; continue; }
  if (source[position] !== '<' || /^<[!?]/.test(rest)) throw new Error('Unsupported XML markup.');
  let end = position + 1, quote = null;
  for (; end < source.length; end++) { const character = source[end]; if (quote) { if (character === quote) quote = null; } else if (character === '"' || character === "'") quote = character; else if (character === '>') break; else if (character === '<') throw new Error('Malformed XML.'); }
  if (end === source.length || quote) throw new Error('Unclosed XML tag.');
  const tag = source.slice(position + 1, end); position = end + 1;
  const closing = /^\/(hierarchy|node)\s*$/.exec(tag);
  if (closing) { if (stack.pop()?.tag !== closing[1]) throw new Error('Mismatched XML tag.'); continue; }
  const opening = /^(hierarchy|node)(?=\s|\/|$)/.exec(tag);
  if (!opening) throw new Error('Unsupported XML element.');
  const selfClosing = tag.endsWith('/'); let attrs = tag.slice(opening[0].length).replace(/\/\s*$/, ''); const a = Object.create(null);
  while (attrs.length) {
   if (/^\s*$/.test(attrs)) break;
   const attribute = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/.exec(attrs);
   if (!attribute || Object.hasOwn(a, attribute[1])) throw new Error('Invalid or duplicate XML attribute.');
   a[attribute[1]] = decode(attribute[2].slice(1, -1)); attrs = attrs.slice(attribute[0].length);
   if (Object.keys(a).length > 40) throw new Error('Too many XML attributes.');
  }
  const parent = stack.at(-1), tagName = opening[1];
  if (!parent) { if (tagName !== 'hierarchy' || ++roots !== 1) throw new Error('Invalid XML root.'); }
  else if (tagName !== 'node') throw new Error('Invalid Android element nesting.');
  const node = { tag: tagName, a, parent, enabled: a.enabled !== 'false' && parent?.enabled !== false, visible: a['visible-to-user'] !== 'false' && parent?.visible !== false };
  if (tagName === 'node') nodes.push(node);
  if (nodes.length > 12000 || stack.length > 128) throw new Error('Android hierarchy is too complex.');
  if (!selfClosing) stack.push(node);
 }
 if (stack.length || roots !== 1) throw new Error('Incomplete XML hierarchy.');
 return nodes;
}
function bounds(node) {
 const m = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(node.a.bounds || '');
 if (!m) return null;
 const [x, y, right, bottom] = m.slice(1).map(Number);
 return right > x && bottom > y && right <= 16384 && bottom <= 16384 ? { x, y, width: right - x, height: bottom - y } : null;
}
function fullyVisible(node) {
 const b = bounds(node); if (!b || !node.visible) return false;
 for (let p = node.parent; p; p = p.parent) {
  const outer = bounds(p); if (p.tag === 'node' && !outer) return false;
  if (outer && (b.x < outer.x || b.y < outer.y || b.x + b.width > outer.x + outer.width || b.y + b.height > outer.y + outer.height)) return false;
 }
 return true;
}
function photoRevealDirection(photo) {
 const b=bounds(photo);if(!b)return null;
 for(let p=photo.parent;p;p=p.parent){
  const viewport=bounds(p);if(p.a.scrollable!=='true'||!viewport||viewport.height<=viewport.width||viewport.height<b.width)continue;
  const cropped=b.height<b.width-3;
  const top=b.y<viewport.y||(cropped&&Math.abs(b.y-viewport.y)<=3);
  const bottom=b.y+b.height>viewport.y+viewport.height||(cropped&&Math.abs(b.y+b.height-viewport.y-viewport.height)<=3);
  return top===bottom?null:top?'down':'up';
 }
 return null;
}
function sharesPhotoCard(photo, button) {
 const box = bounds(photo);
 for (let p = photo.parent; p; p = p.parent) {
  const b = bounds(p);
  if (!b || b.x !== box.x || b.width !== box.width) continue;
  const sameImage=b.y===box.y&&b.height===box.height;
  const captionCard=label(button)==='Like photo prompt'&&b.y<box.y&&box.y-b.y<=box.width*.3&&b.y+b.height===box.y+box.height;
  if(!sameImage&&!captionCard)continue;
  for (let q = button.parent; q; q = q.parent) if (q === p) return true;
 }
 return false;
}
const label = node => clean(node.a['content-desc'] || node.a.text);
function control(node, allowCompose = false) {
 if (!node || !node.enabled || !fullyVisible(node) || (!allowCompose && (node.a.clickable !== 'true' || node.a.class !== 'android.widget.Button'))) return null;
 return { key: hash([label(node), node.a['resource-id'], bounds(node)]), bounds: bounds(node), label: label(node) };
}
function readScreen(xml, { platform = 'hinge', foreground, photoIdentity, commentText } = {}) {
 const result = { platform, kind: 'blocked', name: '', identity: null, screenKey: null, context: { name: '', bio: '', history: '' }, photos: [], controls: blankControls(), composerText: '', composerTextVerified: false, emptyConversation: false, reason: '' };
 const block = reason => ({ ...result, kind: 'blocked', controls: blankControls(), reason });
 if(platform==='bumble')return require('./bumble-screen.cjs')(xml,{foreground,photoIdentity},{parse,bounds,fullyVisible,label,control,hash,result,block});
 if (platform !== 'hinge') return { ...result, kind: 'unsupported', reason: 'Screen reading is not verified for this platform.' };
 if (foreground !== PACKAGE) return block('Hinge must be the selected device foreground app.');
 let nodes; try { nodes = parse(xml); } catch (error) { return block(error.message); }
 // A nearby playing video updates its inert accessibility timer even while the selected photo is unchanged.
 // Normalize only that observed metadata; keep all geometry, other text and actionable attributes in the hash.
 const videoContainers=new Set(nodes.filter(n=>n.a.class==='android.widget.Button'&&n.enabled&&n.visible&&n.a.clickable==='true'&&label(n)==='Unmute video'&&n.parent?.a.class==='android.view.View').map(n=>n.parent));
 result.screenKey = hash(nodes.map(n=>n.a.class==='android.view.View'&&n.a.clickable==='false'&&n.a.scrollable==='false'&&!clean(n.a.text)&&videoContainers.has(n.parent)&&/^Elapsed time: \d+ seconds?$/.test(n.a['content-desc']||'')?{...n.a,'content-desc':'Elapsed time: <playing>'}:n.a));
 if (!nodes.length || nodes.some(n => n.a.package && n.a.package !== PACKAGE)) return block('Another app or system overlay is visible. Return to Hinge.');
 if (nodes.some(n => /(?:^|\.)(?:Dialog|AlertDialog|PopupWindow)$/.test(n.a.class || '') || /:id\/(?:alertTitle|button1|permission_allow_button)$/.test(n.a['resource-id'] || ''))) return block('A dialog requires user attention.');
 const visible = nodes.filter(n => n.visible), find = text => visible.filter(n => label(n) === text);
 if (find('No network connection').length) return block('No network connection. Restore connectivity and read the screen again.');
 const offerTitle='Send a Rose instead?',offerBody='Upgrade your Like to a Rose to be seen first and increase your chance of a match.';
 if(find(offerTitle).length||find('Send Like anyway').length){
  const title=find(offerTitle),body=find(offerBody),ordinary=find('Send Like anyway'),rose=find('Send a Rose'),close=find('Close sheet');
  if([title,body,ordinary,rose,close].some(a=>a.length!==1))return block('The Rose offer is ambiguous.');
  const normal=ordinary[0],normalButton=normal.parent,roseButton=rose[0].parent,sheet=normalButton?.parent;
  if(sheet?.a.class!=='android.widget.ScrollView'||title[0].parent?.parent!==sheet||body[0].parent!==sheet||roseButton?.parent!==sheet)return block('The ordinary Like must belong to the recognized Rose offer.');
  const expected=new Set([offerTitle,offerBody,'Send Like anyway','Send a Rose','Close sheet']);
  if(visible.some(n=>label(n)&&!expected.has(label(n))))return block('An unfamiliar offer requires attention.');
  const clicks=new Set([normalButton,roseButton,close[0]]);
  if(visible.some(n=>n.a.clickable==='true'&&!clicks.has(n)))return block('An unfamiliar offer control requires attention.');
  for(const [text,button]of [[normal,normalButton],[rose[0],roseButton]]){
   const children=visible.filter(n=>n.parent===button);
   if(text.a.class!=='android.widget.TextView'||button.a.class!=='android.view.View'||button.a.clickable!=='true'||!button.enabled||!fullyVisible(text)||children.length!==2||children.filter(n=>n.a.class==='android.widget.Button'&&n.enabled&&fullyVisible(n)).length!==1)return block('The ordinary Like offer control is unavailable.');
  }
  if(!close[0].enabled||close[0].a.clickable!=='true'||!fullyVisible(close[0]))return block('The offer overlay is not verified.');
  const action=control(normalButton,true);if(!action)return block('The normal Like button is outside the visible sheet.');
  result.kind='likeOffer';result.identity=hash(['hinge-rose-offer',result.screenKey]);result.controls.sendLike={...action,label:'Send Like anyway'};
  result.reason='Rose offer: continue with a normal Like.';return result;
 }
 const safeViewLabels = new Set(['Discover','Standouts','Likes You','Matches','Profile Hub','Signals','Benefits','Like photo','Like prompt','Undo last skip','More','Selfie Verified','Dating Preferences']);
 if (visible.some(n => n.enabled && n.a.clickable === 'true' && n.a.class === 'android.view.View' && label(n) && !safeViewLabels.has(label(n)) && !/^Skip .+/.test(label(n)))) return block('An unfamiliar overlay requires user attention.');
 const chat=require('./mobile-chat.cjs').readChat({nodes,visible,find,label,bounds,fullyVisible,control,hash,result,block});if(chat)return chat;
 const nav = find('Discover');
 if (nav.length !== 1 || ![nav[0], nav[0].parent].some(n => n?.a.selected === 'true')) return block('Open the ordinary Discover feed. This screen is not verified.');
 const skips = visible.filter(n => /^Skip .+/.test(label(n)));
 if (skips.length !== 1) return block('A single current profile could not be identified.');
 result.name = label(skips[0]).slice(5); result.context.name = result.name;
 // This native prompt action is recognized only for the current profile; it is never a photo target.
 const friendTake=n=>n.a.class==='android.widget.Button'&&label(n)==="Like "+result.name+"'s Friend's Take";
 const pictures = visible.filter(n => label(n) === result.name + "'s photo" && n.a.class === 'android.widget.ImageView' && bounds(n));
 const prompts = [...new Set(visible.map(label).filter(text => /^Prompt: .+\. Answer: .+/.test(text)))];
 const detailLabels = new Set(['Age', 'Gender', 'Sexuality', 'Height', 'Religion', 'Politics', 'Languages Spoken', 'Dating Intentions']);
 const details = [];
 for (const n of visible.filter(n => detailLabels.has(label(n)) && fullyVisible(n))) {
  const siblings = visible.filter(other => other.parent === n.parent && other !== n && other.a.text && fullyVisible(other));
  if (siblings.length === 1) details.push(label(n) + ': ' + clean(siblings[0].a.text));
 }
 result.context.bio = [...prompts.map(text => text.replace(/^Prompt: /, '').replace(/\. Answer: /, ': ')), ...details].join('\n');
 // A name and generic photo label cannot distinguish two people with the same name.
 result.identity = prompts.length ? hash(['hinge-profile', result.name, [...prompts].sort()]) : /^[a-f0-9]{16}$/.test(photoIdentity || '') && pictures.some(fullyVisible) ? hash(['hinge-photo', result.name, photoIdentity]) : null;
 const comment = find('Edit comment'), priority = [...find('Send priority like'),...find('Send priority like with message')], ordinary = [...find('Send like'),...find('Send like with message')];
 if (comment.length || priority.length || ordinary.length || find('Send a Rose').length) {
  if (comment.length !== 1 || !pictures.length) return block('Unrecognized Like confirmation. Return to Discover.');
  const editor=bounds(comment[0]);
  const confirmation=pictures.filter(n=>{const b=bounds(n);return editor&&b.x===editor.x&&b.width===editor.width&&b.y+b.height<=editor.y;});
  if(confirmation.length!==1)return block('The selected confirmation photo is ambiguous.');
  const photoBounds=bounds(confirmation[0]);
  const photoCaptionControl=n=>{
   const b=bounds(n),p=photoBounds;
   if(n.a.class!=='android.widget.Button'||!['Show caption','Hide caption'].includes(label(n))||!b||b.x<p.x||b.x+b.width>p.x+p.width||b.y+b.height>p.y+p.height)return false;
   if(b.y>=p.y)return true;
   // Compose can leave the caption's bounds above the photo's clipped top edge.
   // Ignore it only inside that image's own wrapper and original square, never as a target.
   if(p.height>=p.width||b.y<p.y+p.height-p.width||b.y+b.height<=p.y)return false;
   for(let wrapper=confirmation[0].parent;wrapper;wrapper=wrapper.parent){
    const w=bounds(wrapper);
    if(wrapper.a.class!=='android.view.View'||!w||w.x!==p.x||w.width!==p.width||w.y<p.y+p.height-p.width||w.y+w.height!==p.y+p.height)break;
    if(w.y!==p.y||w.height!==p.height)continue;
    for(let parent=n.parent;parent;parent=parent.parent)if(parent===wrapper)return true;
   }
   return false;
  };
  const knownButtons=new Set(['Info','More','Send a Rose','Send a Rose with message','Send priority like','Send priority like with message','Send like','Send like with message']);
  const formBounds=[comment[0],...priority,...ordinary,...find('Send a Rose'),...find('Send a Rose with message')].map(bounds);
  const formBottom=formBounds.length&&formBounds.every(Boolean)?Math.max(...formBounds.map(b=>b.y+b.height)):Infinity;
  const backgroundControl=n=>n.a.class==='android.widget.Button'&&(profileContentLabels.has(label(n))||friendTake(n))&&bounds(n)?.y>=formBottom;
  if(visible.some(n=>n.enabled && /Button$/.test(n.a.class||'') && (label(n)||n.a.clickable==='true') && !knownButtons.has(label(n)) && n!==skips[0]&&!backgroundControl(n)&&!photoCaptionControl(n)))return block('An unfamiliar Like control requires user attention.');
  result.kind = 'like'; result.controls.comment = control(comment[0], true);
  // HingeX automatically gives ordinary Likes priority. Roses are never selected.
  // Compose omits typed text from accessibility, so submission requires local visual verification.
  result.composerTextVerified=typeof commentText==='string';
  result.composerText=result.composerTextVerified?commentText:'';
  result.controls.composer=result.composerTextVerified?result.controls.comment:null;
  const final=[...priority,...ordinary];
  if(result.identity && result.composerTextVerified && final.length===1 && Boolean(commentText.trim())===label(final[0]).endsWith(' with message') && final[0].a.class==='android.widget.Button')result.controls.sendLike=control(final[0],true);
  result.reason=result.controls.sendLike?'':'Like submission requires verified comment contents and an unambiguous ordinary Like button.';
  result.photos = confirmation.map(n => ({ key: hash(['photo', label(n),bounds(n)]), bounds: bounds(n), like: null }));
  return result;
 }
 const allowedLabels = new Set([...profileContentLabels, 'Undo last skip', 'More', 'Selfie Verified', 'Dating Preferences']);
 const unknownControl=visible.find(n => n.enabled && n.a.clickable === 'true' && /Button$/.test(n.a.class || '') && !allowedLabels.has(label(n)) && !friendTake(n) && n !== skips[0]);
 if (unknownControl) return block('Unrecognized profile control: '+(label(unknownControl).slice(0,80)||'(unlabeled)')+'.');
 result.kind = 'profile';
 const likes = [...find('Like photo'),...find('Like photo prompt')];
 result.photos = pictures.map(n => {
  const b = bounds(n); const matching = likes.filter(l => { const p = bounds(l); return sharesPhotoCard(n, l) && p && p.x >= b.x && p.y >= b.y && p.x + p.width <= b.x + b.width && p.y + p.height <= b.y + b.height; });
  return { key: hash(['photo', label(n), b]), bounds: b, revealDirection: photoRevealDirection(n), like: result.identity && Math.abs(b.width-b.height)<=3 && fullyVisible(n) && matching.length === 1 && fullyVisible(matching[0]) ? control(matching[0]) : null };
 });
 result.controls.skip = result.identity ? control(skips[0]) : null;
 result.controls.like = result.photos.find(photo => photo.like)?.like || null;
 if (!result.identity) result.reason = 'Visible profile evidence is insufficient to distinguish same-name profiles.';
 return result;
}
module.exports = { readScreen };
