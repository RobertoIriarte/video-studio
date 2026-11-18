import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
// Ephemeral renderer-only loopback server. No agent control API, directory
// listing, arbitrary paths, provider URLs or credentials are exposed.
export async function serveAssets(files: Map<string,{path:string;bytes:number;mime:string}>) {
  const token = randomBytes(32).toString('hex');
  const server = createServer((req,res) => {
    const id = req.url?.match(new RegExp(`^/${token}/([a-f0-9]{64})$`))?.[1]; const file = id && files.get(id); if (!file || !['GET','HEAD'].includes(req.method ?? '')) { res.writeHead(404).end(); return; }
    let start = 0; let end = file.bytes-1; const range = req.headers.range;
    if (range) { const match = /^bytes=(\d+)-(\d*)$/.exec(range); if (!match) {res.writeHead(416).end();return;} start=Number(match[1]);end=match[2] ? Number(match[2]) : end; if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=file.bytes) {res.writeHead(416).end();return;} }
    res.writeHead(range ? 206 : 200,{'content-type':file.mime,'content-length':end-start+1,'accept-ranges':'bytes','cache-control':'no-store','access-control-allow-origin':'*',...(range ? {'content-range':`bytes ${start}-${end}/${file.bytes}`} : {})}); if (req.method === 'HEAD') {res.end();return;} const stream = createReadStream(file.path,{start,end}); stream.on('error',()=>res.destroy()); stream.pipe(res);
  });
  await new Promise<void>((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());}); const address = server.address(); if (!address || typeof address === 'string') throw new Error('NO_ASSET_PORT');
  return {url:(checksum:string)=>`http://127.0.0.1:${address.port}/${token}/${checksum}`,close:()=>new Promise<void>((resolve) => {server.close(()=>resolve());server.closeAllConnections();})};
}
