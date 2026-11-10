'use strict';
const fs=require('node:fs'),path=require('node:path');
const directoriesByTest=new WeakMap();

// On Windows Node cannot flush a POSIX directory descriptor. Model only that
// descriptor for a Linux web-host fixture; receipt and claim I/O stays native.
module.exports=function emulateWebDirectoryDescriptor(t,directory){
  let directories=directoriesByTest.get(t);
  if(!directories){
    directories=new Set();
    directoriesByTest.set(t,directories);
    const open=fs.openSync;
    t.mock.method(fs,'openSync',(file,flags,...rest)=>{
      if(flags==='r'&&directories.has(file))return open(path.join(file,'.fixture-directory-handle'),'a+',0o600);
      return open(file,flags,...rest);
    });
  }
  directories.add(directory);
};
