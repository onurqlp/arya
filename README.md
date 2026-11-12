# Arya — WhatsApp Operasyon Ajanı

## Kurum Takip — 12 Kasım 2026

- Aynı sitede yöneticiye özel **Kurum Takip** sekmesi: `/#kurum-takip`.
- Ödeme, devamsızlık, ödev, grup/öğrenci özeti ve ödeme-devamsızlık kesişimi için ayrı okuma altyapısı.
- Günde üç tarama planı: Türkiye saatiyle 09.00, 14.00, 19.00; ayrıca **Şimdi tara**. Sorgular son taramayı kullanır.
- **Gerçek CRM/kurs bağlantıları henüz tanımlanmadı.** Sekme bu durumu açıkça gösterir; test verileri üretimde gösterilmez.
- Kaynak/API erişimi tamamlanınca yalnızca gerekli alanlar ayrı snapshot tablosunda tutulur; mevcut WhatsApp mesajları, onayları ve gönderim akışı değiştirilmez.
- Kurulum ve veri sözleşmesi: [docs/operations-api.md](docs/operations-api.md). Kontroller: `npm ci && npm test`.

Arya; WhatsApp konuşmalarını kaydetmek, seçilen mesajlardan özet ve yanıt taslağı üretmek ve her taslağı ekip onayına sunmak için hazırlanıyor.

## Mevcut durum

- Genel bakış, konuşmalar, analizler ve raporlar Neon'daki gerçek kayıtları gösterir. Yeni kurulumda kayıt bulunana kadar sıfır/boş durum görünür. Sayfalar yönetici oturumu gerektirir.
- Konuşmalar ekranı son 150 mesajı gösterir; rapor sayıları saklanan tüm mesajlardan hesaplanır. Sayfalar açıkken 30 saniyede bir yenilenir.
- Neon Postgres bağlantısı geldiğinde tablolar API tarafından otomatik kurulur.
- Meta webhook imzası doğrulanır; yeni mesajlar tekil Meta mesaj kimliğiyle saklanır. Yinelenen webhook mesajları yeniden eklenmez.
- Mesaj ve taslak verileri varsayılan olarak 90 gün sonra temizlenir; bu temizlik gelen webhook veya yönetici listeleme isteğinde çalışır. Denetim kayıtları 365 gün tutulur.
- OpenAI yalnızca yönetici Canlı Gelenler sayfasında mesaj seçip onay kutusunu işaretleyerek Analiz et düğmesine bastığında çağrılır. İstek OpenAI Responses API'ye store=false ile gönderilir.
- Üretilen özet ve yanıt taslağı kalıcı onay kuyruğuna düşer. Onaylama WhatsApp'a göndermez. Yönetici ayrıca Gönder'e basınca onaylı bireysel sohbet yanıtı Meta API ile iletilir.
- Grup gönderimi açılmaz; mevcut gruplara resmi API erişimi ayrıca doğrulanmalıdır.
- Otomatik mesaj analizi yoktur. Webhook yalnızca doğrulanmış gelen mesajları saklar.
- Meta'nın bu hesapta hangi sohbetleri veya grupları sağlayabildiği ayrıca teyit edilmelidir; bu kod mevcut gruplara erişim garantisi vermez.

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

Önce yalnızca DATABASE_URL, ARYA_ADMIN_PASSWORD ve ARYA_SESSION_SECRET eklenip yeniden deploy edilmelidir. Ardından Arya panelinde yönetici oturumu açılabilir. Meta bağlanmadan önce panelde hiç gerçek mesaj bulunmaz; örnek veri gösterilmez.

## Akış

1. Meta imzası doğrulanır.
2. Mesaj metni ve gerekli mesaj kimlikleri saklanır; ham webhook gövdesi saklanmaz.
3. Yönetici mesajları Canlı Gelenler bölümünde görür.
4. Yönetici seçilen aynı konuşmadaki metinleri OpenAI'ye göndermeyi açıkça onaylar.
5. Arya özet ve yanıt taslağı üretir; kayıt Yanıt Onayı kuyruğuna eklenir.
6. Ekip onaylar veya reddeder. Bu işlem mesaj göndermez.
7. Yönetici onaylı bireysel yanıt için ayrıca Gönder'e basarsa iletim denenir. Meta'nın mesajlaşma penceresi ve hesap izinleri geçerlidir. Belirsiz teslim durumunda otomatik tekrar yapılmaz.

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

## Geliştirme

Ön yüz statik HTML/JavaScript'tir. API uçları api/ altında Vercel Functions olarak çalışır. admin.js tüm yönetici ekranlarını gerçek veriden oluşturur.
