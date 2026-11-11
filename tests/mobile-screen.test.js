const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readScreen } = require('../desktop/mobile-screen.cjs');
const profile = fs.readFileSync(path.join(__dirname, 'fixtures/mobile/hinge-profile.xml'), 'utf8');
const like = fs.readFileSync(path.join(__dirname, 'fixtures/mobile/hinge-like.xml'), 'utf8');
const read = (xml, options = {}) => readScreen(xml, { platform: 'hinge', foreground: 'co.hinge.app', ...options });
const {nativePhotoForm}=require('./fixtures/hinge-native-photo-form.cjs');

test('native photo form ownership recognizes shallow and deep clipped previews without pixel matching',()=>{
 for(const height of [181,271,400]){
  const s=read(nativePhotoForm({height}),{photoIdentity:'0123456789abcdef',commentText:''});
  assert.equal(s.kind,'like');assert.equal(s.nativePhotoForm,true);assert.equal(s.photos.length,1);
  assert.equal(s.photos[0].bounds.height,height);assert.equal(s.controls.sendLike.label,'Send priority like');
  assert.equal(s.composerTextVerified,true);assert.equal(s.composerText,'');
 }
 assert.equal(read(like,{commentText:''}).nativePhotoForm,true);
 assert.equal(read(profile).nativePhotoForm,undefined);
});

test('native photo form ownership rejects aligned photos or Send controls outside the selected card',()=>{
 for(const options of [{detachedPhoto:true},{detachedForm:true},{detachedSend:true},{photoOwner:'Other'}]){
  const s=read(nativePhotoForm(options),{photoIdentity:'0123456789abcdef',commentText:''});
  assert.equal(s.kind,'blocked',JSON.stringify(options));assert.equal(s.nativePhotoForm,undefined);assert.equal(s.controls.sendLike,null);
 }
 const disabled=nativePhotoForm({detachedSend:true}).replace('content-desc="Send priority like" enabled="true"','content-desc="Send priority like" enabled="false"');
 assert.equal(read(disabled,{photoIdentity:'0123456789abcdef',commentText:''}).kind,'blocked');
});

test('native photo form ownership requires inert bounded photo wrappers and a shared bounded comment form',()=>{
 const xml=nativePhotoForm();
 const mutations=[
  xml.replace('resource-id="photo-subtree" class="android.view.View"','resource-id="photo-subtree" class="android.widget.FrameLayout"'),
  xml.replace('resource-id="photo-visible" class="android.view.View" clickable="false"','resource-id="photo-visible" class="android.view.View" clickable="true"'),
  xml.replace('resource-id="photo-full" class="android.view.View" clickable="false" scrollable="false"','resource-id="photo-full" class="android.view.View" clickable="false" scrollable="true"'),
  xml.replace('resource-id="photo-subtree" class="android.view.View" clickable="false" scrollable="false" bounds="[72,137][648,318]"','resource-id="photo-subtree" class="android.view.View" clickable="false" scrollable="false" bounds="[40,137][680,318]"'),
  xml.replace('resource-id="comment-form" class="android.view.View" clickable="false" scrollable="false" bounds="[40,318][680,608]"','resource-id="comment-form" class="android.view.View" clickable="false" scrollable="false" bounds="[40,319][680,608]"'),
  xml.replace('bounds="[296,502][648,584]"','bounds="[296,502][700,584]"'),
 ];
 for(const candidate of mutations){assert.notEqual(candidate,xml);const s=read(candidate,{photoIdentity:'0123456789abcdef',commentText:''});assert.equal(s.kind,'blocked');assert.equal(s.nativePhotoForm,undefined);}
});

test('native photo form ownership never supplies ordinary action or blank-text verification by itself',()=>{
 const xml=nativePhotoForm(), unverified=read(xml,{photoIdentity:'0123456789abcdef'});
 assert.equal(unverified.nativePhotoForm,true);assert.equal(unverified.controls.sendLike,null);
 assert.equal(read(xml,{photoIdentity:'0123456789abcdef',commentText:'Unsent draft'}).controls.sendLike,null);
 for(const candidate of [xml.replace('Send priority like','Send a Rose'),xml.replace('Send priority like','Purchase Like'),xml.replace('Send priority like','Send priority like with message')])assert.equal(read(candidate,{photoIdentity:'0123456789abcdef',commentText:''}).controls.sendLike,null);
});

test('native photo form ownership cannot survive extra editors, sibling sends, or foreign overlays',()=>{
 const xml=nativePhotoForm(),extra=content=>xml.replace('</hierarchy>',content+'</hierarchy>');
 const mutations=[
  extra('<node class="android.view.View" content-desc="Edit comment" bounds="[72,342][648,478]"/>'),
  extra('<node class="android.widget.Button" content-desc="Send like" bounds="[296,502][648,584]"/>'),
  extra('<node class="android.widget.Button" content-desc="Send a Rose" bounds="[296,502][648,584]"/>'),
  extra('<node class="android.widget.Button" content-desc="Send a Rose" enabled="false" bounds="[296,502][648,584]"/>'),
  extra('<node package="com.android.systemui" class="android.view.View" bounds="[0,0][720,1280]"/>'),
  xml.replace('content-desc="Skip Sample"','content-desc="Skip Other"'),
 ];
 for(const candidate of mutations){const s=read(candidate,{photoIdentity:'0123456789abcdef',commentText:''});assert.equal(s.kind,'blocked');assert.equal(s.nativePhotoForm,undefined);assert.equal(s.controls.sendLike,null);}
});

test('native photo form ownership rejects unfamiliar editable or password surfaces',()=>{
 for(const attrs of ['class="android.widget.EditText"','class="com.example.TextInputEditText"','class="android.view.View" password="true"']){
  const xml=nativePhotoForm().replace('</hierarchy>','<node '+attrs+' bounds="[72,700][648,800]"/></hierarchy>');
  const s=read(xml,{photoIdentity:'0123456789abcdef',commentText:''});
  assert.equal(s.kind,'blocked');assert.equal(s.nativePhotoForm,undefined);assert.equal(s.controls.sendLike,null);
 }
});

test('observed Discover profile returns decoded prompts and exact photo/skip bounds', () => {
 const screen = read(profile);
 assert.equal(screen.kind, 'profile'); assert.equal(screen.name, 'Sample');
 assert.equal(screen.context.bio, 'A perfect weekend: Hiking & coffee.');
 assert.equal(screen.context.history, ''); assert.ok(screen.identity); assert.ok(screen.screenKey);
 assert.deepEqual(screen.controls.skip.bounds, { x: 53, y: 1963, width: 163, height: 163 });
 assert.equal(screen.photos.length, 1); assert.equal(screen.photos[0].like.label, 'Like photo');
 assert.deepEqual(screen.photos[0].like.bounds, { x: 875, y: 1464, width: 126, height: 126 });
 assert.equal(screen.emptyConversation, false); assert.equal(screen.controls.sendMessage, null);
});

test('Like view preserves profile identity but priority and Rose controls are never authorized', () => {
 const screen = read(like);
 assert.equal(screen.kind, 'like'); assert.equal(screen.identity, read(profile).identity);
 assert.equal(screen.controls.comment.label, 'Edit comment'); assert.equal(screen.controls.sendLike, null);
 assert.equal(screen.controls.skip, null); assert.match(screen.reason, /priority|verified/i);
 assert.equal(screen.composerText, '');
});

test('screen revisions include bounds while profile identity requires substance beyond name', () => {
 const original = read(profile), moved = read(profile.replace('[53,642][1027,1616]', '[53,643][1027,1617]'));
 assert.notEqual(original.screenKey, moved.screenKey); assert.equal(original.identity, moved.identity);
 const other = read(profile.replace('Hiking &amp; coffee.', 'Books &amp; tea.'));
 assert.notEqual(original.identity, other.identity);
 const noPrompt = read(profile.replace('Prompt: A perfect weekend. Answer: Hiking &amp; coffee.', ''));
 assert.equal(noPrompt.identity, null); assert.equal(noPrompt.controls.skip, null);
});

test('disabled or duplicate selectors and non-Discover navigation cannot authorize actions', () => {
 assert.equal(read(profile.replace('content-desc="Skip Sample"', 'content-desc="Skip Sample"').replace(/(<node[^>]*content-desc="Skip Sample"[^>]*enabled=")true/, '$1false')).controls.skip, null);
 assert.equal(read(profile.replace('content-desc="Discover"', 'content-desc="Standouts"')).kind, 'blocked');
 const duplicate = profile.replace('</hierarchy>', '<node text="" content-desc="Skip Sample" package="co.hinge.app" class="android.widget.Button" enabled="true" clickable="true" bounds="[1,1][40,40]" /></hierarchy>');
 assert.equal(read(duplicate).kind, 'blocked');
});

test('foreground mismatch and system or unknown dialogs block all controls', () => {
 assert.equal(read(profile, { foreground: 'com.android.launcher3' }).kind, 'blocked');
 for (const extra of ['<node package="com.android.systemui" class="android.view.View" text="Permission" />', '<node package="co.hinge.app" class="android.app.Dialog" text="Continue" />']) {
  const screen = read(profile.replace('</hierarchy>', extra + '</hierarchy>'));
  assert.equal(screen.kind, 'blocked'); assert.equal(screen.controls.skip, null);
 }
 assert.equal(read(profile, { platform: 'bumble', foreground: 'com.bumble.app' }).kind, 'blocked');
});

test('strict XML parsing rejects malformed, unbounded, entity and ambiguous documents', () => {
 for (const xml of [null, '', '<hierarchy><node></hierarchy>', '<hierarchy/><hierarchy/>', '<!DOCTYPE hierarchy [<!ENTITY x SYSTEM "file:///secret">]><hierarchy/>', '<hierarchy><node text="&unknown;" /></hierarchy>', '<hierarchy><node text="one" text="two" /></hierarchy>', '<hierarchy><node text="a & b" /></hierarchy>', profile + 'garbage', '<hierarchy>' + '<node>'.repeat(150) + '</node>'.repeat(150) + '</hierarchy>', ' '.repeat(2 * 1024 * 1024 + 1)]) {
  const screen = read(xml); assert.equal(screen.kind, 'blocked'); assert.equal(screen.controls.skip, null);
 }
});

test('XML entities decode once without treating profile text as markup', () => {
 const screen = read(profile.replace('Hiking &amp; coffee.', 'Tea &lt;3 &quot;books&quot; &apos;yes&apos; &#x1F600; &amp;lt;'));
 assert.equal(screen.context.bio, 'A perfect weekend: Tea <3 "books" \'yes\' 😀 &lt;');
 assert.equal(read(profile.replace('Hiking &amp; coffee.', '&#0;')).kind, 'blocked');
});

test('network failures block even an otherwise recognized profile', () => {
 const broken = profile.replace('</hierarchy>', '<node package="co.hinge.app" class="android.widget.TextView" text="No network connection" /></hierarchy>');
 assert.equal(read(broken).kind, 'blocked'); assert.match(read(broken).reason, /network/i);
 const matches = fs.readFileSync(path.join(__dirname, 'fixtures/mobile/hinge-matches-offline.xml'), 'utf8');
 assert.equal(read(matches).kind, 'blocked'); assert.match(read(matches).reason, /network/i); assert.equal(read(matches).emptyConversation, false);
});

test('observed scroll details provide only actual sibling-attributed profile facts', () => {
 const details = fs.readFileSync(path.join(__dirname, 'fixtures/mobile/hinge-profile-details.xml'), 'utf8');
 const screen = read(details);
 assert.match(screen.context.bio, /Age: 30/); assert.match(screen.context.bio, /Religion: Sample religion/); assert.match(screen.context.bio, /Languages Spoken: English/);
 assert.doesNotMatch(screen.context.bio, /Height:|Dating Intentions:/);
 assert.equal(screen.identity,read(profile).identity);
 assert.equal(screen.controls.sendLike,null);
});

test('a photo clipped by its scrolling container cannot supply an actionable Like', () => {
 const clipped = profile.replace('scrollable="true" long-clickable="false" password="false" selected="false" bounds="[0,642][1080,2179]"', 'scrollable="true" long-clickable="false" password="false" selected="false" bounds="[0,700][1080,2179]"');
 assert.equal(read(clipped).controls.like, null); assert.equal(read(clipped).photos[0].like,null);
});

test('compressed Hinge Discover identifies the inert photo surface below a separate filter and banner', () => {
 const photo = '<node class="android.widget.ImageView" content-desc="Sample&apos;s photo" clickable="false" bounds="[40,774][680,1112]"/>';
 const owner = '<node class="android.view.View" clickable="false" scrollable="true" bounds="[0,774][720,1112]">';
 const filter = '<node class="android.widget.HorizontalScrollView" scrollable="true" bounds="[0,80][720,146]"/>';
 const banner = '<node class="android.view.View" clickable="true" bounds="[40,380][680,510]"/>';
 const chrome = '<node class="android.view.View" content-desc="Discover" selected="true" bounds="[0,1112][144,1228]"/><node class="android.widget.Button" content-desc="Skip Sample" clickable="true" bounds="[40,972][160,1092]"/>';
 const feed = (content, extra='') => '<hierarchy><node package="co.hinge.app" class="android.widget.FrameLayout" bounds="[0,0][720,1280]">'+filter+banner+content+chrome+extra+'</node></hierarchy>';
 const ordinary = owner + photo + '</node>';
 const current = read(feed(ordinary),{photoIdentity:'0123456789abcdef'});
 assert.equal(current.kind,'profile');
 assert.deepEqual(current.scrollSurface,{x:40,y:774,width:640,height:338});
 assert.equal(current.photos[0].like,null);
 const overlay='<node class="android.view.View" clickable="true" bounds="[280,790][460,1100]"/>';
 const nativeControl='<node class="android.widget.Button" clickable="false" bounds="[280,790][460,1100]"/>';
 for (const xml of [feed(ordinary, overlay), feed(ordinary,nativeControl), feed(ordinary+ordinary),
  feed(owner+'</node>'+photo), feed(ordinary.replace('scrollable="true"','long-clickable="true" scrollable="true"')),
  feed(ordinary.replace('class="android.widget.ImageView"', 'long-clickable="true" class="android.widget.ImageView"')),
  feed(ordinary.replace('[0,774][720,1112]','[0,774][700,1112]'))]) {
  assert.equal(read(xml).scrollSurface,null);
 }
 assert.equal(Object.hasOwn(read(profile),'scrollSurface'),false);
 assert.equal(Object.hasOwn(read(feed(ordinary,'<node class="android.app.Dialog"/>')),'scrollSurface'),false);
});

test('only observed button classes and a shared photo card authorize Like or Skip', () => {
 const skipView = profile.replace(/(<node[^>]*class=")android\.widget\.Button("[^>]*content-desc="Skip Sample")/, '$1android.view.View$2');
 assert.equal(read(skipView).controls.skip,null);
 const likeView = profile.replace(/(<node[^>]*class=")android\.widget\.Button("[^>]*content-desc="Like photo")/, '$1android.view.View$2');
 assert.equal(read(likeView).controls.like,null);
 const detached=profile.replace(/<node[^>]*content-desc="Like photo"[^>]*\/>/,'').replace('</hierarchy>','<node text="" content-desc="Like photo" package="co.hinge.app" class="android.widget.Button" enabled="true" clickable="true" bounds="[875,1464][1001,1590]" /></hierarchy>');
 assert.equal(read(detached).controls.like,null);
});

test('valid XML permits a greater-than character inside quoted text', () => {
 const screen=read(profile.replace('Hiking &amp; coffee.','Coffee > tea.'));
 assert.equal(screen.context.bio,'A perfect weekend: Coffee > tea.');
});

test('custom clickable same-package overlays cannot intercept profile actions',()=>{
 const overlay='<node package="co.hinge.app" class="android.view.View" text="Continue" clickable="true" enabled="true" bounds="[0,0][1080,2400]" />';const s=read(profile.replace('</hierarchy>',overlay+'</hierarchy>'));assert.equal(s.kind,'blocked');
});
test('missing or zero-sized ancestor bounds cannot authorize a photo tap',()=>{
 for(const replacement of ['bounds="invalid"','bounds="[0,0][0,0]"']){const altered=profile.replace('bounds="[0,0][1080,2400]"',replacement);assert.equal(read(altered).photos.some(p=>p.like),false)}
});
test('invalid XML self-close syntax and forbidden raw characters fail closed',()=>{
 assert.equal(read(profile.replace('/>','/ >')).kind,'blocked');assert.equal(read(profile.replace('Hiking &amp; coffee.','Hiking \ufffe')).kind,'blocked');
});
test('local photo evidence enables a name-only card, but never blocked screens',()=>{
 const xml=profile.replace('Prompt: A perfect weekend. Answer: Hiking &amp; coffee.','');
 const s=read(xml,{photoIdentity:'0123456789abcdef'});assert.ok(s.identity);assert.ok(s.controls.like);assert.ok(s.controls.skip);
 assert.equal(read(xml,{photoIdentity:'bad'}).identity,null);
 assert.equal(read(xml,{photoIdentity:'0123456789abcdef',foreground:'other.app'}).controls.like,null);
});
test('observed priority Like needs independently verified comment contents',()=>{
 const empty=read(like,{commentText:''});assert.equal(empty.controls.sendLike.label,'Send priority like');assert.ok(empty.controls.composer);assert.equal(empty.composerTextVerified,true);
 const typed=read(like,{commentText:'Hello'});assert.equal(typed.composerText,'Hello');assert.equal(typed.composerTextVerified,true);
 assert.equal(read(like).controls.sendLike,null);assert.equal(read(like).composerTextVerified,false);
 const unknown=like.replace('</hierarchy>','<node class="android.widget.Button" package="co.hinge.app" text="Buy" clickable="true" enabled="true" bounds="[1,1][50,50]" /></hierarchy>');assert.equal(read(unknown,{commentText:''}).kind,'blocked');
 const duplicated=like.replace('content-desc="Send a Rose"','content-desc="Send priority like"');assert.equal(read(duplicated,{commentText:''}).controls.sendLike,null);
});
test('Hinge cropped photo rectangles cannot authorize a Like even if XML calls them visible',()=>{
 const cropped=profile.replaceAll('[53,642][1027,1616]','[53,1000][1027,1616]');assert.equal(read(cropped).controls.like,null);
});
test('observed comment-submit labels must agree with independently read field contents',()=>{
 const typed=like.replace('Send priority like','Send priority like with message').replace('Send a Rose','Send a Rose with message');
 assert.equal(read(typed,{commentText:'Hello'}).controls.sendLike.label,'Send priority like with message');
 assert.equal(read(typed,{commentText:''}).controls.sendLike,null);
 assert.equal(read(like,{commentText:'Hello'}).controls.sendLike,null);
});

const roseOffer=fs.readFileSync(path.join(__dirname,'fixtures/mobile/hinge-rose-offer.xml'),'utf8');
test('exact observed Rose offer exposes only Send Like anyway',()=>{
 const s=read(roseOffer);assert.equal(s.kind,'likeOffer');assert.equal(s.controls.sendLike.label,'Send Like anyway');assert.deepEqual(s.controls.sendLike.bounds,{x:306,y:2138,width:468,height:126});assert.equal(s.controls.like,null);assert.equal(s.controls.skip,null);assert.equal(s.controls.comment,null);
});
test('Rose offer rejects wrong title, altered offer and ambiguous normal action',()=>{
 for(const xml of [roseOffer.replace('Send a Rose instead?','Buy more Likes?'),roseOffer.replace('Upgrade your Like to a Rose to be seen first and increase your chance of a match.','Buy a Rose now'),roseOffer.replace('bounds="[306,2138][774,2264]"','bounds="invalid"'),roseOffer.replace('text="Send a Rose"','text="Send Like anyway"')])assert.equal(read(xml).controls.sendLike,null);
});

test('generic native prompt Like is ignored while photo Likes remain the only targets',()=>{const xml=profile.replace('</hierarchy>','<node class="android.widget.Button" package="co.hinge.app" text="" content-desc="Like" clickable="true" enabled="true" bounds="[875,2070][1001,2179]" /></hierarchy>');const s=read(xml);assert.equal(s.kind,'profile');assert.equal(s.controls.like.label,'Like photo');assert.equal(s.photos.length,read(profile).photos.length);assert.equal(read(xml.replace('content-desc="Like"','content-desc="Buy"')).kind,'blocked');});

test('observed voice-prompt buttons never become photo Like targets',()=>{const xml=profile.replace('</hierarchy>','<node class="android.widget.Button" package="co.hinge.app" content-desc="Play Voice Prompt" clickable="true" enabled="true" bounds="[101,1956][227,2082]" /><node class="android.widget.Button" package="co.hinge.app" content-desc="Like voice prompt" clickable="true" enabled="true" bounds="[875,2174][1001,2179]" /></hierarchy>');const s=read(xml);assert.equal(s.kind,'profile');assert.equal(s.controls.like.label,'Like photo');});

test('captioned photo Like requires the same verified full photo geometry',()=>{const s=read(profile.replace('content-desc="Like photo"','content-desc="Like photo prompt"'));assert.equal(s.kind,'profile');assert.ok(s.identity);assert.equal(s.controls.like.label,'Like photo prompt');const cropped=read(profile.replace('content-desc="Like photo"','content-desc="Like photo prompt"').replaceAll('[53,642][1027,1616]','[53,1000][1027,1616]'));assert.equal(cropped.controls.like,null);});

test('captioned photo shares a tightly bounded card with its Like button outside the image wrapper',()=>{
 const xml='<hierarchy><node class="android.widget.FrameLayout" package="co.hinge.app" bounds="[0,0][1080,2400]"><node class="android.view.View" content-desc="Discover" selected="true" bounds="[0,2179][216,2337]"/><node class="android.widget.Button" content-desc="Skip Sample" enabled="true" clickable="true" bounds="[53,1963][216,2126]"/><node class="android.view.View" bounds="[53,665][1027,1774]"><node class="android.widget.TextView" text="A photo caption" bounds="[53,665][1027,800]"/><node class="android.view.View" bounds="[53,800][1027,1774]"><node class="android.widget.ImageView" content-desc="Sample&apos;s photo" bounds="[53,800][1027,1774]"/></node><node class="android.view.View" bounds="[849,1596][1027,1774]"><node class="android.widget.Button" content-desc="Like photo prompt" enabled="true" clickable="true" bounds="[875,1622][1001,1748]"/></node></node></node></hierarchy>';
 const options={photoIdentity:'0123456789abcdef'},s=read(xml,options);assert.equal(s.kind,'profile');assert.equal(s.controls.like?.label,'Like photo prompt');assert.equal(read(xml.replace('[53,665][1027,1774]','[0,0][1080,2179]'),options).controls.like,null);assert.equal(read(xml.replace('[53,665][1027,1774]','[53,400][1027,1774]'),options).controls.like,null);
});

test('video Like buttons are recognized as profile content but never photo targets',()=>{const s=read(profile.replace('</hierarchy>','<node class="android.widget.Button" package="co.hinge.app" content-desc="Like video" enabled="true" clickable="true" bounds="[875,1819][1001,1945]" /></hierarchy>'));assert.equal(s.kind,'profile');assert.equal(s.controls.like.label,'Like photo');});

test('Hinge video unmute control does not interrupt profile review or become a Like target',()=>{const xml=profile.replace('</hierarchy>','<node class="android.widget.Button" package="co.hinge.app" content-desc="Unmute video" enabled="true" clickable="true" bounds="[64,1939][190,1963]" /></hierarchy>');const before=read(profile),s=read(xml);assert.equal(s.kind,'profile');assert.equal(s.identity,before.identity);assert.deepEqual(s.controls,before.controls);assert.deepEqual(s.photos,before.photos);assert.equal(read(xml.replace('Unmute video','Buy video')).kind,'blocked');});

test('Like confirmation excludes photos below its comment editor and gives images unique keys',()=>{const extra='<node package="co.hinge.app" class="android.widget.ImageView" content-desc="Sample&apos;s photo" bounds="[53,1528][1027,2179]" />';const xml=like.replace('</hierarchy>',extra+'</hierarchy>'),s=read(xml,{commentText:''});assert.equal(s.kind,'like');assert.equal(s.photos.length,1);assert.deepEqual(s.photos[0].bounds,{x:95,y:181,width:890,height:790});assert.ok(s.controls.sendLike);});

test('Hinge video prompt Like is recognized but never chosen as a photo target',()=>{const xml=profile.replace('</hierarchy>','<node class="android.widget.Button" package="co.hinge.app" content-desc="Like video prompt" enabled="true" clickable="true" bounds="[875,1887][1001,2013]" /></hierarchy>');const before=read(profile),s=read(xml);assert.equal(s.kind,'profile');assert.equal(s.identity,before.identity);assert.deepEqual(s.controls,before.controls);assert.deepEqual(s.photos,before.photos);assert.equal(read(xml.replace('Like video prompt','Buy video prompt')).kind,'blocked');});

test('Hinge Like confirmation ignores known profile buttons only below the confirmation form',()=>{for(const label of ['Like','Like photo','Like prompt','Like video','Like video prompt','Like photo prompt','Unmute video','Play Voice Prompt','Like voice prompt','Show caption','Hide caption']){const extra='<node package="co.hinge.app" class="android.widget.Button" content-desc="'+label+'" enabled="true" clickable="true" bounds="[875,1969][1001,2095]" />';const xml=like.replace('</hierarchy>',extra+'</hierarchy>');const s=read(xml,{commentText:''});assert.equal(s.kind,'like',label);assert.equal(s.controls.sendLike.label,'Send priority like');assert.equal(s.controls.like,null);assert.equal(read(xml.replace('[875,1969][1001,2095]','[875,500][1001,626]'),{commentText:''}).kind,'blocked');assert.equal(read(like.replace('</hierarchy>',extra.replace(label,'Buy unknown')+'</hierarchy>'),{commentText:''}).kind,'blocked');}});

test('caption visibility controls never interrupt a profile or become Like targets',()=>{for(const label of ['Show caption','Hide caption']){const xml=profile.replace('</hierarchy>','<node class="android.widget.Button" package="co.hinge.app" content-desc="'+label+'" enabled="true" clickable="true" bounds="[64,1554][190,1680]" /></hierarchy>');const before=read(profile),s=read(xml);assert.equal(s.kind,'profile',label);assert.equal(s.identity,before.identity);assert.deepEqual(s.controls,before.controls);assert.deepEqual(s.photos,before.photos);const bad=read(xml.replace(label,'Purchase caption'));assert.equal(bad.kind,'blocked');assert.match(bad.reason,/Purchase caption/);}});

test('caption controls inside the selected confirmation photo are harmless but cannot overlap its comment or send controls',()=>{for(const label of ['Show caption','Hide caption']){const extra='<node package="co.hinge.app" class="android.widget.Button" content-desc="'+label+'" enabled="true" clickable="true" bounds="[105,202][220,318]" />';const xml=like.replace('</hierarchy>',extra+'</hierarchy>'),s=read(xml,{commentText:''});assert.equal(s.kind,'like');assert.equal(s.controls.sendLike.label,'Send priority like');assert.equal(s.controls.like,null);for(const b of ['[105,1000][220,1100]','[0,202][220,318]','[105,20][220,136]'])assert.equal(read(xml.replace('[105,202][220,318]',b),{commentText:''}).kind,'blocked');assert.equal(read(xml.replace(label,'Buy caption'),{commentText:''}).kind,'blocked');}});

test('clipped Hinge photos expose a scroll hint without authorizing a Like',()=>{
 const top=read(profile.replaceAll('[53,642][1027,1616]','[53,642][1027,1200]'));
 assert.equal(top.photos[0].revealDirection,'down');assert.equal(top.photos[0].like,null);
 const bottom=read(profile.replaceAll('[53,642][1027,1616]','[53,1312][1027,2179]'));
 assert.equal(bottom.photos[0].revealDirection,'up');assert.equal(bottom.photos[0].like,null);
 assert.equal(read(profile).photos[0].revealDirection,null);
 const interior=read(profile.replaceAll('[53,642][1027,1616]','[53,850][1027,1400]'));
 assert.equal(interior.photos[0].revealDirection,null);assert.equal(interior.photos[0].like,null);
});

const friendTakeButton='<node class="android.widget.Button" package="co.hinge.app" content-desc="Like Sample&apos;s Friend&apos;s Take" clickable="true" enabled="true" bounds="[875,1969][1001,2095]" />';
test('Friends Take Like is recognized as content but only a photo can be targeted',()=>{
 const xml=profile.replace('</hierarchy>',friendTakeButton+'</hierarchy>'),s=read(xml);
 assert.equal(s.kind,'profile');assert.equal(s.controls.like.label,'Like photo');
 assert.equal(s.photos.length,read(profile).photos.length);
 const withoutPhoto=xml.replace(/<node[^>]*content-desc="Like photo"[^>]*\/>/,'');
 assert.equal(read(withoutPhoto).kind,'profile');assert.equal(read(withoutPhoto).controls.like,null);
});
test('Friends Take labels must match the current profile and native button exactly',()=>{
 for(const button of [friendTakeButton.replace('Like Sample','Like SomeoneElse'),friendTakeButton.replace('Take"','Take Premium"'),friendTakeButton.replace('android.widget.Button','custom.Button')]){
  assert.equal(read(profile.replace('</hierarchy>',button+'</hierarchy>')).kind,'blocked');
 }
});
test('Friends Take background button is ignored only below the Like confirmation form',()=>{
 const xml=like.replace('</hierarchy>',friendTakeButton+'</hierarchy>');
 const s=read(xml,{commentText:''});assert.equal(s.kind,'like');assert.ok(s.controls.sendLike);assert.equal(s.controls.like,null);
 assert.equal(read(xml.replace('[875,1969][1001,2095]','[875,500][1001,626]'),{commentText:''}).kind,'blocked');
 assert.equal(read(xml.replace('Like Sample','Like SomeoneElse'),{commentText:''}).kind,'blocked');
});

function clippedCaptionLike(label='Show caption',position='[105,91][220,206]',wrapper='[95,181][985,971]'){
 const photo=/<node\b(?=[^>]*class="android\.widget\.ImageView")(?=[^>]*content-desc="Sample(?:&apos;|')s photo")[^>]*\/>/;
 assert.match(like,photo);
 return like.replace(photo,image=>'<node class="android.view.View" bounds="'+wrapper+'"><node class="android.view.View" bounds="[95,118][985,971]"><node class="android.view.View" bounds="[95,181][985,971]">'+image+'</node></node><node class="android.view.View" bounds="[133,91][947,206]"><node class="android.widget.Button" content-desc="'+label+'" clickable="true" enabled="true" bounds="'+position+'" /></node></node>');
}
test('caption clipped behind the header stays bound to the selected confirmation image',()=>{
 for(const label of ['Show caption','Hide caption']){
  const s=read(clippedCaptionLike(label),{commentText:''});
  assert.equal(s.kind,'like');assert.equal(s.controls.sendLike.label,'Send priority like');assert.equal(s.controls.like,null);assert.equal(s.photos.length,1);
 }
});
test('clipped caption recognition rejects other containers, labels and positions',()=>{
 for(const xml of [clippedCaptionLike('Buy caption'),clippedCaptionLike('Show caption','[105,20][220,136]'),clippedCaptionLike('Show caption','[0,91][220,206]'),clippedCaptionLike('Show caption','[105,1000][220,1120]'),clippedCaptionLike('Show caption','[105,91][220,206]','[0,0][1080,2400]')]){
  assert.equal(read(xml,{commentText:''}).kind,'blocked');
 }
});

const videoClock='<node class="android.view.View" bounds="[53,1336][1027,1701]"><node class="android.widget.Button" content-desc="Unmute video" clickable="true" enabled="true" bounds="[64,1347][190,1473]" /><node class="android.view.View" text="" content-desc="Elapsed time: 13 seconds" clickable="false" scrollable="false" enabled="true" bounds="[902,1380][985,1441]" /></node>';
test('inert elapsed counter beside native Unmute video does not invalidate a stationary photo',()=>{
 const xml=profile.replace('</hierarchy>',videoClock+'</hierarchy>'),a=read(xml),b=read(xml.replace('13 seconds','16 seconds'));
 assert.equal(a.kind,'profile');assert.equal(b.screenKey,a.screenKey);assert.equal(b.identity,a.identity);assert.deepEqual(b.controls,a.controls);assert.deepEqual(b.photos,a.photos);
});
test('elapsed-counter normalization preserves action, geometry and other text changes',()=>{
 const xml=profile.replace('</hierarchy>',videoClock+'</hierarchy>'),a=read(xml);
 for(const change of [xml.replace('[902,1380][985,1441]','[902,1381][985,1442]'),xml.replace('[875,1464][1001,1590]','[875,1465][1001,1591]'),xml.replace('Hiking &amp; coffee.','Books &amp; tea.')])assert.notEqual(read(change).screenKey,a.screenKey);
 for(const sample of [xml.replace('Unmute video','Different control'),xml.replace('content-desc="Elapsed time: 13 seconds" clickable="false"','content-desc="Elapsed time: 13 seconds" clickable="true"'),xml.replace('text="" content-desc="Elapsed time','text="Other text" content-desc="Elapsed time')])assert.notEqual(read(sample).screenKey,read(sample.replace('13 seconds','16 seconds')).screenKey);
});


test('photo ownership tolerates trailing name whitespace in native labels',()=>{
 for(const name of ['Example','Dotted İ','Two Words']){
 const xml=profile.replaceAll('Sample',name).replaceAll(name+"'s photo",name+"  's photo");
 const s=read(xml);assert.equal(s.name,name);assert.equal(s.photos.length,1);assert.ok(s.controls.like);
 const noPrompt=xml.replace('Prompt: A perfect weekend. Answer: Hiking &amp; coffee.','');
 assert.ok(read(noPrompt,{photoIdentity:'0123456789abcdef'}).identity);assert.ok(read(noPrompt,{photoIdentity:'0123456789abcdef'}).controls.like);
 assert.equal(read(noPrompt).identity,null);
 }
});
test('photo ownership still rejects another name and non-photo labels',()=>{
 for(const label of ["Other 's photo","sample 's photo","Sample Extra 's photo","Sample 's video"]){
 const s=read(profile.replace("Sample's photo",label));assert.equal(s.photos.length,0);assert.equal(s.controls.like,null);
 }
});

const emptyQueue=fs.readFileSync(path.join(__dirname,'fixtures/mobile/hinge-empty.xml'),'utf8');
test('exact empty Discover queue exposes no actionable controls',()=>{const s=read(emptyQueue);assert.equal(s.kind,'empty');assert.equal(s.identity,null);assert.ok(Object.values(s.controls).every(v=>v===null));});
test('empty queue rejects missing body, wrong navigation and extra controls',()=>{
 for(const xml of [emptyQueue.replace('Try changing your filters','Different copy'),emptyQueue.replace('selected="true"','selected="false"'),emptyQueue.replace('</hierarchy>','<node package="co.hinge.app" class="android.widget.Button" text="Continue" clickable="true" enabled="true" bounds="[1,1][40,40]"/></hierarchy>')])assert.equal(read(xml).kind,'blocked');
});

// Synthetic navigation only: no captured messages or profile data belong in fixtures.
function emptyWithMessageBadge(message='Matches, 1 new message') {
 const tabs=['Discover','Standouts','Likes You',message,'Profile Hub'];
 const navigation='<node class="android.view.View" bounds="[0,2179][1080,2400]">'+tabs.map((text,i)=>'<node class="android.view.View" clickable="'+(i!==0)+'" selected="'+(i===0)+'" bounds="['+(i*216)+',2179]['+((i+1)*216)+',2337]"><node class="android.view.View" text="'+text+'" clickable="false" bounds="['+(i*216)+',2179]['+((i+1)*216)+',2337]"/></node>').join('')+'</node>';
 return emptyQueue.replace(/<node[^>]*text="Discover"[^>]*\/>/,navigation);
}
test('empty Discover accepts changing native message counts only as a navigation badge',()=>{
 for(const text of ['Matches, 1 new message','Matches, 2 new messages','Matches, 123 new messages']) {
  const s=read(emptyWithMessageBadge(text));assert.equal(s.kind,'empty');assert.equal(s.identity,null);assert.deepEqual(s.photos,[]);assert.ok(Object.values(s.controls).every(v=>v===null));
 }
});
test('empty Discover rejects badge-like text outside the native navigation structure',()=>{
 const xml=emptyWithMessageBadge();
 for(const sample of [
  emptyQueue.replace('</hierarchy>','<node class="android.view.View" text="Matches, 1 new message" bounds="[648,2179][864,2337]"/></hierarchy>'),
  xml.replace('text="Matches, 1 new message" clickable="false"','text="Matches, 1 new message" clickable="true"'),
  xml.replace('text="Matches, 1 new message" clickable="false" bounds="[648,2179][864,2337]"','text="Matches, 1 new message" clickable="false" bounds="[648,400][864,558]"'),
  xml.replace('Matches, 1 new message','Matches, 1 new message. Buy now'),
  xml.replace('selected="true"','selected="false"'),
  xml.replace('</hierarchy>','<node class="android.widget.EditText" bounds="[10,10][100,100]"/></hierarchy>'),
  xml.replace('</hierarchy>','<node class="android.app.Dialog" bounds="[10,10][100,100]"/></hierarchy>'),
  xml.replace('</hierarchy>','<node package="com.android.systemui" bounds="[10,10][100,100]"/></hierarchy>'),
 ]) {const s=read(sample);assert.equal(s.kind,'blocked');assert.ok(Object.values(s.controls).every(v=>v===null));}
});

// Synthetic error layout: public UI copy and geometry only, no captured user data.
const feedError = `<hierarchy><node package="co.hinge.app" class="android.view.View" bounds="[0,0][1080,2400]">
 <node class="android.widget.ScrollView" bounds="[0,356][1080,2179]">
  <node class="android.view.View" bounds="[274,1312][806,1380]"><node class="android.widget.TextView" text="Something went wrong" clickable="false" bounds="[274,1312][806,1380]"/></node>
  <node class="android.widget.TextView" text="Oops, something's gone wrong. Let's give it another try." clickable="false" bounds="[106,1401][974,1501]"/>
  <node class="android.view.View" clickable="true" enabled="true" bounds="[383,1590][698,1716]">
   <node class="android.widget.TextView" text="Try again" clickable="false" bounds="[454,1627][627,1678]"/>
   <node class="android.widget.Button" clickable="false" bounds="[383,1590][698,1715]"/>
  </node>
 </node>
 <node class="android.widget.TextView" text="Discover" clickable="false" bounds="[53,234][348,324]"/>
 <node class="android.view.View" bounds="[0,2179][1080,2400]">
  <node class="android.view.View" clickable="false" selected="true" bounds="[0,2179][216,2337]"><node class="android.view.View" content-desc="Discover" clickable="false" bounds="[0,2179][216,2337]"/></node>
  <node class="android.view.View" clickable="true" bounds="[216,2179][432,2337]"><node class="android.view.View" content-desc="Standouts" clickable="false" bounds="[216,2179][432,2337]"/></node>
  <node class="android.view.View" clickable="true" bounds="[432,2179][648,2337]"><node class="android.view.View" content-desc="Likes You" clickable="false" bounds="[432,2179][648,2337]"/></node>
  <node class="android.view.View" clickable="true" bounds="[648,2179][864,2337]"><node class="android.view.View" content-desc="Matches" clickable="false" bounds="[648,2179][864,2337]"/></node>
  <node class="android.view.View" clickable="true" bounds="[864,2179][1080,2337]"><node class="android.view.View" content-desc="Profile Hub" clickable="false" bounds="[864,2179][1080,2337]"/></node>
 </node>
</node></hierarchy>`;

test('recognized Discover feed error exposes only the native retry target',()=>{
 const s=read(feedError);
 assert.equal(s.kind,'feedError');assert.equal(s.identity,null);assert.equal(s.name,'');assert.deepEqual(s.photos,[]);
 assert.deepEqual(s.controls.retry.bounds,{x:383,y:1590,width:315,height:126});assert.equal(s.controls.retry.label,'Try again');assert.ok(s.controls.retry.key);assert.ok(s.screenKey);
 assert.ok(Object.entries(s.controls).every(([key,value])=>key==='retry'||value===null));
});

test('Discover retry rejects altered copy, ambiguous controls, geometry and navigation',()=>{
 const extra=node=>feedError.replace('</hierarchy>',node+'</hierarchy>');
 const samples=[
  feedError.replace('Something went wrong','Another error'),
  feedError.replace("Oops, something's gone wrong.", 'Unexpected failure.'),
  feedError.replace('Try again','Continue'),
  feedError.replace('selected="true"','selected="false"'),
  feedError.replace('text="Discover"','text="Standouts"'),
  feedError.replace('content-desc="Discover"','content-desc="Standouts"'),
  feedError.replace('class="android.view.View" clickable="true" enabled="true"','class="android.view.View" clickable="false" enabled="true"'),
  feedError.replace('enabled="true"','enabled="false"'),
  feedError.replace('enabled="true"','enabled="true" visible-to-user="false"'),
  feedError.replace('[383,1590][698,1716]','[383,1590][383,1716]'),
  feedError.replace('[383,1590][698,1716]','[383,1590][698,2300]'),
  feedError.replace('[383,1590][698,1715]','[383,1590][500,1715]'),
  feedError.replace('[454,1627][627,1678]','[1,1][40,40]'),
  feedError.replace('class="android.widget.Button"','class="android.view.View"'),
  feedError.replace('class="android.widget.ScrollView"','class="android.view.View"'),
  feedError.replace('co.hinge.app','other.app'),
  extra('<node class="android.widget.TextView" text="Try again" bounds="[1,1][40,40]"/>'),
  extra('<node class="android.widget.TextView" text="Subscribe" bounds="[1,1][40,40]"/>'),
  extra('<node class="android.view.View" clickable="true" bounds="[1,1][40,40]"/>'),
  extra('<node class="android.widget.EditText" bounds="[1,1][40,40]"/>'),
  extra('<node class="android.app.Dialog" bounds="[1,1][40,40]"/>'),
  extra('<node package="com.android.systemui" bounds="[1,1][40,40]"/>'),
 ];
 for(const [i,xml] of samples.entries()) {const s=read(xml);assert.equal(s.kind,'blocked','sample '+i);assert.ok(Object.values(s.controls).every(v=>v===null),'sample '+i);}
 assert.equal(read(feedError,{foreground:'other.app'}).kind,'blocked');
});


const promptText='Prompt: A perfect weekend. Answer: Hiking and coffee.';
const promptNode=(label,box,children='',extra='')=>'<node package="co.hinge.app" class="android.view.View" content-desc="'+label+'" bounds="'+box+'" enabled="true" clickable="false" '+extra+'>'+children+'</node>';
const promptButton=(label,box,extra='')=>'<node package="co.hinge.app" class="android.widget.Button" content-desc="'+label+'" bounds="'+box+'" enabled="true" '+extra+'/>';
function promptScreen(confirm=false) {
 const content=confirm
  ?promptNode('','[53,541][1027,1475]',promptNode('','[95,583][985,1092]',promptNode(promptText,'[95,583][985,1092]'))+promptNode('','[53,1092][1027,1475]',promptNode('Edit comment','[95,1124][985,1302]')+promptButton('Send a Rose','[95,1334][358,1443]','clickable="false"')+promptButton('Send priority like','[390,1334][985,1443]','clickable="false"')))
  :promptNode('','[53,280][1027,873]',promptNode('','[53,280][1027,873]',promptNode(promptText,'[53,280][1027,873]')+promptNode('','[849,695][1027,873]',promptNode('','[849,695][1027,873]',promptButton('Like prompt','[875,721][1001,847]','clickable="true"')))));
 return '<hierarchy>'+promptNode('','[0,0][1080,2400]',promptNode('Discover','[0,2179][216,2337]','','selected="true"')+promptButton('Skip Sample','[53,1963][216,2126]','clickable="true"')+promptNode('','[0,181][1080,2179]',content,'scrollable="true"'))+'</hierarchy>';
}

test('native static prompt card exposes its own fully visible Like without inventing photos',()=>{
 const s=read(promptScreen());assert.equal(s.kind,'profile');assert.equal(s.photos.length,0);assert.equal(s.controls.like,null);assert.ok(s.identity);
 assert.ok(Array.isArray(s.prompts));assert.equal(s.prompts.length,1);assert.equal(s.prompts[0].text,promptText);assert.deepEqual(s.prompts[0].bounds,{x:53,y:280,width:974,height:593});assert.equal(s.prompts[0].like.label,'Like prompt');assert.deepEqual(s.prompts[0].like.bounds,{x:875,y:721,width:126,height:126});assert.ok(s.prompts[0].key);
});

test('prompt Likes require a unique same-card button and fully visible static text',()=>{
 const xml=promptScreen(),button=promptButton('Like prompt','[875,721][1001,847]','clickable="true"');
 const samples=[xml.replaceAll('[53,280][1027,873]','[53,100][1027,873]'),xml.replace('content-desc="Like prompt" bounds="[875,721][1001,847]" enabled="true"','content-desc="Like prompt" bounds="[875,721][1001,847]" enabled="false"'),xml.replace(button,button+button),xml.replace(button,'').replace('</hierarchy>',button+'</hierarchy>'),xml.replace('content-desc="'+promptText+'"','content-desc="'+promptText+'" visible-to-user="false"'),xml.replace('[875,721][1001,847]','[1000,721][1100,847]')];
 for(const candidate of samples){const s=read(candidate);assert.ok(Array.isArray(s.prompts));assert.ok(s.prompts.every(p=>p.like===null));}
});

test('observed prompt confirmation exposes selected full text and requires verified comment contents',()=>{
 const before=read(promptScreen()),unverified=read(promptScreen(true)),s=read(promptScreen(true),{commentText:''});
 assert.equal(s.kind,'like');assert.equal(s.identity,before.identity);assert.deepEqual(s.photos,[]);assert.equal(s.prompts.length,1);assert.equal(s.prompts[0].text,before.prompts[0].text);assert.equal(s.prompts[0].like,null);assert.deepEqual(s.prompts[0].bounds,{x:95,y:583,width:890,height:509});assert.equal(s.controls.sendLike.label,'Send priority like');assert.equal(unverified.kind,'like');assert.equal(unverified.controls.sendLike,null);
});

test('prompt confirmation rejects duplicate, detached, clipped or unknown controls',()=>{
 const xml=promptScreen(true),prompt=promptNode(promptText,'[95,583][985,1092]'),send=promptButton('Send priority like','[390,1334][985,1443]','clickable="false"');
 const samples=[xml.replace(prompt,prompt+prompt),xml.replace(prompt,'').replace('</hierarchy>',prompt+'</hierarchy>'),xml.replaceAll('[95,583][985,1092]','[95,150][985,1092]'),xml.replace(send,'').replace('</hierarchy>',send+'</hierarchy>'),xml.replace('Send priority like','Send a Rose'),xml.replace('</hierarchy>',promptButton('Buy gift','[100,1200][200,1300]','clickable="true"')+'</hierarchy>')];
 for(const candidate of samples)assert.equal(read(candidate,{commentText:''}).controls.sendLike,null);
 assert.equal(read(xml,{commentText:'unexpected text'}).controls.sendLike,null);
 assert.ok(read(xml.replace('Send priority like','Send priority like with message'),{commentText:'A verified comment'}).controls.sendLike);
});


function promptWithPreviousVideo() {
 const video=promptNode('','[53,118][1027,488]',promptNode('','[53,181][1027,488]',promptNode("Sample's video",'[53,181][1027,488]')+promptNode('','[849,310][1027,488]',promptNode('','[849,310][1027,488]',promptButton('Like video','[875,336][1001,462]','clickable="true"')))));
 return promptScreen(true).replace(promptNode('','[53,541][1027,1475]','').replace('</node>',''),video+promptNode('','[53,541][1027,1475]','').replace('</node>',''));
}
test('prompt confirmation tolerates only its separate preceding owned video card',()=>{
 const xml=promptWithPreviousVideo(),s=read(xml,{commentText:''});assert.equal(s.kind,'like');assert.equal(s.controls.sendLike.label,'Send priority like');assert.equal(s.prompts.length,1);
 for(const candidate of [xml.replace("Sample's video","Other's video"),xml.replace('Like video','Purchase video'),xml.replace('[53,118][1027,488]','[53,118][1027,1200]'),xml.replace('[875,336][1001,462]','[875,600][1001,726]')])assert.equal(read(candidate,{commentText:''}).controls.sendLike,null);
 const detached=promptScreen(true).replace('</hierarchy>',promptButton('Like video','[875,336][1001,462]','clickable="true"')+'</hierarchy>');assert.equal(read(detached,{commentText:''}).controls.sendLike,null);
});


function promptWithSibling(kind='photo',side='before') {
 const before=side==='before',box=before?'[53,118][1027,275]':'[53,1528][1027,2179]',contentBox=before?'[53,181][1027,275]':box,buttonBox=before?'[875,123][1001,249]':'[875,1969][1001,2095]';
 const text=kind==='prompt'?'Prompt: My ideal Sunday. Answer: A long walk.':"Sample's "+kind;
 const content=kind==='photo'?'<node package="co.hinge.app" class="android.widget.ImageView" content-desc="'+text+'" enabled="true" clickable="false" bounds="'+contentBox+'"/>':promptNode(text,contentBox);
 const sibling=promptNode('',box,promptNode('',contentBox,content)+promptNode('',box,promptButton('Like '+kind,buttonBox,'clickable="true"')));
 const cardStart=promptNode('','[53,541][1027,1475]','').replace('</node>','');
 return promptScreen(true).replace(cardStart,sibling+cardStart);
}
test('prompt confirmation ignores only disjoint sibling cards with their matching native content',()=>{
 for(const kind of ['photo','video','prompt'])for(const side of ['before','after']){
  const xml=promptWithSibling(kind,side),s=read(xml,{commentText:''});assert.equal(s.kind,'like',kind+' '+side);assert.equal(s.controls.sendLike.label,'Send priority like');assert.equal(s.prompts.length,1);assert.equal(s.prompts[0].text,promptText);assert.deepEqual(s.photos,[]);
  assert.equal(read(xml.replace('Like '+kind,'Buy '+kind),{commentText:''}).controls.sendLike,null);
  if(kind!=='prompt')assert.equal(read(xml.replace("Sample's "+kind,"Other's "+kind),{commentText:''}).controls.sendLike,null);
 }
});
test('prompt confirmation rejects mismatched, detached or overlapping sibling controls',()=>{
 const xml=promptWithSibling();
 for(const candidate of [xml.replace('Like photo','Like video'),xml.replace('Like photo','Like prompt'),xml.replace('[875,123][1001,249]','[875,600][1001,726]'),xml.replaceAll('[53,118][1027,275]','[53,118][1027,1200]'),xml.replace('class="android.widget.ImageView"','class="android.view.View"'),xml.replace("Sample's photo",'unrelated'),xml.replace('scrollable="true"','scrollable="false"')])assert.equal(read(candidate,{commentText:''}).controls.sendLike,null);
 const after=promptWithSibling('photo','after');assert.equal(read(after.replaceAll('[53,1528][1027,2179]','[53,1400][1027,2179]'),{commentText:''}).controls.sendLike,null);
});

// The native app can leave just its Discover header and five tabs on screen.
const blankDiscover = feedError.replace(/ <node class="android.widget.ScrollView"[\s\S]*?\n <\/node>/, '');
const badgedDiscover=fs.readFileSync(path.join(__dirname,'fixtures/mobile/hinge-blank-matches-badge.xml'),'utf8');
test('blank Discover with a message count in the ordinary fourth native tab remains read-only',()=>{
 assert.equal(read(badgedDiscover.replace('Matches, 1 new message','Matches')).kind,'feedLoading');
 for(const count of ['1 new message','2 new messages','123 new messages']){
  for(const xml of [badgedDiscover.replace('1 new message',count),blankDiscover.replace('content-desc="Matches"','content-desc="Matches, '+count+'"')]){
   const s=read(xml);
   assert.equal(s.kind,'feedLoading');assert.equal(s.identity,null);assert.equal(s.name,'');
   assert.deepEqual(s.photos,[]);assert.deepEqual(s.prompts,[]);assert.ok(Object.values(s.controls).every(v=>v===null));
  }
 }
 assert.notEqual(read(badgedDiscover).screenKey,read(badgedDiscover.replace('1 new message','2 new messages')).screenKey);
 assert.equal(read(feedError.replace('content-desc="Matches"','content-desc="Matches, 1 new message"')).kind,'blocked');
});
test('badged blank Discover requires the original tab owner, passive label, ordinary navigation and unobstructed screen',()=>{
 const badge=badgedDiscover.split('\n').find(line=>line.includes('content-desc="Matches, 1 new message"'));
 const mutate=(before,after)=>badgedDiscover.replace(badge,badge.replace(before,after));
 const overlay=extra=>badgedDiscover.replace('</hierarchy>',extra+'</hierarchy>');
 for(const sample of [
  badgedDiscover.replace('1 new message','1 new messages'),badgedDiscover.replace('1 new message','0 new messages'),
  badgedDiscover.replace('1 new message','1 new message. Verify account'),
  badgedDiscover.replace('content-desc="Matches, 1 new message"','content-desc="other"').replace('content-desc="Standouts"','content-desc="Matches, 1 new message"'),
  badgedDiscover.replace(badge,badge+'\n'+badge),mutate('clickable="false"','clickable="true"'),
  mutate('clickable="false"','clickable="false" focusable="true"'),mutate('clickable="false"','clickable="false" long-clickable="true"'),
  mutate('class="android.view.View"','class="android.widget.TextView"'),mutate('[432,1112][576,1232]','[476,1112][532,1232]'),
  mutate('content-desc="Matches, 1 new message"','text="Matches, 1 new message"'),
  mutate('/>','><node class="android.view.View" bounds="[432,1112][576,1232]"/></node>'),
  badgedDiscover.replace('selected="true"','selected="false"'),badgedDiscover.replace('text="Discover"','text="Matches"'),
  overlay('<node class="android.widget.Button" bounds="[65,100][200,145]"/>'),
  overlay('<node class="android.view.View" clickable="true" bounds="[100,300][300,400]"/>'),
  overlay('<node class="android.widget.EditText"/>'),overlay('<node class="android.webkit.WebView"/>')
 ]){
  const s=read(sample);assert.equal(s.kind,'blocked');assert.ok(Object.values(s.controls).every(v=>v===null));
 }
 assert.equal(read(badgedDiscover,{foreground:'other.app'}).kind,'blocked');
});
test('blank Discover shell has no profile identity, queue-exhaustion signal, or actionable controls', () => {
 const result = read(blankDiscover);
 assert.equal(result.kind, 'feedLoading');
 assert.equal(result.identity, null);
 assert.ok(Object.values(result.controls).every(value => value === null));
 assert.deepEqual(result.photos, []);
});
test('blank Discover shell rejects overlays, extra content, and ambiguous native navigation', () => {
 const add = node => blankDiscover.replace('</hierarchy>', node + '</hierarchy>');
 for (const xml of [
  add('<node class="android.widget.TextView" text="Verify your account"/>'),
  add('<node class="android.webkit.WebView"/>'), add('<node class="android.widget.ImageView"/>'),
  add('<node class="android.widget.Button"/>'), add('<node class="android.widget.EditText"/>'),
  add('<node class="android.view.View" scrollable="true"/>'), add('<node class="android.view.View" clickable="true"/>'),
  blankDiscover.replace('selected="true"','selected="false"'),
  blankDiscover.replace('content-desc="Profile Hub"','content-desc="Discover"'),
  blankDiscover.replace('text="Discover"','text="Matches"'),
  blankDiscover.replace('clickable="true" bounds="[216,2179][432,2337]"','clickable="true" bounds="[100,2179][432,2337]"'),
 ]) assert.equal(read(xml).kind, 'blocked');
 assert.equal(read(blankDiscover,{foreground:'com.android.systemui'}).kind,'blocked');
});

test('ordinary Discover alternate review owns an inert scroll lane in the visible photo', () => {
 const owner = '<node class="android.view.View" scrollable="true" clickable="false" bounds="[0,137][720,1112]">';
 const photo = '<node class="android.widget.ImageView" content-desc="Sample&apos;s photo" clickable="false" bounds="[40,347][680,987]"/>';
 const chrome = '<node class="android.view.View" content-desc="Discover" selected="true" bounds="[0,1112][144,1228]"/><node class="android.widget.Button" content-desc="Skip Sample" clickable="true" bounds="[40,972][160,1092]"/>';
 const feed = (content, extra='') => '<hierarchy><node package="co.hinge.app" class="android.widget.FrameLayout" bounds="[0,0][720,1280]">'+content+chrome+extra+'</node></hierarchy>';
 const readCard = (content, extra) => read(feed(content,extra),{photoIdentity:'0123456789abcdef'});
 const mediaBounds = '[40,347][680,987]';
 for (const [reported, expected] of [
  [mediaBounds, {x:40,y:347,width:640,height:640}],
  ['[40,137][680,715]', {x:40,y:137,width:640,height:578}],
  ['[40,75][680,715]', {x:40,y:137,width:640,height:578}],
 ]) {
  const current = readCard(owner+photo.replace(mediaBounds,reported)+'</node>');
  assert.equal(current.kind, 'profile');
  assert.deepEqual(current.reviewScrollSurface,expected);
  assert.equal(Object.hasOwn(current,'scrollSurface'),false,'ordinary desktop reviews keep their original behavior');
 }
 const ordinary = owner+photo+'</node>';
 for (const [content,extra] of [
  [ordinary, '<node class="android.view.View" clickable="true" bounds="[330,400][410,430]"/>'],
  [ordinary, '<node class="android.widget.Button" clickable="false" bounds="[340,400][410,430]"/>'],
  [ordinary, '<node class="android.view.View" long-clickable="true" bounds="[352,400][354,430]"/>'],
  [ordinary, '<node class="android.view.View" clickable="true" bounds="invalid"/>'],
  [ordinary+owner+'</node>'],
  [owner+'</node>'+photo],
  [owner+'<node class="android.view.View" scrollable="true" clickable="false" bounds="[40,350][680,987]">'+photo+'</node></node>'],
  [owner.replace('clickable="false"','clickable="true"')+photo+'</node>'],
  [owner.replace('[0,137][720,1112]','[0,137][700,1112]')+photo+'</node>'],
  [owner+photo.replace(mediaBounds,'[40,45][680,149]')+'</node>'],
  [owner+photo.replace(mediaBounds,'[0,347][810,987]')+'</node>'],
 ]) {
  assert.equal(readCard(content,extra).reviewScrollSurface,null);
 }
 assert.equal(Object.hasOwn(read(like),'reviewScrollSurface'),false);
 assert.equal(Object.hasOwn(read(feed(ordinary),{foreground:'other.app'}),'reviewScrollSurface'),false);
 const clippedNav = feed(ordinary).replace('[0,1112][144,1228]','[0,1112][144,1350]');
 assert.equal(read(clippedNav).reviewScrollSurface,null);
 const detached = feed('').replace('</hierarchy>','<node class="android.view.View" bounds="[0,0][720,1280]">'+ordinary+'</node></hierarchy>');
 assert.equal(read(detached).reviewScrollSurface,null);
 const prompt = photo.replace('android.widget.ImageView','android.view.View').replace('Sample&apos;s photo','Prompt: On weekends. Answer: Hiking.');
 assert.deepEqual(readCard(owner+prompt+'</node>').reviewScrollSurface,{x:40,y:347,width:640,height:640});
});

test('alternate Discover can cross only the clear heading and padding of an owned native choices card', () => {
 const xmlNode=(cls,rect,attr='',children='')=>'<node class="android.'+cls+'" bounds="'+rect+'" '+attr+'>'+children+'</node>';
 const view=(rect,children='',attr='')=>xmlNode('view.View',rect,'clickable="false" '+attr,children);
 const text=(rect,value)=>xmlNode('widget.TextView',rect,'clickable="false" text="'+value+'"');
 const button=(rect,attr)=>xmlNode('widget.Button',rect,attr);
 const panel='[40,650][680,1112]';
 const opt=(rect,buttonRect,childRect)=>xmlNode('view.View',rect,'clickable="true"',text(childRect,'Option')+button(buttonRect,'clickable="false"'));
 const group=opt('[89,862][295,958]','[88,862][296,958]','[124,878][260,940]')+
  opt('[317,862][523,958]','[316,862][524,958]','[352,878][488,940]')+
  opt('[89,978][370,1074]','[88,978][371,1074]','[164,994][335,1056]');
 const like=view('[544,1078][680,1112]',view('[544,1078][680,1112]',button('[564,1098][660,1112]','clickable="true" content-desc="Like"')));
 const elements=view(panel)+text('[88,790][403,830]','Choose one')+group+like;
 const frame=(children)=>view(panel,view(panel,children));
 const feed=(children,extra='')=>'<hierarchy>'+xmlNode('widget.FrameLayout','[0,0][720,1280]','package="co.hinge.app"',
  view('[0,137][720,1112]',children,'scrollable="true"')+
  xmlNode('view.View','[0,1112][144,1228]','content-desc="Discover" selected="true"')+
  button('[40,972][160,1092]','clickable="true" content-desc="Skip Sample"')+extra)+'</hierarchy>';
 const s=read(feed(frame(elements)));
 assert.equal(s.kind,'profile');
 assert.equal(s.reviewNewChoiceLane,false);
 assert.equal(s.identity,null);
 assert.equal(s.controls.like,null);
 assert.equal(s.prompts.length,0);
 assert.equal(s.photos.length,0);
 assert.equal(Object.hasOwn(s,'scrollSurface'),false);
 const lane=s.reviewScrollSurface;
 assert.ok(lane);
 const center=lane.x+lane.width/2;
 assert.ok(lane.height>=120 && lane.width>=96 && center>=88 && center<=403);
 assert.ok(lane.y>=650+10 && lane.y+lane.height<=862-10,'all device motion stays above the choice hit boxes');
 const display='[0,0][720,1280]';
 const ordered=(backOrder,frontOrder='3',backAttr='',content=frame(elements))=>{
  const behind=xmlNode('view.ViewGroup',display,'clickable="false" '+backOrder,view(display,'',backAttr));
  const foreground=feed(content).slice('<hierarchy>'.length,-'</hierarchy>'.length)
   .replace('class="android.widget.FrameLayout"', 'class="android.widget.FrameLayout" drawing-order="'+frontOrder+'"');
  return '<hierarchy>'+xmlNode('view.ViewGroup',display,'package="co.hinge.app"',foreground+behind)+'</hierarchy>';
 };
 assert.deepEqual(read(ordered('drawing-order="2"')).reviewScrollSurface,lane);
 for(const xml of [
  ordered('drawing-order="4"'),ordered('drawing-order="3"'),ordered(''),
  ordered('drawing-order="2"','3','long-clickable="true"'),
  feed(frame(elements),button('[201,650][287,862]','clickable="true" content-desc="Like"')),
  feed(frame(elements),button('invalid','clickable="false"')),
  feed(frame(elements),xmlNode('view.View','[195,650][298,862]','long-clickable="true"')),
  feed(frame(elements),xmlNode('view.View','[195,650][298,862]','clickable="false" content-desc="Unknown overlay"')),
  feed(frame(elements),xmlNode('app.Dialog','[195,650][298,862]','')),
  feed(frame(elements.replace('text="Choose one"','text=""'))),
  feed(frame(elements.replace('text="Choose one"','text="Choose one" scrollable="true"'))),
  feed(frame(elements.replace('content-desc="Like"','content-desc="Like video"'))),
  feed(frame(elements.replace(group,''))),
  feed(frame(elements+button('[125,660][375,855]','clickable="true" content-desc="More"'))),
  feed(frame(elements).replace('clickable="false"','clickable="true"')),
  feed(frame(elements)+frame(elements)),
  feed('',frame(elements)),
  feed(frame(elements).replaceAll(panel,'[40,760][680,1112]')),
 ]) assert.ok(read(xml).reviewScrollSurface==null,'unexpected or obstructed panel cannot supply a lane');

 // Once the card scrolls behind the native header, Compose clips the body
 // while its outer wrapper and inert backdrop keep their original top edge.
 const outer='[40,108][680,672]', clipped='[40,137][680,672]';
 const observedHeading=text('[88,248][403,288]','Choose one').replace('clickable="false"','drawing-order="1" clickable="false"');
 const observedChoices=opt('[89,320][295,416]','[88,320][296,416]','[124,336][260,398]')+
  opt('[317,320][523,416]','[316,320][524,416]','[352,336][488,398]')+
  opt('[89,436][370,532]','[88,436][371,532]','[164,452][335,514]');
 const observedLike=view('[544,536][680,672]',view('[544,536][680,672]',
  button('[564,556][660,652]','clickable="true" content-desc="Like"')));
 const inside=(backdrop=outer)=>view(backdrop,'','drawing-order="0"')+observedHeading+observedChoices+observedLike;
 const card=(body=clipped,backdrop=outer)=>view(outer,view(body,inside(backdrop)));
 const canonical=read(feed(card()));
 assert.deepEqual(canonical.reviewScrollSurface,{x:197,y:149,width:96,height:159});
 assert.equal(canonical.reviewNewChoiceLane,true);
 assert.equal(canonical.controls.like,null);assert.equal(canonical.identity,null);
 for(const xml of [
  feed(card('[41,137][680,672]')), feed(card('[40,137][679,672]')),
  feed(card('[40,138][680,672]')), feed(card('[40,136][680,672]')), feed(card('[40,137][680,671]')),
  feed(card(clipped,'[40,107][680,672]')), feed(card(clipped,'[40,108][680,671]')),
  feed(view(outer)+view(clipped,inside())), feed(view(outer,view(clipped,inside())+view(clipped))),
  feed(card(),button('[240,160][250,270]','clickable="true" content-desc="Like"')),
 ]) assert.ok(read(xml).reviewScrollSurface==null,'a different offset, edge, owner or overlay cannot authorize the clipped lane');

 // A wheel event has no touch path. Its entire hit margin must land on a
 // static native text leaf inside the verified scroller; two landmarks prove movement.
 const adjacent=key=>view('[40,712][680,891]',view('[40,712][680,891]',
  view('[80,752][408,851]',text('[80,752][408,851]',key))+
  opt('[440,745][640,841]','[440,752][640,834]','[507,776][573,810]')));
 const pair=card()+adjacent('A second static landmark');
 const both=read(feed(pair));
 assert.deepEqual(both.reviewWheelPoint,{x:245,y:268});
 const inForeground=ordered('drawing-order="2"','3','',pair);
 assert.deepEqual(read(inForeground).reviewWheelPoint,both.reviewWheelPoint);
 const marker=both.reviewScrollFrame;
 assert.match(marker.ownerKey,/^[a-f0-9]{64}$/);assert.match(marker.chromeKey,/^[a-f0-9]{64}$/);
 assert.deepEqual(marker.landmarks.map(({x,y,width,height})=>[x,y,width,height]),[[88,248,315,40],[80,752,328,99]]);
 assert.equal(new Set(marker.landmarks.map(n=>n.key)).size,2);
 assert.doesNotMatch(JSON.stringify(marker),/Choose one|second static|Sample/);
 const shifted=pair.replaceAll('[88,248][403,288]','[88,216][403,256]').replaceAll('[80,752][408,851]','[80,720][408,819]');
 const moved=read(feed(shifted));
 assert.equal(marker.chromeKey,moved.reviewScrollFrame.chromeKey);
 assert.equal(marker.ownerKey,moved.reviewScrollFrame.ownerKey);
 assert.deepEqual(moved.reviewScrollFrame.landmarks.map(n=>[n.key,n.y]),marker.landmarks.map(n=>[n.key,n.y-32]));
 for(const [expected,scenes] of [
  [null,[feed(card()+adjacent('Choose one')),
  ordered('drawing-order="4"','3','',pair), ordered('drawing-order="3"','3','',pair),
  ordered('','3','',pair), ordered('drawing-order="2"','3','focusable="true"',pair),
  inForeground.replace('bounds="[0,0][720,1280]" clickable="false" ></node>','bounds="invalid" clickable="false" ></node>'),
  feed(pair,xmlNode('view.View','[0,0][720,1280]','scrollable="true"')),
  feed(pair,button('invalid','clickable="false"')), feed(pair+view('[0,137][720,1112]','','scrollable="true"'))]],
  [{x:244,y:801},[
  feed(pair.replace('drawing-order="0"','drawing-order="2"')), feed(pair.replace('drawing-order="1"','')),
  feed(pair.replace('clickable="false" text="Choose one"','clickable="false" focusable="true" text="Choose one"')),
  feed(pair,button('[249,276][280,290]','clickable="true" content-desc="Like"')),
  feed(pair,xmlNode('view.View','[235,258][255,278]','clickable="false" content-desc="Unowned overlay"'))]],
  [{x:245,y:268},[feed(card()),
  feed(pair.replace('class="android.view.View" bounds="[80,752][408,851]"','class="android.widget.NumberPicker" bounds="[80,752][408,851]"')),
  feed(pair.replace('class="android.view.View" bounds="[80,752][408,851]"','class="android.view.View" scrollable="true" bounds="[80,752][408,851]"')),
  feed(pair.replace('class="android.view.View" bounds="[80,752][408,851]"','class="android.view.View" selected="true" bounds="[80,752][408,851]"'))]]
 ]) for(const xml of scenes){
  const rejected=read(xml);
  assert.deepEqual(rejected.reviewWheelPoint??null,expected);
  assert.ok(rejected.reviewScrollFrame==null);
 }

 // The wheel start recorded only the two heading positions. Intermediate poll
 // rows here are a synthetic reconstruction; the landing rectangles were measured.
 const scene=(landed,options={})=>{
  const dy=landed?0:128, outer=landed?'[40,89][680,454]':'[40,18][680,582]', body=landed?'[40,137][680,454]':'[40,137][680,582]';
  const rect=(x,y,r,b)=>'['+x+','+(y+dy)+']['+r+','+(b+dy)+']';
  const option=(x,y,r,b,labelBox,value)=>opt(rect(x,y,r,b),rect(x,y,r,b),labelBox).replace('text="Option"','text="'+value+'"');
  const rows=option(89,102,295,198,landed?'[124,137][260,180]':rect(124,118,260,180),'First option')+
   option(317,102,523,198,landed?'[352,137][488,180]':rect(352,118,488,180),'Second option')+
   option(89,218,370,314,rect(124,234,335,296),options.third || 'Third option');
  const stack=view(outer,view(body,view(outer,'','drawing-order="0"')+
   (landed?'':text('[88,158][403,198]','Poll heading').replace('clickable="false"','clickable="false" drawing-order="1"'))+
   rows+view(rect(544,318,680,454),view(rect(544,318,680,454),button(rect(564,338,660,434),'clickable="true" content-desc="Like"')))));
  const pane=rect(40,494,680,673), left=rect(80,534,408,633);
  const panel=view(pane,view(pane,view(pane,view(left,text(left,'Passive neighbor'))+
   option(440,527,640,623,rect(507,558,573,592),options.side || 'Neighbor choice'))));
  return feed(stack+panel,options.cover?button('[232,571][257,596]','clickable="true" content-desc="Like"'):'');
 };
 const first=read(scene(false)), landed=read(scene(true));
 assert.deepEqual(first.reviewWheelPoint,{x:245,y:178});
 assert.deepEqual(landed.reviewWheelPoint,{x:244,y:583});
 const landing=landed.reviewScrollFrame.landmarks;
 assert.deepEqual(landing.map(({x,y,width,height})=>[x,y,width,height]),[[124,234,211,62],[80,534,328,99],[507,558,66,34]]);
 for(const mark of landing){
  const previous=first.reviewScrollFrame.landmarks.find(other=>other.key===mark.key);
  assert.ok(previous);assert.deepEqual({...previous,y:previous.y-128},mark);
 }
 assert.deepEqual(landed.prompts,[]);assert.equal(landed.controls.like,null);assert.equal(landed.identity,null);
 const covered=read(scene(true,{cover:true}));
 assert.equal(covered.reviewWheelPoint,null,'geometry from a choice can never provide input');
 assert.deepEqual(covered.reviewScrollFrame.landmarks.map(m=>[m.x,m.y]),[[124,234],[507,558]]);
 for(const opts of [{cover:true,third:'Neighbor choice'},{cover:true,side:'Elapsed time: 5 seconds'}]){
  const sparse=read(scene(true,opts));assert.equal(sparse.reviewWheelPoint,null);assert.equal(sparse.reviewScrollFrame,null);
 }
 const unsafeOption=read(scene(true,{cover:true}).replace('class="android.view.View" bounds="[89,218][370,314]"','class="android.view.View" scrollable="true" bounds="[89,218][370,314]"'));
 assert.equal(unsafeOption.reviewWheelPoint,null);assert.equal(unsafeOption.reviewScrollFrame,null);
 const edge=read(feed(card()+view('[80,950][408,1112]',text('[80,1050][408,1112]','Clipped at the viewport'))));
 assert.deepEqual(edge.reviewWheelPoint,{x:245,y:268});
 assert.equal(edge.reviewScrollFrame,null,'a viewport-clipped label may resize during motion');
});

function recoveryScene({moved=false,other='',backOrder=2,backAttr='',photoBlock='',ownerAttr='',otherOwner=false,
 name='Sample',skipBox='[40,948][164,1072]',tab='Discover',clipped=false,ownerId='discover-list',includeLike=true,header=355}={}){
 const rect='[0,0][720,1280]',photoBounds=clipped?'[40,355][680,910]':'[40,355][680,995]';
 const node=(cls,box,props,body='')=>'<node class="android.'+cls+'" bounds="'+box+'" '+props+'>'+body+'</node>';
 const view=(box,props,body)=>node('view.View',box,'clickable="false" '+props,body);
 const chrome=view('[0,1112][144,1232]','selected="true" focusable="true"',view('[0,1112][144,1232]','content-desc="'+tab+'"',''))+
  node('widget.Button',skipBox,'clickable="true" content-desc="Skip '+name+'"');
 const photo=()=>node('widget.ImageView',photoBounds,'clickable="false" content-desc="'+name+'&apos;s photo"');
 const like=node('widget.Button','[551,868][650,965]','clickable="true" content-desc="Like photo"');
 const card=view(photoBounds,'',view(photoBounds,'',view(photoBounds,'',photo())+photoBlock+(includeLike?like:'')));
 const prompt=view('[40,360][680,800]','',view('[40,360][680,800]','content-desc="Prompt: Weekend activity. Answer: Reading."','')+
  node('widget.Button','[551,665][650,765]','clickable="true" content-desc="Like prompt"'));
 const owner=view('[0,'+header+'][720,1112]','scrollable="true" resource-id="'+ownerId+'" '+ownerAttr,moved?prompt:card);
 const front=node('widget.FrameLayout',rect,'clickable="false" drawing-order="3"',view(rect,'',owner+chrome+other+(otherOwner?owner:'')));
 const back=node('view.ViewGroup',rect,'clickable="false" '+(backOrder===null?'':'drawing-order="'+backOrder+'"'),
  view(rect,backAttr,''));
 return '<hierarchy>'+node('view.ViewGroup',rect,'clickable="false" package="co.hinge.app"',front+back)+'</hierarchy>';
}

test('original square photo exposes a bounded passive recovery drag and continuous Discover chrome',()=>{
 const readScene=opts=>read(recoveryScene(opts),{photoIdentity:'0123456789abcdef'});
 const source=readScene({});assert.equal(source.kind,'profile');assert.match(source.recoveryChromeKey,/^[a-f0-9]{64}$/);
 const imageWithoutFingerprint=read(recoveryScene());assert.equal(imageWithoutFingerprint.recoveryDrag,undefined);
 assert.equal(source.recoveryDrag?.chromeKey,source.recoveryChromeKey);
 const lane=source.recoveryDrag.surface,photo=source.photos[0].bounds;
 assert.ok(lane.width>=96&&lane.height>=120);
 assert.ok(lane.x>=photo.x&&lane.y>=photo.y&&lane.x+lane.width<=photo.x+photo.width&&lane.y+lane.height<=photo.y+photo.height);
 const moved=readScene({moved:true,header:137});
 assert.equal(moved.kind,'profile');assert.equal(moved.prompts[0]?.like?.label,'Like prompt');
 assert.equal(moved.recoveryDrag,undefined);assert.equal(moved.recoveryChromeKey,source.recoveryChromeKey);
 for(const opts of [{name:'Other'},{skipBox:'[42,948][166,1072]'},{ownerId:'different-list'}])
  assert.notEqual(readScene(opts).recoveryChromeKey,source.recoveryChromeKey);
 for(const opts of [{otherOwner:true},{tab:'Standouts'},{ownerAttr:'focusable="true"'}])assert.equal(readScene(opts).recoveryChromeKey,undefined);
});

test('recovery does not cross unknown z-order, covered or incomplete media, or actionable layers',()=>{
 const readScene=opts=>read(recoveryScene(opts),{photoIdentity:'0123456789abcdef'});
 const overlay=(attrs,rect='[349,652][380,700]')=>'<node class="android.view.View" bounds="'+rect+'" '+attrs+'/>';
 for(const opts of [
  {backOrder:3},{backOrder:4},{backOrder:null},{backAttr:'focusable="true"'},{backAttr:'content-desc="Passive unknown overlay"'},
  {other:overlay('clickable="false"')},{other:overlay('clickable="true"')},{other:overlay('clickable="false" scrollable="true"')},
  {other:overlay('clickable="false"','invalid')},{photoBlock:overlay('clickable="false"')},
  {clipped:true},{includeLike:false}
 ])assert.equal(readScene(opts).recoveryDrag,undefined,JSON.stringify(opts));
});

test('a recovery drag stays inside the useful clear interval around the photo center',()=>{
 const overlay='<node class="android.view.View" clickable="false" bounds="[210,882][511,995]"/>';
 const source=read(recoveryScene({other:overlay}),{photoIdentity:'0123456789abcdef'});
 const surface=source.recoveryDrag?.surface;assert.ok(surface);
 assert.ok(surface.y+surface.height<=882-12,'input and its contact margin end before the passive overlay');
 assert.ok(Math.min(1280*.65*.36,surface.height*.72)>=224,'the bounded gesture still moves through substantial photo content');
 const short=overlay.replace('[210,882][511,995]','[210,720][511,995]')+
  '<node class="android.view.View" clickable="true" bounds="[215,355][498,615]"/>';
 assert.equal(read(recoveryScene({other:short}),{photoIdentity:'0123456789abcdef'}).recoveryDrag,undefined);
});

test('partial native fragments expose only verified wheel geometry and never turn options or promotions into Like targets',()=>{
 const node=(cls,b,attrs='',kids='')=>`<node class="android.${cls}" bounds="${b}" ${attrs}>${kids}</node>`;
 const view=(b,kids='',attrs='')=>node('view.View',b,(attrs.includes('clickable=')?'':'clickable="false" ')+attrs,kids);
 const text=(b,value)=>node('widget.TextView',b,`clickable="false" text="${value}"`);
 const button=(b,attrs='')=>node('widget.Button',b,attrs);
 const row=(b,label)=>{const top=Number(/^\[\d+,(\d+)\]/.exec(b)[1]);return view(b,view(b,'',`content-desc="Option: ${label}"`)+
  view(`[120,${top+49}][496,${top+83}]`)+view(`[544,${top+38}][600,${top+94}]`)+button(b,'clickable="false"'),'clickable="true"')};
 // Anonymous content; wrappers, roles and rectangles match the observed native layout.
 const panel='[40,618][680,1112]',heading=view('[88,758][323,798]','','content-desc="Prompt: A partially visible question" drawing-order="1"');
 const fragments=view(panel,view(panel,view(panel,'','drawing-order="0"')+heading+view('[88,846][632,1112]',
  row('[88,846][632,978]','Books')+row('[88,1002][632,1112]','Music'))));
 const banner='[40,399][680,578]',left='[80,439][408,538]',right='[440,432][640,528]';
 const adjacent=view(banner,view(banner,view(banner,view(left,text(left,'A passive product explanation'))+
  view(right,text('[507,463][573,497]','Try it')+button('[440,439][640,521]','clickable="false"'),'clickable="true"'))));
 const feed=(content=fragments,extra='')=>'<hierarchy>'+node('widget.FrameLayout','[0,0][720,1280]','package="co.hinge.app" clickable="false"',
  view('[0,137][720,1112]',adjacent+content,'scrollable="true"')+view('[0,1112][144,1232]','','content-desc="Discover" selected="true"')+
  button('[40,948][164,1072]','clickable="true" content-desc="Skip Sample"')+extra)+'</hierarchy>';
 const good=read(feed());assert.equal(good.kind,'profile');
 assert.ok(good.reviewWheelPoint);assert.ok(good.reviewScrollFrame);assert.match(good.recoveryChromeKey,/^[a-f0-9]{64}$/);
 assert.equal(good.identity,null);assert.deepEqual(good.photos,[]);assert.deepEqual(good.prompts,[]);
 assert.equal(good.controls.like,null);assert.equal(good.controls.skip,null);assert.equal(good.reviewScrollSurface,null);
 for(const xml of [feed(fragments.replace('Prompt: A partially visible question','Prompt: Another partial question')),
  feed(fragments.replaceAll('Option: ','Fragment: '))]){
  const fragment=read(xml);assert.equal(fragment.kind,'profile');assert.ok(fragment.reviewWheelPoint);assert.ok(fragment.reviewScrollFrame);
  assert.equal(fragment.identity,null);assert.deepEqual(fragment.photos,[]);assert.deepEqual(fragment.prompts,[]);assert.equal(fragment.controls.like,null);
 }
 for(const xml of [feed(fragments,view('[230,470][260,510]','','content-desc="Unknown overlay"')),
  feed(fragments,node('app.Dialog','[0,0][720,1280]')),feed().replace('content-desc="Discover" selected="true"','content-desc="Standouts" selected="true"'),
  feed().replace('scrollable="true"','scrollable="false"'),feed().replace('content-desc="Skip Sample"','content-desc="Unknown button"'),
  feed().replace('A passive product explanation','Try it')]){
  const blocked=read(xml);assert.ok(!blocked.reviewWheelPoint||!blocked.reviewScrollFrame);
 }
 assert.equal(read(feed(),{foreground:'other.app'}).kind,'blocked');
});
