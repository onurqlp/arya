# ARYA yerel WhatsApp Web ajanı

Chrome için Manifest V3 yerel eklentisi, kullanıcı açık bıraktığı WhatsApp Web oturumunda çalışır. Meta Cloud API ve WhatsApp sohbet gelen kutusu kullanılmaz.

## Veri akışı

- Gelen sohbet geçmişi, ham mesaj metni, gönderen adı, sohbet başlığı, medya, çerez ve tarayıcı profili API'ye aktarılmaz.
- Yalnızca etkin ders eşlemesindeki öğretmen birebir sohbetinde ve teyit penceresi içinde görünen yeni yanıt yerelde incelenir. Tam `ok`, `tamam`, `evet` açık teyit sayılır.
- Panel/API'ye ders eşlemesi kimliği, SHA-256 mesaj özeti, zaman ve karar kodu gider. Bu, sohbet içeriği değildir; panel sadece programı, ajan bağlantısını ve teslimat durumunu gösterir.
- Planlanan ders mesajı ve gönderim kuyruğu koordinatör veritabanında tutulur; yerel eklenti komutu Chrome'daki WhatsApp Web gönder düğmesiyle uygular. Kuyruk tektir. Belirsiz teslimat otomatik tekrarlanmaz.

## Ders teyidi

Eşlemeler panelde elle tanımlanır; saat dilimi Europe/Istanbul'dur. Ajan 09.00'da öğretmene teyit sorusu gönderir ve 12.00'ye kadar cevap bekler. Açık teyit alınırsa gruba ders saatini yazar ve ders öncesi hatırlatmayı planlar. Farklı, çelişkili veya yanlış sohbetten gelen yanıt insan kontrolüne kalır. Öğretmenin ham mesajı panel/ARYA ONAY'a kopyalanmaz; WhatsApp Web'den kontrol edilir.

## Kurulum

1. Bu klasörü Chrome'da yerel, paketlenmemiş eklenti olarak yükle.
2. Eklenti seçeneklerinde `https://arya-whatsapp-panel.vercel.app`, Vercel'de önceden tanımlanmış HMAC anahtarı ve sohbet kapsamı `*` olsun. Anahtar git'e veya sohbete yazılmaz.
3. Vercel'de `ARYA_LOCAL_WHATSAPP_ENABLED=true`, `ARYA_WHATSAPP_TRANSPORT=web`, `ARYA_LOCAL_WHATSAPP_ALLOWED_CHATS=["*"]` ve mevcut kurulumla uyumlu en az 32 karakterli `ARYA_LOCAL_WHATSAPP_INGEST_SECRET` tanımlı olmalıdır. `INGEST` eski ortam değişkeni adıdır; bu uç nokta sohbet içeriği kabul etmez.
4. Chrome ve zaten açık WhatsApp Web oturumu açık kalsın. Eklenti güncellemesinden sonra eklentiyi yenile, WhatsApp Web sekmesini normal şekilde yenile. Çıkış yapma ve yeni QR başlatma.
5. Panelde öğretmen birebir sohbet başlığını, görünen öğretmen adını, sınıf grup başlığını, gün ve saatleri eşle. Önizleme ve alıcı başlıklarını gözden geçir. Canlı gönderim varsayılan olarak kapalıdır.

Gelen metin DOM seçicilerinde yerelde okunur. WhatsApp Web arayüzü değişirse ajan durabilir. Bu, WhatsApp'ın resmî otomasyon arayüzü değildir ve hesap kısıtlaması riski vardır.
