'use strict';
// Native account-limit sheet contains only Hinge's own copy; no profile content.
const title='Too many people are waiting for your reply';
const body='8 or more people are waiting for your response. Reply or end the conversation with these matches, then you can send likes. Research shows this leads to more dates.';
const node=(id,kind,box,children='',attrs='')=>`<node resource-id="${id}" class="${kind}" package="co.hinge.app" enabled="true" clickable="false" bounds="${box}" ${attrs}>${children}</node>`;
function yourTurnLimit(){
 const row=(id,text,box,textBox)=>node(id,'android.view.View',box,
  node(id+'-label','android.widget.TextView',textBox,'',`text="${text}"`)+node(id+'-button','android.widget.Button',box))
  .replace('clickable="false"','clickable="true"');
 const sheet=node('turn-sheet','android.widget.ScrollView','[0,378][720,1232]',
  node('turn-title','android.widget.TextView','[68,494][652,636]','',`text="${title}"`)+
  node('turn-body','android.widget.TextView','[68,668][652,902]','',`text="${body}"`)+
  row('turn-matches','View matches','[211,970][510,1066]','[259,998][462,1038]')+
  row('turn-learn','Learn more','[247,1075][474,1171]','[287,1106][434,1140]'));
 const close=node('turn-close','android.view.View','[0,1232][720,1280]','','content-desc="Close sheet"').replace('clickable="false"','clickable="true"');
 return '<hierarchy>'+node('turn-root','android.widget.FrameLayout','[0,0][720,1280]',
  node('turn-owner','android.view.View','[0,0][720,1280]',close+
   node('turn-outer','android.view.View','[0,0][720,1046]',node('turn-inner','android.view.View','[0,312][720,1232]',sheet))))+'</hierarchy>';
}
module.exports={yourTurnLimit};
