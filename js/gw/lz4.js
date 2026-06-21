// LZ4 frame compressor — adapted from lz4js (MIT, Ben Noordhuis / DarkLNXMatter).
// Tuned so the frame descriptor matches python's
//   lz4.frame.compress(data, block_size=BLOCKSIZE_MAX1MB, block_linked=False)
// i.e. FLG = version(0x40) | block-independence(0x20) ; BD = block-max-size id 6 (1 MiB).
// For payloads <= 1 MiB this yields a single block, byte-equivalent to the python output.

// ---- xxhash32 (needed for the 1-byte frame-descriptor checksum) -------------
const prime1 = 0x9e3779b1, prime2 = 0x85ebca77, prime3 = 0xc2b2ae3d,
  prime4 = 0x27d4eb2f, prime5 = 0x165667b1;

function rotl(x, r) { x = x & 0xffffffff; return ((x << r) | (x >>> (32 - r))) >>> 0; }
function mul(a, b) {
  var al = a & 0xffff, ah = a >>> 16;
  return (((al * b) >>> 0) + (((ah * b) & 0xffff) << 16)) >>> 0;
}
function readU32(b, n) { return (b[n] | (b[n + 1] << 8) | (b[n + 2] << 16) | (b[n + 3] << 24)) >>> 0; }
function writeU32(b, n, v) { b[n] = v & 0xff; b[n + 1] = (v >>> 8) & 0xff; b[n + 2] = (v >>> 16) & 0xff; b[n + 3] = (v >>> 24) & 0xff; }

export function xxh32(seed, buf, index, len) {
  var h, p = index, end = index + len;
  if (len >= 16) {
    var limit = end - 16;
    var v1 = (seed + prime1 + prime2) >>> 0,
      v2 = (seed + prime2) >>> 0,
      v3 = (seed) >>> 0,
      v4 = (seed - prime1) >>> 0;
    do {
      v1 = mul(rotl((v1 + mul(readU32(buf, p), prime2)) >>> 0, 13), prime1) >>> 0; p += 4;
      v2 = mul(rotl((v2 + mul(readU32(buf, p), prime2)) >>> 0, 13), prime1) >>> 0; p += 4;
      v3 = mul(rotl((v3 + mul(readU32(buf, p), prime2)) >>> 0, 13), prime1) >>> 0; p += 4;
      v4 = mul(rotl((v4 + mul(readU32(buf, p), prime2)) >>> 0, 13), prime1) >>> 0; p += 4;
    } while (p <= limit);
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0;
  } else {
    h = (seed + prime5) >>> 0;
  }
  h = (h + len) >>> 0;
  while (p + 4 <= end) {
    h = mul(rotl((h + mul(readU32(buf, p), prime3)) >>> 0, 17), prime4) >>> 0;
    p += 4;
  }
  while (p < end) {
    h = mul(rotl((h + mul(buf[p] & 0xff, prime5)) >>> 0, 11), prime1) >>> 0;
    p++;
  }
  h = (h ^ (h >>> 15)) >>> 0; h = mul(h, prime2) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0; h = mul(h, prime3) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h >>> 0;
}

// ---- LZ4 block compression (faithful port of lz4js) -------------------------
const minMatch = 4, minLength = 13, searchLimit = 5, skipTrigger = 6;
const mlBits = 4, mlMask = (1 << mlBits) - 1, runBits = 4, runMask = (1 << runBits) - 1;
const hashSize = 1 << 16;

function hashU32(a) {
  a = a | 0;
  a = (a + 2127912214 + (a << 12)) | 0;
  a = (a ^ -949894596 ^ (a >>> 19));
  a = (a + 374761393 + (a << 5)) | 0;
  a = ((a + -744332180) ^ (a << 9));
  a = (a + -42973499 + (a << 3)) | 0;
  return (a ^ -1252372727 ^ (a >>> 16)) | 0;
}

function compressBlock(src, dst, sIndex, sLength, hashTable) {
  var mIndex, mAnchor, mLength, mOffset, mStep, literalCount, dIndex, sEnd, n;
  dIndex = 0; sEnd = sLength + sIndex; mAnchor = sIndex;

  if (sLength >= minLength) {
    var searchMatchCount = (1 << skipTrigger) + 3;
    while (sIndex + minMatch < sEnd - searchLimit) {
      var seq = readU32(src, sIndex);
      var hash = hashU32(seq) >>> 0;
      hash = (((hash >> 16) ^ hash) >>> 0) & 0xffff;
      mIndex = hashTable[hash] - 1;
      hashTable[hash] = sIndex + 1;

      if (mIndex < 0 || ((sIndex - mIndex) >>> 16) > 0 || readU32(src, mIndex) !== seq) {
        mStep = searchMatchCount++ >> skipTrigger;
        sIndex += mStep;
        continue;
      }
      searchMatchCount = (1 << skipTrigger) + 3;

      literalCount = sIndex - mAnchor;
      mOffset = sIndex - mIndex;
      sIndex += minMatch; mIndex += minMatch;
      mLength = sIndex;
      while (sIndex < sEnd - searchLimit && src[sIndex] === src[mIndex]) { sIndex++; mIndex++; }
      mLength = sIndex - mLength;

      var token = mLength < mlMask ? mLength : mlMask;
      if (literalCount >= runMask) {
        dst[dIndex++] = (runMask << mlBits) + token;
        for (n = literalCount - runMask; n >= 0xff; n -= 0xff) dst[dIndex++] = 0xff;
        dst[dIndex++] = n;
      } else {
        dst[dIndex++] = (literalCount << mlBits) + token;
      }
      for (var i = 0; i < literalCount; i++) dst[dIndex++] = src[mAnchor + i];

      dst[dIndex++] = mOffset;
      dst[dIndex++] = (mOffset >> 8);

      if (mLength >= mlMask) {
        for (n = mLength - mlMask; n >= 0xff; n -= 0xff) dst[dIndex++] = 0xff;
        dst[dIndex++] = n;
      }
      mAnchor = sIndex;
    }
  }

  if (mAnchor === 0) return 0;

  literalCount = sEnd - mAnchor;
  if (literalCount >= runMask) {
    dst[dIndex++] = (runMask << mlBits);
    for (n = literalCount - runMask; n >= 0xff; n -= 0xff) dst[dIndex++] = 0xff;
    dst[dIndex++] = n;
  } else {
    dst[dIndex++] = (literalCount << mlBits);
  }
  sIndex = mAnchor;
  while (sIndex < sEnd) dst[dIndex++] = src[sIndex++];
  return dIndex;
}

// ---- LZ4 frame --------------------------------------------------------------
const magicNum = 0x184D2204;
const fdVersion = 0x40, fdBlockIndep = 0x20;
const bdId = 6, maxBlockSize = 0x100000; // 1 MiB to match BLOCKSIZE_MAX1MB

function compressBound(n) { return (n + (n / 255 | 0) + 16) | 0; }

export function compressFrame(src) {
  var hashTable = new Int32Array(hashSize);
  var blockBuf = new Uint8Array(compressBound(maxBlockSize));
  var dst = new Uint8Array(7 + compressBound(src.length) + 8 * Math.ceil(src.length / maxBlockSize) + 8);
  var dIndex = 0;

  writeU32(dst, dIndex, magicNum); dIndex += 4;
  var FLG = fdVersion | fdBlockIndep;     // 0x60
  var BD = bdId << 4;                      // 0x60
  dst[dIndex++] = FLG;
  dst[dIndex++] = BD;
  // HC: second byte of (xxh32(0, {FLG,BD}) >> 8)
  var hc = (xxh32(0, dst, 4, 2) >>> 8) & 0xff;
  dst[dIndex++] = hc;

  var remaining = src.length, sIndex = 0;
  while (remaining > 0) {
    var blockSize = remaining > maxBlockSize ? maxBlockSize : remaining;
    var compSize = compressBlock(src, blockBuf, sIndex, blockSize, hashTable);
    if (compSize === 0 || compSize >= blockSize) {
      // store uncompressed block
      writeU32(dst, dIndex, 0x80000000 | blockSize); dIndex += 4;
      dst.set(src.subarray(sIndex, sIndex + blockSize), dIndex); dIndex += blockSize;
    } else {
      writeU32(dst, dIndex, compSize); dIndex += 4;
      dst.set(blockBuf.subarray(0, compSize), dIndex); dIndex += compSize;
    }
    sIndex += blockSize; remaining -= blockSize;
  }
  writeU32(dst, dIndex, 0); dIndex += 4; // end mark
  return dst.subarray(0, dIndex);
}
