const form = document.getElementById("settings");
const secret = document.getElementById("secret");
const chats = document.getElementById("chats");
const status = document.getElementById("status");

chrome.runtime.sendMessage({ type: "ARYA_GET_CONFIG" }, (result) => {
  chats.value = "*";
  if (result?.configured) status.textContent = "Ajan ayarları kayıtlı.";
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const allowedChats = chats.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  chrome.runtime.sendMessage({
    type: "ARYA_SAVE_CONFIG",
    endpoint: document.getElementById("endpoint").value,
    secret: secret.value,
    allowedChats
  }, (result) => {
    status.textContent = result?.ok ? "Ayarlar kaydedildi." : "Ayarlar doğrulanamadı.";
    if (result?.ok) secret.value = "";
  });
});
