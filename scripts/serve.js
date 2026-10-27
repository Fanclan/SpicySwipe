const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');const port=Number(process.env.PORT||5173);
http.createServer((req,res)=>{let file;try{file=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{res.writeHead(400);res.end();return}
 if(file==='/'){res.writeHead(302,{Location:'/ui/dashboard.html'});res.end();return}const target=path.resolve(root,'.'+file);
 if(!target.startsWith(root+path.sep)||file.includes('/.')){res.writeHead(403);res.end();return}
 fs.readFile(target,(err,data)=>{if(err){res.writeHead(404);res.end('Not found');return}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'})[path.extname(target)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(data)})
}).listen(port,'127.0.0.1',()=>console.log(`SpicySwipe preview: http://127.0.0.1:${port}`));
