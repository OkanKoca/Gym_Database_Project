const express = require('express');
const { Client } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const port = 3000;

// PostgreSQL bağlantısı
const client = new Client({
  user: 'postgres',
  host: 'localhost',
  database: 'spor_salon_sistemi',
  password: 'okan',
  port: 5432,
});

client.connect()
  .then(() => console.log('Connected to the database'))
  .catch(err => console.error('Connection error', err.stack));

app.use(cors());
app.use(bodyParser.json()); // JSON verisi alabilmek için
app.use(express.static('public')); // Static dosyalar (HTML, CSS, JS) için

// ---------------------------UYELER----------------------

app.get('/api/uyeler', async (req, res) => {
  const { searchTerm } = req.query;
  console.log("GET /api/uyeler request received", searchTerm);

  let query = `SELECT u.*, ap."Paket_Adi" AS "paketAdi", ua."Bitis_Tarihi" AS "UyelikBitisTarihi" 
               FROM public."Uyeler" u 
               LEFT JOIN public."AbonelikPaketleri" ap ON u."Paket_ID" = ap."Paket_ID" 
               LEFT JOIN public."UyeAbonelikleri" ua ON u."Uye_ID" = ua."Uye_ID"`;
  let values = [];

  if (searchTerm) {
    query += ` WHERE u."Ad" ILIKE $1 OR u."Soyad" ILIKE $1`;
    values = [`%${searchTerm}%`];
  }
  query += ' ORDER BY "Uye_ID" ASC';

  try {
    const result = await client.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching data:', err.stack);
    res.status(500).send('Error fetching data: ' + err.stack);
  }
});

// Veritabanından tek bir üyeyi ID ile getir
app.get('/api/uyeler/:id', (req, res) => {
  const { id } = req.params; // URL parametresinden ID'yi al
  const query = 'SELECT * FROM public."Uyeler" WHERE "Uye_ID" = $1';

  client.query(query, [id])
    .then(result => {
      if (result.rows.length === 0) {
        return res.status(404).send('Üye bulunamadı.');
      }
      res.json(result.rows[0]); // Tek üyeyi döndür
    })
    .catch(err => {
      console.error('Error fetching data:', err.stack);
      res.status(500).send('Error fetching data: ' + err.stack);
    });
});


app.post('/api/uyeler', async (req, res) => {
  const { Ad, Soyad, Telefon, Eposta, Kayit_Tarihi, Paket_ID } = req.body;

  try {
    await client.query('BEGIN'); // Transaction başlat

    // Yeni üyeyi kaydet
    const uyeQuery = 'INSERT INTO public."Uyeler" ("Ad", "Soyad", "Telefon", "Eposta", "Kayit_Tarihi", "Paket_ID") VALUES ($1, $2, $3, $4, $5, $6) RETURNING "Uye_ID"';
    const uyeResult = await client.query(uyeQuery, [Ad, Soyad, Telefon, Eposta, Kayit_Tarihi, Paket_ID]);
    const yeniUyeId = uyeResult.rows[0].Uye_ID;

    // Abonelik paketinin ücretini al
    const paketQuery = 'SELECT "Ucret" FROM public."AbonelikPaketleri" WHERE "Paket_ID" = $1';
    const paketResult = await client.query(paketQuery, [Paket_ID]);
    const tutar = paketResult.rows[0].Ucret;

    // Otomatik ödeme kaydını oluştur
    const odemeTarihi = new Date().toISOString(); // Şu anki tarih ve saat
    const odemeYontemi = 'Nakit'; // Varsayılan ödeme yöntemi

    // Öncelikle UyeAbonelikleri kaydını oluşturmalıyız
    const uyeAbonelikQuery = 'INSERT INTO public."UyeAbonelikleri" ("Uye_ID", "Paket_ID", "Baslangic_Tarihi", "Bitis_Tarihi") VALUES ($1, $2, $3, $4) RETURNING "Uye_Abonelik_ID"';
    // Bitiş tarihini hesapla (örneğin paket süresi kadar ekleyerek)
    const paketBilgisiQuery = 'SELECT "Sure" FROM public."AbonelikPaketleri" WHERE "Paket_ID" = $1';
    const paketBilgisiResult = await client.query(paketBilgisiQuery, [Paket_ID]);
    const paketSuresi = paketBilgisiResult.rows[0].Sure;
    const bitisTarihi = new Date();
    bitisTarihi.setMonth(bitisTarihi.getMonth() + paketSuresi);
    const bitisTarihiISO = bitisTarihi.toISOString();

    const uyeAbonelikResult = await client.query(uyeAbonelikQuery, [yeniUyeId, Paket_ID, Kayit_Tarihi, bitisTarihiISO]);
    const yeniUyeAbonelikId = uyeAbonelikResult.rows[0].Uye_Abonelik_ID;

    const odemeQuery = 'INSERT INTO public."Odemeler" ("Uye_ID", "Tutar", "Tarih", "Odeme_Yontemi", "Uye_Abonelik_ID") VALUES ($1, $2, $3, $4, $5) RETURNING *';
    const odemeResult = await client.query(odemeQuery, [yeniUyeId, tutar, odemeTarihi, odemeYontemi, yeniUyeAbonelikId]);

    await client.query('COMMIT'); // Transaction'ı tamamla
    res.status(201).json(uyeResult.rows[0]); // Sadece üye bilgilerini döndür
  } catch (err) {
    await client.query('ROLLBACK'); // Hata durumunda transaction'ı geri al
    console.error('Error inserting data:', err.stack);
    res.status(500).send('Error inserting data: ' + err.stack);
  }
});

// Üye güncelle
app.put('/api/uyeler/:id', async (req, res) => {
  const { id } = req.params;
  const { Ad, Soyad, Telefon, Eposta, Kayit_Tarihi, Paket_ID } = req.body;
  console.log(`PUT /api/uyeler/${id}, gelen data:`, req.body);
  const query = 'UPDATE public."Uyeler" SET "Ad" = $1, "Soyad" = $2, "Telefon" = $3, "Eposta" = $4, "Kayit_Tarihi" = $5, "Paket_ID" = $6 WHERE "Uye_ID" = $7 RETURNING *';

  try {
    const result = await client.query(query, [Ad, Soyad, Telefon, Eposta, Kayit_Tarihi, Paket_ID, id]); // await ekleyin
    if (result.rowCount === 0) {
      console.log(`Üye bulunamadı: ${id}`);
      return res.status(404).send('Üye bulunamadı.');
    }
    console.log(`Üye güncellendi: ${id}`, result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating data:', err.stack);
    res.status(500).send('Error updating data: ' + err.stack);
  }
});

// Üye sil
app.delete('/api/uyeler/:id', (req, res) => {
  const { id } = req.params;
  console.log(`DELETE /api/uyeler/${id}`)
  const query = 'DELETE FROM public."Uyeler" WHERE "Uye_ID" = $1 RETURNING *';
  client.query(query, [id])
    .then(result => {
      if (result.rowCount === 0) {
        console.log(`Üye bulunamadı: ${id}`);
        return res.status(404).send('Üye bulunamadı.');
      }
        console.log(`Üye silindi: ${id}`, result.rows[0]);
      res.json({ message: 'Deleted successfully', deleted: result.rows[0] });
    })
    .catch(err => {
        console.error('Error deleting data:', err.stack);
        res.status(500).send('Error deleting data: ' + err.stack)
    });
});

//-----------------------ABONELİK PAKETLERİ-------------------------------

  // Veritabanındaki "AbonelikPaketleri" tablosundaki tüm paketleri getir
app.get('/api/AbonelikPaketleri', (req, res) => {
  client.query('SELECT * FROM public."AbonelikPaketleri" ORDER BY "Paket_ID" ASC')
    .then(result => res.json(result.rows))
    .catch(err => {
      console.error('Error fetching data:', err.stack);
      res.status(500).send('Error fetching data: ' + err.stack);
    });
});

app.post('/api/abonelikpaketleri', async (req, res) => {
  const { Paket_Adi, Sure, Ucret } = req.body;
  try {
      const query = 'INSERT INTO public."AbonelikPaketleri" ("Paket_Adi", "Sure", "Ucret") VALUES ($1, $2, $3) RETURNING *';
      const result = await client.query(query, [Paket_Adi, Sure, Ucret]);
      res.status(201).json(result.rows[0]);
  } catch (err) {
      console.error('Abonelik paketi eklenirken hata oluştu:', err.stack);
      res.status(500).send('Abonelik paketi eklenirken hata oluştu: ' + err.stack);
  }
});

 // Veritabanından tek bir abonelik paketini ID ile getir
 app.get('/api/abonelikpaketleri/:id', (req, res) => {
  const { id } = req.params;
  const query = 'SELECT * FROM public."AbonelikPaketleri" WHERE "Paket_ID" = $1';

  client.query(query, [id])
      .then(result => {
          if (result.rows.length === 0) {
              return res.status(404).send('Abonelik paketi bulunamadı.');
          }
          res.json(result.rows[0]);
      })
      .catch(err => {
          console.error('Error fetching data:', err.stack);
          res.status(500).send('Error fetching data: ' + err.stack);
      });
});

// Veritabanından tek bir üye ve abonelik paketi bilgisini Uye_ID ile getir
app.get('/api/uyeler/abonelik/:id', async (req, res) => {
  const { id } = req.params;
   console.log('Gelen Uye_ID:', id);
   try {
      const uyeQuery = 'SELECT * FROM public."Uyeler" WHERE "Uye_ID" = $1';
       const uyeResult = await client.query(uyeQuery, [id]);
      if (uyeResult.rows.length === 0) {
        console.log('Üye bulunamadı Uye_ID:', id);
          return res.status(404).send('Üye bulunamadı.');
      }
      const uye = uyeResult.rows[0];
       console.log('Üye bilgileri:', uye);
       let paketAdi = 'Paket Yok';
      if (uye.Paket_ID) {
          const paketQuery = 'SELECT "Paket_Adi" FROM public."AbonelikPaketleri" WHERE "Paket_ID" = $1';
           const paketResult = await client.query(paketQuery, [uye.Paket_ID]);
           console.log('Paket Sonucu:', paketResult);
          if (paketResult.rows.length > 0) {
              paketAdi = paketResult.rows[0].Paket_Adi;
          }else{
             console.log('Paket adresi bulunamadı, Paket_ID:', uye.Paket_ID);
          }
      }
      const result = {
          ...uye,
          paketAdi: paketAdi
      };
      res.json(result);
  } catch (err) {
      console.error('Error fetching data:', err.stack);
      res.status(500).send('Error fetching data: ' + err.stack);
  }
});

// Abonelik paketini güncelle
app.put('/api/abonelikpaketleri/:id', async (req, res) => {
  const { id } = req.params;
  const { Paket_Adi, Sure, Ucret } = req.body;
  try {
      const query = 'UPDATE public."AbonelikPaketleri" SET "Paket_Adi" = $1, "Sure" = $2, "Ucret" = $3 WHERE "Paket_ID" = $4 RETURNING *';
      const result = await client.query(query, [Paket_Adi, Sure, Ucret, id]);
      if (result.rows.length === 0) {
          return res.status(404).send('Abonelik paketi bulunamadı.');
      }
      res.json(result.rows[0]);
  } catch (err) {
      console.error('Abonelik paketi güncellenirken hata oluştu:', err.stack);
      res.status(500).send('Abonelik paketi güncellenirken hata oluştu: ' + err.stack);
  }
});

// Abonelik paketini sil
app.delete('/api/abonelikpaketleri/:id', async (req, res) => {
  const { id } = req.params;
  try {
      const query = 'DELETE FROM public."AbonelikPaketleri" WHERE "Paket_ID" = $1 RETURNING *';
      const result = await client.query(query, [id]);
      if (result.rows.length === 0) {
          return res.status(404).send('Abonelik paketi bulunamadı.');
      }
      res.json({ message: 'Abonelik paketi başarıyla silindi.' });
  } catch (err) {
      console.error('Abonelik paketi silinirken hata oluştu:', err.stack);
      res.status(500).send('Abonelik paketi silinirken hata oluştu: ' + err.stack);
  }
});


//---------------------------ÖDEMELER-----------------------

// Ödeme kaydetme
app.post('/api/odemeler', (req, res) => {
  const { Uye_ID, Tutar, Tarih, Odeme_Yontemi, Uye_Abonelik_ID } = req.body;
  const query = 'INSERT INTO public."Odemeler" ("Uye_ID", "Tutar", "Tarih", "Odeme_Yontemi", "Uye_Abonelik_ID") VALUES ($1, $2, $3, $4, $5) RETURNING *';
  client.query(query, [Uye_ID, Tutar, Tarih, Odeme_Yontemi, Uye_Abonelik_ID])
      .then(result => {
          res.status(201).json(result.rows[0]);
      })
      .catch(err => {
          console.error('Ödeme kaydedilirken hata oluştu:', err.stack);
          res.status(500).send('Ödeme kaydedilirken hata oluştu: ' + err.stack);
      });
});

//-----------------------------PERSONEL---------------------------

// Belirli bir personeli ID'ye göre getir
app.get('/api/personel/:id', async (req, res) => {
  const { id } = req.params;

  try {
      const query = `
          SELECT
              p."Personel_ID",
              p."Ad",
              p."Soyad",
              p."Telefon",
              p."Eposta",
              e."Egitmen_ID",
              t."Personel_ID" AS "Temizlik_Gorevlisi_ID",
              COALESCE(
                  (SELECT ARRAY_AGG(u."Uzmanlik_Adi")
                   FROM public."EgitmenUzmanlikAlanlari" eua
                   JOIN public."UzmanlikAlanlari" u ON eua."Uzmanlik_ID" = u."Uzmanlik_ID"
                   WHERE eua."Egitmen_ID" = e."Egitmen_ID"),
                  '{}'
              ) AS "Uzmanlik_Alanlari",
              COALESCE(
                  (SELECT ARRAY_AGG(sa."Alan_Adi")
                   FROM public."TemizlikGorevlisiSorumluAlan" tgsa
                   JOIN public."SorumluOlunanAlanlar" sa ON tgsa."Alan_ID" = sa."Alan_ID"
                   WHERE tgsa."Personel_ID" = t."Personel_ID"),
                  '{}'
              ) AS "Sorumlu_Alanlar",
              CASE
                  WHEN e."Egitmen_ID" IS NOT NULL THEN 'Egitmen'
                  WHEN t."Personel_ID" IS NOT NULL THEN 'TemizlikGorevlisi'
                  ELSE 'Bilinmeyen'
              END AS "Tip"
          FROM public."Personeller" p
          LEFT JOIN public."Egitmenler" e ON p."Personel_ID" = e."Egitmen_ID"
          LEFT JOIN public."TemizlikGorevlileri" t ON p."Personel_ID" = t."Personel_ID"
          WHERE p."Personel_ID" = $1
      `;
      const result = await client.query(query, [id]);

      if (result.rows.length === 0) {
          return res.status(404).send('Personel bulunamadı.');
      }

      res.json(result.rows[0]);
  } catch (err) {
      console.error('Personel bilgileri getirilirken hata oluştu:', err.stack);
      res.status(500).send('Personel bilgileri getirilirken hata oluştu: ' + err.stack);
  }
});
//-------------------------------------------------------------------------------
// Personel Ekleme (POST /api/personel)
//--------------------------------------------------------------------------------
app.post('/api/personel', async (req, res) => {
  const { Ad, Soyad, Telefon, Eposta, Tip, Uzmanlik_Alanlari, Alanlar } = req.body;

  try {
    await client.query('BEGIN');

    // Önce Personeller tablosuna ekleme işlemi
    const personelQuery = 'INSERT INTO public."Personeller" ("Ad", "Soyad", "Telefon", "Eposta") VALUES ($1, $2, $3, $4) RETURNING "Personel_ID"';
    const personelResult = await client.query(personelQuery, [Ad, Soyad, Telefon, Eposta]);
    const yeniPersonelId = personelResult.rows[0].Personel_ID;

    // Personel tipine göre ilgili tabloya ekleme işlemi
    if (Tip === 'Egitmen') {
      const egitmenQuery = 'INSERT INTO public."Egitmenler" ("Egitmen_ID") VALUES ($1) RETURNING "Egitmen_ID"';
      const egitmenResult = await client.query(egitmenQuery, [yeniPersonelId]);
      const yeniEgitmenId = egitmenResult.rows[0].Egitmen_ID;

      // Uzmanlık alanlarını EgitmenUzmanlikAlanlari tablosuna ekleme işlemi
      if (Uzmanlik_Alanlari && Uzmanlik_Alanlari.length > 0) {
        for (const uzmanlikId of Uzmanlik_Alanlari) {
          const egitmenUzmanlikQuery = 'INSERT INTO public."EgitmenUzmanlikAlanlari" ("Egitmen_ID", "Uzmanlik_ID") VALUES ($1, $2)';
          await client.query(egitmenUzmanlikQuery, [yeniEgitmenId, uzmanlikId]);
        }
      }

      await client.query('COMMIT');
      res.status(201).json({ Personel_ID: yeniPersonelId, Egitmen_ID: yeniEgitmenId, Tip: 'Egitmen' });

    } else if (Tip === 'TemizlikGorevlisi') {
      // Temizlik görevlisini TemizlikGorevlileri tablosuna ekleme işlemi
      const temizlikGorevlisiQuery = 'INSERT INTO public."TemizlikGorevlileri" ("Personel_ID") VALUES ($1) RETURNING "Personel_ID"';
      const temizlikGorevlisiResult = await client.query(temizlikGorevlisiQuery, [yeniPersonelId]);

      // Sorumlu olunan alanları TemizlikGorevlisiSorumluAlan tablosuna ekleme işlemi
      if (Alanlar && Alanlar.length > 0) {
          for (const alanId of Alanlar) {
              const temizlikGorevlisiSorumluAlanQuery = 'INSERT INTO public."TemizlikGorevlisiSorumluAlan" ("Personel_ID", "Alan_ID") VALUES ($1, $2)';
              await client.query(temizlikGorevlisiSorumluAlanQuery, [yeniPersonelId, alanId]);
          }
      }

      await client.query('COMMIT');
      res.status(201).json({ Personel_ID: yeniPersonelId, Tip: 'TemizlikGorevlisi' });
    } else {
      await client.query('ROLLBACK');
      res.status(400).send('Geçersiz personel tipi.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Personel eklenirken hata oluştu:', err.stack);
    res.status(500).send('Personel eklenirken hata oluştu: ' + err.stack);
  }
});

//-------------------------------------------------------------------------------
// Tüm Personelleri Listeleme (GET /api/personel)
//--------------------------------------------------------------------------------
app.get('/api/personel', async (req, res) => {
  try {
      const query = `
          SELECT
              p."Personel_ID",
              p."Ad",
              p."Soyad",
              p."Telefon",
              p."Eposta",
              e."Egitmen_ID",
              t."Personel_ID" AS "Temizlik_Gorevlisi_ID",
              COALESCE(json_agg(DISTINCT u."Uzmanlik_Adi") FILTER (WHERE u."Uzmanlik_Adi" IS NOT NULL), '[]') AS "Uzmanlik_Alanlari",
              COALESCE(json_agg(DISTINCT sa."Alan_Adi") FILTER (WHERE sa."Alan_Adi" IS NOT NULL), '[]') AS "Sorumlu_Alanlar",
              CASE
                  WHEN e."Egitmen_ID" IS NOT NULL THEN 'Egitmen'
                  WHEN t."Personel_ID" IS NOT NULL THEN 'TemizlikGorevlisi'
                  ELSE 'Bilinmeyen'
              END AS "Tip"
          FROM public."Personeller" p
          LEFT JOIN public."Egitmenler" e ON p."Personel_ID" = e."Egitmen_ID"
          LEFT JOIN public."TemizlikGorevlileri" t ON p."Personel_ID" = t."Personel_ID"
          LEFT JOIN public."EgitmenUzmanlikAlanlari" eua ON e."Egitmen_ID" = eua."Egitmen_ID"
          LEFT JOIN public."UzmanlikAlanlari" u ON eua."Uzmanlik_ID" = u."Uzmanlik_ID"
          LEFT JOIN public."TemizlikGorevlisiSorumluAlan" tgsa ON t."Personel_ID" = tgsa."Personel_ID"
          LEFT JOIN public."SorumluOlunanAlanlar" sa ON tgsa."Alan_ID" = sa."Alan_ID"
          GROUP BY p."Personel_ID", e."Egitmen_ID", t."Personel_ID"
          ORDER BY p."Personel_ID" ASC
      `;
      const result = await client.query(query);
      res.json(result.rows);
  } catch (err) {
      console.error('Personeller getirilirken hata oluştu:', err.stack);
      res.status(500).send('Personeller getirilirken hata oluştu: ' + err.stack);
  }
});
//-------------------------------------------------------------------------------
// Personel Güncelleme (PUT /api/personel/:id)
//--------------------------------------------------------------------------------
app.put('/api/personel/:id', async (req, res) => {
  const { id } = req.params;
  const { Ad, Soyad, Telefon, Eposta, Tip, Uzmanlik_Alanlari, Alanlar } = req.body;

  try {
      await client.query('BEGIN');

      // Personel bilgilerini güncelle
      const personelQuery = 'UPDATE public."Personeller" SET "Ad" = $1, "Soyad" = $2, "Telefon" = $3, "Eposta" = $4 WHERE "Personel_ID" = $5';
      await client.query(personelQuery, [Ad, Soyad, Telefon, Eposta, id]);

      // Personel tipine göre ilgili tablodaki bilgileri güncelle
      if (Tip === 'Egitmen') {
          // Önce mevcut uzmanlık alanlarını sil
          const deleteUzmanlikQuery = 'DELETE FROM public."EgitmenUzmanlikAlanlari" WHERE "Egitmen_ID" = $1';
          await client.query(deleteUzmanlikQuery, [id]);

          // Uzmanlık alanlarını güncelle
          if (Uzmanlik_Alanlari && Uzmanlik_Alanlari.length > 0) {
              for (const uzmanlikId of Uzmanlik_Alanlari) {
                  const egitmenUzmanlikQuery = 'INSERT INTO public."EgitmenUzmanlikAlanlari" ("Egitmen_ID", "Uzmanlik_ID") VALUES ($1, $2)';
                  await client.query(egitmenUzmanlikQuery, [id, uzmanlikId]);
              }
          }
      } else if (Tip === 'TemizlikGorevlisi') {
          // Önce mevcut sorumlu olunan alanları sil
          const deleteAlanlarQuery = 'DELETE FROM public."TemizlikGorevlisiSorumluAlan" WHERE "Personel_ID" = $1';
          await client.query(deleteAlanlarQuery, [id]);

          // Sorumlu olunan alanları güncelle
          if (Alanlar && Alanlar.length > 0) {
              for (const alanId of Alanlar) {
                  const temizlikGorevlisiSorumluAlanQuery = 'INSERT INTO public."TemizlikGorevlisiSorumluAlan" ("Personel_ID", "Alan_ID") VALUES ($1, $2)';
                  await client.query(temizlikGorevlisiSorumluAlanQuery, [id, alanId]);
              }
          }
      } else {
          await client.query('ROLLBACK');
          return res.status(400).send('Geçersiz personel tipi.');
      }

      await client.query('COMMIT');
      res.status(200).json({ message: 'Personel başarıyla güncellendi.' });
  } catch (err) {
      await client.query('ROLLBACK');
      console.error('Personel güncellenirken hata oluştu:', err.stack);
      res.status(500).send('Personel güncellenirken hata oluştu: ' + err.stack);
  }
});

//-------------------------------------------------------------------------------
// Personel Silme (DELETE /api/personel/:id)
//--------------------------------------------------------------------------------
app.delete('/api/personel/:id', async (req, res) => {
  const { id } = req.params;

  try {
      await client.query('BEGIN');

      // Önce EgitmenUzmanlikAlanlari tablosundaki ilgili kayıtları sil
      const egitmenUzmanlikDeleteQuery = 'DELETE FROM public."EgitmenUzmanlikAlanlari" WHERE "Egitmen_ID" = $1';
      await client.query(egitmenUzmanlikDeleteQuery, [id]);

      // Sonra Egitmenler tablosundan ilgili kaydı sil
      const egitmenDeleteQuery = 'DELETE FROM public."Egitmenler" WHERE "Egitmen_ID" = $1';
      await client.query(egitmenDeleteQuery, [id]);

      // Önce TemizlikGorevlisiSorumluAlan tablosundaki ilgili kayıtları sil
      const temizlikGorevlisiAlanDeleteQuery = 'DELETE FROM public."TemizlikGorevlisiSorumluAlan" WHERE "Personel_ID" = $1';
      await client.query(temizlikGorevlisiAlanDeleteQuery, [id]);

      // Sonra TemizlikGorevlileri tablosundan ilgili kaydı sil
      const temizlikGorevlisiDeleteQuery = 'DELETE FROM public."TemizlikGorevlileri" WHERE "Personel_ID" = $1';
      await client.query(temizlikGorevlisiDeleteQuery, [id]);

      // En son Personeller tablosundan ilgili kaydı sil
      const personelDeleteQuery = 'DELETE FROM public."Personeller" WHERE "Personel_ID" = $1';
      await client.query(personelDeleteQuery, [id]);

      await client.query('COMMIT');
      res.status(200).json({ message: 'Personel başarıyla silindi.' });
  } catch (err) {
      await client.query('ROLLBACK');
      console.error('Personel silinirken hata oluştu:', err.stack);
      res.status(500).send('Personel silinirken hata oluştu: ' + err.stack);
  }
});


//-------------------------------------------------------------------------------
// Uzmanlık Alanları İşlemleri
//--------------------------------------------------------------------------------

// Tüm uzmanlık alanlarını getir
app.get('/api/uzmanlikalanlari', async (req, res) => {
  try {
    const query = 'SELECT * FROM public."UzmanlikAlanlari" ORDER BY "Uzmanlik_ID" ASC';
    const result = await client.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Uzmanlık alanları getirilirken hata oluştu:', err.stack);
    res.status(500).send('Uzmanlık alanları getirilirken hata oluştu: ' + err.stack);
  }
});

// Yeni uzmanlık alanı ekle
app.post('/api/uzmanlikalanlari', async (req, res) => {
  const { Uzmanlik_Adi } = req.body;
  try {
    const query = 'INSERT INTO public."UzmanlikAlanlari" ("Uzmanlik_Adi") VALUES ($1) RETURNING *';
    const result = await client.query(query, [Uzmanlik_Adi]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Uzmanlık alanı eklenirken hata oluştu:', err.stack);
    res.status(500).send('Uzmanlık alanı eklenirken hata oluştu: ' + err.stack);
  }
});

// Uzmanlık alanını güncelle
app.put('/api/uzmanlikalanlari/:id', async (req, res) => {
  const { id } = req.params;
  const { Uzmanlik_Adi } = req.body;
  try {
    const query = 'UPDATE public."UzmanlikAlanlari" SET "Uzmanlik_Adi" = $1 WHERE "Uzmanlik_ID" = $2 RETURNING *';
    const result = await client.query(query, [Uzmanlik_Adi, id]);
    if (result.rows.length === 0) {
      return res.status(404).send('Uzmanlık alanı bulunamadı.');
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Uzmanlık alanı güncellenirken hata oluştu:', err.stack);
    res.status(500).send('Uzmanlık alanı güncellenirken hata oluştu: ' + err.stack);
  }
});

// Uzmanlık alanını sil
app.delete('/api/uzmanlikalanlari/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const query = 'DELETE FROM public."UzmanlikAlanlari" WHERE "Uzmanlik_ID" = $1 RETURNING *';
    const result = await client.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).send('Uzmanlık alanı bulunamadı.');
    }
    res.json({ message: 'Uzmanlık alanı başarıyla silindi.' });
  } catch (err) {
    console.error('Uzmanlık alanı silinirken hata oluştu:', err.stack);
    res.status(500).send('Uzmanlık alanı silinirken hata oluştu: ' + err.stack);
  }
});


//-------------------------------------------------------------------------------
// SORUMLU OLUNAN ALAN İŞLEMLERİ
//--------------------------------------------------------------------------------
// Tüm Sorumlu Olunan Alanları Getir
app.get('/api/sorumluolunanalanlar', async (req, res) => {
    try {
        const query = 'SELECT * FROM public."SorumluOlunanAlanlar" ORDER BY "Alan_ID" ASC';
        const result = await client.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Sorumlu olunan alanlar getirilirken hata oluştu:', err.stack);
        res.status(500).send('Sorumlu olunan alanlar getirilirken hata oluştu: ' + err.stack);
    }
});

// Yeni Sorumlu Olunan Alan Ekle
app.post('/api/sorumluolunanalanlar', async (req, res) => {
    const { Alan_Adi } = req.body;
    try {
        const query = 'INSERT INTO public."SorumluOlunanAlanlar" ("Alan_Adi") VALUES ($1) RETURNING *';
        const result = await client.query(query, [Alan_Adi]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Sorumlu olunan alan eklenirken hata oluştu:', err.stack);
        res.status(500).send('Sorumlu olunan alan eklenirken hata oluştu: ' + err.stack);
    }
});

// Sorumlu Olunan Alanı Güncelle
app.put('/api/sorumluolunanalanlar/:id', async (req, res) => {
    const { id } = req.params;
    const { Alan_Adi } = req.body;
    try {
        const query = 'UPDATE public."SorumluOlunanAlanlar" SET "Alan_Adi" = $1 WHERE "Alan_ID" = $2 RETURNING *';
        const result = await client.query(query, [Alan_Adi, id]);
        if (result.rows.length === 0) {
            return res.status(404).send('Sorumlu olunan alan bulunamadı.');
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Sorumlu olunan alan güncellenirken hata oluştu:', err.stack);
        res.status(500).send('Sorumlu olunan alan güncellenirken hata oluştu: ' + err.stack);
    }
});

// Sorumlu Olunan Alanı Sil
app.delete('/api/sorumluolunanalanlar/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const query = 'DELETE FROM public."SorumluOlunanAlanlar" WHERE "Alan_ID" = $1 RETURNING *';
        const result = await client.query(query, [id]);
        if (result.rows.length === 0) {
            return res.status(404).send('Sorumlu olunan alan bulunamadı.');
        }
        res.json({ message: 'Sorumlu olunan alan başarıyla silindi.' });
    } catch (err) {
        console.error('Sorumlu olunan alan silinirken hata oluştu:', err.stack);
        res.status(500).send('Sorumlu olunan alan silinirken hata oluştu: ' + err.stack);
    }
});

//-------------------------------EGZERSİZLER--------------------------------

// Tüm egzersizleri getir
app.get('/api/egzersizler', async (req, res) => {
  try {
      const query = `
          SELECT
              e."Egzersiz_ID",
              e."Egzersiz_Adi",
              COALESCE(
                  (
                      SELECT ARRAY_AGG(kg."Kas_Grubu_Adi")
                      FROM public."EgzersizKasGruplari" ekg
                      JOIN public."KasGruplari" kg ON ekg."Kas_Grubu_ID" = kg."Kas_Grubu_ID"
                      WHERE ekg."Egzersiz_ID" = e."Egzersiz_ID"
                  ),
                  '{}'
              ) AS "Kas_Gruplari"
          FROM public."Egzersizler" e
          ORDER BY e."Egzersiz_ID" ASC
      `;
      const result = await client.query(query);
      res.json(result.rows);
  } catch (err) {
      console.error('Egzersizler getirilirken hata oluştu:', err.stack);
      res.status(500).send('Egzersizler getirilirken hata oluştu: ' + err.stack);
  }
});

// Yeni egzersiz ekle
app.post('/api/egzersizler', async (req, res) => {
const { Egzersiz_Adi, Kas_Gruplari } = req.body;
try {
    await client.query('BEGIN');

    // Egzersizi Egzersizler tablosuna ekle
    const egzersizQuery = 'INSERT INTO public."Egzersizler" ("Egzersiz_Adi") VALUES ($1) RETURNING "Egzersiz_ID"';
    const egzersizResult = await client.query(egzersizQuery, [Egzersiz_Adi]);
    const yeniEgzersizId = egzersizResult.rows[0].Egzersiz_ID;

    // Kas gruplarını EgzersizKasGruplari tablosuna ekle
    if (Kas_Gruplari && Kas_Gruplari.length > 0) {
        for (const kasGrubuId of Kas_Gruplari) {
            const egzersizKasGrubuQuery = 'INSERT INTO public."EgzersizKasGruplari" ("Egzersiz_ID", "Kas_Grubu_ID") VALUES ($1, $2)';
            await client.query(egzersizKasGrubuQuery, [yeniEgzersizId, kasGrubuId]);
        }
    }

    await client.query('COMMIT');
    res.status(201).json({ Egzersiz_ID: yeniEgzersizId });
} catch (err) {
    await client.query('ROLLBACK');
    console.error('Egzersiz eklenirken hata oluştu:', err.stack);
    res.status(500).send('Egzersiz eklenirken hata oluştu: ' + err.stack);
}
});

// Belirli bir egzersizi ID'ye göre getir
app.get('/api/egzersizler/:id', async (req, res) => {
  const { id } = req.params;
  try {
      const query = `
          SELECT
              e."Egzersiz_ID",
              e."Egzersiz_Adi",
              COALESCE(json_agg(kg."Kas_Grubu_Adi") FILTER (WHERE kg."Kas_Grubu_Adi" IS NOT NULL), '[]') AS "Kas_Gruplari"
          FROM public."Egzersizler" e
          LEFT JOIN public."EgzersizKasGruplari" ekg ON e."Egzersiz_ID" = ekg."Egzersiz_ID"
          LEFT JOIN public."KasGruplari" kg ON ekg."Kas_Grubu_ID" = kg."Kas_Grubu_ID"
          WHERE e."Egzersiz_ID" = $1
          GROUP BY e."Egzersiz_ID", e."Egzersiz_Adi"
      `;
      const result = await client.query(query, [id]);
      if (result.rows.length === 0) {
          return res.status(404).send('Egzersiz bulunamadı.');
      }
      res.json(result.rows[0]);
  } catch (err) {
      console.error('Egzersiz bilgileri getirilirken hata oluştu:', err.stack);
      res.status(500).send('Egzersiz bilgileri getirilirken hata oluştu: ' + err.stack);
  }
});

// Egzersizi güncelle
app.put('/api/egzersizler/:id', async (req, res) => {
const { id } = req.params;
const { Egzersiz_Adi, Kas_Gruplari } = req.body;
try {
    await client.query('BEGIN');

    // Egzersiz bilgilerini güncelle
    const egzersizQuery = 'UPDATE public."Egzersizler" SET "Egzersiz_Adi" = $1 WHERE "Egzersiz_ID" = $2';
    await client.query(egzersizQuery, [Egzersiz_Adi, id]);

    // Mevcut kas gruplarını sil
    const deleteKasGruplariQuery = 'DELETE FROM public."EgzersizKasGruplari" WHERE "Egzersiz_ID" = $1';
    await client.query(deleteKasGruplariQuery, [id]);

    // Yeni kas gruplarını ekle
    if (Kas_Gruplari && Kas_Gruplari.length > 0) {
        for (const kasGrubuId of Kas_Gruplari) {
            const egzersizKasGrubuQuery = 'INSERT INTO public."EgzersizKasGruplari" ("Egzersiz_ID", "Kas_Grubu_ID") VALUES ($1, $2)';
            await client.query(egzersizKasGrubuQuery, [id, kasGrubuId]);
        }
    }

    await client.query('COMMIT');
    res.status(200).json({ message: 'Egzersiz başarıyla güncellendi.' });
} catch (err) {
    await client.query('ROLLBACK');
    console.error('Egzersiz güncellenirken hata oluştu:', err.stack);
    res.status(500).send('Egzersiz güncellenirken hata oluştu: ' + err.stack);
}
});

// Egzersizi sil
app.delete('/api/egzersizler/:id', async (req, res) => {
const { id } = req.params;
try {
    await client.query('BEGIN');

    // Önce EgzersizKasGruplari tablosundaki ilgili kayıtları sil
    const egzersizKasGrubuDeleteQuery = 'DELETE FROM public."EgzersizKasGruplari" WHERE "Egzersiz_ID" = $1';
    await client.query(egzersizKasGrubuDeleteQuery, [id]);

    // Sonra Egzersizler tablosundan ilgili kaydı sil
    const egzersizDeleteQuery = 'DELETE FROM public."Egzersizler" WHERE "Egzersiz_ID" = $1';
    const result = await client.query(egzersizDeleteQuery, [id]);

    if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).send('Egzersiz bulunamadı.');
    }

    await client.query('COMMIT');
    res.status(200).json({ message: 'Egzersiz başarıyla silindi.' });
} catch (err) {
    await client.query('ROLLBACK');
    console.error('Egzersiz silinirken hata oluştu:', err.stack);
    res.status(500).send('Egzersiz silinirken hata oluştu: ' + err.stack);
}
});

//-------------------------------------------------------------------------------
// Kas Grubu İşlemleri
//--------------------------------------------------------------------------------

// Tüm kas gruplarını getir
app.get('/api/kasgruplari', async (req, res) => {
  try {
    const query = 'SELECT * FROM public."KasGruplari" ORDER BY "Kas_Grubu_ID" ASC';
    const result = await client.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Kas grupları getirilirken hata oluştu:', err.stack);
    res.status(500).send('Kas grupları getirilirken hata oluştu: ' + err.stack);
  }
});

// Yeni kas grubu ekle
app.post('/api/kasgruplari', async (req, res) => {
  const { Kas_Grubu_Adi } = req.body;
  try {
    const query = 'INSERT INTO public."KasGruplari" ("Kas_Grubu_Adi") VALUES ($1) RETURNING *';
    const result = await client.query(query, [Kas_Grubu_Adi]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Kas grubu eklenirken hata oluştu:', err.stack);
    res.status(500).send('Kas grubu eklenirken hata oluştu: ' + err.stack);
  }
});

// Kas grubunu güncelle
app.put('/api/kasgruplari/:id', async (req, res) => {
  const { id } = req.params;
  const { Kas_Grubu_Adi } = req.body;
  try {
    const query = 'UPDATE public."KasGruplari" SET "Kas_Grubu_Adi" = $1 WHERE "Kas_Grubu_ID" = $2 RETURNING *';
    const result = await client.query(query, [Kas_Grubu_Adi, id]);
    if (result.rows.length === 0) {
      return res.status(404).send('Kas grubu bulunamadı.');
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Kas grubu güncellenirken hata oluştu:', err.stack);
    res.status(500).send('Kas grubu güncellenirken hata oluştu: ' + err.stack);
  }
});

// Kas grubunu sil
app.delete('/api/kasgruplari/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const query = 'DELETE FROM public."KasGruplari" WHERE "Kas_Grubu_ID" = $1 RETURNING *';
    const result = await client.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).send('Kas grubu bulunamadı.');
    }
    res.json({ message: 'Kas grubu başarıyla silindi.' });
  } catch (err) {
    console.error('Kas grubu silinirken hata oluştu:', err.stack);
    res.status(500).send('Kas grubu silinirken hata oluştu: ' + err.stack);
  }
});


//-------------------------------------------------------------------------------
// Sağlık Bilgileri İşlemleri
//-------------------------------------------------------------------------

// Tüm sağlık bilgilerini ve ilgili üye bilgilerini getir
app.get('/api/saglikbilgileri', async (req, res) => {
  try {
    const query = `
      SELECT sb."Saglik_ID", sb."Uye_ID", sb."Boy", sb."Kilo", sb."Vucut_Kitle_Indeksi", u."Ad", u."Soyad"
      FROM public."SaglikBilgileri" sb
      JOIN public."Uyeler" u ON sb."Uye_ID" = u."Uye_ID"
      ORDER BY sb."Saglik_ID" ASC
    `;
    const result = await client.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Sağlık bilgileri ve üye bilgileri getirilirken hata oluştu:', err.stack);
    res.status(500).send('Sağlık bilgileri ve üye bilgileri getirilirken hata oluştu: ' + err.stack);
  }
});

// Yeni sağlık bilgisi ekle
app.post('/api/saglikbilgileri', async (req, res) => {
  const { Uye_ID, Boy, Kilo, Vucut_Kitle_Indeksi } = req.body;
  try {
    const query = 'INSERT INTO public."SaglikBilgileri" ("Uye_ID", "Boy", "Kilo", "Vucut_Kitle_Indeksi") VALUES ($1, $2, $3, $4) RETURNING *';
    const result = await client.query(query, [Uye_ID, Boy, Kilo, Vucut_Kitle_Indeksi]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Sağlık bilgisi eklenirken hata oluştu:', err.stack);
    res.status(500).send('Sağlık bilgisi eklenirken hata oluştu: ' + err.stack);
  }
});

// Belirli bir sağlık bilgisini ID'ye göre getir
app.get('/api/saglikbilgileri/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const query = 'SELECT * FROM public."SaglikBilgileri" WHERE "Saglik_ID" = $1';
    const result = await client.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).send('Sağlık bilgisi bulunamadı.');
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Sağlık bilgisi getirilirken hata oluştu:', err.stack);
    res.status(500).send('Sağlık bilgisi getirilirken hata oluştu: ' + err.stack);
  }
});

// Sağlık bilgisini güncelle
app.put('/api/saglikbilgileri/:id', async (req, res) => {
  const { id } = req.params;
  const { Uye_ID, Boy, Kilo, Vucut_Kitle_Indeksi } = req.body;
  try {
    const query = 'UPDATE public."SaglikBilgileri" SET "Uye_ID" = $1, "Boy" = $2, "Kilo" = $3, "Vucut_Kitle_Indeksi" = $4 WHERE "Saglik_ID" = $5 RETURNING *';
    const result = await client.query(query, [Uye_ID, Boy, Kilo, Vucut_Kitle_Indeksi, id]);
    if (result.rows.length === 0) {
      return res.status(404).send('Sağlık bilgisi bulunamadı.');
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Sağlık bilgisi güncellenirken hata oluştu:', err.stack);
    res.status(500).send('Sağlık bilgisi güncellenirken hata oluştu: ' + err.stack);
  }
});

// Sağlık bilgisini sil
app.delete('/api/saglikbilgileri/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const query = 'DELETE FROM public."SaglikBilgileri" WHERE "Saglik_ID" = $1 RETURNING *';
    const result = await client.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).send('Sağlık bilgisi bulunamadı.');
    }
    res.json({ message: 'Sağlık bilgisi başarıyla silindi.' });
  } catch (err) {
    console.error('Sağlık bilgisi silinirken hata oluştu:', err.stack);
    res.status(500).send('Sağlık bilgisi silinirken hata oluştu: ' + err.stack);
  }
});


// Sunucu başlat
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});