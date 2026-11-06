// Bildirim yonetimi. Internete acik bir yonetim sayfasi yok; bu komutlar sunucuda calisir.
// Kullanim: node scripts/reports.mjs list [pending|approved|rejected]
//           node scripts/reports.mjs approve <id>
//           node scripts/reports.mjs reject <id>
import { openCommunity } from '../server/community.mjs';

const [command, arg] = process.argv.slice(2);
const community = openCommunity();

function show(r) {
  const changes = [
    r.name && `isim: ${r.name}`, r.phone && `telefon: ${r.phone}`, r.hours && `saat: ${r.hours}`,
    r.closed && 'KAPANDI', r.note && `not: ${r.note}`,
  ].filter(Boolean).join(' | ');
  console.log(`#${r.id} [${r.status}] ${r.placeName ?? '(isimsiz)'} (${r.placeId}) -> ${changes}`);
}

if (command === 'list') {
  const rows = community.list(arg ?? 'pending');
  rows.forEach(show);
  console.log(`${rows.length} bildirim`);
} else if (command === 'approve' && Number(arg)) {
  show(community.approve(Number(arg)));
  console.log('Onaylandi, bir sonraki istekten itibaren gorunur');
} else if (command === 'reject' && Number(arg)) {
  community.reject(Number(arg));
  console.log('Reddedildi');
} else {
  console.error('Kullanim: node scripts/reports.mjs list [durum] | approve <id> | reject <id>');
  process.exitCode = 1;
}
community.close();
