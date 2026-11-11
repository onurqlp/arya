# Arya — WhatsApp Operasyon Ajanı

Arya; WhatsApp konuşmalarını güvenli biçimde kaydetmek, seçilen mesajlardan özet ve yanıt taslağı üretmek ve her taslağı ekip onayına sunmak için hazırlanıyor.

## Mevcut durum

- Ana paneldeki genel bakış, rapor ve analiz kartları örnek veridir.
- Canlı Gelenler ve Yanıt Onayı ayrı, yönetici oturumu gerektiren bölümlerdir.
- Neon Postgres bağlantısı geldiğinde tablolar API tarafından otomatik kurulur.
- Meta webhook imzası doğrulanır; yeni mesajlar tekil Meta mesaj kimliğiyle saklanır. Yinelenen webhook mesajları yeniden eklenmez.
- Mesaj ve taslak verileri varsayılan olarak 90 gün sonra temizlenir; bu temizlik gelen webhook veya yönetici listeleme isteğinde çalışır. Denetim kayıtları 365 gün tutulur.
- OpenAI yalnızca yönetici Canlı Gelenler sayfasında mesaj seçip onay kutusunu işaretleyerek Analiz et düğmesine bastığında çağrılır. İstek OpenAI Responses API'ye store=false ile gönderilir.
- Üretilen özet ve yanıt taslağı kalıcı onay kuyruğuna düşer. Onaylama WhatsApp'a göndermez.
- WhatsApp'a gönderim kodu bu sürümde yoktur ve gönderim kapalıdır.
- Otomatik mesaj analizi yoktur. Webhook yalnızca doğrulanmış gelen mesajları saklar.
- Meta'nın bu hesapta hangi sohbetleri veya grupları sağlayabildiği ayrıca teyit edilmelidir; bu kod mevcut gruplara erişim garantisi vermez.

## Kurulum

Vercel projesinin Settings → Environment Variables bölümüne aşağıdaki değerleri Production ortamında ekleyin. Gerçek değerleri GitHub'a, HTML dosyalarına veya sohbete yazmayın.

- DATABASE_URL: Vercel Marketplace üzerinden bu projeye bağlı Neon Postgres bağlantı değeri.
- ARYA_ADMIN_PASSWORD: En az 20 karakterlik, yalnızca Arya için kullanılan yönetici parolası.
- ARYA_SESSION_SECRET: En az 32 karakterlik, rastgele imza anahtarı.
- ARYA_RETENTION_DAYS: İsteğe bağlı; 30–365 arası gün, varsayılan 90.
- OPENAI_API_KEY: OpenAI API anahtarı.
- OPENAI_MODEL: Bu projede kullanılacak model adı.
- META_APP_SECRET: Meta uygulama gizli değeri; yalnızca sunucu ortamında.
- META_WEBHOOK_VERIFY_TOKEN: Senin belirleyeceğin uzun, rastgele webhook doğrulama değeri.
- META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, META_GRAPH_API_VERSION: Yalnızca ileride ayrı outbound gönderim aşaması için; bu sürüm bunları kullanmaz.

Önce yalnızca DATABASE_URL, ARYA_ADMIN_PASSWORD ve ARYA_SESSION_SECRET eklenip yeniden deploy edilmelidir. Ardından Arya panelinde Canlı Gelenler bölümünde yönetici oturumu açılabilir. API'ler eklenmeden önce sayfa örnek verileriyle çalışmaya devam eder.

## Akış

1. Meta imzası doğrulanır.
2. Mesaj metni ve gerekli mesaj kimlikleri saklanır; ham webhook gövdesi saklanmaz.
3. Yönetici mesajları Canlı Gelenler bölümünde görür.
4. Yönetici seçilen aynı konuşmadaki metinleri OpenAI'ye göndermeyi açıkça onaylar.
5. Arya özet ve yanıt taslağı üretir; kayıt Yanıt Onayı kuyruğuna eklenir.
6. Ekip onaylar veya reddeder. Bu işlem mesaj göndermez.

## Güvenlik sınırları

- Yönetici oturumu HTTP-only, production ortamında Secure ve SameSite=Strict imzalı çerez kullanır; dört saat sonra sona erer.
- Yönetici girişi aynı IP özeti için 15 dakikalık pencerede sekiz hatadan sonra geçici olarak kilitlenir. IP adresi düz metin saklanmaz.
- Yönetici API'leri oturum ve aynı-kaynak kontrolü ister.
- OpenAI veya Meta anahtarları tarayıcı koduna gönderilmez.
- Webhook, veritabanı veya yönetici oturumu hazır değilse doğrulama ve mesaj alımı açılmaz.
- Mesajlar, analizler ve onaylar gerçek kullanıcı içeriği içerebilir. Gerçek mesaj akışını açmadan önce AYDA'nın erişim ve saklama tercihlerini doğrulayın.

## Endpoint'ler

- GET /api/health: Gizli değerleri göstermeden kurulum durumunu verir.
- GET /api/admin/session: Oturum ve gerekli kurulum bayraklarını döndürür.
- POST /api/admin/login ve POST /api/admin/logout: Yönetici oturumu.
- GET /api/admin/messages: Oturumla son 150 mesaj.
- GET /api/admin/approvals?status=pending|approved|rejected: Onay kuyruğu.
- POST /api/admin/approval: Taslağı approve veya reject durumuna geçirir; göndermez.
- POST /api/agent-draft: Mesaj kimliklerini OpenAI'ye gönderip taslağı kaydeder; oturum gerekir.
- GET|POST /api/meta-webhook: Meta challenge doğrulaması ve imzalı olayların kalıcı kaydı.

## Geliştirme

Ön yüz statik HTML/JavaScript'tir. API uçları api/ altında Vercel Functions olarak çalışır. admin.js gerçek mesaj ve onay ekranlarını yönetir; ana ekrandaki mevcut örnek panellerden bağımsızdır.
