# ARYA — yerel WhatsApp Web ders ajanı

ARYA, bu bilgisayarda açık WhatsApp Web oturumundan çalışan yerel bir ders koordinatörüdür. Meta Cloud API kullanılmaz. Panel WhatsApp gelen kutusu değildir; ders eşlemelerini, ajan bağlantısını ve kuyruk/teslimat durumunu yönetir.

## Mesaj ve veri akışı

- Gelen WhatsApp sohbetlerinin metni, medya içeriği ve konuşma geçmişi API'ye gönderilmez; web panelinde gösterilmez veya arşivlenmez. Öğretmen yanıtı yalnızca Chrome'daki WhatsApp Web DOM'unda, ilgili dersin 09.00–12.00 teyit penceresinde yerelde sınıflandırılır.
- API'ye sınırlı bir ders sonucu gider: ders eşlemesi kimliği, mesajın tek yönlü özeti, zaman ve karar kodu. Ham mesaj, gönderen adı ve sohbet başlığı gönderilmez.
- Ders planı ve otomatik gönderim kuyruğu ortak koordinatör veritabanında tutulur. Planlanan ders mesajı, bu yerel ajana gönderim komutu olarak iletilir; WhatsApp'ta tek gönderim kuyruğuyla ve açık Chrome oturumundan gönderilir.
- Teslimatı doğrulanamayan mesaj otomatik tekrar gönderilmez. Canlı gönderim varsayılan olarak kapalıdır.

## İlk ders koordinasyonu

Panelden öğretmen birebir sohbet başlığını, öğretmen görünen adını, sınıf grubunu, haftanın gününü ve ders saatini elle eşleştir. Ajan 09.00'da öğretmene teyit sorusu gönderir ve 12.00'ye kadar bekler. Yalnız tam `ok`, `tamam` veya `evet` açık teyit sayılır. Başka cevapta insan kontrolü gerekir; mesajın metnini WhatsApp Web'den kendin görürsün. Onaydan sonra gruba ders saati duyurusu ve ders öncesi hatırlatma planlanır.

## Yerel Chrome eklentisi

- Kaynak: `local-whatsapp-agent/` (Manifest V3, sürüm 0.3.0).
- Chrome'da eklentiyi yükleyip seçeneklerde panel adresini, sunucu HMAC bağlantı anahtarını ve sohbet kapsamı olarak `*` değerini ayarla. Sunucu allowlist'inde de `*` olmalıdır.
- Chrome ve WhatsApp Web açık kalmalıdır. Eklenti güncellemesinde eklentiyi yenile ve WhatsApp Web sekmesini normal şekilde yenile; mevcut WhatsApp oturumundan çıkış yapma veya yeni QR oturumu başlatma.
- Yeni ders eşlemelerini varsayılan kapalı kaydet. Önizleme ve doğru WhatsApp başlıklarını kontrol etmeden canlı gönderimi açma.

## Vercel ayarları

Gerekli ortam değişkenleri: `DATABASE_URL`, `ARYA_ADMIN_PASSWORD`, `ARYA_SESSION_SECRET`, `ARYA_WHATSAPP_TRANSPORT=web`, `ARYA_LOCAL_WHATSAPP_ENABLED=true`, `ARYA_LOCAL_WHATSAPP_ALLOWED_CHATS=["*"]` ve en az 32 karakterli `ARYA_LOCAL_WHATSAPP_INGEST_SECRET`. Son değişken mevcut kurulumdan geriye uyumlu HMAC adı taşır; içerik aktarımını açmaz. `OPENAI_API_KEY` ve `OPENAI_MODEL` yalnız paneldeki AI destekli diğer Arya özellikleri için kullanılır.

Meta webhook, abonelik, gelen kutusu, konuşma özeti ve sohbet yanıtı API dosyaları bu sürümden kaldırılmıştır. ARYA Vercel'de kalmış `META_*` değerleri artık bu kod tarafından kullanılmaz; Meta uygulamasını veya Business hesabı varlıklarını ayrıca silmez.

## Kurulum / doğrulama

Vercel'de ARYA mesaj DB'si ve ayrı ders koordinatör DB'si gerekir. Ders veritabanının sahibi `db/migrations/001_local_whatsapp_agent.sql` dosyasını `DERS_COORD_DATABASE_URL`'in işaret ettiği ARYA koordinatör DB'sinde bir kez uygular; çalışma rolüne tablolar için gereken grant'ler bu migration'da verilir. Runtime health kontrolü artık tablo oluşturmaz/değiştirmez. `42501` izin hatasında doğru koordinatör DB'sinde sahip migration'ının ve çalışma rolü grant'lerinin uygulandığını kontrol et. Panelde **Sistem Durumu** ve **ARYA Yerel Ajanı** sayfaları bağlantı ve kuyruk durumunu gösterir.

`api/health.js` mesaj gelen kutusunun kapalı, Meta taşımasının kullanılmadığını ve yerel Web ajanı kurulum bayraklarını gizli değerleri göstermeden raporlar.

## Güvenlik ve sınırlar

WhatsApp Web'in DOM üzerinden otomasyonu WhatsApp'ın resmî entegrasyon API'si değildir. Arayüz değişiklikleri eklentiyi bozabilir ve platform kurallarına göre hesap kısıtlaması riski doğurabilir. Hesap oturumunu açık tut, erişimi yalnız bu yerel Chrome eklentisine ver ve belirsiz teslimatları WhatsApp'tan elle kontrol et.
