# Kurum Takip bağlantısı ve tarama

Bu sürümde aynı Arya sitesinde yönetici oturumuna açık Kurum Takip sekmesi vardır. Derin bağlantı: /#kurum-takip. CRM/kurs gerçek veri erişimi henüz sağlanmadı; boş durum sayı üretmez. Login ekranlarının Supabase Auth kullandığı doğrulandı; gerçek akademik/ödeme şemaları ve aralarındaki kimlik eşleşmesi doğrulanmadı.

## Güncelleme ve saklama

- Vercel Cron: UTC 06:00, 11:00, 16:00 = Europe/Istanbul 09:00, 14:00, 19:00.
- CRON_SECRET sunucu ortamında bulunmalı. GET /api/operations-refresh yalnızca Authorization: Bearer CRON_SECRET kabul eder.
- Yönetici Şimdi tara ile POST /api/admin/operations {"action":"refresh"} gönderebilir.
- Kaynak bağlantısı yoksa hiçbir DB veya uzak kaynak çağrısı yapılmaz.
- Kaynak yapılandırıldığında tarama yalnızca arya_operations_snapshots tablosunu oluşturur/günceller. Her kaynak için son tek snapshot tutulur; eski mesaj tablolarına, retention veya ensureSchema fonksiyonlarına dokunulmaz.
- Sorgular yeni kaynak taraması başlatmaz; son snapshot kullanılır. Başarısız son tarama veya 18 saatten eski veri güncel sonuç sayılmaz. Bu süre 19.00–09.00 arasındaki 14 saatlik gece aralığını kapsar.
- Yeni kaynak yanıtının coverage.to değeri, alındığı anda Türkiye'deki bugünün tarihi olmalı; eski kapsam yeniden alınarak güncelmiş gibi sunulmaz. Kaynak URL'si/anahtarı değişirse önceki snapshot kullanılmaz; yeni başarılı tarama gerekir.
- Mevcut kaynaklar, kimlik doğrulama ve WhatsApp gönderim akışı değiştirilmez. CRM/kurs kayıtlarına yazma yoktur.

## Kaynak bağlantıları

Sunucuda ARYA_CRM_READ_URL, ARYA_CRM_READ_TOKEN ve ARYA_COURSE_READ_URL, ARYA_COURSE_READ_TOKEN kullanılır. URL'ler yalnızca ilgili crm.aydadil.com ve kurs.aydadil.com HTTPS hostlarında olabilir. Kullanıcı/şifre/query/hash/özel port veya yönlendirme kabul edilmez. Anahtarlar yalnızca sunucuda Authorization başlığında taşınır. Kaynak GET işlemi gerçekten salt okunur olmalıdır.

Bu URL'ler var olduğu varsayılan endpoint'ler değildir. Mevcut uygulamaların geliştiricisi uyumlu salt okuma uçlarını sağlarsa aşağıdaki sözleşme kullanılır. Alternatif olarak yönetici girişinden sonra mevcut Supabase şeması doğrulanıp bu ortak sözleşmeye dönüştüren ayrı adaptör eklenebilir. Tarayıcı oturumunun açık olması Arya sunucusuna otomatik erişim vermez; oturum yenilemesi ve kalıcı sunucu erişimi ayrıca doğrulanmalıdır. Yönetici parolalarını Git'e, sorgu alanına veya sohbete koymayın.

## Version 1 JSON sözleşmesi

Her kaynak application/json döndürür; en fazla 2 MiB, her dizi en fazla 10.000 satır. complete:true, tüm kapsam sayfalarının tüketildiğini taahhüt eder. Kısmi sayfalar kabul edilmez.

Ortak: version:1, complete:true, coverage:{from:"YYYY-MM-DD",to:"YYYY-MM-DD"}, students, groups.

- students: {id,name,active:boolean,groupIds:string[]}.
- groups: {id,name,level,teacher,active:boolean}.
- CRM payments: {id,studentId,groupId,dueDate:"YYYY-MM-DD",remainingMinor:integer,currency:"TRY",status:"open"|"paid"|"cancelled"}.
- Kurs attendance: {id,studentId,groupId,date:"YYYY-MM-DD",status:"present"|"absent"|"excused"|"unrecorded"}.
- Kurs homework: {id,studentId,groupId,date:"YYYY-MM-DD",status:"done"|"missing"|"unchecked"|"submitted"}.

Tüm öğrenci/grup referansları kendi snapshot'ında bulunmalı. İki sistemdeki id'ler aynı kişiyi/grubu gösteren kanonik ID olmalı; kaynakların yerel ID'leri farklıysa adaptör açık eşleştirme tablosu kullanmalı. İsimden veya ortak aile telefonundan otomatik birleştirme yapılmaz.

remainingMinor yüzde birlik birimdir: 125000 = 1250.00 TRY. Desteklenen para birimleri TRY, EUR, USD, GBP ve CHF. İptal, indirim, iade ve kısmi ödeme hesaba katılmış kalan tutarı kaynak belirler. Farklı para birimleri toplanmaz. Diğer para birimleri için adaptör tasarımı genişletilmelidir.

CRM coverage.to snapshot'ın hesaplandığı gün; gelecekteki taksit vadeleri payments içinde bulunabilir. Akademik tarihlerin tümü açıklanan coverage aralığındadır. “Geciken”: açık, kalan>0, vade<Türkiye'de bugün. “Devamsızlık”: absent; excused/unrecorded dahil değil. “Eksik ödev”: missing; unchecked/submitted dahil değil. Kesişim öğrenci+grup kimliği ile yapılır.

## Yönetici API

- GET /api/admin/operations: gizli değer içermeyen durum, kaynak alınma/deneme zamanı, sorgu seçenekleri, tarama planı.
- POST /api/admin/operations {type,search}: izinli yönetici sorgusu; aynı kaynak kontrolü gerekir.
- İzinli type: overdue, absence, homework, group, student, overdue_absence.
- Sonuç: status, message, columns, rows, total, truncated, sources. Her sources girdisinde state, varsa retrievedAt ve coverage var. total:null eksik bağlantıda sayı hesaplanmadığı anlamına gelir. Sıfırdan farklıdır.
- Sonuçta en fazla 50 satır gösterilir; toplam ayrı korunur. Kaynakların kendileri tam olmalıdır. Öğrenci/grup tekil özeti belirsizse needs_selection döner.

## Doğrulama

npm ci && npm test. Testler gerçek kişisel veri, üretim DB veya Meta/OpenAI çağrısı kullanmaz. Test admin parolaları yalnızca test süreçlerinin belleğinde bulunur. Girişli UI, gerçek yeni API handler ile DOM testinde doğrulanır; üretim verisi bağlantısı için kaynak erişimi hâlâ zorunludur.
