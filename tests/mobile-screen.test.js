const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readScreen } = require('../desktop/mobile-screen.cjs');
const profile = fs.readFileSync(path.join(__dirname, 'fixtures/mobile/hinge-profile.xml'), 'utf8');
const like = fs.readFileSync(path.join(__dirname, 'fixtures/mobile/hinge-like.xml'), 'utf8');
const read = (xml, options = {}) => readScreen(xml, { platform: 'hinge', foreground: 'co.hinge.app', ...options });

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
