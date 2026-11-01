import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
const server=createServer(async(req,res)=>{
 if(req.url==='/test-api/snapshot') {res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"preview only"}');return}
 const name=req.url==='/'?'index.html':req.url==='/app.js'?'app.js':null
 if(!name){res.writeHead(404);res.end();return}
 res.setHeader('content-type',name.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(new URL('../preview/'+name,import.meta.url)))
})
server.listen(4178,'127.0.0.1',()=>console.log('Preview http://127.0.0.1:4178 (no live data)'))
