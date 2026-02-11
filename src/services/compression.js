const zlib = require('zlib');

/**
 * Compress a JSON-serializable value into a gzip Buffer.
 * @param {*} data - Object/string to compress
 * @returns {Buffer} gzip-compressed buffer
 */
function compressJson(data) {
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    return zlib.gzipSync(Buffer.from(json, 'utf8'));
}

/**
 * Decompress a gzip Buffer back into a parsed JS object.
 * If the input is already a string (legacy uncompressed data), parse it directly.
 * @param {Buffer|string|null} compressed - gzip buffer or legacy JSON string
 * @returns {*} parsed JS object, or null if input is null/undefined
 */
function decompressJson(compressed) {
    if (compressed === null || compressed === undefined) return null;

    // Legacy support: if it's a string, it's uncompressed JSON from before migration
    if (typeof compressed === 'string') {
        return JSON.parse(compressed);
    }

    // Buffer (compressed data)
    const decompressed = zlib.gunzipSync(compressed);
    return JSON.parse(decompressed.toString('utf8'));
}

module.exports = { compressJson, decompressJson };
