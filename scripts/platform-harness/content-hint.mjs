// What MediaStreamTrack.contentHint does to a 640x480 animated canvas under a 120 kbps cap, in a same-page loopback. Measurement only; the
// app does NOT set a hint (see CLAUDE.md, *Mobile platform polish*). Some runs of the loopback send no frames: run it twice.
//   node scripts/platform-harness/content-hint.mjs
import { connect, sleep } from '../touch-harness/lib.mjs'
import { ORIGIN } from './lib.mjs'
const c = await connect()
await c.send('Page.navigate', { url: `${ORIGIN}manifest.webmanifest` })
await sleep(800)
for (const hint of ['detail', '', 'motion', 'text', 'detail', '']) {
  await c.send('Page.navigate', { url: `${ORIGIN}manifest.webmanifest?${Math.random()}` })
  await sleep(1000)
  const out = await c.evBody(`
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480; document.body.append(canvas);
    const g = canvas.getContext('2d'); let n = 0; let stop = false;
    const draw = () => { if (stop) return; n++;
      g.fillStyle = '#008000'; g.fillRect(0, 0, 640, 480);
      g.fillStyle = '#fff'; g.font = '14px monospace';
      for (let y = 0; y < 30; y++) g.fillText('Elifoot 98 Classificacao ' + y + ' ' + ((n * 7 + y * 13) % 100), 10, 16 + y * 15);
      g.fillStyle = '#ff0'; g.fillRect((n * 9) % 600, 200 + (n * 5) % 200, 40, 40);
      requestAnimationFrame(draw) };
    draw();
    const stream = canvas.captureStream(30);
    const track = stream.getVideoTracks()[0];
    ${hint ? `track.contentHint = ${JSON.stringify(hint)};` : ''}
    const readBack = track.contentHint;
    const a = new RTCPeerConnection(), b = new RTCPeerConnection();
    a.onicecandidate = e => e.candidate && b.addIceCandidate(e.candidate); b.onicecandidate = e => e.candidate && a.addIceCandidate(e.candidate);
    const sender = a.addTrack(track, stream);
    const got = new Promise(res => { b.ontrack = e => res(e.streams[0]) });
    const offer = await a.createOffer(); await a.setLocalDescription(offer); await b.setRemoteDescription(offer);
    const answer = await b.createAnswer(); await b.setLocalDescription(answer); await a.setRemoteDescription(answer);
    const p = sender.getParameters(); p.encodings[0].maxBitrate = 120000; await sender.setParameters(p);
    const degradation = sender.getParameters().degradationPreference ?? '(not exposed)';
    await got;
    await new Promise(r => setTimeout(r, 9000));
    const stats = await a.getStats(); let o = null; stats.forEach(s => { if (s.type === 'outbound-rtp' && s.kind === 'video') o = s });
    stop = true; a.close(); b.close(); canvas.remove();
    return JSON.stringify({ hint: ${JSON.stringify(hint)} || '(none)', readBack, degradation, w: o.frameWidth, h: o.frameHeight, fps: o.framesPerSecond, framesSent: o.framesSent, limit: o.qualityLimitationReason });
  `, 60000)
  console.log(out)
}
