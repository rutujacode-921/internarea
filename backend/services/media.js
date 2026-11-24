const crypto = require("crypto");
const mongoose = require("mongoose");
const { SPACE_SETTINGS: S, IMAGE_TYPES, VIDEO_TYPES } = require("../config/space");

// Photos and videos are stored in MongoDB (GridFS), so no extra cloud service
// or keys are needed, and uploads survive redeploys.

let bucket = null;
const getBucket = () => {
  if (!bucket) bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "media" });
  return bucket;
};

// Works out the real file type from its first bytes. The browser-supplied
// type and file name are ignored, so a renamed file can't sneak through.
function detectType(buf) {
  if (!buf || buf.length < 12) return null;
  const ascii = (start, end) => buf.toString("latin1", start, end);
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
  if (ascii(4, 8) === "ftyp") return ascii(8, 12) === "qt  " ? "video/quicktime" : "video/mp4";
  return null;
}

// Validates uploaded files: up to 4 photos, or a single video; size limits per type.
// Returns { media } or { error }.
function inspectFiles(files) {
  const media = [];
  for (const file of files) {
    const mime = detectType(file.buffer);
    const kind = IMAGE_TYPES.includes(mime) ? "image" : VIDEO_TYPES.includes(mime) ? "video" : null;
    if (!kind) return { error: "MEDIA_TYPE" };
    if (kind === "image" && file.size > S.maxImageBytes) return { error: "IMAGE_TOO_LARGE" };
    if (kind === "video" && file.size > S.maxVideoBytes) return { error: "VIDEO_TOO_LARGE" };
    media.push({ kind, mime, size: file.size, buffer: file.buffer, hash: crypto.createHash("sha256").update(file.buffer).digest("hex") });
  }
  const videos = media.filter((m) => m.kind === "video").length;
  if (videos > 1 || (videos === 1 && media.length > 1)) return { error: "ONE_VIDEO_ONLY" };
  if (media.length > S.maxImages) return { error: "TOO_MANY_FILES" };
  if (new Set(media.map((m) => m.hash)).size !== media.length) return { error: "REPEATED_MEDIA" };
  return { media };
}

function storeFile(item, uid) {
  return new Promise((resolve, reject) => {
    const upload = getBucket().openUploadStream(`${uid}-${item.hash.slice(0, 12)}`, {
      contentType: item.mime,
      metadata: { uid, kind: item.kind, hash: item.hash },
    });
    upload.on("error", reject);
    upload.on("finish", () => resolve(upload.id));
    upload.end(item.buffer);
  });
}

async function deleteFiles(fileIds) {
  for (const id of fileIds) {
    try {
      await getBucket().delete(new mongoose.Types.ObjectId(id));
    } catch {
      // Already gone.
    }
  }
}

// ---- Signed links ----------------------------------------------------------------
// Media is served to <img>/<video> tags, which can't send the sign-in header,
// so each link carries a signature and expiry. Links are only handed out to
// users allowed to see the post (e.g. friends-only posts).
const SECRET = process.env.MEDIA_SECRET || process.env.JWT_SECRET || process.env.OTP_SECRET || crypto.randomBytes(32).toString("hex");
const sign = (id, exp) => crypto.createHmac("sha256", SECRET).update(`${id}.${exp}`).digest("hex").slice(0, 32);

function mediaUrl(fileId) {
  // Rounded expiry, so the same link is reused and browsers can cache it.
  const window = S.mediaLinkHours * 3600;
  const exp = (Math.floor(Date.now() / 1000 / window) + 2) * window;
  return `/api/space/media/${fileId}?exp=${exp}&sig=${sign(String(fileId), exp)}`;
}

function verifyMediaSignature(id, exp, sig) {
  if (!mongoose.isValidObjectId(id) || !/^\d+$/.test(String(exp)) || typeof sig !== "string") return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expected = sign(String(id), exp);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

// Streams a file, honouring Range requests so videos can seek.
async function streamFile(req, res, id) {
  const fileId = new mongoose.Types.ObjectId(id);
  const file = await getBucket().find({ _id: fileId }).next();
  if (!file) return res.status(404).end();

  res.setHeader("Content-Type", file.contentType || "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : file.length - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : file.length - 1;
    start = Math.max(0, start);
    end = Math.min(end, file.length - 1);
    if (start > end) {
      res.setHeader("Content-Range", `bytes */${file.length}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${file.length}`);
    res.setHeader("Content-Length", end - start + 1);
    return getBucket().openDownloadStream(fileId, { start, end: end + 1 }).on("error", () => res.end()).pipe(res);
  }
  res.setHeader("Content-Length", file.length);
  getBucket().openDownloadStream(fileId).on("error", () => res.end()).pipe(res);
}

module.exports = { inspectFiles, storeFile, deleteFiles, mediaUrl, verifyMediaSignature, streamFile, detectType };
