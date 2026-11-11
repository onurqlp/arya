# Arya — WhatsApp Operasyon Ajanı

Arya; AYDA WhatsApp çalışma alanındaki konuşmaları anlamlandırmak, özetlemek, karar ve takip maddelerini çıkarmak ve belirsiz/hassas konuları insan onayına taşımak için tasarlanıyor.

## Şu anki durum

- Panel yayında; grup isimleri, mesajlar, sayılar ve raporlar **örnek veridir**.
- `api/health` yalnızca sunucu ortam değişkenlerinin var/yok durumunu bildirir; hiçbir gizli değeri döndürmez.
- `api/meta-webhook` Meta'nın GET doğrulama isteğini ve POST imza denetimini hazırlar.
- Webhook POST isteği imza doğrulansa bile şimdilik **503 döndürür**. Böylece olay kalıcı olarak kaydedilmeden Meta'ya “işledim” denmez; gerçek mesaj işleme henüz etkin değildir.
- OpenAI çağrısı, mesaj saklama, ekip girişi/onayı ve WhatsApp'a gönderim **henüz uygulanmadı**.
- Var olan WhatsApp gruplarına erişim doğrulanmadan bu gruplar bağlanmış gibi gösterilmeyecek. Meta'da WhatsApp Cloud API ve gruplar için mevcut yetki/kapsam ayrıca teyit edilmelidir.

## API uç noktaları

### `GET /api/health`

Kurulum durumunu güvenli biçimde gösterir. Anahtarların değerlerini veya kısmi içeriklerini döndürmez.

### `GET /api/meta-webhook`

Meta webhook doğrulama isteğinde `hub.mode=subscribe`, `hub.verify_token` ve `hub.challenge` parametrelerini kontrol eder. Doğru doğrulama token'ı varsa challenge'ı geri verir.

### `POST /api/meta-webhook`

İstek gövdesini sınırlı boyutta okur ve `x-hub-signature-256` imzasını `META_APP_SECRET` ile denetler. İmzalı bir WhatsApp olayı henüz kuyruğa alınmadığı ve onay akışına bağlanmadığı için bu endpoint şimdilik olayı işlenmiş saymaz. Gerçek webhook aboneliğini etkinleştirmeden önce kalıcı kuyruk, yinelenen olay kontrolü ve hata/yeniden deneme davranışı tamamlanmalıdır.

## Gerekli sunucu ortam değişkenleri

Değerleri yalnızca Vercel projesinin **Settings → Environment Variables** bölümüne ekleyin. `.env.example` dosyası adları listeler; gerçek değer içermez.

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `META_ACCESS_TOKEN`
- `META_PHONE_NUMBER_ID`
- `META_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN`
- `META_GRAPH_API_VERSION`

Anahtarları HTML, JavaScript, GitHub deposu veya tarayıcıya koymayın. Anahtar eklendiğinde tek başına bir bağlantı oluşmaz; sunucu tarafındaki işleme akışı da tamamlanmalıdır.

## Sıradaki geliştirme adımları

1. Kalıcı veri deposu ve webhook olay kuyruğu ekle; yinelenen olayları ayıkla.
2. WhatsApp mesaj olaylarını güvenli biçimde ayrıştır ve saklama/silme süresini uygula.
3. OpenAI Responses API üzerinden yalnızca grup özeti, karar/görev çıkarımı ve yanıt taslağı üret.
4. Yönetici oturumu ve insan onay kuyruğu ekle; panel API'lerini kimlik doğrulama olmadan açık bırakma.
5. Onaylanan yanıtların WhatsApp'a gönderimini, açık bir denetim kaydı ve kapalı varsayılan gönderim ayarıyla ekle.
6. Önce test varlığıyla doğrula. Mevcut grupları okuma olanağını Meta hesabında ayrıca doğrulamadan üretim gruplarına geçme.

## Geliştirme

Arayüz `index.html` içinde statik olarak çalışır. Sunucu uç noktaları Vercel Functions olarak `api/` altında yayınlanır. Henüz herhangi bir mesajı işleyen veya gönderen işlev yoktur.
