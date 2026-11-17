import { createInterface } from 'node:readline/promises';
import { loadPrivateEnv } from './private-env.mjs';

loadPrivateEnv();
if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('El bootstrap requiere terminal interactivo para ocultar la contraseña.');
if (!process.env.AUTH_BOOTSTRAP_TOKEN || !process.env.BOOTSTRAP_IDEMPOTENCY_KEY || !process.env.APP_ORIGIN) throw new Error('Ejecuta primero pnpm local:setup.');
const rl = createInterface({ input: process.stdin, output: process.stdout });
const name = await rl.question('Nombre del propietario: ');
const email = await rl.question('Correo: ');
rl.close();
const password = await new Promise((resolvePassword, reject) => {
  let value = '';
  process.stdout.write('Contraseña (12–128 caracteres, oculta): ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  const finish = () => { process.stdin.off('data', input); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
  const input = (chunk) => {
    for (const character of chunk) {
      if (character === '\u0003') { finish(); reject(new Error('Cancelado.')); return; }
      if (character === '\r' || character === '\n') { finish(); resolvePassword(value); return; }
      if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
      else if (character >= ' ') value += character;
    }
  };
  process.stdin.on('data', input);
});
const response = await fetch('http://127.0.0.1:8787/api/v1/bootstrap', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: process.env.APP_ORIGIN,
    authorization: `Bearer ${process.env.AUTH_BOOTSTRAP_TOKEN}`, 'idempotency-key': process.env.BOOTSTRAP_IDEMPOTENCY_KEY },
  body: JSON.stringify({ name, email, password }),
});
if (!response.ok) {
  console.error(`Bootstrap no completado (HTTP ${response.status}). Repite con la misma configuración y credenciales si fue un fallo transitorio.`);
  process.exitCode = 1;
} else console.log('Propietario listo. Inicia sesión en la web. Conserva protegida la configuración privada.');
