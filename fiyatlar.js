// fiyatlar.js - Sadece Akakçe kullanan, derinlemesine tarama yapan motor
const { aramaAkakce, urunTeklifleri, havuzdaCalistir } = require('./tarayici');
const { esnekAlakaFiltresi, cekirdekSorgu, sirala, topluPaketMi, birimFiyatHesapla } = require('./yardimcilar');

const ADAY_MAKS = 30; // 30 farklı ürünün detayına girer
const DETAY_ESZAMANLI = 4;
const DETAY_BUTCE_MS = 45000;

async function akakceAra(arananUrun, bitis) {
    let liste = await aramaAkakce(arananUrun);
    let ilgili = esnekAlakaFiltresi(liste, arananUrun);
    
    if (ilgili.length === 0) {
        const sade = cekirdekSorgu(arananUrun);
        if (sade) {
            console.log(`ℹ️ [Akakçe] Sonuç yok, sade sorgu deneniyor: "${sade}"`);
            liste = await aramaAkakce(sade);
            ilgili = esnekAlakaFiltresi(liste, arananUrun);
        }
    }
    
    console.log(`📊 [Akakçe] ${liste.length} ürün bulundu, ${ilgili.length} tanesi alakalı`);
    if (ilgili.length === 0) return [];

    const adaylar = [...ilgili].sort(sirala).slice(0, ADAY_MAKS);
    console.log(`🔎 [Akakçe] Toplam ${adaylar.length} ürünün detay sayfasına giriliyor...`);
    
    const sonuclar = await havuzdaCalistir(adaylar, DETAY_ESZAMANLI, async (urun) => {
        if (Date.now() > bitis) return [];
        return urunTeklifleri(urun);
    });
    
    const teklifler = sonuclar.flat().filter(Boolean);
    console.log(`📊 [Akakçe] Detay: ${adaylar.length} üründen toplam ${teklifler.length} market teklifi çekildi.`);
    return teklifler.map((t) => ({ ...t, kaynak: t.kaynak || 'akakce' }));
}

const durum = { akakce: { basarili: 0, hatali: 0 } };
const durumRapor = () => JSON.parse(JSON.stringify(durum));

async function karmaArama(arananUrun) {
    const zaman = new Date().toISOString();
    const bitis = Date.now() + DETAY_BUTCE_MS;

    try {
        const sonuclar = await akakceAra(arananUrun, bitis);
        durum.akakce.basarili++;
        
        return sonuclar.filter((i) => i && i.title && i.price).map((i) => ({
            ...i,
            isBulk: typeof i.isBulk === 'boolean' ? i.isBulk : topluPaketMi(i.title),
            unitPrice: i.unitPrice || birimFiyatHesapla(i.title, i.price) || null,
            storeIcon: i.storeIcon || '🛒',
            link: i.link || '#',
            guncelleme: i.guncelleme || zaman
        }));
    } catch (error) {
        durum.akakce.hatali++;
        console.error('❌ Akakçe Arama Hatası:', error.message);
        return [];
    }
}

module.exports = { karmaArama, durumRapor };