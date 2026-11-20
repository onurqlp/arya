# Arya yerel WhatsApp Web ajanı — GO1 ve GO2 hazırlığı

Bu klasör, Chrome/Edge Manifest V3 yerel eklentisini içerir. Allowlist'teki açık sohbetlerin yeni gelen metinlerini alır; yerel alarm her dakika merkezi ajan kuyruğunu kontrol eder. Kuyruk işi geldiyse doğru sohbeti arar, başlığı birebir doğrular ve tek gönderim denemesi yapar. Sohbet geçmişini başlangıçta içe aktarmaz; medya veya kişi numarası okumaz. WhatsApp Web'in resmi entegrasyon API'si değildir; DOM seçicileri değişebilir ve hesap kısıtlaması riski vardır.

## İstenen ders teyit akışı

Hedef iş akışı: sabah yalnızca eşleştirilmiş öğretmen grubuna teyit sorusu, öğretmenin açık onayı gelince aynı gruba ders saatini yazma, ders öncesi hatırlatma. Gelen mesajda öğretmen adı ve grup adı ders çizelgesiyle eşleşmezse, yanıt açık değilse veya saat çelişiyorsa insan kontrolü gerekir. Her gönderim önce hedef grup başlığıyla dry-run'da gösterilmeli. Tek bir ortak outbox kullanılmalı; gönderim sonucu belirsizse aynı işi otomatik tekrar göndermemeli.

**Demo çizelgesi bu akış için kaynak değildir:** üretim commit'indeki Ders Programı, Görev Kuyruğu ve ajan API'si GO3 demo/simülasyon olarak yazılmıştır. GO1 dalındaki `/#whatsapp-web-dersleri` elle tanımlanan haftalık eşlemeleri ayrı koordinatör veritabanında tutar.

GO2 akışı etkinleştirildiğinde yerel dakikalık alarmı 09.00 teyitini, 12.00 yanıtsızlık eskalasyonunu, açık onay sonrası grup duyurusunu ve teyit edilmiş ders için ders öncesi hatırlatmayı tek outbox'a koyar. `classifyLocalTeacherReply` grup başlığı ve görünen öğretmen adı eşleşmeden kabul etmez; yalnızca tam `ok`, `tamam`, `evet` (son noktalama işaretleri olabilir) açık teyittir. Diğer yanıtlar ARYA ONAY'a kodlu inceleme olur. Yanıt `#KOD metin` biçiminde geldiğinde açık incelemeye bağlanır.

Outbox aynı anda tek işi lease eder. Lease süresi dolan veya sonucu belirsiz iş `uncertain` olur ve yeniden gönderilmez; yönetici WhatsApp Web'de kontrol edip elle uzlaştırır. Kuru çalışma alıcı başlığını ve mesajı gösterir. Canlı kapı varsayılan kapalıdır; Web taşıma yapılandırması, etkin eşlemelerin ve ARYA ONAY'ın sunucu allowlist'inde olması ve yöneticinin açık alıcı/taslak doğrulaması olmadan açılmaz. Eklenti bu çalışma oturumunda tarayıcıya kurulmadı.

## Sunucu yapılandırması

Bu dal GitHub'a gönderildi ve Vercel Preview deployment'ı `READY` oldu: `https://arya-whatsapp-panel-4r6n9olwt-onurqlp-7179.vercel.app/` (deployment `dpl_BBGrf4ub3jHXpZuvnfPt1Ed28jgh`, commit `5706cc46c8c46fe32668ec79129d3b439caf91eb`). Üretim alias'ı ve production ayarları değiştirilmedi; canlı proje eski Meta transport kodunda kalıyor. Bu dala özel Preview ortam değişkenleri tanımlı değil, bu yüzden Preview canlı ajan olarak yapılandırılmış değildir. Üretime geçilecek deployment'ta `ARYA_WHATSAPP_TRANSPORT=web` ve koordinatör DB için `DERS_COORDINATOR_ENABLED=true` yapılandırılmalıdır. Aşağıdaki alım ayarları da gereklidir:

- `ARYA_LOCAL_WHATSAPP_ENABLED=true`
- `ARYA_LOCAL_WHATSAPP_INGEST_SECRET`: en az 32 karakterlik rastgele değer
- `ARYA_LOCAL_WHATSAPP_ALLOWED_CHATS`: sohbet adlarından oluşan JSON dizisi; ör. `["Grup adı"]`

Gönderim için ayrıca bu PC'deki yerel ajan son iki dakika içinde WhatsApp Web sekmesi gördüğünü bildirmeli; ayrı koordinatör DB'de panelden kaydedilmiş onay grubu ve etkin ders eşlemeleri sunucu allowlist'iyle aynı olmalıdır. Panelin canlı kapısı bunları ve yönetici tarafından girilen alıcı/kuru çalışma doğrulama ifadesini kontrol eder. Save/pause/grup adı değişimi canlı ayarını tekrar kapatır.

Bu ayarlar henüz Vercel'e eklenmedi. Varsayılan durumda alım endpoint'i kapalıdır. Anahtar değerleri Git'e veya sohbete eklenmemelidir.

## Yerel eklenti kurulumu

1. Eklenti kurulumunu yetkili tarayıcı eklenti arayüzünden yap; başka tarayıcı profiline veya WhatsApp profil deposuna erişme.
2. `options.html` ayarlarında aynı sunucu anahtarını ve sunucu allowlist'indeki sohbet adlarını gir.
3. Mevcut `web.whatsapp.com` sekmesini yenile; yeni QR oturumu başlatma.
4. Bir allowlist sohbetinde yeni gelen test mesajının panelde görünmesini doğrula. Canlı kapıyı açmadan önce tüm sohbet başlıklarını ve kuru çalışma taslaklarını tek tek gözden geçir.

## Teslimat davranışı

İleti kimliği tarayıcıda SHA-256 ile özetlenir; `arya_messages.message_id` benzersizliği yinelenen kayıtları engeller. Yerel alım kuyruğu 500 iletiyle sınırlandırılır; dolduğunda eski kayıtları sessizce silmez ve rozet uyarısı verir. Gecikmiş alım 24 saat içinde kabul edilir, gelecekte 5 dakikadan fazla olan damga reddedilir. Outbox işi idempotency anahtarıyla saklanır; teslimi belirsiz iş otomatik tekrar edilmez.
