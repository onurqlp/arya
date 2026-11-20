# ARYA WhatsApp Web — GO 1 durumu / GO 2 başlangıç

**Tarih:** 20 Kasım 2026 (Europe/Istanbul)
**Repo:** `C:\Users\Pc\Desktop\CHAT GPT\ARYA`
**Dal:** `codex/arya-whatsapp-web-agent-go1-20261120`
**Başlangıç commit'i:** `95310ec3f262e4ca63495416a91a9292c6b13ed3`

## GO 1 — yerel köprü/ajan kodu hazır; PC kurulumu doğrulanmadı

- Chrome/Edge MV3 yerel eklenti kaynakları `local-whatsapp-agent/` altında. Allowlist'teki açık sohbetlerde yalnızca yeni gelen metinleri alır; ilk yüklemede geçmişi içe aktarmaz.
- Alım, zaman damgalı HMAC isteğiyle `/api/local-whatsapp-ingest` uç noktasına gider. Sunucu bayrağı, 32+ karakter anahtar, sunucu allowlist'i, grup eşleşmesi, zaman penceresi ve mesaj kimliği biçimi doğrulanır; veritabanı benzersizliği tekrar kayıtları engeller.
- Yeni kodda transport varsayılanı `web`; Meta yalnızca `ARYA_WHATSAPP_TRANSPORT=meta` açıkça ayarlanırsa seçilir. Web modunda Meta webhook/abonelik 404 verir ve gönderim uçları reddedilir. Canlı Vercel ortam değerleri ve deployment değiştirilmedi.
- Yerel `api/local-whatsapp-agent` ucu HMAC imzalı pull/ack alır. İzole koordinatör DB'deki tek outbox tek işi lease eder; lease zaman aşımı `uncertain` yapar ve iş tekrar kuyruğa dönmez. Admin paneli belirsiz/engelli işleri WhatsApp Web'de elle kontrol ederek uzlaştırır.
- Eklenti yeni gelenleri idempotent alır, dakikada bir gönderim işini kontrol eder, hedef sohbeti arayıp tam başlığı doğrular ve tek tıklama denemesi yapar. Eksik/yanlış hedef gönderimi durdurur. Alım kuyruğu kapasite aşımında eski mesajı sessizce silmez.
- Yönetici panelinde ayrı koordinatör veritabanını kullanan elle ders eşleme ekranı eklendi. İlk kayıtlar devre dışı; ajan varsayılan olarak duraklatılmış, kuru çalışma açık ve gönderim kapalı.
- Gerçek WhatsApp oturumuna eklenti kurulumu doğrulanamadı. Önceki tarayıcı kontrolünde uzantı yönetim sayfasına erişim denetimi engel oldu; farklı bir yöntemle bu engel aşılmadı. Kullanıcı oturumu/QR akışına dokunulmadı.

## GO 2 — ders teyidi ve yönlendirme iş akışı

- Seçilen tarih için alıcı başlığı, saat, metin ve koşul gösteren kuru çalışma paneli vardır.
- Etkin gönderim kapısı altında yerel dakikalık alarm 09.00 teyitini; 12.00 yanıtsızlık eskalasyonunu; açık teyit sonrası grup saat duyurusunu; teyitli dersin öncesi hatırlatmasını idempotent outbox'a koyar.
- Sınıflandırıcı grup ve görünen öğretmen adı çizelgeyle eşleştiğinde yalnızca tam `ok`, `tamam`, `evet` yanıtını kabul eder. Diğer yanıtlar, `#KOD metin` ile ARYA ONAY grubuna inceleme kuyruğuna bağlanır.
- Sunucu transport/allowlist ayarları yok, schedule yok, paused/dry-run varsayılanı açık. Böylece kuyruk işi çekilmez ve mesaj gönderilmez. Eklenti PC'ye kurulmadı; otomatik akış canlıda denenmedi.

## Doğrulama ve canlı sınır

- `node --check` ile değişen JavaScript dosyalarının sözdizimi, `git diff --check` ile yama biçimi kontrol edildi. Proje test paketi çalıştırılmadı.
- Dal `5706cc46c8c46fe32668ec79129d3b439caf91eb` commit'iyle GitHub'a gönderildi; Vercel otomatik Preview deployment'ı `READY`: `https://arya-whatsapp-panel-4r6n9olwt-onurqlp-7179.vercel.app/` (`dpl_BBGrf4ub3jHXpZuvnfPt1Ed28jgh`). Bu dal için Preview ortam değişkeni yok; Preview ajan bağlantısı çalışır durumda sayılmaz.
- Üretime dağıtım yapılmadı; production Vercel/Neon/Meta ortam ayarları değiştirilmedi. Dış kullanıcıya veya WhatsApp grubuna mesaj gönderilmedi.
- Bu çalışma klasöründe kullanıcı tarafından anılan MASTER MD ve GO1/GO3 durum raporları bulunamadı; yalnızca GO0 raporu ve başlatma TXT'si mevcut. Bu rapor eksik belgeyi varmış gibi varsaymaz.

## Kalan canlıya geçiş kapıları

1. Tarayıcı eklentisini bu PC'deki mevcut WhatsApp Web oturumuna kurup bağlantıyı onayla; oturumu kapatma/QR başlatma.
2. Panelde gerçek öğretmen/grup/hafta/saat eşlemelerini gir; alıcı başlıklarını açık WhatsApp Web'de karşılaştır.
3. Web transport, HMAC sırrı, server allowlist'i ve ayrı koordinatör DB ayarlarını Vercel'de yapılandır; Meta anahtarlarını sökmeden önce yeni Web hattını doğrula.
4. Yerel ajanı bağla; panelin son iki dakikada WhatsApp Web sekmesi gördüğünü doğrula. Kuru çalışma mesajlarını ve ARYA ONAY'ın tam grup başlığını incele. Canlı kapı yalnızca yönetici açık doğrulama yazarsa açılır.
5. İlk canlı alıcı/mesaj eyleminden önce açık WhatsApp Web'de mesajın hedefini ve metnini son kez doğrula. Bu oturumda gerçek mesaj gönderilmedi ve üretime dağıtım yapılmadı.
