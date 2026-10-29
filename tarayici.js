// tarayici.js - Akakçe odaklı, engel aşan stabil motor
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const {
    bekle, rastgele, normalize, birimFiyatHesapla, hamIsle, tekillestir, teklifleriIsle
} = require('./yardimcilar');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
const MAKS_SAYFA = 3;
const SAYFA_OMRU_MS = 60000;

async function tekrarDene(fn, { deneme = 3, taban = 800, ad = 'işlem' } = {}) {
    let sonHata;
    for (let i = 1; i <= deneme; i++) {
        try { return await fn(i); } 
        catch (e) {
            sonHata = e;
            if (i < deneme) {
                const gecikme = taban * 2 ** (i - 1) + rastgele(0, 400);
                console.log(`↻ ${ad} başarısız, ${gecikme}ms sonra tekrar...`);
                await bekle(gecikme);
            }
        }
    }
    throw sonHata;
}

let browserInstance = null;
let browserPromise = null;

const bagliMi = (b) => { try { return typeof b.isConnected === 'function' ? b.isConnected() : b.connected; } catch (e) { return false; } };

async function getBrowser() {
    if (browserInstance && bagliMi(browserInstance)) return browserInstance;
    if (browserPromise) return browserPromise;

    console.log('🚀 Puppeteer tarayıcısı BULUT UYUMLU ayarlarla başlatılıyor...');
    const baslat = tekrarDene(
        () => puppeteer.launch({
            headless: true, 
            timeout: 30000,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-gpu', '--disable-blink-features=AutomationControlled',
                `--user-agent=${USER_AGENT}`
            ]
        })
    ).then((browser) => {
        browserInstance = browser;
        browser.on('disconnected', () => { if (browserInstance === browser) browserInstance = null; });
        return browser;
    });

    browserPromise = baslat;
    baslat.then(() => { if (browserPromise === baslat) browserPromise = null; }, () => { if (browserPromise === baslat) browserPromise = null; });
    return baslat;
}

process.once('exit', () => { try { if (browserInstance && browserInstance.process()) browserInstance.process().kill('SIGKILL'); } catch (e) {} });

let acikSayfa = 0;
const sayfaKuyrugu = [];
async function sayfaHakkiAl() {
    if (acikSayfa < MAKS_SAYFA) { acikSayfa++; return; }
    await new Promise((coz) => sayfaKuyrugu.push(coz));
}
function sayfaHakkiBirak() {
    const siradaki = sayfaKuyrugu.shift();
    if (siradaki) siradaki(); else acikSayfa = Math.max(0, acikSayfa - 1);
}

const sonIstekZamani = {};
async function nezaketGecikmesi(anahtar = 'genel') {
    const simdi = Date.now();
    const hedef = Math.max(simdi, (sonIstekZamani[anahtar] || 0) + rastgele(800, 1800));
    sonIstekZamani[anahtar] = hedef;
    if (hedef > simdi) await bekle(hedef - simdi);
}

async function sayfaAc(ozelUrl, secenek = {}) {
    await sayfaHakkiAl();
    let page = null;
    let birakildi = false;
    const birak = () => { if (!birakildi) { birakildi = true; sayfaHakkiBirak(); } };

    try {
        const browser = await getBrowser();
        page = await browser.newPage();
        
        const omur = setTimeout(() => page.close().catch(() => {}), SAYFA_OMRU_MS);
        page.once('close', () => { clearTimeout(omur); birak(); });

        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent(USER_AGENT);
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            window.chrome = { runtime: {} };
        });

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (req.isInterceptResolutionHandled && req.isInterceptResolutionHandled()) return;
            const tur = req.resourceType();
            if (tur === 'image' || tur === 'media' || tur === 'font') req.abort().catch(() => {});
            else req.continue().catch(() => {});
        });

        await tekrarDene(async () => {
            const yanit = await page.goto(ozelUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
            if (yanit && yanit.status() >= 400) throw new Error(`HTTP ${yanit.status()}`);
            await bekle(3000); 
        });

        return page;
    } catch (hata) {
        if (page) await page.close().catch(() => {});
        birak();
        throw hata;
    }
}

// 🛠️ SİLİNEN FONKSİYON GERİ EKLENDİ
async function aramaAkakce(arananUrun) {
    let page = null;
    try {
        await nezaketGecikmesi('akakce');
        page = await sayfaAc(`https://www.akakce.com/arama/?q=${encodeURIComponent(arananUrun)}`);
        const ham = await page.evaluate(() => {
            const items = [];
            document.querySelectorAll('li, .p-card, article').forEach(el => {
                const text = (el.innerText || '').trim();
                if (text.length > 10 && text.length < 500 && /(TL|₺)/.test(text)) {
                    const aTag = el.querySelector('a[href]');
                    const tEl = el.querySelector('h3, h2, .pn, .w, .t, a[title]');
                    let title = tEl ? (tEl.getAttribute('title') || tEl.innerText || '').trim() : '';
                    if (aTag && title) items.push({ title, text, alts: '', link: aTag.href });
                }
            });
            return items;
        });
        return tekillestir(hamIsle(ham));
    } catch (error) { return []; } finally { if (page) await page.close().catch(() => {}); }
}

// 🛠️ DÜZELTİLMİŞ DETEKTİF FONKSİYONU
async function urunTeklifleri(urun) {
    if (!urun || !urun.link || urun.link === '#') return [];
    let page = null;
    try {
        await nezaketGecikmesi('akakce-detay');
        page = await sayfaAc(urun.link);
        
        await bekle(3000);

        const ham = await page.evaluate(() => {
            const ONFILTRE = /migros|a101|[sşSŞ]ok|b[iıİI]m|carrefour|hakmar|bizim|sec|macrocenter|mopas|onur|tarim kredi|file|kim|yunus/i;
            const sonuc = [];
            const elements = document.querySelectorAll('li, tr, article, div, a');

            for (const el of elements) {
                if (sonuc.length >= 400) break;
                if (el.children.length > 25) continue; 

                const raw = el.textContent || '';
                if (raw.length > 2500 || !(raw.includes('TL') || raw.includes('₺'))) continue;

                const text = (el.innerText || '').trim();
                if (!text || text.length > 350 || !/(TL|₺)/.test(text)) continue;

                let info = text + ' ' + (el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '');
                el.querySelectorAll('img, a[href]').forEach((x) => {
                    info += ' ' + (x.getAttribute('alt') || '') + ' ' + (x.getAttribute('title') || '') +
                            ' ' + (x.getAttribute('src') || '') + ' ' + (x.getAttribute('href') || '');
                });
                
                if (!ONFILTRE.test(info)) continue;

                const a = el.tagName === 'A' ? el : el.querySelector('a[href]');
                sonuc.push({ text, raw: raw.replace(/\s+/g, ' ').trim().slice(0, 400), info, link: a ? a.href : '' });
            }
            return sonuc;
        });

        const teklifler = teklifleriIsle(ham);

        return teklifler.map((t) => ({
            title: urun.title, 
            price: t.fiyat, 
            unitPrice: t.birim || birimFiyatHesapla(urun.title, t.fiyat),
            market: t.market, 
            storeIcon: '🛒', 
            link: /^https?:/.test(t.link) ? t.link : urun.link, 
            isBulk: urun.isBulk,
            kaynak: 'akakce'
        }));
    } catch (error) { 
        return []; 
    } finally { 
        if (page) await page.close().catch(() => {}); 
    }
}

async function havuzdaCalistir(liste, limit, fn) {
    const sonuc = new Array(liste.length);
    let sira = 0;
    const isciler = Array.from({ length: Math.min(limit, liste.length) }, async () => {
        while (true) {
            const k = sira++;
            if (k >= liste.length) break;
            try { sonuc[k] = await fn(liste[k]); } catch (e) { sonuc[k] = []; }
        }
    });
    await Promise.all(isciler);
    return sonuc;
}

async function tarayiciyiKapat() { if (browserInstance) await browserInstance.close().catch(() => {}); }

function kisaOnbellekli(fn, ttl = 0) {
    const saklanan = new Map();
    const suren = new Map();
    const kopya = (liste) => (Array.isArray(liste) ? liste.map((x) => ({ ...x })) : liste);
    return async function (anahtar) {
        const k = normalize(anahtar);
        const c = saklanan.get(k);
        if (c && Date.now() - c.zaman < ttl) return kopya(c.veri);
        if (suren.has(k)) return kopya(await suren.get(k));
        const is = fn(anahtar).then((v) => {
            if (Array.isArray(v) && v.length && ttl > 0) {
                if (saklanan.size >= 50) saklanan.delete(saklanan.keys().next().value);
                saklanan.set(k, { zaman: Date.now(), veri: v });
            }
            return v;
        }).finally(() => suren.delete(k));
        suren.set(k, is);
        return kopya(await is);
    };
}

module.exports = {
    getBrowser, tarayiciyiKapat, sayfaAc, nezaketGecikmesi,
    aramaAkakce: kisaOnbellekli(aramaAkakce), // Artık burada ve yukarıda tanımlı, hata vermez
    urunTeklifleri, havuzdaCalistir
};