# Arya — WhatsApp Operasyon Ajanı

## Kurum Takip — 12 Kasım 2026

- Aynı sitede yöneticiye özel **Kurum Takip** sekmesi: `/#kurum-takip`.
- Ödeme, devamsızlık, ödev, grup/öğrenci özeti ve ödeme-devamsızlık kesişimi için ayrı okuma altyapısı.
- Günde üç tarama planı: Türkiye saatiyle 09.00, 14.00, 19.00; ayrıca **Şimdi tara**. Sorgular son taramayı kullanır.
- **Gerçek CRM/kurs bağlantıları henüz tanımlanmadı.** Sekme bu durumu açıkça gösterir; test verileri üretimde gösterilmez.
- Kaynak/API erişimi tamamlanınca yalnızca gerekli alanlar ayrı snapshot tablosunda tutulur; mevcut WhatsApp mesajları, onayları ve gönderim akışı değiştirilmez.
- Kurulum ve veri sözleşmesi: [docs/operations-api.md](docs/operations-api.md). Kontroller: `npm ci && npm test`.

Arya; bireysel WhatsApp mesajlarını kaydeder, Asya'nın güncel yanıt modeli ve bilgi tabanının bir anlık görüntüsüyle yanıt taslağı hazırlar ve müşteriye göndermeden önce iki işletme sahibine özel mesajla onaylatır.

## Mevcut durum

- Genel bakış, konuşmalar, analizler ve raporlar Neon'daki gerçek kayıtları gösterir. Yeni kurulumda kayıt bulunana kadar sıfır/boş durum görünür. Sayfalar yönetici oturumu gerektirir.
- Konuşmalar ekranı son 150 mesajı gösterir; rapor sayıları saklanan tüm mesajlardan hesaplanır. Sayfalar açıkken 30 saniyede bir yenilenir.
- Neon Postgres bağlantısı geldiğinde tablolar API tarafından otomatik kurulur.
- Meta webhook imzası doğrulanır; yeni mesajlar tekil Meta mesaj kimliğiyle saklanır. Yinelenen webhook mesajları yeniden eklenmez.
- Mesaj ve taslak verileri varsayılan olarak 90 gün sonra temizlenir; bu temizlik gelen webhook veya yönetici listeleme isteğinde çalışır. Denetim kayıtları 365 gün tutulur.
- Yeni bireysel müşteri mesajı geldiğinde webhook kaydı yapar, son 10 mesajı OpenAI Responses API'ye `store=false` ile gönderip Asya tarzında özet ve yanıt taslağı oluşturur.
- Taslak müşteriye otomatik gönderilmez. Ayarlanmış sahip numaralarına özel WhatsApp onayı gider; `TASLAK KOD` taslağı gösterir, `ONAY KOD` gönderir, `RED KOD` reddeder, `DURUM` bekleyenleri listeler.
- Sahibin WhatsApp mesajları müşteri konuşma kayıtlarına karışmaz. Onay yalnızca izin listesindeki iki numaradan kabul edilir; ilk geçerli onay/ret işlemi kazanır.
- Müşteriye yanıt, müşterinin son mesajından sonraki 24 saat içinde gönderilir. Süre dolmuşsa Arya göndermeyi durdurur; müşteri yeniden yazınca onay komutu tekrar kullanılabilir.
- Sahiplerden son 24 saatte işletme numarasına mesaj gelmemişse bildirim göndermek için Meta tarafından onaylanmış bir WhatsApp şablonu gerekir. Vercel sağlık ekranı yalnızca şablon adının girilip girilmediğini kontrol eder; Meta'daki onay durumunu doğrulamaz. Şablon yoksa bildirim gönderilmez; taslak panelde onay kuyruğunda kalır.
- Grup API'si mevcut WhatsApp gruplarına katılma veya okuma yolu değildir; bu akış bireysel sohbetlerle çalışır.

## Kurulum

Vercel projesinin Settings → Environment Variables bölümüne aşağıdaki değerleri Production ortamında ekleyin. Gerçek değerleri GitHub'a, HTML dosyalarına veya sohbete yazmayın.

- DATABASE_URL: Vercel Marketplace üzerinden bu projeye bağlı Neon Postgres bağlantı değeri.
- ARYA_ADMIN_PASSWORD: En az 3 karakterlik yönetici parolası. İnternete açık yönetici paneli için uzun ve rastgele bir parola kullanılması kuvvetle önerilir.
- ARYA_SESSION_SECRET: En az 32 karakterlik rastgele imza anahtarı. Üç karaktere indirilmemelidir; oturum çerezlerinin güvenliği buna bağlıdır.
- ARYA_RETENTION_DAYS: İsteğe bağlı; 30–365 arası gün, varsayılan 90.
- OPENAI_API_KEY: OpenAI API anahtarı.
- OPENAI_MODEL: Bu projede kullanılacak model adı.
- META_APP_SECRET: Meta uygulama gizli değeri; yalnızca sunucu ortamında.
- META_WEBHOOK_VERIFY_TOKEN: Senin belirleyeceğin uzun, rastgele webhook doğrulama değeri.
- META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, META_GRAPH_API_VERSION: Onaylı bireysel yanıtları iletmek için. Sürüm örneğin v23.0 biçiminde olmalıdır.
- ARYA_OWNER_WA_IDS: Sen ve Esra'nın WhatsApp numaraları, ülke koduyla ve yalnız rakamla; virgülle ayrılmış. Bunlar özel onay alıcıları ve izin listesidir.
- ARYA_OWNER_NOTIFICATION_TEMPLATE: Meta'da onaylanmış bildirim şablonu adı. İşletme numarasına son 24 saatte yazmamış sahibine bildirim için gerekir.
- ARYA_OWNER_NOTIFICATION_LANG: Şablon dili, varsayılan `tr`.

İlk uçtan uca testten önce `ARYA_OWNER_WA_IDS` değerini kaydedip Production'ı deploy edin. Sonra iki sahip de işletme WhatsApp numarasına özelden bir mesaj göndersin; bu, her sahip için 24 saatlik yanıt penceresini açar ve sahip mesajları müşteri kuyruğuna girmez. Bu pencere dışında bildirim göndermek için Meta'da onaylı şablon gerekir.

Önerilen Meta şablonu: `arya_owner_review_request`, Türkçe. Gövde metni: `Yeni müşteri mesajı: {{1}}. Taslak kodu: {{2}}. Görmek için TASLAK {{2}}, göndermek için ONAY {{2}}, reddetmek için RED {{2}} yazın.` Meta'nın istediği örnek değişken değerlerini sağlayıp şablon onayını bekleyin.

Önce yalnızca DATABASE_URL, ARYA_ADMIN_PASSWORD ve ARYA_SESSION_SECRET eklenip yeniden deploy edilmelidir. Ardından Arya panelinde yönetici oturumu açılabilir. Meta bağlanmadan önce panelde hiç gerçek mesaj bulunmaz; örnek veri gösterilmez.

## Akış

1. Meta imzası doğrulanır.
2. Mesaj metni ve gerekli mesaj kimlikleri saklanır; ham webhook gövdesi saklanmaz.
3. Yönetici mesajları Canlı Gelenler bölümünde görür.
4. İzin listesindeki sahip mesajıysa müşteri kuyruğuna eklenmez; `DURUM`, `TASLAK`, `ONAY` veya `RED` komutu işlenir.
5. Yeni bireysel müşteri mesajı Asya bilgi tabanı ve model ayarlarıyla incelenir; sonuç onay kuyruğuna eklenir ve sahiplerine bildirilir.
6. `TASLAK KOD` önerilen yanıtı gösterir. `ONAY KOD` yalnızca onaylı taslağı müşteriye gönderir; `RED KOD` reddeder. Onay tek başına başka hiçbir eylemi tetiklemez.
7. Mesaj gönderimi Meta'nın 24 saatlik müşteri hizmeti penceresi içinde yapılır. Belirsiz teslim durumunda otomatik tekrar yapılmaz.

## Güvenlik sınırları

- Yönetici oturumu HTTP-only, production ortamında Secure ve SameSite=Strict imzalı çerez kullanır; dört saat sonra sona erer.
- Yönetici girişi aynı IP özeti veya tüm girişlerde 15 dakikalık pencerede sekiz hatadan sonra geçici olarak kilitlenir. Kısa parola seçimi bu sınırlamaya rağmen tahmin riski yaratır; uzun parola kullanın. IP adresi düz metin saklanmaz.
- Yönetici API'leri oturum ve aynı-kaynak kontrolü ister.
- OpenAI veya Meta anahtarları tarayıcı koduna gönderilmez.
- Webhook, veritabanı veya yönetici oturumu hazır değilse doğrulama ve mesaj alımı açılmaz.
- Mesajlar, analizler ve onaylar gerçek kullanıcı içeriği içerebilir. Gerçek mesaj akışını açmadan önce AYDA'nın erişim ve saklama tercihlerini doğrulayın.

## Endpoint'ler

- GET /api/health: Gizli değerleri göstermeden kurulum durumunu verir.
- GET /api/admin/session: Oturum ve gerekli kurulum bayraklarını döndürür.
- POST /api/admin/login ve POST /api/admin/logout: Yönetici oturumu.
- GET /api/admin/messages: Oturumla son 150 mesaj.
- GET /api/admin/summary: Gerçek mesaj ve onay sayıları, son yedi gün dağılımı ve son 150 mesaj.
- GET /api/admin/approvals?status=pending|approved|sent|sending|rejected: Onay kuyruğu.
- POST /api/admin/approval: Taslağı approve veya reject durumuna geçirir; göndermez.
- POST /api/admin/send: Onaylı bireysel sohbet yanıtını ayrı yönetici eylemiyle gönderir.
- POST /api/agent-draft: Mesaj kimliklerini OpenAI'ye gönderip taslağı kaydeder; oturum gerekir.
- GET|POST /api/meta-webhook: Meta challenge doğrulaması ve imzalı olayların kalıcı kaydı.

## Sahiplerin WhatsApp komutları

- `DURUM`: Onay bekleyen kodları listeler.
- `TASLAK 1234ABCD`: Özet ve müşteriye önerilen yanıtı gösterir.
- `ONAY 1234ABCD`: Onaylar ve 24 saatlik müşteri yanıt penceresi açıksa gönderir.
- `RED 1234ABCD`: Taslağı reddeder; müşteriye mesaj göndermez.
- `YARDIM`: Komutları gösterir.

## Geliştirme

Ön yüz statik HTML/JavaScript'tir. API uçları api/ altında Vercel Functions olarak çalışır. admin.js tüm yönetici ekranlarını gerçek veriden oluşturur.
