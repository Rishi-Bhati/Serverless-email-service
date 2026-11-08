// Minimal SMTP sink for end-to-end tests: accepts any mail on 127.0.0.1:<port> and appends each
// message to a JSON-lines file as {"raw": "...", "rcpt": ["..."]}.
//
// `raw` is the DATA payload; `rcpt` lists the envelope recipients (the addresses offered in RCPT TO),
// which is what actually decides delivery — and is the only place a blind copy should appear.
//
// usage: node scripts/smtp-sink.mjs <outfile> [port=2525]
import net from 'node:net';
import { appendFileSync } from 'node:fs';
const out = process.argv[2];
const port = Number(process.argv[3] || 2525);
net.createServer((sock) => {
  let buf = '', data = false, msg = '', auth = 0, rcpt = [];
  const w = (s) => sock.write(s + '\r\n');
  w('220 sink ESMTP');
  sock.on('data', (c) => {
    buf += c.toString('latin1');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) {
        if (line === '.') {
          data = false;
          appendFileSync(out, JSON.stringify({ raw: msg, rcpt }) + '\n');
          msg = ''; rcpt = [];
          w('250 OK queued');
        }
        else msg += line.replace(/^\.\./, '.') + '\r\n';
        continue;
      }
      if (auth) { auth--; if (auth === 0) w('235 ok'); else w('334 UGFzc3dvcmQ6'); continue; }
      const u = line.toUpperCase();
      if (u.startsWith('EHLO') || u.startsWith('HELO')) { sock.write('250-sink\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n'); }
      else if (u.startsWith('AUTH PLAIN') && line.length > 11) w('235 ok');
      else if (u.startsWith('AUTH PLAIN')) { auth = 1; w('334 '); }
      else if (u.startsWith('AUTH LOGIN')) { auth = 2; w('334 VXNlcm5hbWU6'); }
      else if (u.startsWith('RCPT')) {
        const m = line.match(/<([^>]*)>/);
        if (m && m[1]) rcpt.push(m[1]);
        w('250 OK');
      }
      else if (u.startsWith('MAIL') || u.startsWith('RSET') || u.startsWith('NOOP')) { if (u.startsWith('MAIL')) rcpt = []; w('250 OK'); }
      else if (u === 'DATA') { data = true; w('354 go'); }
      else if (u === 'QUIT') { w('221 bye'); sock.end(); }
      else w('250 OK');
    }
  });
  sock.on('error', () => {});
}).listen(port, '127.0.0.1', () => console.log('sink up on', port));
