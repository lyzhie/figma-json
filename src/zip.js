(function attachZipWriter(global) {
  "use strict";

  const encoder = new TextEncoder();
  let crcTable = null;

  function getCrcTable() {
    if (crcTable) return crcTable;

    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[n] = value >>> 0;
    }
    return crcTable;
  }

  function crc32(bytes) {
    const table = getCrcTable();
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      crc = table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function writeU16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function writeU32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function concat(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let cursor = 0;
    for (const part of parts) {
      output.set(part, cursor);
      cursor += part.length;
    }
    return output;
  }

  function dosTimestamp(date) {
    const year = Math.max(1980, date.getFullYear());
    const time =
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2);
    const day =
      ((year - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate();
    return { time, day };
  }

  function makeLocalHeader(nameBytes, dataBytes, crc, timestamp) {
    const buffer = new ArrayBuffer(30 + nameBytes.length);
    const view = new DataView(buffer);
    writeU32(view, 0, 0x04034b50);
    writeU16(view, 4, 20);
    writeU16(view, 6, 0x0800);
    writeU16(view, 8, 0);
    writeU16(view, 10, timestamp.time);
    writeU16(view, 12, timestamp.day);
    writeU32(view, 14, crc);
    writeU32(view, 18, dataBytes.length);
    writeU32(view, 22, dataBytes.length);
    writeU16(view, 26, nameBytes.length);
    writeU16(view, 28, 0);
    const output = new Uint8Array(buffer);
    output.set(nameBytes, 30);
    return output;
  }

  function makeCentralHeader(nameBytes, dataBytes, crc, timestamp, localOffset) {
    const buffer = new ArrayBuffer(46 + nameBytes.length);
    const view = new DataView(buffer);
    writeU32(view, 0, 0x02014b50);
    writeU16(view, 4, 20);
    writeU16(view, 6, 20);
    writeU16(view, 8, 0x0800);
    writeU16(view, 10, 0);
    writeU16(view, 12, timestamp.time);
    writeU16(view, 14, timestamp.day);
    writeU32(view, 16, crc);
    writeU32(view, 20, dataBytes.length);
    writeU32(view, 24, dataBytes.length);
    writeU16(view, 28, nameBytes.length);
    writeU16(view, 30, 0);
    writeU16(view, 32, 0);
    writeU16(view, 34, 0);
    writeU16(view, 36, 0);
    writeU32(view, 38, 0);
    writeU32(view, 42, localOffset);
    const output = new Uint8Array(buffer);
    output.set(nameBytes, 46);
    return output;
  }

  function makeEndRecord(entryCount, centralSize, centralOffset) {
    const buffer = new ArrayBuffer(22);
    const view = new DataView(buffer);
    writeU32(view, 0, 0x06054b50);
    writeU16(view, 4, 0);
    writeU16(view, 6, 0);
    writeU16(view, 8, entryCount);
    writeU16(view, 10, entryCount);
    writeU32(view, 12, centralSize);
    writeU32(view, 16, centralOffset);
    writeU16(view, 20, 0);
    return new Uint8Array(buffer);
  }

  function createZip(files, modifiedAt) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error("ZIP requires at least one file.");
    }
    if (files.length > 65535) {
      throw new Error("ZIP entry limit exceeded.");
    }

    const timestamp = dosTimestamp(modifiedAt || new Date());
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;

    for (const file of files) {
      if (!file || typeof file.path !== "string" || !file.path.trim()) {
        throw new Error("Every ZIP entry requires a path.");
      }

      const safePath = file.path.replace(/^\/+/, "").replace(/\\/g, "/");
      if (safePath.split("/").includes("..")) {
        throw new Error(`Unsafe ZIP path: ${file.path}`);
      }

      const nameBytes = encoder.encode(safePath);
      const dataBytes =
        file.content instanceof Uint8Array
          ? file.content
          : encoder.encode(String(file.content ?? ""));

      if (dataBytes.length > 0xffffffff) {
        throw new Error(`ZIP entry is too large: ${safePath}`);
      }

      const checksum = crc32(dataBytes);
      const localHeader = makeLocalHeader(nameBytes, dataBytes, checksum, timestamp);
      const centralHeader = makeCentralHeader(
        nameBytes,
        dataBytes,
        checksum,
        timestamp,
        localOffset,
      );

      localParts.push(localHeader, dataBytes);
      centralParts.push(centralHeader);
      localOffset += localHeader.length + dataBytes.length;
    }

    const centralDirectory = concat(centralParts);
    return concat([
      ...localParts,
      centralDirectory,
      makeEndRecord(files.length, centralDirectory.length, localOffset),
    ]);
  }

  global.FigmaJsonZip = { createZip, crc32 };
})(globalThis);
