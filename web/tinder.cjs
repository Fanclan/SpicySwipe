// Only the Tinder view and its permitted sign-in popups are addressable.
module.exports = async function tinderRequest(action, data, contents) {
  if (!contents || contents.isDestroyed()) throw Error('Open Tinder first.');
  if (action === 'web:frame') {
    const picture = await contents.capturePage();
    return {id:contents.id, ...picture.getSize(), image:'data:image/jpeg;base64,' + picture.toJPEG(78).toString('base64')};
  }
  if (contents.id !== data.id) throw Error('Tinder window changed. Try again.');
  contents.focus();
  if (data.type === 'click' || data.type === 'wheel') {
    if (![data.x,data.y].every(n => Number.isInteger(n) && n >= 0 && n <= 5000)) throw Error('Invalid coordinates.');
    const point = {x:data.x,y:data.y};
    if (data.type === 'wheel') {
      if (!Number.isFinite(data.delta)) throw Error('Invalid scroll.');
      contents.sendInputEvent({...point,type:'mouseWheel',deltaY:-Math.sign(data.delta)*100,deltaX:0});
    } else {
      for (const type of ['mouseDown','mouseUp']) contents.sendInputEvent({...point,type,button:'left',clickCount:1});
    }
  } else if (data.type === 'text' && typeof data.text === 'string' && data.text.length <= 4000) {
    await contents.insertText(data.text);
  } else if (data.type === 'key' && ['Enter','Tab','Backspace','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Delete'].includes(data.key)) {
    for (const type of ['keyDown','keyUp']) contents.sendInputEvent({type,keyCode:data.key});
  } else throw Error('Unsupported input.');
  return {ok:true};
};
