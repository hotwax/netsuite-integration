/**
 * Gunzip a File Cabinet file and report what it contains.
 *
 * Phase 2 of the File Cabinet PoC (hotwax/mantle-netsuite-connector#307). Moqui uploads a gzipped
 * NDJSON feed, then calls this to prove the content survived. It creates no records and does no
 * mapping - that is the generic creator, #336.
 *
 * The SHA-256 is over the decompressed bytes so the caller can compare it with a digest of the
 * pre-gzip source. A record count alone would pass even if every line were mangled.
 *
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/file', 'N/compress', 'N/crypto', 'N/encode', 'N/error'],
    (file, compress, crypto, encode, error) => {

        // Same list as HC_RL_UploadFileToCabinet. For these types getContents() returns base64
        // rather than text, so both the hash and the line split have to account for it.
        const BINARY_TYPES = ['MISCBINARY', 'ZIP', 'PDF'];

        const sha256 = (contents, inputEncoding) => {
            var hashObj = crypto.createHash({ algorithm: crypto.HashAlg.SHA256 });
            hashObj.update({ input: contents, inputEncoding: inputEncoding });
            return hashObj.digest({ outputEncoding: encode.Encoding.HEX }).toLowerCase();
        };

        // NDJSON is one record per line and normally ends with a newline, so the trailing empty
        // string must not count. A blank line is not a record either.
        //
        // Filtering explicitly rather than trusting split(): JavaScript keeps trailing empty strings
        // where Java discards them, so a naive count here would disagree with the Moqui producer by
        // one on every feed file that ends in a newline - a phantom "lost record" on the first run.
        const countRecords = (text) => {
            var lines = text.split(/\r?\n/);
            var count = 0;
            for (var i = 0; i < lines.length; i++) {
                if (lines[i].trim()) count++;
            }
            return count;
        };

        const post = (requestBody) => {
            var fileId = requestBody.fileId;
            if (!fileId) {
                throw error.create({
                    name: 'MISSING_REQUIRED_PARAM',
                    message: 'fileId is required to verify a gzipped file'
                });
            }

            var gzippedFile = file.load({ id: fileId });
            var compressedBytes = gzippedFile.size;

            // Throws if the file is not actually gzip. Let that surface rather than reporting a
            // zero count - "the thing we uploaded was not gzip" is a real finding, not an edge case.
            var gunzippedFile = compress.gunzip({ file: gzippedFile });
            var observedFileType = gunzippedFile.fileType;
            var contents = gunzippedFile.getContents();

            // NetSuite infers the gunzipped file's type. When it lands on a binary type, getContents()
            // hands back base64, and hashing that string directly would report a mismatch that looks
            // exactly like corruption. Hash the base64 with a BASE_64 inputEncoding instead, so the
            // digest covers the true decoded bytes and never passes through a character-encoding
            // conversion - which is the one thing that must not sit in the middle of an integrity check.
            var isBinary = BINARY_TYPES.indexOf(observedFileType) !== -1;
            var digest = sha256(contents, isBinary ? encode.Encoding.BASE_64 : encode.Encoding.UTF_8);

            var text = isBinary
                ? encode.convert({
                    string: contents,
                    inputEncoding: encode.Encoding.BASE_64,
                    outputEncoding: encode.Encoding.UTF_8
                })
                : contents;

            var recordCount = countRecords(text);

            // Logged at audit level because observedFileType is the open question this PoC exists to
            // answer, and #308 and #336 both need the answer.
            log.audit('Gzip verify', 'fileId: ' + fileId +
                ', observedFileType: ' + observedFileType +
                ', compressedBytes: ' + compressedBytes +
                ', decompressedChars: ' + text.length +
                ', recordCount: ' + recordCount +
                ', sha256: ' + digest);

            return {
                status: 'success',
                fileId: fileId,
                recordCount: recordCount,
                sha256: digest,
                // Character count, not bytes - String.length counts UTF-16 code units. Diagnostic only;
                // integrity is the sha256's job.
                decompressedChars: text.length,
                compressedBytes: compressedBytes,
                observedFileType: observedFileType
            };
        };

        return { post };
    });
