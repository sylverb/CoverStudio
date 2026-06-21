// Minimal ZIP reader (no deps). Reads the central directory and extracts entries.
// Supports STORE (0) and DEFLATE (8, via DecompressionStream('deflate-raw')).
// Returns a Map<filename, Uint8Array>.

export async function readZip(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const n = bytes.length;

  // Find End Of Central Directory (EOCD): signature 0x06054b50, scan from end.
  let eocd = -1;
  for (let i = n - 22; i >= 0 && i >= n - 22 - 65536; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid ZIP (EOCD not found)');

  const cdCount = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);

  // ZIP64 handling if values are 0xffffffff
  if (cdOffset === 0xffffffff) {
    // locate ZIP64 EOCD locator
    const loc = eocd - 20;
    if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
      const z64 = Number(dv.getBigUint64(loc + 8, true));
      if (dv.getUint32(z64, true) === 0x06064b50) {
        cdOffset = Number(dv.getBigUint64(z64 + 48, true));
      }
    }
  }

  const out = new Map();
  const dec = new TextDecoder('utf-8');
  let p = cdOffset;

  for (let e = 0; e < cdCount; e++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break; // central dir header
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    let localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // resolve possible zip64 extra for offset/size
    let realCompSize = compSize, realLocalOff = localOff;
    if (localOff === 0xffffffff || compSize === 0xffffffff) {
      let ep = p + 46 + nameLen, ee = ep + extraLen;
      while (ep + 4 <= ee) {
        const id = dv.getUint16(ep, true), sz = dv.getUint16(ep + 2, true);
        let q = ep + 4;
        if (id === 0x0001) {
          if (compSize === 0xffffffff) { realCompSize = Number(dv.getBigUint64(q, true)); q += 8; }
          if (localOff === 0xffffffff) { realLocalOff = Number(dv.getBigUint64(q, true)); q += 8; }
        }
        ep += 4 + sz;
      }
    }

    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // directory entry

    // read local header to find the data start
    if (dv.getUint32(realLocalOff, true) !== 0x04034b50) continue;
    const lNameLen = dv.getUint16(realLocalOff + 26, true);
    const lExtraLen = dv.getUint16(realLocalOff + 28, true);
    const dataStart = realLocalOff + 30 + lNameLen + lExtraLen;
    const comp = bytes.subarray(dataStart, dataStart + realCompSize);

    let data;
    if (method === 0) {
      data = comp.slice();
    } else if (method === 8) {
      data = await inflateRaw(comp);
    } else {
      throw new Error('Unsupported ZIP compression method: ' + method + ' (' + name + ')');
    }
    out.set(name, data);
  }
  return out;
}

export async function inflateRaw(u8) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Response(u8).body.pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}
