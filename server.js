// server.js - BirimMat backend (Express) - Kararlı Sürüm
const express = require('express');
const cors = require('cors');
const { normalize, sonuclariHazirla } = require('./yardimcilar');
const { getBrowser, tarayiciyiKapat } = require('./tarayici');
const { tarifBul, durumRapor: tarifDurum } = require('./tarifler');
const { karmaArama, durumRapor: fiyatDurum } = require('./fiyatlar');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const ARA_ZAMAN_ASIMI_MS = 75000;    
const ARA_CACHE_SURESI = 0; // 🛠️ Önbellek kapatıldı, her arama anlık yapılır
const TARIF_ZAMAN_ASIMI_MS = 60000;  

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '10kb' }));

function zamanAsimi(promise, ms, mesaj) {
    let zamanlayici;
    const asim = new Promise((_, red) => {
        zamanlayici = setTimeout(() => red(new Error(mesaj)), ms);
    });
    return Promise.race([promise, asim]).finally(() => clearTimeout(zamanlayici));
}

const devamEden = new Map();
function tekilCalistir(anahtar, fn) {
    if (devamEden.has(anahtar)) return devamEden.get(anahtar);
    const is = Promise.resolve().then(fn).finally(() => devamEden.delete(anahtar));
    devamEden.set(anahtar, is);
    return is;
}

const CACHE_SURESI = 0; // 🛠️ Genel önbellek kapatıldı
const cache = new Map();
function cacheGet(key) {
    const kayit = cache.get(key);
    if (!kayit) return null;
    if (Date.now() - kayit.zaman > kayit.sure) {
        cache.delete(key);
        return null;
    }
    return kayit.veri;
}
function cacheSet(key, veri, sure = CACHE_SURESI) {
    if (sure === 0) return; // Süre 0 ise kaydetme
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    cache.set(key, { zaman: Date.now(), sure, veri });
}

const hizSiniri = new Map();
function hizKontrol(req, res, next) {
    const ip = req.ip;
    const simdi = Date.now();
    const kayit = hizSiniri.get(ip) || { sayac: 0, baslangic: simdi };
    if (simdi - kayit.baslangic > 60000) {
        kayit.sayac = 0;
        kayit.baslangic = simdi;
    }
    kayit.sayac++;
    hizSiniri.set(ip, kayit);
    if (kayit.sayac > 20) {
        return res.status(429).json({ success: false, message: 'Çok fazla istek. Lütfen biraz bekleyin.' });
    }
    next();
}

function istekTakipci(res) {
    const durum = { kapandi: false };
    res.on('close', () => { if (!res.writableEnded) durum.kapandi = true; });
    return durum;
}

const zamanAsimiMi = (e) => /zaman aşım/i.test(String(e && e.message));

// ---------------------------------------------------------------
// 1. Market Fiyatları Arama Modülü (/api/ara)
// ---------------------------------------------------------------
async function fiyatAra(arananUrun, cacheKey) {
    const ham = await karmaArama(arananUrun);
    const liste = Array.isArray(ham) ? ham : [];

    const hazir = sonuclariHazirla(liste, arananUrun, 60);
    if (hazir.length === 0) return [];

    const finalSonuclar = hazir.map((item, index) => ({
        id: index + 1, title: item.title, price: item.price, unitPrice: item.unitPrice,
        market: item.market, kaynak: item.kaynak, storeIcon: item.storeIcon, link: item.link,
        isBulk: !!item.isBulk, supheli: !!item.supheli, benzer: !!item.benzer, guncelleme: item.guncelleme
    }));

    cacheSet(cacheKey, finalSonuclar, ARA_CACHE_SURESI);
    return finalSonuclar;
}

app.get('/api/ara', hizKontrol, async (req, res) => {
    const istemci = istekTakipci(res);
    try {
        const arananUrun = String(req.query.q || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        if (!arananUrun || arananUrun.length < 2) {
            return res.status(400).json({ success: false, message: 'Lütfen en az 2 karakterden oluşan geçerli bir ürün adı girin.' });
        }

        console.log(`\n🔍 Market Arama İsteği: "${arananUrun}"`);
        const cacheKey = 'ara:' + normalize(arananUrun);
        
        const sonuclar = await tekilCalistir(cacheKey, () =>
            zamanAsimi(fiyatAra(arananUrun, cacheKey), ARA_ZAMAN_ASIMI_MS, 'Market araması zaman aşımına uğradı')
        );

        if (istemci.kapandi) return;

        if (sonuclar.length === 0) {
            return res.status(404).json({ success: false, message: 'Bu ürün için eşleşen fiyat bulunamadı.' });
        }

        res.json({ success: true, query: arananUrun, results: sonuclar });
    } catch (error) {
        console.error('❌ Market Arama Hatası:', error.message);
        if (!res.headersSent && !istemci.kapandi) {
            res.status(zamanAsimiMi(error) ? 504 : 500).json({ success: false, message: 'Sunucu hatası oluştu.' });
        }
    }
});

// ---------------------------------------------------------------
// 2. Şef AI - Tarif Modülü (/api/tarif)
// ---------------------------------------------------------------
async function tarifGetir(yemekAdi, cacheKey) {
    const sonuc = await tarifBul(yemekAdi);
    if (!sonuc) return { bulunamadi: true };
    const yanit = { success: true, query: yemekAdi, tarifAdi: sonuc.tarifAdi, malzemeler: sonuc.malzemeler, adimlar: sonuc.adimlar, link: sonuc.link, kaynak: sonuc.kaynak };
    cacheSet(cacheKey, yanit, 10 * 60 * 1000); 
    return { yanit };
}

app.get('/api/tarif', hizKontrol, async (req, res) => {
    const istemci = istekTakipci(res);
    try {
        const yemekAdi = String(req.query.q || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        if (!yemekAdi || yemekAdi.length < 2) {
            return res.status(400).json({ success: false, message: 'Lütfen geçerli bir yemek adı girin.' });
        }

        console.log(`\n🍳 Tarif Arama İsteği: "${yemekAdi}"`);
        const cacheKey = 'tarif:' + normalize(yemekAdi);
        const onbellek = cacheGet(cacheKey);
        if (onbellek) return res.json(onbellek);

        const sonuc = await tekilCalistir(cacheKey, () =>
            zamanAsimi(tarifGetir(yemekAdi, cacheKey), TARIF_ZAMAN_ASIMI_MS, 'Tarif isteği zaman aşımına uğradı')
        );

        if (istemci.kapandi) return;
        if (sonuc.bulunamadi) return res.status(404).json({ success: false, message: 'Tarif bulunamadı.' });
        res.json(sonuc.yanit);
    } catch (error) {
        if (!res.headersSent && !istemci.kapandi) res.status(502).json({ success: false, message: 'Tarif siteleri şu an erişilemiyor.' });
    }
});

app.get('/api/saglik', (req, res) => {
    res.json({ success: true, uptimeSn: Math.round(process.uptime()), bellekMB: Math.round(process.memoryUsage().rss / 1048576), fiyatKaynaklari: fiyatDurum(), tarifKaynaklari: tarifDurum() });
});

app.use((req, res) => res.status(404).json({ success: false, message: 'Bulunamadı.' }));

let sunucu = null;
let kapaniyor = false;
async function kapat() {
    if (kapaniyor) return;
    kapaniyor = true;
    console.log('\n🛑 Sunucu kapatılıyor...');
    const zorla = setTimeout(() => process.exit(1), 10000);
    zorla.unref();
    try { if (sunucu) await new Promise((coz) => sunucu.close(() => coz())); } catch (e) {}
    await tarayiciyiKapat();
    process.exit(0);
}

if (require.main === module) {
    process.on('unhandledRejection', (neden) => console.error('⚠️ Hata:', neden));
    process.on('uncaughtException', (err) => console.error('⚠️ Hata:', err));
    process.on('SIGINT', kapat);
    process.on('SIGTERM', kapat);

    sunucu = app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Sunucu Aktif: http://localhost:${PORT}`);
        getBrowser().catch((err) => console.error('⚠️ Tarayıcı Hatası:', err.message));
    });
}

module.exports = app;