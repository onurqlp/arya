const endpoint = document.getElementById("endpoint");
const secret = document.getElementById("secret");
const groups = document.getElementById("groups");
const status = document.getElementById("status");

chrome.storage.local.get(["settings"], (result) => {
  const value = result.settings || {};
  endpoint.value = value.endpoint || endpoint.value;
  secret.value = value.secret || "";
  groups.value = (value.groups || []).join("\n");
});

document.getElementById("save").addEventListener("click", () => {
  const groupNames = [...new Set(groups.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
  const origin = endpoint.value.trim().replace(/\/+$/, "");
  if (!/^https:\/\//.test(origin)) {
    status.textContent = "Arya adresi HTTPS ile başlamalı.";
    return;
  }
  if (secret.value.trim().length < 32) {
    status.textContent = "Aktarım anahtarı en az 32 karakter olmalı.";
    return;
  }
  if (!groupNames.length) {
    status.textContent = "En az bir grup adı ekle.";
    return;
  }
  chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    endpoint: origin,
    secret: secret.value.trim(),
    groups: groupNames
  }, (result) => {
    status.textContent = result?.ok ? "Ayarlar kaydedildi." : "Kaydedilemedi.";
  });
});