# Arya — WhatsApp Operasyon Ajanı

Arya; AYDA çalışma gruplarındaki konuşmaları anlamlandırmak, özetlemek, karar ve takip maddelerini çıkarmak ve belirsiz/hassas konuları insan onayına taşımak için tasarlanan bir ajandır.

## Şu anki sürüm

Bu repo şu anda yalnızca **statik arayüz prototipidir**. Ekrandaki grup adları, sayılar, mesajlar ve raporlar örnek veridir. WhatsApp, Meta Cloud API, OpenAI veya kalıcı veritabanı bağlantısı yoktur. Eylem düğmeleri yalnızca tarayıcıdaki demo görünümünü değiştirir; WhatsApp mesajı göndermez.

## Güvenlik

- OpenAI veya Meta secret/token değerlerini `.html`, `.js`, GitHub ya da tarayıcıya koymayın.
- Gerçek bağlantı sunucu tarafı fonksiyonlar üzerinden yapılmalıdır.
- Gizli değerler barındırma sağlayıcısının Environment Variables bölümünde saklanmalıdır.
- İlk canlı denemede ajan sadece özet ve yanıt taslağı üretmeli; insan onayı olmadan gönderim yapmamalıdır.
- Webhook imzası doğrulanmalı; tekrar gelen olaylar ayıklanmalı ve hassas kayıtlar için saklama/silme kuralı belirlenmelidir.

## Canlı sisteme geçiş için sıradaki işler

1. Server-side API katmanı ve güvenli ortam değişkenleri.
2. Meta webhook doğrulaması, mesaj alımı ve olay kuyruğu.
3. OpenAI ajan akışı: özet, karar/görev çıkarımı, belirsizlik puanı, yanıt taslağı.
4. İnsan onay kuyruğu ve denetim kaydı.
5. İzinli test numarası/grubunda doğrulama; gerçek gruplara erişimin Meta tarafındaki uygunluğunu ayrıca teyit etme.
6. Kontrollü yayın; otomatik gönderimi ayrı ve kapalı bir ayar olarak tutma.

## Geliştirme

Bu prototipte derleme adımı veya bağımlılık kurulumu yoktur. `index.html` dosyasını doğrudan açabilir ya da statik site olarak yayınlayabilirsiniz.
