const KEY = "ss-mix-2025-xor-key";
const DEV_ID_OBF = "IApBGwwKGgo=";
const DEV_PW_OBF = "SzRGVDNJZl5RCgA=";

function deobf(b64) {
  const data = atob(b64);
  let out = "";
  for (let i = 0; i < data.length; i++) {
    out += String.fromCharCode(data.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
  }
  return out;
}

export const devCreds = () => ({
  devid: deobf(DEV_ID_OBF),
  devpassword: deobf(DEV_PW_OBF),
});
