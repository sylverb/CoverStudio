// .gw assembly (byte-exact to shrink_it.py).

export function assembleGw(o) {
  const enc = new TextEncoder();
  // GW_FLAGS
  let flags = 0;
  if (o.invert) flags |= 1;
  flags |= (o.flagSound << 1) & 0xE;
  if (o.segBits === 4) flags |= 0x10;
  if (o.segBits === 2) flags |= 0x100;
  if (o.bgJpeg) flags |= 0x20;
  flags |= (o.deflicker << 6) & 0xC0;

  // section list order: BGD,SGD,SGO,SGX,SGY,SGH,SGW,MLD,PGM,BTN
  const btn = new Uint8Array(10 * 4); {
    const dv = new DataView(btn.buffer);
    for (let i = 0; i < 10; i++) dv.setUint32(i * 4, (o.btnData[i] >>> 0), true);
  }
  const sections = [o.sectionBgd, o.sectionSgd, o.sgo, o.sgx, o.sgy, o.sgh, o.sgw, o.melody, o.program, btn]
    .map((s) => s || new Uint8Array(0));

  // header: 8+8+7+1+4 = 28 bytes, then 10*(off,size)=80 → data starts at 108
  const HEADER = 28 + 80;
  // compute offsets with 4-byte alignment
  const offs = new Array(10), sizes = new Array(10);
  let off = HEADER;
  for (let i = 0; i < 10; i++) { offs[i] = off; sizes[i] = sections[i].length; off += sizes[i]; if (off % 4) off += 4 - (off % 4); }
  const total = off;

  const out = new Uint8Array(total); const dv = new DataView(out.buffer);
  let p = 0;
  // CPU_TYPE (8 bytes incl trailing \0): cpuType is 7 chars + null
  const cpu = enc.encode(o.cpuType); for (let i = 0; i < 7; i++) out[p + i] = cpu[i] || 0; out[p + 7] = 0; p += 8;
  // ROM signature: rom_name right-justified to 8, last 8 chars
  let sig = o.romName; sig = sig.length < 8 ? ' '.repeat(8 - sig.length) + sig : sig.slice(-8);
  const sigB = enc.encode(sig); for (let i = 0; i < 8; i++) out[p + i] = sigB[i] || 0x20; p += 8;
  // RTC (7 bytes)
  out[p++] = o.rtc.ADD_TIME_HOUR_MSB & 0xff; out[p++] = o.rtc.ADD_TIME_HOUR_LSB & 0xff;
  out[p++] = o.rtc.ADD_TIME_MIN_MSB & 0xff; out[p++] = o.rtc.ADD_TIME_MIN_LSB & 0xff;
  out[p++] = o.rtc.ADD_TIME_SEC_MSB & 0xff; out[p++] = o.rtc.ADD_TIME_SEC_LSB & 0xff;
  out[p++] = o.rtc.ADD_TIME_HOUR_MSB_PM_VALUE & 0xff;
  // spare
  out[p++] = 0;
  // flags int32 LE
  dv.setInt32(p, flags, true); p += 4;
  // section table
  for (let i = 0; i < 10; i++) { dv.setInt32(p, offs[i], true); p += 4; dv.setInt32(p, sizes[i], true); p += 4; }
  // data sections with 'P' padding to 4 bytes
  for (let i = 0; i < 10; i++) {
    out.set(sections[i], offs[i]);
    let endp = offs[i] + sizes[i];
    let pad = (sizes[i] % 4); if (pad) { for (let k = 0; k < 4 - pad; k++) out[endp + k] = 0x50; }
  }
  return out;
}
