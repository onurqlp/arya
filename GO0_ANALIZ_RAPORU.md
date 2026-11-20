# ARYA WhatsApp Web — GO 0 ortam doğrulaması

**Tarih:** 20 Kasım 2026 (Europe/Istanbul)
**Kapsam:** Yalnızca ARYA. ASYA deposu, verisi, hesabı veya ayarları değiştirilmedi.

## Doğrulanan canlı kaynak

- **Yerel proje:** `C:\Users\Pc\Desktop\CHAT GPT\ARYA`
- **GitHub:** `onurqlp/arya` (public depo; varsayılan dal `main`)
- **Canlı üretim dalı/commit:** `codex/arya-ders-coordinator-go3-20261120` / `95310ec3f262e4ca63495416a91a9292c6b13ed3`
- **Çalışma dalı:** `codex/arya-whatsapp-web-agent-go1-20261120`, aynı üretim commit’inden yerelde açıldı. GO1 düzenlemeleri bu dalda yapılacak.
- **Eski kopya:** `C:\Users\Pc\Downloads\arya-main.zip`, 12 Kasım tarihli; canlı kaynak değil. İçindeki eski grup izleyici, Meta üzerinden bildirim gönderme yolu da taşıyor. Yeni mimariye doğrudan alınmamalı.

## Vercel ve Neon

- **Vercel projesi:** `arya-whatsapp-panel` (`prj_BKejpZmbgZ5kQPYA4Q4xX9UkgBIy`)
- **Üretim alan adı:** [arya-whatsapp-panel.vercel.app](https://arya-whatsapp-panel.vercel.app)
- **Doğrulanan üretim deployment’ı:** `dpl_JEJpQ3NuVCUHwHvUf18R8qzdRQLp`, `READY`; dal ve commit yukarıdaki üretim kaynağıyla eşleşiyor. Üretim kök sayfası HTTP 200 verdi.
- **Canlı `/api/health`:** veritabanı, yönetici oturumu ve OpenAI yapılandırılmış; `databaseReady` ve `adminReady` true. Meta aboneliği `401`, hata kodu `190` ve “Application has been deleted” durumunda. Buna rağmen mevcut sağlık yanıtı `outboundSending: true` raporluyor; Meta yolu değiştirilmeden önce bu durum güvenli biçimde kapatılmalı.
- **Neon ARYA projesi:** `arya` (`wispy-math-91879743`), varsayılan dal `main` (`br-curly-butterfly-bcq9m5on`). Canlı sağlık denetimi DB bağlantısını doğruladı; tablo satırları okunmadı.
- Vercel’de `DATABASE_URL` bağlantı ailesi ve ayrı ders koordinatörü için `DERS_COORD_DATABASE_URL` tanımı var. Kaynak kodu koordinatör DB’sinin konuşma DB’sinden ayrı olmasını denetliyor. Gizli değerler raporlanmadı.

## Ajan ve Meta envanteri

- Ayrı bir ARYA yerel ajan işlemi/kurulumu bulunmadı. Codex PC uygulaması çalışıyor: `C:\Users\Pc\AppData\Local\OpenAI\Codex\bin\89cd6612adc9c8d8\codex.exe`.
- Mevcut `api/lesson-agent.js` yalnızca `VERCEL_ENV !== "production"` iken açılıyor; üretimde 404 döndürüyor. Preview ortamındaki `DERS_AGENT_TOKEN` test istemcisi içindir; canlı WhatsApp Web ajanı değildir.
- Üretim dalında `local-group-watcher` eklentisi ve `api/local-group-ingest.js` bulunmuyor. İkisi yalnızca eski ZIP içinde görüldü. Eski alım kodu opsiyonel olarak Meta API bildirimleri de gönderebiliyor; aynen etkinleştirilmemeli.
- Meta bağımlılıklarının kod izleri: `api/meta-webhook.js`, `api/meta-subscription.js`, `lib/meta-subscription.js`, `api/admin/send.js`, `lib/manual-reply.js`; ayrıca `api/health.js`, `api/admin/status.js`, `api/admin/session.js` ve `admin.js` içinde yapılandırma/durum referansları var. Üretim ortamında Meta ile ilgili env adları mevcut; hiçbir değer rapora alınmadı. Meta kodu/ayarları henüz kaldırılmadı.
- **Mevcut WhatsApp Web:** WhatsApp Web başlıklı Firefox penceresi ve Chrome `aydadil.com` profilinde `web.whatsapp.com` sekmesi açık. Mesajlar veya oturum depoları incelenmedi; oturum kapatılmadı, sıfırlanmadı ve QR akışı başlatılmadı.
- Chrome ve Edge tarayıcı bağlantıları çalışıyor. Kurulu eklentilerin tam ad/sürüm listesi, mevcut tarayıcı denetiminde görünür değildi; isim/sürüm tahmini yapılmadı. ARYA’ya ait eklenti kurulumu doğrulanmadı.

## GO 1 için başlangıç durumu

1. Kod, doğrulanmış üretim commit’inden ayrı yerel dalda açıldı; üretim sitesi veya Vercel ayarları değiştirilmedi.
2. İlk canlı değişiklikten önce tek yerel WhatsApp Web oturumu, tek gönderim kuyruğu, idempotency ve belirsiz teslimatta otomatik tekrar yok kuralları yeni uygulamada sağlanmalı.
3. Mevcut Meta gönderim uçları yeni Web kuyruğuyla aynı anda kullanılmamalı. Meta kaldırma/etkisizleştirme, Web alım ve manuel onaylı taslak akışı doğrulanana kadar ertelenmeli.
4. Ajan kurulumu veya WhatsApp’a erişim sağlayan bir eklenti henüz yapılmadı. Gerçek alıcıya mesaj gönderilmedi.
