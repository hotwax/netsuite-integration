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
 * Phase 3 (#308) added a `mode` parameter to measure where each read path stops working:
 *   contents  getContents() - the whole file at once, capped at 10MB (default, Phase 2 behaviour)
 *   stream    lines.iterator() - line at a time, 10MB applies per line, so no practical file cap
 *   both      run each in turn against the same file and report them separately
 *
 * IMPORTANT for callers: the uploaded file's NAME decides the gunzipped file's type, and the type
 * decides how much fits. gunzip strips '.gz' and NetSuite infers the type from what is left, and
 * File.fileType is read-only afterwards, so the name is the only control. Verified live against
 * 4054670_SB1 by uploading ONE payload under five names: '.txt.gz' yields PLAINTEXT, '.csv.gz' CSV,
 * '.json.gz' JSON, and both '.ndjson.gz' and a bare '.gz' yield MISCBINARY.
 *
 * What the type does NOT change is capacity. Measured both ways on this account, getContents() fails
 * at exactly the same size - 68,100 records read, 68,200 threw SSS_FILE_CONTENT_SIZE_EXCEEDED, for
 * PLAINTEXT and MISCBINARY alike. So the 10MB ceiling is on the file's content bytes, not on the
 * base64 string a binary type hands back. An earlier reading of this code assumed base64 inflation
 * cost a quarter of the headroom; it does not.
 *
 * Nor does the type decide streaming: contrary to the documentation, which describes lines.iterator()
 * as being for text and .csv files, a MISCBINARY gunzip temp file streamed correctly here with a
 * matching digest. Prefer '.txt.gz' regardless - getContents() then returns text instead of base64, so
 * consumers skip a decode step, and the feed stays inside documented behaviour rather than relying on
 * an undocumented one Oracle is free to change. It buys clarity and supportability, not capacity.
 *
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/file', 'N/compress', 'N/crypto', 'N/encode', 'N/error', 'N/runtime'],
    (file, compress, crypto, encode, error, runtime) => {

        // NOT the same list as HC_RL_UploadFileToCabinet, despite the shared name. These are fileType
        // NAMES that a File object reports, not file.Type input keys - two namespaces that overlap
        // enough to look identical and are not.
        //
        // MISCBINARY is the entry that matters and it must stay here. It is what NetSuite reports for
        // a gunzipped file whose name carries no recognized text extension, confirmed live. The same
        // value is invalid as an INPUT, which is why the upload side must never send it.
        //
        // For these types getContents() returns base64 rather than text, so both the hash and the
        // line split have to account for it.
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

        const remainingUsage = () => runtime.getCurrentScript().getRemainingUsage();

        // Whole-file read. Capped at 10MB of file content by getContents(), which throws
        // SSS_FILE_CONTENT_SIZE_EXCEEDED beyond it. The cap is on the content, not on the returned
        // string: a binary type returns base64 and still fails at the same file size, measured.
        const readViaContents = (gunzippedFile, observedFileType) => {
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

            return {
                recordCount: countRecords(text),
                sha256: digest,
                // Character count, not bytes - String.length counts UTF-16 code units. Diagnostic only;
                // integrity is the sha256's job.
                decompressedChars: text.length
            };
        };

        // Line-at-a-time read. The 10MB limit applies per line rather than per file, so this is the only
        // path with no practical ceiling on record count.
        //
        // The digest is built incrementally, one update() per line, so integrity is still checked end to
        // end without ever holding the file in memory. Each line is rehydrated as value + '\n', which
        // reproduces the source exactly for an NDJSON file that ends in a newline - so a digest matching
        // the contents-mode one is also proof that the iterator yielded no phantom trailing line.
        // linesYielded is reported separately precisely so that assumption stays falsifiable.
        const readViaStream = (gunzippedFile) => {
            var hashObj = crypto.createHash({ algorithm: crypto.HashAlg.SHA256 });
            var linesYielded = 0;
            var recordCount = 0;
            var maxLineChars = 0;
            var decompressedChars = 0;

            gunzippedFile.lines.iterator().each((line) => {
                var value = line.value;
                linesYielded++;
                decompressedChars += value.length + 1;
                if (value.length > maxLineChars) maxLineChars = value.length;
                if (value.trim()) recordCount++;
                hashObj.update({ input: value + '\n', inputEncoding: encode.Encoding.UTF_8 });
                return true;
            });

            return {
                recordCount: recordCount,
                sha256: hashObj.digest({ outputEncoding: encode.Encoding.HEX }).toLowerCase(),
                decompressedChars: decompressedChars,
                linesYielded: linesYielded,
                maxLineChars: maxLineChars
            };
        };

        const post = (requestBody) => {
            var fileId = requestBody.fileId;
            if (!fileId) {
                throw error.create({
                    name: 'MISSING_REQUIRED_PARAM',
                    message: 'fileId is required to verify a gzipped file'
                });
            }

            // Defaults to the whole-file read so the Phase 2 contract is unchanged for existing callers.
            var mode = requestBody.mode || 'contents';
            if (['contents', 'stream', 'both'].indexOf(mode) === -1) {
                throw error.create({
                    name: 'INVALID_MODE',
                    message: 'mode must be one of contents, stream or both; got ' + mode
                });
            }

            var gzippedFile = file.load({ id: fileId });
            var compressedBytes = gzippedFile.size;

            // Throws if the file is not actually gzip. Let that surface rather than reporting a
            // zero count - "the thing we uploaded was not gzip" is a real finding, not an edge case.
            var gunzippedFile = compress.gunzip({ file: gzippedFile });
            var observedFileType = gunzippedFile.fileType;

            var response = {
                status: 'success',
                fileId: fileId,
                mode: mode,
                compressedBytes: compressedBytes,
                observedFileType: observedFileType,
                usageAtStart: remainingUsage()
            };

            // Each read is captured rather than allowed to abort the request, because a failure IS the
            // measurement: the whole point of #308 is to find where each path stops working, and in
            // 'both' mode one path failing must not hide the other path's result.
            if (mode === 'contents' || mode === 'both') {
                var before = remainingUsage();
                try {
                    response.contents = readViaContents(gunzippedFile, observedFileType);
                } catch (e) {
                    response.contents = { failed: true, errorName: e.name, errorMessage: e.message };
                }
                response.contents.usageSpent = before - remainingUsage();
            }

            if (mode === 'stream' || mode === 'both') {
                // In 'both' mode getContents() has already consumed the stream and the iterator would
                // yield nothing - which reads as an empty file rather than a spent one, so it has to be
                // handled rather than left to look like a result. resetStream() was tried first and did
                // NOT rewind a gunzip temp file: mode 'both' reported linesYielded 0 against a file that
                // streamed 500 lines under mode 'stream'. Decompressing a second time is cheap (gunzip
                // costs no usage units, measured) and gives the stream read a genuinely untouched file.
                var streamSource = (mode === 'both') ? compress.gunzip({ file: gzippedFile }) : gunzippedFile;
                var streamBefore = remainingUsage();
                try {
                    response.stream = readViaStream(streamSource);
                } catch (e) {
                    response.stream = { failed: true, errorName: e.name, errorMessage: e.message };
                }
                response.stream.usageSpent = streamBefore - remainingUsage();
            }

            // Logged at audit level because observedFileType and the per-path usage cost are what #308
            // and #336 both need, and a RESTlet response is not retained anywhere the next agent can read.
            log.audit('Gzip verify', 'fileId: ' + fileId +
                ', mode: ' + mode +
                ', observedFileType: ' + observedFileType +
                ', compressedBytes: ' + compressedBytes +
                ', contents: ' + JSON.stringify(response.contents || null) +
                ', stream: ' + JSON.stringify(response.stream || null));

            // Phase 2's callers read recordCount, sha256 and decompressedChars off the top level and must
            // keep working, so the active mode's numbers are promoted. 'both' promotes the streamed ones:
            // if the two disagree the response still carries each separately, and streaming is the path
            // the feed is meant to end up on.
            var primary = (mode === 'contents') ? response.contents : response.stream;
            if (primary && !primary.failed) {
                response.recordCount = primary.recordCount;
                response.sha256 = primary.sha256;
                response.decompressedChars = primary.decompressedChars;
            }

            return response;
        };

        return { post };
    });
