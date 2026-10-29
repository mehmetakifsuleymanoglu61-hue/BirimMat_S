// kontrol.js - Kurulum denetimi.  Kullanım:  node kontrol.js
// Dosyalar eksik mi, yanlış kopyalanmış mı (iki kez yapıştırma vb.), paketler kurulu mu, kontrol eder.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const KLASOR = __dirname;
const DOSYALAR = [
    { ad: 'server.js', zorunlu: true },
    { ad: 'tarayici.js', zorunlu: true },
    { ad: 'yardimcilar.js', zorunlu: true },
    { ad: 'fiyatlar.js', zorunlu: true },
    { ad: 'tarifler.js', zorunlu: true },
    { ad: 'marketler.js', zorunlu: false } // yoksa sadece Akakçe kullanılır
];
const PAKETLER = ['express', 'cors', 'axios', 'cheerio', 'puppeteer'];
const BEKLENEN = {
    'tarayici.js': ['getBrowser', 'tarayiciyiKapat', 'sayfaAc', 'nezaketGecikmesi', 'aramaCheerio', 'aramaPuppeteer', 'urunTeklifleri', 'havuzdaCalistir'],
    'yardimcilar.js': ['normalize', 'alakaFiltresi', 'esnekAlakaFiltresi', 'sonuclariHazirla', 'teklifleriIsle', 'sirala', 'birimFiyatHesapla'],
    'fiyatlar.js': ['karmaArama', 'durumRapor'],
    'tarifler.js': ['tarifBul', 'durumRapor']
};

let hata = 0;
let uyari = 0;
const ok = (m) => console.log('  ✅ ' + m);
const kotu = (m) => { hata++; console.log('  ❌ ' + m); };
const dikkat = (m) => { uyari++; console.log('  ⚠️  ' + m); };

console.log('\n1) Dosyalar ve söz dizimi');
for (const { ad, zorunlu } of DOSYALAR) {
    const yol = path.join(KLASOR, ad);
    if (!fs.existsSync(yol)) {
        zorunlu ? kotu(`${ad} bulunamadı`) : dikkat(`${ad} yok (isteğe bağlı; olmazsa sadece Akakçe kullanılır)`);
        continue;
    }
    const satir = fs.readFileSync(yol, 'utf8').split('\n').length;
    const r = spawnSync(process.execPath, ['--check', yol], { encoding: 'utf8' });
    if (r.status === 0) ok(`${ad} (${satir} satır)`);
    else {
        const mesaj = (r.stderr || '').split('\n').find((l) => /Error/.test(l)) || 'söz dizimi hatası';
        kotu(`${ad}: ${mesaj.trim()}  -> dosya bozuk ya da içerik iki kez yapıştırılmış olabilir; dosyayı silip yenisini KOPYALA`);
    }
}

console.log('\n2) Paketler');
for (const p of PAKETLER) {
    try {
        require.resolve(p, { paths: [KLASOR] });
        ok(p);
    } catch (e) {
        kotu(`${p} kurulu değil  -> npm install ${p}`);
    }
}

console.log('\n3) Dosyalar birbirini buluyor mu');
if (hata === 0) {
    for (const [dosya, isimler] of Object.entries(BEKLENEN)) {
        try {
            const m = require(path.join(KLASOR, dosya));
            const eksik = isimler.filter((i) => typeof m[i] !== 'function');
            eksik.length ? kotu(`${dosya}: eksik fonksiyon(lar): ${eksik.join(', ')}  -> dosya eski sürüm olabilir`) : ok(dosya);
        } catch (e) {
            kotu(`${dosya} yüklenemedi: ${e.message.split('\n')[0]}`);
        }
    }
    try {
        require(path.join(KLASOR, 'server.js'));
        ok('server.js yüklendi (bağlantılar tamam)');
    } catch (e) {
        kotu(`server.js yüklenemedi: ${e.message.split('\n')[0]}`);
    }
} else {
    dikkat('Önceki hatalar giderilmeden bu adım atlandı');
}

console.log(`\nSonuç: ${hata} hata, ${uyari} uyarı.`);
console.log(hata === 0 ? '👍 Her şey yerinde, "npm start" ile başlatabilirsin.\n' : '👎 Önce yukarıdaki ❌ satırlarını düzelt.\n');
process.exit(hata === 0 ? 0 : 1);
