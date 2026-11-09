'use strict';
const { createHash } = require('node:crypto');
const PACKAGE = 'co.hinge.app';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const profileContentLabels = new Set(['Like','Like photo','Like prompt','Like video','Like video prompt','Like photo prompt','Unmute video','Play Voice Prompt','Like voice prompt','Show caption','Hide caption']);
const blankControls = () => ({ skip: null, like: null, sendLike: null, comment: null, composer: null, sendMessage: null, retry: null });
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
function visibleVerticalMedia(item, owner) {
 const box = bounds(item);
 if (!box || !item.visible) return null;
 let top = box.y, bottom = box.y + box.height;
 for (let n = item.parent; n; n = n.parent) {
  const outer = bounds(n);
  if (!outer || box.x < outer.x || box.x + box.width > outer.x + outer.width) return null;
  top = Math.max(top, outer.y); bottom = Math.min(bottom, outer.y + outer.height);
  if (n === owner) return bottom > top ? {...box, y:top, height:bottom-top} : null;
 }
 return null;
}
// A wheel scroll has no touch path. Only static native text with an unambiguous hit
// margin qualifies; two independent landmarks allow the controller to verify motion.
function staticWheelFrame(visible,owner,display,discover,kids,backdrops,behindDiscover) {
 const viewport=bounds(owner), skips=visible.filter(n=>/^Skip .+/.test(label(n)));
 if (skips.length!==1 || skips[0].a.class!=='android.widget.Button' || !skips[0].enabled ||
     skips[0].a.clickable!=='true' || !fullyVisible(skips[0])) return null;
 const path=n=>{
  const out=[];
  for (let p=n;p?.tag==='node';p=p.parent) out.push(p);
  return out;
 };
 const interactive=(n,allowOwner=false)=>!n.enabled || ['clickable','long-clickable','focusable','focused','checkable','checked','selected','password']
  .some(k=>n.a[k]==='true') || (!allowOwner && n.a.scrollable==='true') ||
  /(?:Button|EditText|Picker|SeekBar|Spinner|Switch|TabWidget|WebView)$/.test(n.a.class || '');
 if (path(owner).some(n=>interactive(n,n===owner))) return null;
 const texts=visible.filter(n=>n.a.class==='android.widget.TextView' && label(n) && path(n).includes(owner));
 if (texts.length<2 || texts.length>64) return null;
 const keyFor=n=>hash(['discover-text',n.a['resource-id'] || '',label(n)]);
 const keys=texts.map(keyFor), landmarks=[];
 let point=null;
 for (const [i,n] of texts.entries()) {
  const lineage=path(n), depth=lineage.indexOf(owner), b=bounds(n);
  if (keys.indexOf(keys[i])!==keys.lastIndexOf(keys[i]) || kids(n).length || !fullyVisible(n) ||
      interactive(n) || n.a.clickable!=='false' || b.width<26 || b.height<26) continue;
  if (lineage.slice(1,depth).some(p=>!['android.view.View','android.view.ViewGroup','android.widget.FrameLayout','android.widget.LinearLayout'].includes(p.a.class) ||
      interactive(p) || p.a.clickable!=='false' || /(?:picker|tabbar|navigation|slider|input)/i.test(p.a['resource-id'] || ''))) continue;
  const x=Math.floor(b.x+b.width/2), y=Math.floor(b.y+b.height/2), margin=12;
  if (x<viewport.x+margin || x>viewport.x+viewport.width-margin || y<viewport.y+margin || y>viewport.y+viewport.height-margin ||
      x<display.x+24 || x>display.x+display.width-24 || y<display.y+24 || y>display.y+display.height-24) continue;
  const covered=visible.some(other=>{
   const box=bounds(other);
   if (!box) return true;
   if (x+margin<box.x || x-margin>=box.x+box.width || y+margin<box.y || y-margin>=box.y+box.height) return false;
   if (lineage.includes(other) || (other===backdrops.get(n) && !interactive(other))) return false;
   if (interactive(other)) return true;
   const [leaf]=kids(other);
   return !behindDiscover(other,box) && !(kids(other).length===1 && behindDiscover(leaf,bounds(leaf)));
  });
  if (covered) continue;
  point??={x,y};
  landmarks.push({key:keys[i],...b});
 }
 if (landmarks.length<2 || !landmarks.some(n=>Math.abs(n.y-landmarks[0].y)>=24)) return null;
 const shape=n=>path(n).map(p=>[p.a.class,p.a['resource-id'] || '',p.a['drawing-order'] || '',bounds(p)]);
 return {point,frame:{ownerKey:hash(['discover-scroll',shape(owner)]),
  chromeKey:hash(['discover-chrome',shape(discover),shape(skips[0]),label(skips[0])]),landmarks}};
}
// Options and their Like are interactive, so only the heading and the blank space above
// the choices can supply a drag surface. An unobscured photo or prompt keeps precedence.
function alternateScrollSurface(visible,owner,display,mediaSurface,geometry) {
 const children = new Map();
 for (const n of visible) {
  if (!children.has(n.parent)) children.set(n.parent, []);
  children.get(n.parent).push(n);
 }
 const kids = n => children.get(n) || [];
 const inert = (n, cls) => n?.a.class === cls && n.enabled && n.a.clickable === 'false' &&
  n.a.scrollable !== 'true' && n.a['long-clickable'] !== 'true';
 const wrapper = n => inert(n,'android.view.View') && !label(n);
 const sameBox = (a,b) => Boolean(bounds(a) && bounds(b) && a.a.bounds === b.a.bounds);
 const bodyFitsCard = (card,body) => {
  if (sameBox(card,body)) return true;
  // Compose clips the body at the Discover header before updating its outer
  // wrapper and backdrop. Only the top edge may differ, at the viewport edge.
  const full=bounds(card), shown=bounds(body), viewport=bounds(owner);
  return full && shown && full.y<viewport.y && shown.y===viewport.y && fullyVisible(body) &&
   full.x===shown.x && full.width===shown.width && full.y+full.height===shown.y+shown.height;
 };
 const options = n => {
  const parts=kids(n);
  return n.a.class==='android.view.View' && n.a.clickable==='true' && n.enabled &&
   n.a.scrollable!=='true' && n.a['long-clickable']!=='true' && bounds(n) && parts.length===2 &&
   parts.some(p=>inert(p,'android.widget.TextView') && label(p) && !kids(p).length) &&
   parts.some(p=>inert(p,'android.widget.Button') && !label(p) && !kids(p).length);
 };
 const contentLike = n => {
  const [inner]=kids(n), [button]=kids(inner);
  return wrapper(n) && kids(n).length===1 && wrapper(inner) && sameBox(n,inner) &&
   kids(inner).length===1 && button.a.class==='android.widget.Button' && label(button)==='Like' &&
   button.enabled && button.a.clickable==='true' && !kids(button).length && bounds(button);
 };
 // Some Android roots keep a full-display blank View in a separate background
 // ViewGroup. Use explicit sibling drawing order; tree indices can be reversed.
 const behindDiscover = (n,b) => {
  const back=n.parent, common=back?.parent;
  if (!b || !wrapper(n) || n.a.focusable==='true' || kids(n).length || !inert(back,'android.view.ViewGroup') ||
      label(back) || back.a.focusable==='true' || kids(back).length!==1 || common?.a.class!=='android.view.ViewGroup' ||
      b.x!==display.x || b.y!==display.y || b.width!==display.width || b.height!==display.height ||
      !sameBox(n,back) || !sameBox(back,common)) return false;
  let front=owner;
  while (front && front.parent!==common) front=front.parent;
  if (front?.a.class!=='android.widget.FrameLayout' || !sameBox(back,front)) return false;
  const order=layer=>/^[1-9]\d{0,4}$/.test(layer.a['drawing-order'] || '') ? Number(layer.a['drawing-order']) : 0;
  const lower=order(back), upper=order(front);
  return lower>0 && lower<upper && kids(common).filter(layer=>order(layer)===lower).length===1 &&
   kids(common).filter(layer=>order(layer)===upper).length===1;
 };
 const candidates=[], headingBackdrops=new Map();
 for (const card of kids(owner)) {
  const [body]=kids(card);
  if (!wrapper(card) || kids(card).length!==1 || !wrapper(body) || !bodyFitsCard(card,body)) continue;
  const nodes=kids(body), headings=nodes.filter(n=>inert(n,'android.widget.TextView') && label(n) && !kids(n).length);
  const choices=nodes.filter(options), backdrops=nodes.filter(n=>wrapper(n) && sameBox(n,card) && !kids(n).length);
  if (headings.length!==1 || choices.length<2 || choices.length>4 || backdrops.length!==1 ||
      nodes.filter(contentLike).length!==1 || nodes.length!==choices.length+3) continue;
  const heading=headings[0], h=bounds(heading), panel=visibleVerticalMedia(body,owner);
  if (!h || !panel || !fullyVisible(heading)) continue;
  // A point on this native heading overlaps the blank sibling's raw bounds.
  // Its explicit drawing order must put the heading in front of that sibling.
  const below=backdrops[0].a['drawing-order'], above=heading.a['drawing-order'];
  if (/^\d{1,5}$/.test(below) && /^\d{1,5}$/.test(above) && Number(below)<Number(above)) {
   headingBackdrops.set(heading,backdrops[0]);
  }
  const padding=12, width=96, x=Math.floor(h.x+(h.width-width)/2);
  const top=Math.max(panel.y,display.y+Math.ceil(display.height*.1))+padding;
  const bottom=Math.min(...choices.map(n=>bounds(n).y),panel.y+panel.height,display.y+Math.floor(display.height*.9))-padding;
  if (x<panel.x+padding || x+width>panel.x+panel.width-padding || h.y<top ||
      h.y+h.height>bottom || bottom-top<120) continue;
  const blocked=visible.some(n=>{
   if (n===owner || n===heading || n===backdrops[0]) return false;
   const interactive=n.a.clickable==='true' || n.a['long-clickable']==='true' || n.a.scrollable==='true' ||
    n.a.class==='android.widget.Button' || n.a.class==='android.widget.EditText';
   // Ignore only passive enclosing layout. A separate visible leaf could cover the lane.
   const b=bounds(n);
   if (!b) return true;
   if (!interactive && kids(n).length && !label(n)) return false;
   const overlaps=x-padding<b.x+b.width && b.x<x+width+padding && top-padding<b.y+b.height && b.y<bottom+padding;
   return overlaps && (interactive || !behindDiscover(n,b));
  });
  if (!blocked) candidates.push({bounds:{x,y:top,width,height:bottom-top},clipped:!sameBox(card,body)});
 }
 const wheel=staticWheelFrame(visible,owner,display,geometry.discover,kids,headingBackdrops,behindDiscover);
 if (wheel) {geometry.wheelPoint=wheel.point;geometry.scrollFrame=wheel.frame;}
 if (mediaSurface) return mediaSurface;
 if (candidates.length!==1) return null;
 geometry.newChoiceLane=candidates[0].clipped;
 return candidates[0].bounds;
}
function discoverScrollSurfaces(visible, discover, media) {
 const tab = bounds(discover);
 if (!tab) return {review:null};
 // The full-width profile scroller shares its lower edge with the Discover navigation.
 const owners = visible.filter(n => {
  if (n.a.scrollable !== 'true') return false;
  const b = bounds(n);
  return b && b.x === 0 && b.width > tab.width && b.y + b.height === tab.y;
 });
 const compressed = owners.filter(n => {
  const b = bounds(n);
  return b.width > b.height;
 });
 let root = discover;
 while (root.parent?.tag === 'node') root = root.parent;
 const geometry={discover,wheelPoint:null,scrollFrame:null,newChoiceLane:false};
 return {
  // Existing reviews use an explicit surface only when a banner compresses the viewport.
  compressed:compressed.length ? mediaScrollSurface(visible, media, compressed, root, false) : undefined,
  review:discover.enabled && fullyVisible(discover) ? mediaScrollSurface(visible, media, owners, root, geometry) : null,
  wheelPoint:geometry.wheelPoint,scrollFrame:geometry.scrollFrame,newChoiceLane:geometry.newChoiceLane
 };
}
function mediaScrollSurface(visible, media, owners, root, alternate) {
 if (owners.length !== 1) return null;
 const [owner] = owners;
 const display = bounds(root), viewport = bounds(owner);
 if (owner.a.class !== 'android.view.View' || owner.a.clickable !== 'false' ||
     owner.a['long-clickable'] === 'true' || !owner.enabled || !fullyVisible(owner) ||
     !display || display.x !== viewport.x || display.width !== viewport.width) return null;
 if (alternate) {
  let ownerRoot=owner;
  while (ownerRoot.parent?.tag === 'node') ownerRoot=ownerRoot.parent;
  if (ownerRoot !== root) return null;
 }
 const surfaces = [];
 for (const item of media) {
  let parent = item.parent;
  while (parent && parent.a.scrollable !== 'true') parent = parent.parent;
  if (parent !== owner) return null;
  if (!item.enabled || item.a.clickable !== 'false' || item.a['long-clickable'] === 'true') continue;
  const b = alternate ? visibleVerticalMedia(item, owner) : fullyVisible(item) && bounds(item);
  if (!b || b.width < 96 || b.height < 120) continue;
  const x = Math.floor(b.x + b.width / 2), margin = alternate ? 8 : 0;
  // Only move through inert content. A floating button or a nested carousel can
  // share its coordinates even when it is a sibling outside the media subtree.
  const obstructed = visible.some(n => {
   if (n === owner || !(n.a.clickable === 'true' || n.a['long-clickable'] === 'true' || n.a.scrollable === 'true' ||
       n.a.class === 'android.widget.EditText' || n.a.class === 'android.widget.Button')) return false;
   const obstacle = bounds(n);
   return !obstacle || (x + margin >= obstacle.x && x - margin < obstacle.x + obstacle.width && b.y < obstacle.y + obstacle.height && obstacle.y < b.y + b.height);
  });
  if (!obstructed) surfaces.push(b);
 }
 const mediaSurface=surfaces.sort((a,b) => b.height - a.height)[0] || null;
 return alternate ? alternateScrollSurface(visible,owner,display,mediaSurface,alternate) : mediaSurface;
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
const discoverTabNames = ['Discover', 'Standouts', 'Likes You', 'Matches', 'Profile Hub'];
// Both native Discover placeholders keep the same contiguous row of five tabs.
function discoverNavigation(find, minY) {
 const tabs = [];
 let previous;
 for (const [index, text] of discoverTabNames.entries()) {
  const matches = find(text).filter(node => index !== 0 || node.a.class === 'android.view.View');
  if (matches.length !== 1) return null;
  const item = matches[0], tab = item.parent, box = bounds(item), tabBox = tab && bounds(tab);
  if (item.a.class !== 'android.view.View' || item.a.clickable !== 'false' || !item.enabled || !fullyVisible(item) ||
      tab?.a.class !== 'android.view.View' || !tab.enabled || !fullyVisible(tab) ||
      tab.a.clickable !== (index === 0 ? 'false' : 'true') || (tab.a.selected === 'true') !== (index === 0) ||
      !box || !tabBox || box.x !== tabBox.x || box.y !== tabBox.y || box.width !== tabBox.width || box.height !== tabBox.height || box.y < minY) return null;
  if (previous && (tab.parent !== tabs[0].parent || box.x !== previous.x + previous.width || box.y !== previous.y || box.height !== previous.height)) return null;
  tabs.push(tab);
  previous = box;
 }
 return tabs;
}
function blankDiscoverShell(visible, find) {
 const discover = find('Discover');
 if (discover.length !== 2) return false;
 const header = discover.find(n => n.a.class === 'android.widget.TextView');
 if (!header || header.a.clickable !== 'false' || !header.enabled || !fullyVisible(header)) return false;
 const box = bounds(header), tabs = discoverNavigation(find, box.y + box.height);
 if (!tabs || visible.filter(n => label(n)).length !== 6) return false;
 const otherTabs = new Set(tabs.slice(1));
 const containers = /^(?:android\.(?:view\.(?:View|ViewGroup)|widget\.(?:FrameLayout|LinearLayout))|(?:[\w.]+\.)?(?:ComposeView|ycl))$/;
 return visible.every(n => (n === header || containers.test(n.a.class || '')) && n.a.scrollable !== 'true' &&
  (n.a.selected === 'true') === (n === tabs[0]) && (n.a.clickable === 'true') === otherTabs.has(n) &&
  !(clean(n.a.text) && clean(n.a['content-desc']) && clean(n.a.text) !== clean(n.a['content-desc'])));
}
function readScreen(xml, { platform = 'hinge', foreground, photoIdentity, commentText } = {}) {
 const result = { platform, kind: 'blocked', name: '', identity: null, screenKey: null, context: { name: '', bio: '', history: '' }, photos: [], prompts: [], controls: blankControls(), composerText: '', composerTextVerified: false, emptyConversation: false, reason: '' };
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
 const errorTitle='Something went wrong',errorBody="Oops, something's gone wrong. Let's give it another try.";
 if(find(errorTitle).length||find(errorBody).length||find('Try again').length){
  const required=[errorTitle,errorBody,'Try again'];
  const expected=new Set([...required,...discoverTabNames]);
  if(required.some(text=>find(text).length!==1)||visible.some(n=>(label(n)&&!expected.has(label(n)))||/EditText/.test(n.a.class||'')))return block('The Discover retry screen is not verified.');
  const title=find(errorTitle)[0],body=find(errorBody)[0],retry=find('Try again')[0],button=retry.parent,sheet=button?.parent;
  const inertText=n=>n.a.class==='android.widget.TextView'&&n.a.clickable==='false'&&n.enabled&&fullyVisible(n);
  if(![title,body,retry].every(inertText)||sheet?.a.class!=='android.widget.ScrollView'||title.parent?.parent!==sheet||body.parent!==sheet||button.a.class!=='android.view.View'||button.a.clickable!=='true'||!button.enabled||!fullyVisible(button))return block('The native Discover retry control is unavailable.');
  const children=visible.filter(n=>n.parent===button),native=children.filter(n=>n.a.class==='android.widget.Button');
  const b=bounds(button),s=bounds(sheet),t=bounds(title),bodyBox=bounds(body),nativeBox=native.length===1&&bounds(native[0]);
  if(children.length!==2||native.length!==1||native[0].a.clickable!=='false'||label(native[0])||!native[0].enabled||!fullyVisible(native[0])||!nativeBox||nativeBox.x!==b.x||nativeBox.y!==b.y||nativeBox.width!==b.width||Math.abs(nativeBox.height-b.height)>1||t.y+t.height>bodyBox.y||bodyBox.y+bodyBox.height>b.y)return block('The native Discover retry bounds are not verified.');
  const discover=find('Discover'),headers=discover.filter(n=>n.a.class==='android.widget.TextView'),tabs=discover.filter(n=>n.a.class==='android.view.View');
  if(discover.length!==2||headers.length!==1||tabs.length!==1||!inertText(headers[0])||bounds(headers[0]).y+bounds(headers[0]).height>s.y)return block('The Discover retry header is not verified.');
  const tabRow=discoverNavigation(find,s.y+s.height);
  if(!tabRow)return block('The Discover retry navigation is not verified.');
  const clicks=new Set([button,...tabRow.slice(1)]);
  if(visible.some(n=>(n.a.clickable==='true'&&!clicks.has(n))||(/Button$/.test(n.a.class||'')&&n!==native[0])))return block('An unfamiliar control covers the Discover retry screen.');
  const action=control(button,true);if(!action)return block('The Discover retry target is unavailable.');
  result.kind='feedError';result.controls.retry={...action,label:'Try again'};result.reason='Discover could not load. Retry is available.';return result;
 }
 if(blankDiscoverShell(visible,find)){
  result.kind='feedLoading';result.reason='Waiting for Discover to load.';return result;
 }
 const emptyTitle="You've seen everyone for now",emptyBody='Try changing your filters so more people match your criteria—or check back later!';
 if(find(emptyTitle).length){
  const nav=find('Discover'),required=[emptyTitle,emptyBody,'Change filters','Review skipped profiles'];
  const labels=new Set([...required,'Discover','Standouts','Likes You','Matches','Profile Hub','Dating Preferences','Signals filter, Off','Age filter options','Height filter options','Dating intentions filter options']);
  // Unread message counts change independently of the exhausted Discover queue.
  // Accept that inert label only inside a sibling native navigation tab, never in an overlay.
  const badges=visible.filter(n=>/^Matches, (?:1 new message|(?:[2-9]|[1-9]\d+) new messages)$/.test(label(n)));
  const navigationBadge=n=>{
   const discover=nav[0],tab=n.parent,discoverTab=discover?.parent,b=bounds(n),d=discover&&bounds(discover),t=tab&&bounds(tab);
   return badges.length===1&&n===badges[0]&&nav.length===1&&n.a.class==='android.view.View'&&n.a.clickable==='false'&&
    discover.a.class==='android.view.View'&&discoverTab?.a.class==='android.view.View'&&discoverTab.a.selected==='true'&&
    tab?.a.class==='android.view.View'&&tab.a.clickable==='true'&&tab.parent===discoverTab.parent&&tab!==discoverTab&&
    fullyVisible(n)&&fullyVisible(discover)&&b&&d&&t&&b.x===t.x&&b.y===t.y&&b.width===t.width&&b.height===t.height&&
    b.y===d.y&&b.height===d.height&&b.x>=d.x+d.width;
  };
  if(nav.length!==1||![nav[0],nav[0].parent].some(n=>n?.a.selected==='true')||required.some(text=>find(text).length!==1||!fullyVisible(find(text)[0]))||visible.some(n=>(label(n)&&!labels.has(label(n))&&!navigationBadge(n))||/EditText/.test(n.a.class||'')))return block('Empty Discover screen is not verified.');
  result.kind='empty';result.reason='Waiting for profiles. Your filters are unchanged.';return result;
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
 // Native photo labels can preserve trailing whitespace from a profile name.
 // Normalize only the owner segment; retain the exact suffix, name casing and image type.
 const photoSuffix = "'s photo";
 const pictures = visible.filter(n => label(n).endsWith(photoSuffix) && clean(label(n).slice(0,-photoSuffix.length)) === result.name && n.a.class === 'android.widget.ImageView' && bounds(n));
 const prompts = [...new Set(visible.map(label).filter(text => /^Prompt: .+\. Answer: .+/.test(text)))];
 const staticPrompts=visible.filter(n=>n.a.class==='android.view.View'&&n.enabled&&n.a.clickable==='false'&&/^Prompt: .+\. Answer: .+$/.test(label(n))&&bounds(n));
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
  if (comment.length !== 1) return block('Unrecognized Like confirmation. Return to Discover.');
  const editor=bounds(comment[0]);
  const confirmation=pictures.filter(n=>{const b=bounds(n);return editor&&b.x===editor.x&&b.width===editor.width&&b.y+b.height<=editor.y;});
  // The observed prompt preview and comment form are siblings in one card.
  const promptConfirmation=staticPrompts.filter(n=>{
   const b=bounds(n),wrapper=n.parent,card=wrapper?.parent,form=comment[0].parent,w=wrapper&&bounds(wrapper),f=form&&bounds(form);
   return fullyVisible(n)&&editor&&b.x===editor.x&&b.width===editor.width&&b.y+b.height<=editor.y&&wrapper?.a.class==='android.view.View'&&w&&w.x===b.x&&w.y===b.y&&w.width===b.width&&w.height===b.height&&card?.a.class==='android.view.View'&&card===form?.parent&&form.a.class==='android.view.View'&&f?.y===b.y+b.height;
  });
  if(confirmation.length+promptConfirmation.length!==1)return block('The selected confirmation content is ambiguous.');
  if(promptConfirmation.length&&[...priority,...ordinary,...find('Send a Rose'),...find('Send a Rose with message')].some(n=>n.parent!==comment[0].parent))return block('The prompt Like controls must belong to its comment form.');
  const photoBounds=confirmation.length?bounds(confirmation[0]):null;
  const photoCaptionControl=n=>{
   const b=bounds(n),p=photoBounds;
   if(!p||n.a.class!=='android.widget.Button'||!['Show caption','Hide caption'].includes(label(n))||!b||b.x<p.x||b.x+b.width>p.x+p.width||b.y+b.height>p.y+p.height)return false;
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
  const promptBackgroundControl=n=>{
   if(n.a.class!=='android.widget.Button')return false;
   const action=label(n),photoControl=['Like photo','Like photo prompt','Show caption','Hide caption'].includes(action),videoControl=['Like video','Like video prompt','Unmute video'].includes(action);
   if(!photoControl&&!videoControl&&action!=='Like prompt')return false;
   const selectedCard=promptConfirmation[0].parent.parent,selected=bounds(selectedCard),button=bounds(n);
   if(!selected||!button)return false;
   for(let card=n.parent;card;card=card.parent){
    const b=bounds(card);
    // Ignore only another native content card in the same feed, wholly outside the form.
    if(card.parent!==selectedCard.parent||card.a.class!=='android.view.View'||card.parent?.a.scrollable!=='true'||!b||b.x!==selected.x||b.width!==selected.width||!(b.y+b.height<=selected.y||b.y>=selected.y+selected.height)||button.x<b.x||button.y<b.y||button.x+button.width>b.x+b.width||button.y+button.height>b.y+b.height)continue;
    return visible.filter(content=>{
     const owned=photoControl?pictures.includes(content):videoControl?content.a.class==='android.view.View'&&content.a.clickable==='false'&&label(content)===result.name+"'s video":staticPrompts.includes(content),box=bounds(content);
     if(!owned||!content.enabled||!box||box.x!==b.x||box.width!==b.width||box.y<b.y||box.y+box.height>b.y+b.height)return false;
     for(let parent=content.parent;parent;parent=parent.parent)if(parent===card)return true;
     return false;
    }).length===1;
   }
   return false;
  };
  const backgroundControl=n=>promptConfirmation.length?promptBackgroundControl(n):n.a.class==='android.widget.Button'&&(profileContentLabels.has(label(n))||friendTake(n))&&bounds(n)?.y>=formBottom;
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
  result.prompts = promptConfirmation.map(n=>({key:hash(['prompt',label(n),bounds(n)]),text:label(n),bounds:bounds(n),like:null}));
  return result;
 }
 const allowedLabels = new Set([...profileContentLabels, 'Undo last skip', 'More', 'Selfie Verified', 'Dating Preferences']);
 const unknownControl=visible.find(n => n.enabled && n.a.clickable === 'true' && /Button$/.test(n.a.class || '') && !allowedLabels.has(label(n)) && !friendTake(n) && n !== skips[0]);
 if (unknownControl) return block('Unrecognized profile control: '+(label(unknownControl).slice(0,80)||'(unlabeled)')+'.');
 result.kind = 'profile';
 const surfaces = discoverScrollSurfaces(visible, nav[0], [...pictures, ...staticPrompts]);
 if (surfaces.compressed !== undefined) result.scrollSurface = surfaces.compressed;
 result.reviewScrollSurface = surfaces.review;
 result.reviewNewChoiceLane = surfaces.newChoiceLane===true;
 result.reviewWheelPoint = surfaces.wheelPoint || null;
 result.reviewScrollFrame = surfaces.scrollFrame || null;
 const likes = [...find('Like photo'),...find('Like photo prompt')];
 result.photos = pictures.map(n => {
  const b = bounds(n); const matching = likes.filter(l => { const p = bounds(l); return sharesPhotoCard(n, l) && p && p.x >= b.x && p.y >= b.y && p.x + p.width <= b.x + b.width && p.y + p.height <= b.y + b.height; });
  return { key: hash(['photo', label(n), b]), bounds: b, revealDirection: photoRevealDirection(n), like: result.identity && Math.abs(b.width-b.height)<=3 && fullyVisible(n) && matching.length === 1 && fullyVisible(matching[0]) ? control(matching[0]) : null };
 });
 result.prompts=staticPrompts.map(n=>{
  const b=bounds(n),matching=find('Like prompt').filter(button=>{
   const p=bounds(button);
   return p&&sharesPhotoCard(n,button)&&p.x>=b.x&&p.y>=b.y&&p.x+p.width<=b.x+b.width&&p.y+p.height<=b.y+b.height&&staticPrompts.filter(other=>sharesPhotoCard(other,button)).length===1;
  });
  return {key:hash(['prompt',label(n),b]),text:label(n),bounds:b,like:result.identity&&fullyVisible(n)&&matching.length===1?control(matching[0]):null};
 });
 result.controls.skip = result.identity ? control(skips[0]) : null;
 result.controls.like = result.photos.find(photo => photo.like)?.like || null;
 if (!result.identity) result.reason = 'Visible profile evidence is insufficient to distinguish same-name profiles.';
 return result;
}
module.exports = { readScreen };
