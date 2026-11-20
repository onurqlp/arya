# Arya yerel WhatsApp Web ajanı

Bu klasör, Chrome/Edge Manifest V3 yerel eklentisini içerir. Eklenti açık WhatsApp Web sekmesinde eşlenmiş ders akışını izler; bu site bir WhatsApp gelen kutusu değildir. Gelen mesajlar eski `arya_messages` sohbet arşivine kaydedilmez veya panelde listelenmez. Yerel alarm her dakika merkezi tek gönderim kuyruğunu kontrol eder. Kuyruk işi geldiyse doğru sohbeti arar, başlığı birebir doğrular ve tek gönderim denemesi yapar. Sohbet geçmişini başlangıçta içe aktarmaz; medya veya kişi numarası okumaz. WhatsApp Web'in resmi entegrasyon API'si değildir; DOM seçicileri değişebilir ve hesap kısıtlaması riski vardır.

## İstenen ders teyit akışı

Hedef iş akışı: sabah teyit sorusu eşleştirilmiş öğretmenin birebir WhatsApp sohbetine gider; açık onay gelince ders saati sınıf grubuna yazılır ve ders öncesi hatırlatma gruba gider. Öğretmenin birebir sohbet başlığı çizelgeyle eşleşmezse, yanıt açık değilse veya saat çelişiyorsa insan kontrolü gerekir. Her gönderim önce hedef sohbet başlığıyla kuru çalışmada gösterilmeli. Tek bir ortak outbox kullanılmalı; gönderim sonucu belirsizse aynı işi otomatik tekrar göndermemeli.

**Demo çizelgesi bu akış için kaynak değildir:** ders eşlemeleri yalnızca `/#whatsapp-web-dersleri` altındaki yerel ajan panelinden elle tanımlanır; eski demo programı ajan tarafından kullanılmaz.

GO2 akışı etkinleştirildiğinde yerel dakikalık alarmı 09.00 birebir teyidini, 12.00 yanıtsızlık eskalasyonunu, açık onay sonrası grup duyurusunu ve teyit edilmiş ders için ders öncesi hatırlatmayı tek outbox'a koyar. `classifyLocalTeacherReply` öğretmenin birebir sohbet başlığını ve varsa görünen gönderen adını çizelgeyle eşleştirmeden kabul etmez; yalnızca tam `ok`, `tamam`, `evet` (son noktalama işaretleri olabilir) açık teyittir. Diğer yanıtlar ARYA ONAY'a kodlu inceleme olur. Yanıt `#KOD metin` biçiminde geldiğinde açık incelemeye bağlanır.

Outbox aynı anda tek işi lease eder. Lease süresi dolan veya sonucu belirsiz iş `uncertain` olur ve yeniden gönderilmez; yönetici WhatsApp Web'de kontrol edip elle uzlaştırır. Kuru çalışma alıcı başlığını ve mesajı gösterir. Canlı kapı varsayılan kapalıdır; Web taşıma yapılandırması, etkin eşlemelerin ve ARYA ONAY'ın sunucu allowlist'inde olması ve yöneticinin açık alıcı/taslak doğrulaması olmadan açılmaz.

## Sunucu yapılandırması

Üretim paneli `https://arya-whatsapp-panel.vercel.app/` adresindedir ve Web taşımasını kullanır. Şu an üretim health yanıtı yerel WhatsApp Web ingest ayarının tamamlanmadığını gösteriyordu; yeni site sürümü bu durumu açıkça gösterecek. Yerel köprünün açılması için üretimde aşağıdaki ayarlar gerekir:

- `ARYA_LOCAL_WHATSAPP_ENABLED=true`
- `ARYA_LOCAL_WHATSAPP_INGEST_SECRET`: en az 32 karakterlik rastgele değer
- `ARYA_LOCAL_WHATSAPP_ALLOWED_CHATS`: öğretmen birebir sohbetleri, sınıf grupları ve ARYA ONAY başlığından oluşan JSON dizisi; ör. `["Öğretmen başlığı", "Sınıf grubu", "ARYA ONAY"]`

Gönderim için ayrıca bu PC'deki yerel ajan son iki dakika içinde WhatsApp Web sekmesi gördüğünü bildirmeli; ayrı koordinatör DB'de panelden kaydedilmiş onay grubu ve etkin ders eşlemeleri sunucu allowlist'iyle aynı olmalıdır. Panelin canlı kapısı bunları ve yönetici tarafından girilen alıcı/kuru çalışma doğrulama ifadesini kontrol eder. Save/pause/grup adı değişimi canlı ayarını tekrar kapatır.

Bu ayarların hazır olduğunu doğrulamadan canlı gönderim açılmaz. Gizli değerleri Git'e veya sohbete ekleme.

## Yerel eklenti kurulumu

1. Eklenti kurulumunu yetkili tarayıcı eklenti arayüzünden yap; başka tarayıcı profiline veya WhatsApp profil deposuna erişme.
2. `options.html` ayarlarında üretim endpoint'ini, ingest anahtarını, yerel ajan kimliğini ve izin verilen sohbet başlıklarını gir.
3. Mevcut `web.whatsapp.com` sekmesini yenile; yeni QR oturumu başlatma.
4. Panelde yerel ajan çevrimiçi durumunu ve kuru çalışma taslaklarını doğrula. WhatsApp sohbet içeriği panelde gösterilmez. Canlı kapıyı açmadan önce tüm sohbet başlıklarını ve kuru çalışma taslaklarını tek tek gözden geçir.

## Teslimat davranışı

İleti kimliği tarayıcıda SHA-256 ile özetlenir; ayrı ders işleme tablosundaki benzersiz kimlik yinelenen olayları engeller. Yerel alım kuyruğu 500 olayla sınırlandırılır; dolduğunda eski olayları sessizce silmez ve rozet uyarısı verir. Gecikmiş olay 24 saat içinde kabul edilir, gelecekte 5 dakikadan fazla olan damga reddedilir. Outbox işi idempotency anahtarıyla saklanır; teslimi belirsiz iş otomatik tekrar edilmez.

## Veritabanı kurulumu

`db/migrations/001_local_whatsapp_agent.sql` bir kez Neon veritabanı sahibiyle uygulanır. Vercel uygulama rolüne yalnızca bu ajan tablolarında `SELECT/INSERT/UPDATE/DELETE` verilir; uygulama istekleri tablo oluşturmaya veya değiştirmeye çalışmaz. Bu, runtime rolünde `42501 insufficient_privilege` hatasını önler.
