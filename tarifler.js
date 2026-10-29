// tarifler.js - Sadece Yemek.com üzerinden çalışan hızlı tarif bulucu
const axios = require('axios');
const cheerio = require('cheerio');
const { sayfaAc, nezaketGecikmesi } = require('./tarayici');
const { normalize } = require('./yardimcilar');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const KAYNAK_ZAMAN_ASIMI_MS = 20000;      // Tek bir site için üst sınır (Hızlandırmak için biraz düşürdük)
const SOGUMA_MS = 5 * 60 * 1000;          
const ENGEL_RE = /just a moment|checking your browser|attention required|captcha|robot olmad/i;

const YASAK_YOLLAR = [
    '/ara/', '/arama', '/kategori/', '/yazar/', '/yazarlar/', '/uye/', '/video/',
    '/page/', '/sayfa/', '/etiket/', '/profil/', '/sozluk/'
];

const slugla = (s) => normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---------------------------------------------------------------
// SADECE YEMEK.COM KALDI
// ---------------------------------------------------------------
const KAYNAKLAR = [
    {
        ad: 'Yemek.com',
        alan: 'yemek.com',
        dogrudan: (q) => {
            const s = slugla(q);
            return s ? [`https://yemek.com/tarif/${s}/`] : [];
        },
        aramaUrl: (q) => `https://yemek.com/arama/?q=${encodeURIComponent(q)}`,
        tarifMi: (u) => /^\/tarif\/[^/]+\/?$/.test(u.pathname)
    }
];

// ---------------------------------------------------------------
// Sayfa indirme: axios -> (olmazsa) Puppeteer
// ---------------------------------------------------------------
async function htmlPuppeteer(url) {
    let page = null;
    try {
        await nezaketGecikmesi(new URL(url).hostname);
        page = await sayfaAc(null, url, 7000);
        return await page.content();
    } finally {
        if (page) await page.close().catch(() => {});
    }
}

async function htmlAl(url) {
    try {
        const r = await axios.get(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept-Language': 'tr-TR,tr;q=0.9',
                Accept: 'text/html,application/xhtml+xml'
            },
            timeout: 8000,
            maxContentLength: 6 * 1024 * 1024,
            responseType: 'text',
            validateStatus: (s) => s >= 200 && s < 300
        });
        const veri = typeof r.data === 'string' ? r.data : '';
        if (veri.length > 500 && !ENGEL_RE.test(veri.slice(0, 2500))) return veri;
    } catch (e) {
        const durum = e.response && e.response.status;
        if (durum === 404 || durum === 410) return null;
    }
    return htmlPuppeteer(url);
}

// ---------------------------------------------------------------
// Arama sonuç sayfasından en alakalı tarif bağlantısını seç
// ---------------------------------------------------------------
function tarifLinkiBul(html, kaynak, tabanUrl, sorgu) {
    const $ = cheerio.load(html);
    const kelimeler = normalize(sorgu).split(/\s+/).filter((k) => k.length >= 3);
    const goruldu = new Set();
    const adaylar = [];

    $('a[href]').each((i, a) => {
        let u;
        try {
            u = new URL($(a).attr('href'), tabanUrl);
        } catch (e) {
            return;
        }
        const host = u.hostname.replace(/^www\./, '');
        if (!(host === kaynak.alan || host.endsWith('.' + kaynak.alan))) return;
        if (u.pathname.length < 5) return;
        if (YASAK_YOLLAR.some((y) => u.pathname.includes(y))) return;
        if (!kaynak.tarifMi(u)) return;

        u.hash = '';
        const link = u.href;
        if (goruldu.has(link)) return;
        goruldu.add(link);

        const hedef = normalize(u.pathname + ' ' + $(a).text());
        const puan = kelimeler.length ? kelimeler.filter((k) => hedef.includes(k)).length : 1;
        adaylar.push({ link, puan, sira: adaylar.length });
    });

    adaylar.sort((a, b) => b.puan - a.puan || a.sira - b.sira);
    return adaylar.length && adaylar[0].puan > 0 ? adaylar[0].link : null;
}

// ---------------------------------------------------------------
// Tarif sayfasından başlık / malzeme / adımları çıkar
// ---------------------------------------------------------------
const metinTemizle = (s) =>
    cheerio.load(String(s || ''), null, false).text().replace(/\s+/g, ' ').trim();
const tekil = (liste) => [...new Set(liste.map(metinTemizle).filter(Boolean))];

function adimCoz(x) {
    if (!x) return [];
    if (typeof x === 'string') return [x];
    if (Array.isArray(x)) return x.flatMap(adimCoz);
    if (x.itemListElement) return adimCoz(x.itemListElement);
    return x.text ? [x.text] : x.name ? [x.name] : [];
}

function receteCoz(html) {
    const $ = cheerio.load(html);

    const dugumler = [];
    const gez = (n) => {
        if (!n) return;
        if (Array.isArray(n)) return n.forEach(gez);
        if (typeof n === 'object') {
            dugumler.push(n);
            if (n['@graph']) gez(n['@graph']);
        }
    };
    $('script[type="application/ld+json"]').each((i, el) => {
        try {
            gez(JSON.parse($(el).contents().text()));
        } catch (e) { }
    });
    const recete = dugumler.find((n) => {
        const t = n['@type'];
        return Array.isArray(t) ? t.includes('Recipe') : t === 'Recipe';
    });

    let baslik = '';
    let malzemeler = [];
    let adimlar = [];
    if (recete) {
        baslik = metinTemizle(recete.name);
        malzemeler = tekil([].concat(recete.recipeIngredient || []));
        adimlar = tekil(adimCoz(recete.recipeInstructions));
    }

    if (!baslik) baslik = metinTemizle($('h1').first().text()) || 'İsimsiz Tarif';

    if (!malzemeler.length) {
        malzemeler = tekil(
            $('[itemprop="recipeIngredient"], [itemprop="ingredients"], [class*="ingredient" i] li, [class*="malzeme" i] li')
                .map((i, e) => $(e).text()).get()
        );
    }
    if (!adimlar.length) {
        adimlar = tekil(
            $('[itemprop="recipeInstructions"] li, [itemprop="recipeInstructions"] p, [class*="instruction" i] li, [class*="yapilis" i] li, [class*="step" i] p')
                .map((i, e) => $(e).text()).get()
        );
    }

    if (!malzemeler.length || !adimlar.length) {
        $('nav, header, footer, aside, script, style, [class*="comment" i], [class*="menu" i]').remove();
        const alan = $('article, main, .entry-content, .post-content').first();
        const kok = alan.length ? alan : $('body');
        if (!malzemeler.length) {
            malzemeler = tekil(
                kok.find('li').map((i, e) => $(e).text()).get()
                    .map(metinTemizle)
                    .filter((m) => m.length > 2 && m.length < 120 && !/Giriş|Üye|Yorum/.test(m))
            );
        }
        if (!adimlar.length) {
            adimlar = tekil(
                kok.find('p').map((i, e) => $(e).text()).get()
                    .map(metinTemizle)
                    .filter((m) => m.length > 20 && m.length < 500)
            );
        }
    }

    return { baslik, malzemeler: malzemeler.slice(0, 30), adimlar: adimlar.slice(0, 20) };
}

const detayGecerliMi = (d) => d && (d.malzemeler.length > 0 || d.adimlar.length > 0);

// ---------------------------------------------------------------
// Tek bir kaynaktan tarif al
// ---------------------------------------------------------------
async function kaynaktanAl(kaynak, sorgu) {
    // 1) Doğrudan adres tahmini (arama sayfası gerektirmez)
    for (const adres of kaynak.dogrudan ? kaynak.dogrudan(sorgu) : []) {
        const html = await htmlAl(adres);
        if (!html) continue;
        const d = receteCoz(html);
        if (detayGecerliMi(d) && d.malzemeler.length > 0) {
            return { tarifAdi: d.baslik, malzemeler: d.malzemeler, adimlar: d.adimlar, link: adres };
        }
    }

    // 2) Site içi arama
    const aramaUrl = kaynak.aramaUrl(sorgu);
    const aramaHtml = await htmlAl(aramaUrl);
    if (!aramaHtml) return null;

    const tarifLinki = tarifLinkiBul(aramaHtml, kaynak, aramaUrl, sorgu);
    console.log(`🔗 [${kaynak.ad}] Bulunan Tarif Linki:`, tarifLinki);
    if (!tarifLinki) return null;

    const tarifHtml = await htmlAl(tarifLinki);
    if (!tarifHtml) return null;
    const d = receteCoz(tarifHtml);
    if (!detayGecerliMi(d)) return null;

    return { tarifAdi: d.baslik, malzemeler: d.malzemeler, adimlar: d.adimlar, link: tarifLinki };
}

// ---------------------------------------------------------------
// Dışarıya açılan fonksiyon
// ---------------------------------------------------------------
const sogumada = new Map();

function kaynaklariSirala() {
    const simdi = Date.now();
    const aktif = KAYNAKLAR.filter((k) => (sogumada.get(k.ad) || 0) < simdi);
    return aktif.length ? aktif : KAYNAKLAR;
}

function zamanAsimi(promise, ms, mesaj) {
    let z;
    const asim = new Promise((_, red) => { z = setTimeout(() => red(new Error(mesaj)), ms); });
    return Promise.race([promise, asim]).finally(() => clearTimeout(z));
}

async function tarifBul(sorgu) {
    let hatalar = 0;
    let denenen = 0;
    let sonHata = null;

    for (const kaynak of kaynaklariSirala()) {
        denenen++;
        try {
            const sonuc = await zamanAsimi(
                kaynaktanAl(kaynak, sorgu),
                KAYNAK_ZAMAN_ASIMI_MS,
                `${kaynak.ad} zaman aşımına uğradı`
            );
            if (sonuc) {
                sogumada.delete(kaynak.ad);
                return { ...sonuc, kaynak: kaynak.ad };
            }
            console.log(`ℹ️ ${kaynak.ad}: tarif bulunamadı, sıradaki kaynağa geçiliyor...`);
        } catch (e) {
            hatalar++;
            sonHata = e;
            sogumada.set(kaynak.ad, Date.now() + SOGUMA_MS);
            console.log(`⚠️ ${kaynak.ad} erişilemedi (${e.message}), sıradaki kaynağa geçiliyor...`);
        }
    }

    if (denenen > 0 && hatalar === denenen && sonHata) throw sonHata;
    return null;
}

function durumRapor() {
    const simdi = Date.now();
    return KAYNAKLAR.map((k) => {
        const bitis = sogumada.get(k.ad) || 0;
        return { kaynak: k.ad, atlaniyor: bitis > simdi, tekrarDenemeSn: bitis > simdi ? Math.round((bitis - simdi) / 1000) : 0 };
    });
}

module.exports = { tarifBul, durumRapor, KAYNAKLAR, tarifLinkiBul, receteCoz, slugla };