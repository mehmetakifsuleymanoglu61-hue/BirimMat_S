// yardimcilar.js - saf yardımcı fonksiyonlar (Kesin filtreleme ve hata ayıklama kurallı)
const bekle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rastgele = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function normalize(text) {
    return String(text == null ? '' : text)
        .replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase().replace(/\u0307/g, '')
        .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u')
        .replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[’‘`´]/g, "'");
}

function fiyatTemizleVeCevir(fiyatStr) {
    if (fiyatStr === null || fiyatStr === undefined || fiyatStr === '') return 999999;
    let temiz = String(fiyatStr).replace(/[^0-9,.]/g, '');
    if (!temiz) return 999999;
    if (temiz.includes(',')) temiz = temiz.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(temiz)) temiz = temiz.replace(/\./g, '');
    const sayi = parseFloat(temiz);
    return Number.isFinite(sayi) ? sayi : 999999;
}

// 🛠️ Pttavm çıkarıldı, yeni marketler eklendi
const MARKET_DESENLERI = [
    ['Migros', /\bmigros/], ['A101', /\ba101/], ['Şok', /\bsok(market)?\b/],
    ['BİM', /\bbim\b/], ['CarrefourSA', /\bcarrefour/], ['Hakmar', /\bhakmar/],
    ['Bizim Toptan', /\bbizim/], ['Seç Market', /\bsec(market)?\b/], ['Macrocenter', /\bmacrocenter/],
    ['Mopaş', /\bmopas/], ['Onur Market', /\bonur/], ['Tarım Kredi', /\btarim kredi/],
    ['File Market', /\bfile(market)?\b/], ['Kim Market', /\bkim(market)?\b/], ['Yunus Market', /\byunus\b/]
];

function marketleriBul(text) {
    if (!text) return [];
    const t = normalize(text);
    return MARKET_DESENLERI.filter(([, re]) => re.test(t)).map(([ad]) => ad);
}

function marketAdiBul(text) {
    const bulunan = marketleriBul(text);
    return bulunan.length > 0 ? bulunan[0] : 'Zincir Mağaza';
}

function topluPaketMi(title) {
    if (!title) return false;
    const t = normalize(title);
    if (/\bkoli\b/.test(t)) return true;
    if (/\b\d+\s*'?\s*(li|lu)\b/.test(t)) return true;
    if (/\b\d+\s*x\s*\d+/.test(t)) return true;
    if (/\bx\s*\d+\b/.test(t)) return true;
    if (/\b\d+\s*(adet|paket)\b/.test(t)) return true;
    return false;
}

const FIYAT_KAYNAK = String.raw`(?<![\d.,])(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?|\d+\.\d{1,2})\s*(?:TL|₺)(\s*\/\s*[a-zA-ZçğıöşüÇĞİÖŞÜ]+)?`;
const FIYAT_TEST = new RegExp(FIYAT_KAYNAK);
const fiyatReOlustur = () => new RegExp(FIYAT_KAYNAK, 'g');

function fiyatlariAyir(text) {
    let fiyat = null, birim = null;
    const metin = String(text || '');
    const re = fiyatReOlustur();
    let m;
    while ((m = re.exec(metin)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        if (m[2]) { if (!birim) birim = m[1] + ' TL/' + m[2].replace(/[\s/]/g, ''); }
        else if (!fiyat) fiyat = m[1] + ' TL';
    }
    if (!fiyat && !birim) {
        const onRe = /(?:₺|TL)\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?|\d+\.\d{1,2})/;
        const o = onRe.exec(metin);
        if (o) fiyat = o[1] + ' TL';
    }
    return { fiyat, birim };
}

function birimFiyatHesapla(title, fiyatStr) {
    if (!title || topluPaketMi(title)) return null;
    const m = normalize(title).match(/(\d+(?:[.,]\d+)?)\s*(kg|gr|g|lt|l|ml|cl)\b/);
    if (!m) return null;
    const miktar = parseFloat(m[1].replace(',', '.'));
    if (!miktar) return null;
    const fiyat = fiyatTemizleVeCevir(fiyatStr);
    if (fiyat >= 999999) return null;

    let deger, birim;
    switch (m[2]) {
        case 'kg': deger = miktar; birim = 'kg'; break;
        case 'gr': case 'g': deger = miktar / 1000; birim = 'kg'; break;
        case 'lt': case 'l': deger = miktar; birim = 'lt'; break;
        case 'ml': deger = miktar / 1000; birim = 'lt'; break;
        case 'cl': deger = miktar / 100; birim = 'lt'; break;
        default: return null;
    }
    return (fiyat / deger).toFixed(2).replace('.', ',') + ' TL/' + birim;
}

function hamIsle(hamListe) {
    const ana = [], yedek = [];
    for (const h of hamListe || []) {
        if (!h) continue;
        const title = String(h.title || '').trim();
        if (title.length < 3 || normalize(title).includes('en ucuz')) continue;
        if (FIYAT_TEST.test(title) && !/[a-zA-ZçğıöşüÇĞİÖŞÜ]{3,}/.test(title.replace(fiyatReOlustur(), ''))) continue;
        const { fiyat, birim } = fiyatlariAyir(h.text);
        const kayit = { title, market: marketAdiBul((h.text || '') + ' ' + (h.alts || '')), storeIcon: '🛒', link: h.link || '#', isBulk: topluPaketMi(title) };
        if (fiyat) {
            kayit.price = fiyat; kayit.unitPrice = birim || birimFiyatHesapla(title, fiyat) || null; ana.push(kayit);
        } else if (birim) {
            kayit.price = birim; kayit.unitPrice = birim; yedek.push(kayit);
        }
    }
    return ana.length > 0 ? ana : yedek;
}

function tekillestir(liste) {
    const goruldu = new Set();
    return (liste || []).filter((item) => {
        if (fiyatTemizleVeCevir(item.price) >= 999999) return false;
        const anahtar = normalize(item.title) + '|' + item.price;
        if (goruldu.has(anahtar)) return false;
        goruldu.add(anahtar);
        return true;
    });
}

const YOK_SAYILAN = new Set(['lt', 'l', 'litre', 'kg', 'gr', 'g', 'gram', 'ml', 'cl', 'adet', 've', 'ile', 'icin']);
const MIKTAR_KAYNAK = String.raw`(\d+(?:[.,]\d+)?)\s*(kg|gr|g|lt|l|ml|cl)\b`;

function miktarCikar(text) {
    const m = normalize(text).match(new RegExp(MIKTAR_KAYNAK));
    if (!m) return null;
    const n = parseFloat(m[1].replace(',', '.'));
    if (!n) return null;
    switch (m[2]) {
        case 'kg': return { deger: n, birim: 'kg' };
        case 'gr': case 'g': return { deger: n / 1000, birim: 'kg' };
        case 'lt': case 'l': return { deger: n, birim: 'lt' };
        case 'ml': return { deger: n / 1000, birim: 'lt' };
        case 'cl': return { deger: n / 100, birim: 'lt' };
        default: return null;
    }
}

function kelimeVarMi(baslik, k) {
    return baslik.split(/[^a-z0-9]+/).some((x) => x === k || (k.length >= 5 && x.startsWith(k) && x.length - k.length <= 2));
}

function alakaFiltresi(liste, arananUrun) {
    const kelimeler = normalize(arananUrun)
        .split(/[^a-z0-9]+/)
        .filter((k) => k.length >= 2 && !/^\d+$/.test(k) && !/^\d+(kg|gr|g|lt|l|ml|cl)$/.test(k) && !YOK_SAYILAN.has(k));
    
    if (kelimeler.length === 0) return liste || [];

    return (liste || []).filter((item) => {
        const t = normalize(item.title);
        // Miktar farkını görmezden gel, sadece kelimelere bak
        if (!kelimeler.every((k) => kelimeVarMi(t, k))) return false;
        return true;
    });
}

const NITELIK = new Set(['tam', 'yarim', 'yagli', 'yagsiz', 'az', 'light', 'organik', 'laktozsuz', 'uht', 'pastorize', 'taze', 'gunluk', 'buyuk', 'kucuk', 'boy', 'paket', 'klasik', 'dogal', 'sade', 'yuzde', 'protein', 'fit']);

function sorguKelimeleri(arananUrun) {
    return normalize(arananUrun).split(/[^a-z0-9]+/).filter((k) => k.length >= 2 && !/^\d+$/.test(k) && !/^\d+(kg|gr|g|lt|l|ml|cl)$/.test(k) && !YOK_SAYILAN.has(k));
}

function cekirdekSorgu(arananUrun) {
    const hepsi = sorguKelimeleri(arananUrun);
    const cekirdek = hepsi.filter((k) => !NITELIK.has(k));
    if (cekirdek.length === 0 || cekirdek.length === hepsi.length) return null;
    const m = miktarCikar(arananUrun);
    return cekirdek.join(' ') + (m ? ` ${m.deger} ${m.birim}` : '');
}

const AYKIRI_KELIMELER = ['cikolata', 'muz', 'cilek', 'vanilya', 'protein', 'fit', 'meyveli', 'kahve', 'sade', 'light', 'laktozsuz'];

function esnekAlakaFiltresi(liste, arananUrun) {
    const arananNormal = normalize(arananUrun);
    const temizListe = (liste || []).filter(item => {
        const t = normalize(item.title);
        return !AYKIRI_KELIMELER.some(k => t.includes(k) && !arananNormal.includes(k));
    });
    const tam = alakaFiltresi(temizListe, arananUrun);
    const sade = cekirdekSorgu(arananUrun);
    if (!sade) return tam;
    const tamKumesi = new Set(tam);
    const benzer = alakaFiltresi(temizListe, sade).filter((x) => !tamKumesi.has(x)).map((x) => ({ ...x, benzer: true }));
    return [...tam, ...benzer];
}

const KAMPANYA_RE = /ve uzeri|uzeri alisveris|kargo|sepet|kampanya|indirim|hediye|taksit|kupon|bedava|yerine|fiyatina/;

function teklifleriIsle(hamTeklifler) {
    const enIyi = new Map();
    for (const h of hamTeklifler || []) {
        if (!h || !h.text) continue;
        if (KAMPANYA_RE.test(normalize(h.text))) continue;
        const marketler = marketleriBul(h.info);
        if (marketler.length !== 1) continue;
        let { fiyat, birim } = fiyatlariAyir(h.text);
        if (!fiyat) continue;

        if (h.raw) {
            const rakamlar = (x) => String(x).replace(/\D/g, '');
            const re = fiyatReOlustur();
            let m;
            while ((m = re.exec(String(h.raw))) !== null) {
                if (m[2]) continue;
                const aday = m[1] + ' TL';
                if (aday !== fiyat && rakamlar(aday) === rakamlar(fiyat) && /[.,]\d{1,2}$/.test(m[1])) { fiyat = aday; break; }
            }
        }
        if (/^\d{3,4} TL$/.test(fiyat)) {
            const sayi = parseInt(fiyat, 10);
            if (sayi >= 100 && sayi <= 2000) { const s = String(sayi); fiyat = s.slice(0, -2) + ',' + s.slice(-2) + ' TL'; }
        }
        if (birim && /^\d{3,5} TL\//.test(birim)) {
            const bSayi = parseInt(birim, 10);
            if (bSayi >= 100 && bSayi <= 20000) { const s = String(bSayi); birim = s.slice(0, -2) + ',' + s.slice(-2) + ' TL' + birim.substring(birim.indexOf('/')); }
        }

        const market = marketler[0];
        const uzunluk = String(h.text).length;
        const onceki = enIyi.get(market);
        if (!onceki || uzunluk < onceki.uzunluk || (uzunluk === onceki.uzunluk && fiyatTemizleVeCevir(fiyat) < fiyatTemizleVeCevir(onceki.fiyat))) {
            enIyi.set(market, { market, fiyat, birim, link: h.link, uzunluk, kaynakMetin: String(h.text).slice(0, 140) });
        }
    }
    return [...enIyi.values()].map(({ market, fiyat, birim, link, kaynakMetin }) => ({ market, fiyat, birim, link, kaynakMetin }));
}

function birimDegeri(unitPrice) {
    const m = String(unitPrice || '').match(/^([\d.,]+)\s*TL\/(\w+)/);
    if (!m) return null;
    const deger = fiyatTemizleVeCevir(m[1]);
    return deger >= 999999 ? null : { deger, birim: normalize(m[2]) };
}

function sirala(a, b) {
    const ba = !!a.isBulk, bb = !!b.isBulk;
    if (ba !== bb) return ba ? 1 : -1;
    if (!!a.benzer !== !!b.benzer) return a.benzer ? 1 : -1;
    if (!!a.supheli !== !!b.supheli) return a.supheli ? 1 : -1;
    const ua = birimDegeri(a.unitPrice), ub = birimDegeri(b.unitPrice);
    if (!!ua !== !!ub) return ua ? -1 : 1;
    if (ua && ub) {
        if (ua.birim !== ub.birim) return ua.birim < ub.birim ? -1 : 1;
        if (ua.deger !== ub.deger) return ua.deger - ub.deger;
    }
    return fiyatTemizleVeCevir(a.price) - fiyatTemizleVeCevir(b.price);
}

function fiyataGore(a, b) { return fiyatTemizleVeCevir(a.price) - fiyatTemizleVeCevir(b.price); }

function urunAnahtari(item) {
    const m = miktarCikar(item.title);
    const kelimeler = normalize(item.title).replace(new RegExp(MIKTAR_KAYNAK, 'g'), ' ').split(/[^a-z0-9]+/).filter(Boolean);
    const sirali = [...new Set(kelimeler)].sort().join(' ');
    return normalize(item.market) + '|' + sirali + '|' + (m ? m.deger + m.birim : '');
}

function kaynakTekillestir(liste) {
    const oncelik = (i) => (i.kaynak === 'site' ? 0 : 1);
    const en = new Map();
    for (const item of liste) {
        const k = urunAnahtari(item);
        const onceki = en.get(k);
        if (!onceki || oncelik(item) < oncelik(onceki) || (oncelik(item) === oncelik(onceki) && fiyatTemizleVeCevir(item.price) < fiyatTemizleVeCevir(onceki.price))) { en.set(k, item); }
    }
    return [...en.values()];
}

function supheliIsaretle(liste) {
    const gruplar = {};
    const anahtarOf = (item) => { const m = miktarCikar(item.title); const b = birimDegeri(item.unitPrice); return m && b ? m.birim + ':' + m.deger : null; };
    for (const item of liste) { const k = anahtarOf(item); if (k) (gruplar[k] = gruplar[k] || []).push(birimDegeri(item.unitPrice).deger); }
    const medyanlar = {};
    for (const [k, degerler] of Object.entries(gruplar)) {
        if (degerler.length < 3) continue;
        const sirali = [...degerler].sort((a, b) => a - b);
        const ort = Math.floor(sirali.length / 2);
        medyanlar[k] = sirali.length % 2 ? sirali[ort] : (sirali[ort - 1] + sirali[ort]) / 2;
    }
    for (const item of liste) {
        const k = anahtarOf(item);
        if (!k || !medyanlar[k]) continue;
        const oran = birimDegeri(item.unitPrice).deger / medyanlar[k];
        if (oran > 2 || oran < 0.5) item.supheli = true;
    }
    return liste;
}

function asiriAykiriAyikla(liste) {
    const degerler = {};
    for (const item of liste) { const b = birimDegeri(item.unitPrice); if (b) (degerler[b.birim] = degerler[b.birim] || []).push(b.deger); }
    const medyanlar = {};
    for (const [birim, d] of Object.entries(degerler)) {
        if (d.length < 2) continue;
        const sirali = [...d].sort((x, y) => x - y);
        const ort = Math.floor(sirali.length / 2);
        medyanlar[birim] = sirali.length % 2 ? sirali[ort] : (sirali[ort - 1] + sirali[ort]) / 2;
    }
    return liste.filter((item) => {
        const b = birimDegeri(item.unitPrice);
        if (!b || !medyanlar[b.birim]) return true;
        const oran = b.deger / medyanlar[b.birim];
        
        // Uçuk fiyat kontrolü (Medyanın yarısından az veya 2 katından fazlaysa sil)
        if (oran > 2 || oran < 0.5) { 
            console.log(`🚫 Hatalı Fiyat Silindi: ${item.market} | ${item.title} | ${item.price}`);
            return false; 
        }
        return true;
    });
}

function sonuclariHazirla(liste, arananUrun, maks = 60) {
    let l = esnekAlakaFiltresi((liste || []).map((x) => ({ ...x })), arananUrun);
    for (const i of l) {
        if (!i.unitPrice) i.unitPrice = birimFiyatHesapla(i.title, i.price) || null;
        if (i.isBulk === undefined) i.isBulk = topluPaketMi(i.title);
    }
    l = asiriAykiriAyikla(l); 
    l = kaynakTekillestir(l);
    supheliIsaretle(l);
    const normalUrunler = l.filter(x => !x.supheli);
    if (normalUrunler.length >= 1) { l = normalUrunler; }
    l.sort(sirala);
    return l.slice(0, maks);
}

module.exports = {
    bekle, rastgele, normalize, fiyatTemizleVeCevir,
    marketleriBul, marketAdiBul, topluPaketMi, fiyatlariAyir, birimFiyatHesapla,
    hamIsle, tekillestir, alakaFiltresi, teklifleriIsle, 
    birimDegeri, sirala, fiyataGore, miktarCikar, kaynakTekillestir, supheliIsaretle, 
    asiriAykiriAyikla, sonuclariHazirla, esnekAlakaFiltresi, cekirdekSorgu
};