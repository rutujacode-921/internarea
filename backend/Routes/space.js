const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const router = express.Router();

const User = require("../Model/User");
const { Friendship, Follow, Post, Comment, Like, Save, Report, View, Share, Notification } = require("../Model/Space");
const { requireAuth } = require("../middleware/auth");
const { sendError, asyncHandler } = require("../utils/errors");
const { cleanText, extractHashtags, extractMentions, textProblem, contentHash } = require("../utils/moderation");
const media = require("../services/media");
const space = require("../services/space");
const { SPACE_SETTINGS: S } = require("../config/space");

const isId = (v) => mongoose.isValidObjectId(v);
const PAGE = 10;

// Cursors for "newest first" lists: "<ISO date>_<id>".
const encodeCursor = (doc, field = "createdAt") => (doc ? `${new Date(doc[field]).toISOString()}_${doc._id}` : null);
function cursorFilter(cursor, field = "createdAt") {
  if (typeof cursor !== "string") return {};
  const [iso, id] = cursor.split("_");
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || !isId(id)) return {};
  return { $or: [{ [field]: { $lt: date } }, { [field]: date, _id: { $lt: new mongoose.Types.ObjectId(id) } }] };
}

// Media is streamed with a signed link (no sign-in header on <img>/<video>).
router.get(
  "/media/:id",
  asyncHandler(async (req, res) => {
    if (!media.verifyMediaSignature(req.params.id, req.query.exp, req.query.sig)) return res.status(403).end();
    await media.streamFile(req, res, req.params.id);
  })
);

router.use(requireAuth);

// Loads the viewer's profile and friend list for every request below.
router.use(
  asyncHandler(async (req, res, next) => {
    req.me = await space.ensureProfile(req.authUser);
    req.friends = await space.friendUids(req.me.uid);
    req.friendSet = new Set(req.friends);
    next();
  })
);

async function loadVisiblePost(req, res) {
  const { id } = req.params;
  const post = isId(id) ? await Post.findById(id) : null;
  if (!post || !space.canView(post, req.me.uid, req.friendSet)) {
    sendError(req, res, 404, "POST_NOT_FOUND");
    return null;
  }
  return post;
}

// Resolves @usernames in text to existing users (excluding the author).
async function resolveMentions(text, authorUid) {
  const names = extractMentions(text);
  if (!names.length) return [];
  const users = await User.find({ username: { $in: names } }).select("uid username");
  return users.filter((u) => u.uid !== authorUid);
}

// =============================================================================
// Me, profiles, search
// =============================================================================

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const [allowance, followers, following, unread] = await Promise.all([
      space.allowance(req.me.uid),
      Follow.countDocuments({ following: req.me.uid }),
      Follow.countDocuments({ follower: req.me.uid }),
      Notification.countDocuments({ uid: req.me.uid, read: false }),
    ]);
    res.json({
      profile: space.publicProfile(req.me, { friendCount: req.friends.length, followerCount: followers, followingCount: following }),
      allowance,
      unreadNotifications: unread,
      settings: { editWindowMinutes: S.editWindowMinutes, deleteWindowMinutes: S.deleteWindowMinutes, maxTextLength: S.maxTextLength, maxImages: S.maxImages, maxImageMb: S.maxImageBytes / 1048576, maxVideoMb: S.maxVideoBytes / 1048576 },
    });
  })
);

router.put(
  "/me",
  asyncHandler(async (req, res) => {
    const updates = {};
    if (req.body?.username !== undefined) {
      const username = String(req.body.username).trim().toLowerCase();
      if (!space.USERNAME_RE.test(username)) return sendError(req, res, 400, "USERNAME_INVALID");
      updates.username = username;
    }
    if (req.body?.bio !== undefined) {
      const bio = cleanText(req.body.bio, 160);
      if (bio.length > 160) return sendError(req, res, 400, "BIO_TOO_LONG");
      if (textProblem(bio, { maxLength: 160 })) return sendError(req, res, 400, "INAPPROPRIATE_CONTENT");
      updates.bio = bio;
    }
    try {
      const user = await User.findOneAndUpdate({ _id: req.me._id }, { $set: updates }, { new: true });
      res.json({ profile: space.publicProfile(user) });
    } catch (error) {
      if (error?.code === 11000) return sendError(req, res, 409, "USERNAME_TAKEN");
      throw error;
    }
  })
);

router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase().replace(/^@/, "").slice(0, 40);
    if (q.length < 2) return res.json({ users: [] });
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const users = await User.find({
      uid: { $ne: req.me.uid },
      username: { $type: "string" },
      $or: [{ username: { $regex: `^${escaped}` } }, { name: { $regex: escaped, $options: "i" } }],
    })
      .limit(20)
      .select("uid username name photo bio");
    const withStatus = await Promise.all(users.map(async (u) => ({ ...space.publicProfile(u), relationship: await space.relationship(req.me.uid, u.uid) })));
    res.json({ users: withStatus });
  })
);

router.get(
  "/users/:username",
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ username: String(req.params.username).toLowerCase() });
    if (!user) return sendError(req, res, 404, "USER_NOT_FOUND");
    const [friendCount, followers, following, postCount, rel] = await Promise.all([
      space.friendCount(user.uid),
      Follow.countDocuments({ following: user.uid }),
      Follow.countDocuments({ follower: user.uid }),
      Post.countDocuments({ authorUid: user.uid, status: "active" }),
      space.relationship(req.me.uid, user.uid),
    ]);
    res.json({ profile: space.publicProfile(user, { friendCount, followerCount: followers, followingCount: following, postCount }), relationship: rel });
  })
);

router.get(
  "/users/:username/posts",
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ username: String(req.params.username).toLowerCase() }).select("uid");
    if (!user) return sendError(req, res, 404, "USER_NOT_FOUND");
    const posts = await Post.find({ authorUid: user.uid, ...space.visibleFilter(req.me.uid, req.friends), ...cursorFilter(req.query.cursor) })
      .sort({ createdAt: -1, _id: -1 })
      .limit(PAGE);
    res.json({ posts: await space.serializePosts(posts, req.me.uid), nextCursor: posts.length === PAGE ? encodeCursor(posts.at(-1)) : null });
  })
);

// =============================================================================
// Friends and follows
// =============================================================================

async function targetUser(req, res) {
  const user = await User.findOne({ uid: String(req.params.uid || req.body?.uid || "") });
  if (!user) {
    sendError(req, res, 404, "USER_NOT_FOUND");
    return null;
  }
  return user;
}

const profileList = async (uids) => {
  const users = await User.find({ uid: { $in: uids } }).select("uid username name photo bio");
  return users.map((u) => space.publicProfile(u));
};

router.get(
  "/friends",
  asyncHandler(async (req, res) => {
    const [incoming, outgoing] = await Promise.all([
      Friendship.find({ recipient: req.me.uid, status: "pending" }).sort({ createdAt: -1 }),
      Friendship.find({ requester: req.me.uid, status: "pending" }).sort({ createdAt: -1 }),
    ]);
    res.json({
      friends: await profileList(req.friends),
      incoming: await profileList(incoming.map((r) => r.requester)),
      outgoing: await profileList(outgoing.map((r) => r.recipient)),
      allowance: await space.allowance(req.me.uid),
    });
  })
);

// Send a friend request (or accept theirs if they already asked).
router.post(
  "/friends/requests",
  asyncHandler(async (req, res) => {
    const target = await targetUser(req, res);
    if (!target) return;
    if (target.uid === req.me.uid) return sendError(req, res, 400, "CANNOT_FRIEND_SELF");
    const key = space.pairKey(req.me.uid, target.uid);
    const existing = await Friendship.findOne({ pairKey: key });
    if (existing?.status === "accepted") return sendError(req, res, 409, "ALREADY_FRIENDS");
    if (existing?.requester === req.me.uid) return sendError(req, res, 409, "REQUEST_ALREADY_SENT");
    if (existing) {
      await Friendship.updateOne({ _id: existing._id, status: "pending" }, { $set: { status: "accepted", acceptedAt: new Date() } });
      await space.notify({ to: target.uid, type: "friend_accept", actor: req.me, dedupeKey: `fa:${key}` });
      return res.json({ relationship: await space.relationship(req.me.uid, target.uid) });
    }

    const today = await Friendship.countDocuments({ requester: req.me.uid, createdAt: { $gte: new Date(Date.now() - 86400000) } });
    if (today >= S.maxFriendRequestsPerDay) return sendError(req, res, 429, "FRIEND_REQUEST_LIMIT");
    try {
      await Friendship.create({ pairKey: key, requester: req.me.uid, recipient: target.uid, status: "pending" });
    } catch (error) {
      if (error?.code !== 11000) throw error; // simultaneous requests: the other one won
    }
    await space.notify({ to: target.uid, type: "friend_request", actor: req.me, dedupeKey: `fr:${key}:${req.me.uid}` });
    res.status(201).json({ relationship: await space.relationship(req.me.uid, target.uid) });
  })
);

router.post(
  "/friends/requests/:uid/accept",
  asyncHandler(async (req, res) => {
    const target = await targetUser(req, res);
    if (!target) return;
    const key = space.pairKey(req.me.uid, target.uid);
    const updated = await Friendship.findOneAndUpdate(
      { pairKey: key, requester: target.uid, recipient: req.me.uid, status: "pending" },
      { $set: { status: "accepted", acceptedAt: new Date() } },
      { new: true }
    );
    if (!updated) return sendError(req, res, 404, "REQUEST_NOT_FOUND");
    await Notification.updateOne({ dedupeKey: `fr:${key}:${target.uid}` }, { $set: { read: true } });
    await space.notify({ to: target.uid, type: "friend_accept", actor: req.me, dedupeKey: `fa:${key}` });
    res.json({ relationship: await space.relationship(req.me.uid, target.uid), allowance: await space.allowance(req.me.uid) });
  })
);

// Decline a request, cancel your own, or unfriend.
router.delete(
  "/friends/:uid",
  asyncHandler(async (req, res) => {
    const target = await targetUser(req, res);
    if (!target) return;
    const key = space.pairKey(req.me.uid, target.uid);
    const removed = await Friendship.findOneAndDelete({ pairKey: key });
    if (!removed) return sendError(req, res, 404, "REQUEST_NOT_FOUND");
    if (removed.status === "pending") await Notification.deleteOne({ dedupeKey: `fr:${key}:${removed.requester}` });
    res.json({ relationship: await space.relationship(req.me.uid, target.uid), allowance: await space.allowance(req.me.uid) });
  })
);

router.put(
  "/follow/:uid",
  asyncHandler(async (req, res) => {
    const target = await targetUser(req, res);
    if (!target) return;
    if (target.uid === req.me.uid) return sendError(req, res, 400, "CANNOT_FOLLOW_SELF");
    await Follow.updateOne({ follower: req.me.uid, following: target.uid }, { $setOnInsert: { follower: req.me.uid, following: target.uid } }, { upsert: true });
    res.json({ relationship: await space.relationship(req.me.uid, target.uid) });
  })
);

router.delete(
  "/follow/:uid",
  asyncHandler(async (req, res) => {
    const target = await targetUser(req, res);
    if (!target) return;
    await Follow.deleteOne({ follower: req.me.uid, following: target.uid });
    res.json({ relationship: await space.relationship(req.me.uid, target.uid) });
  })
);

// =============================================================================
// Posts
// =============================================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: S.maxVideoBytes, files: S.maxImages, fields: 10, fieldSize: 16 * 1024 },
}).array("media", S.maxImages);

// Turns multer's errors into friendly ones.
const handleUpload = (req, res, next) =>
  upload(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") return sendError(req, res, 413, "VIDEO_TOO_LARGE");
    if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") return sendError(req, res, 400, "TOO_MANY_FILES");
    return sendError(req, res, 400, "UPLOAD_FAILED");
  });

// POST /api/space/posts - multipart: text, privacy, media[] (up to 4 photos or 1 video).
router.post(
  "/posts",
  handleUpload,
  asyncHandler(async (req, res) => {
    const me = req.me;
    const text = cleanText(req.body?.text, S.maxTextLength);
    const privacy = req.body?.privacy || "public";
    if (!["public", "friends"].includes(privacy)) return sendError(req, res, 400, "INVALID_PRIVACY");

    // 1. Content checks.
    const inspected = media.inspectFiles(req.files || []);
    if (inspected.error) return sendError(req, res, 400, inspected.error);
    const files = inspected.media;
    if (!text && !files.length) return sendError(req, res, 400, "EMPTY_POST");
    const problem = textProblem(text, { maxLength: S.maxTextLength });
    if (problem) return sendError(req, res, 400, problem);

    // 2. Posting privileges by number of friends.
    const allowance = await space.allowance(me.uid);
    if (allowance.limit === 0) return sendError(req, res, 403, "POSTING_NOT_ALLOWED", {}, { allowance });
    if (!allowance.canPost) return sendError(req, res, 429, "DAILY_POST_LIMIT", { limit: allowance.limit }, { allowance });

    // 3. Anti-spam: burst limit, duplicates, repeated media.
    const last = await Post.findOne({ authorUid: me.uid }).sort({ createdAt: -1 }).select("createdAt");
    const sinceLast = last ? (Date.now() - last.createdAt.getTime()) / 1000 : Infinity;
    if (sinceLast < S.minSecondsBetweenPosts) {
      const seconds = Math.ceil(S.minSecondsBetweenPosts - sinceLast);
      return sendError(req, res, 429, "POSTING_TOO_FAST", { seconds }, { retryAfter: seconds });
    }
    const since = new Date(Date.now() - S.duplicateWindowDays * 86400000);
    const hash = contentHash(text, files.map((f) => f.hash));
    if (await Post.exists({ authorUid: me.uid, contentHash: hash, status: { $ne: "deleted" }, createdAt: { $gte: since } })) {
      return sendError(req, res, 409, "DUPLICATE_POST");
    }
    if (files.length && (await Post.exists({ authorUid: me.uid, "media.hash": { $in: files.map((f) => f.hash) }, status: { $ne: "deleted" }, createdAt: { $gte: since } }))) {
      return sendError(req, res, 409, "REPEATED_MEDIA");
    }

    // 4. Use one post from today's allowance (atomic).
    if (!(await space.claimPostSlot(me.uid, allowance.limit))) {
      return sendError(req, res, 429, "DAILY_POST_LIMIT", { limit: allowance.limit }, { allowance: await space.allowance(me.uid) });
    }

    // 5. Store media and create the post; undo everything if anything fails.
    const stored = [];
    try {
      for (const f of files) stored.push({ fileId: await media.storeFile(f, me.uid), kind: f.kind, mime: f.mime, size: f.size, hash: f.hash });
      const mentionUsers = await resolveMentions(text, me.uid);
      const post = await Post.create({
        author: space.authorOf(me),
        authorUid: me.uid,
        text,
        hashtags: extractHashtags(text),
        mentions: mentionUsers.map((u) => u.uid),
        media: stored,
        mediaType: files.length ? files[0].kind : "text",
        privacy,
        friendCountAtPost: allowance.friends,
        contentHash: hash,
      });
      for (const u of mentionUsers) {
        if (privacy === "friends" && !req.friendSet.has(u.uid)) continue; // they couldn't see it
        await space.notify({ to: u.uid, type: "mention", actor: me, postId: post._id, preview: text, dedupeKey: `m:${post._id}:${u.uid}` });
      }
      const [serialized] = await space.serializePosts([post], me.uid);
      res.status(201).json({ post: serialized, allowance: await space.allowance(me.uid) });
    } catch (error) {
      await media.deleteFiles(stored.map((s) => s.fileId));
      await space.releasePostSlot(me.uid);
      throw error;
    }
  })
);

router.get(
  "/posts/:id",
  asyncHandler(async (req, res) => {
    const post = await loadVisiblePost(req, res);
    if (post) res.json({ post: (await space.serializePosts([post], req.me.uid))[0] });
  })
);

// Edit text / privacy within the edit window (media can't be changed).
router.patch(
  "/posts/:id",
  asyncHandler(async (req, res) => {
    const post = await loadVisiblePost(req, res);
    if (!post) return;
    if (post.authorUid !== req.me.uid) return sendError(req, res, 403, "NOT_POST_AUTHOR");
    if ((Date.now() - post.createdAt.getTime()) / 60000 >= S.editWindowMinutes) {
      return sendError(req, res, 403, "EDIT_WINDOW_PASSED", { minutes: S.editWindowMinutes });
    }
    const text = req.body?.text !== undefined ? cleanText(req.body.text, S.maxTextLength) : post.text;
    const privacy = req.body?.privacy ?? post.privacy;
    if (!["public", "friends"].includes(privacy)) return sendError(req, res, 400, "INVALID_PRIVACY");
    if (!text && !post.media.length) return sendError(req, res, 400, "EMPTY_POST");
    const problem = textProblem(text, { maxLength: S.maxTextLength });
    if (problem) return sendError(req, res, 400, problem);

    const hash = contentHash(text, post.media.map((m) => m.hash));
    if (hash !== post.contentHash && (await Post.exists({ _id: { $ne: post._id }, authorUid: req.me.uid, contentHash: hash, status: { $ne: "deleted" } }))) {
      return sendError(req, res, 409, "DUPLICATE_POST");
    }
    const mentionUsers = await resolveMentions(text, req.me.uid);
    const newlyMentioned = mentionUsers.filter((u) => !post.mentions.includes(u.uid));
    const updated = await Post.findOneAndUpdate(
      { _id: post._id },
      { $set: { text, privacy, hashtags: extractHashtags(text), mentions: mentionUsers.map((u) => u.uid), contentHash: hash, editedAt: new Date() } },
      { new: true }
    );
    for (const u of newlyMentioned) {
      if (privacy === "friends" && !req.friendSet.has(u.uid)) continue;
      await space.notify({ to: u.uid, type: "mention", actor: req.me, postId: post._id, preview: text, dedupeKey: `m:${post._id}:${u.uid}` });
    }
    res.json({ post: (await space.serializePosts([updated], req.me.uid))[0] });
  })
);

router.delete(
  "/posts/:id",
  asyncHandler(async (req, res) => {
    const post = await loadVisiblePost(req, res);
    if (!post) return;
    if (post.authorUid !== req.me.uid) return sendError(req, res, 403, "NOT_POST_AUTHOR");
    if ((Date.now() - post.createdAt.getTime()) / 60000 >= S.deleteWindowMinutes) {
      return sendError(req, res, 403, "DELETE_WINDOW_PASSED", { minutes: S.deleteWindowMinutes });
    }
    await Post.updateOne({ _id: post._id }, { $set: { status: "deleted", deletedAt: new Date(), media: [] } });
    await media.deleteFiles(post.media.map((m) => m.fileId));
    await Notification.deleteMany({ postId: post._id });
    res.json({ deleted: true });
  })
);

// ---- Reactions ------------------------------------------------------------------------

// Adds or removes a one-per-user reaction and keeps the post's counter in step.
function toggle(Model, counter, onAdd) {
  return asyncHandler(async (req, res) => {
    const post = await loadVisiblePost(req, res);
    if (!post) return;
    const adding = req.method === "PUT";
    let changed = false;
    if (adding) {
      try {
        await Model.create({ postId: post._id, uid: req.me.uid });
        changed = true;
      } catch (error) {
        if (error?.code !== 11000) throw error; // already there: no change
      }
    } else {
      changed = (await Model.deleteOne({ postId: post._id, uid: req.me.uid })).deletedCount > 0;
    }
    if (changed) await Post.updateOne({ _id: post._id }, { $inc: { [counter]: adding ? 1 : -1 } });
    if (changed && adding && onAdd) await onAdd(req, post);
    const fresh = await Post.findById(post._id);
    res.json({ post: (await space.serializePosts([fresh], req.me.uid))[0] });
  });
}

const notifyLike = (req, post) =>
  space.notify({ to: post.authorUid, type: "like", actor: req.me, postId: post._id, preview: post.text, dedupeKey: `l:${post._id}:${req.me.uid}` });

router.put("/posts/:id/like", toggle(Like, "likeCount", notifyLike));
router.delete("/posts/:id/like", toggle(Like, "likeCount"));
router.put("/posts/:id/save", toggle(Save, "saveCount"));
router.delete("/posts/:id/save", toggle(Save, "saveCount"));

// Counted once per user, when the post is actually seen in the feed.
router.post(
  "/posts/:id/view",
  asyncHandler(async (req, res) => {
    const post = await loadVisiblePost(req, res);
    if (!post) return;
    try {
      await View.create({ postId: post._id, uid: req.me.uid });
      await Post.updateOne({ _id: post._id }, { $inc: { viewCount: 1 } });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
    res.json({ ok: true });
  })
);

// channel: "link" (copied link), "native" (device share sheet), or "friend" (+ toUid).
router.post(
  "/posts/:id/share",
  asyncHandler(async (req, res) => {
    const post = await loadVisiblePost(req, res);
    if (!post) return;
    const channel = ["link", "friend", "native"].includes(req.body?.channel) ? req.body.channel : "link";
    let toUid = null;
    if (channel === "friend") {
      toUid = String(req.body?.toUid || "");
      if (!req.friendSet.has(toUid)) return sendError(req, res, 400, "SHARE_NOT_ALLOWED");
      // A friends-only post can only be sent to someone who may see it.
      if (post.privacy === "friends" && post.authorUid !== toUid && !(await space.friendUids(post.authorUid)).includes(toUid)) {
        return sendError(req, res, 400, "SHARE_NOT_ALLOWED");
      }
    }
    await Share.create({ postId: post._id, uid: req.me.uid, channel, toUid });
    await Post.updateOne({ _id: post._id }, { $inc: { shareCount: 1 } });
    await space.notify({ to: post.authorUid, type: "share", actor: req.me, postId: post._id, preview: post.text, dedupeKey: `s:${post._id}:${req.me.uid}` });
    if (toUid) await space.notify({ to: toUid, type: "share_to_you", actor: req.me, postId: post._id, preview: post.text });
    const fresh = await Post.findById(post._id);
    res.json({ post: (await space.serializePosts([fresh], req.me.uid))[0] });
  })
);

const REPORT_REASONS = ["spam", "inappropriate", "harassment", "violence", "misinformation", "other"];
router.post(
  "/posts/:id/report",
  asyncHandler(async (req, res) => {
    const post = await loadVisiblePost(req, res);
    if (!post) return;
    if (post.authorUid === req.me.uid) return sendError(req, res, 400, "CANNOT_REPORT_OWN");
    const reason = req.body?.reason;
    if (!REPORT_REASONS.includes(reason)) return sendError(req, res, 400, "INVALID_REPORT_REASON");
    const recent = await Report.countDocuments({ uid: req.me.uid, createdAt: { $gte: new Date(Date.now() - 86400000) } });
    if (recent >= S.maxReportsPerDay) return sendError(req, res, 429, "REPORT_LIMIT");
    try {
      await Report.create({ postId: post._id, uid: req.me.uid, reason, details: cleanText(req.body?.details, 300).slice(0, 300) });
    } catch (error) {
      if (error?.code === 11000) return sendError(req, res, 409, "ALREADY_REPORTED");
      throw error;
    }
    const updated = await Post.findOneAndUpdate({ _id: post._id }, { $inc: { reportCount: 1 } }, { new: true });
    // Enough independent reports hide the post until it is reviewed.
    if (updated.reportCount >= S.autoHideReports && updated.status === "active") {
      await Post.updateOne({ _id: post._id, status: "active" }, { $set: { status: "hidden" } });
    }
    res.json({ reported: true });
  })
);

// ---- Comments ---------------------------------------------------------------------------

router.get(
  "/posts/:id/comments",
  asyncHandler(async (req, res) => {
    const post = await loadVisiblePost(req, res);
    if (!post) return;
    const filter = { postId: post._id, status: "active" };
    if (typeof req.query.after === "string" && isId(req.query.after)) filter._id = { $gt: new mongoose.Types.ObjectId(req.query.after) };
    const comments = await Comment.find(filter).sort({ _id: 1 }).limit(20);
    res.json({
      comments: comments.map((c) => ({
        id: c._id,
        author: c.author,
        text: c.text,
        createdAt: c.createdAt,
        canDelete: c.authorUid === req.me.uid || post.authorUid === req.me.uid,
      })),
      nextAfter: comments.length === 20 ? comments.at(-1)._id : null,
    });
  })
);

router.post(
  "/posts/:id/comments",
  asyncHandler(async (req, res) => {
    const post = await loadVisiblePost(req, res);
    if (!post) return;
    const text = cleanText(req.body?.text, S.maxCommentLength);
    if (!text) return sendError(req, res, 400, "EMPTY_COMMENT");
    const problem = textProblem(text, { maxLength: S.maxCommentLength });
    if (problem) return sendError(req, res, 400, problem);

    const minuteAgo = new Date(Date.now() - 60000);
    if ((await Comment.countDocuments({ authorUid: req.me.uid, createdAt: { $gte: minuteAgo } })) >= S.maxCommentsPerMinute) {
      return sendError(req, res, 429, "COMMENT_TOO_FAST");
    }
    if (await Comment.exists({ postId: post._id, authorUid: req.me.uid, text, status: "active" })) {
      return sendError(req, res, 409, "DUPLICATE_COMMENT");
    }
    const mentionUsers = await resolveMentions(text, req.me.uid);
    const comment = await Comment.create({ postId: post._id, author: space.authorOf(req.me), authorUid: req.me.uid, text, mentions: mentionUsers.map((u) => u.uid) });
    await Post.updateOne({ _id: post._id }, { $inc: { commentCount: 1 } });
    await space.notify({ to: post.authorUid, type: "comment", actor: req.me, postId: post._id, preview: text });
    for (const u of mentionUsers) {
      if (u.uid === post.authorUid) continue;
      await space.notify({ to: u.uid, type: "mention", actor: req.me, postId: post._id, preview: text });
    }
    res.status(201).json({ comment: { id: comment._id, author: comment.author, text, createdAt: comment.createdAt, canDelete: true } });
  })
);

router.delete(
  "/comments/:id",
  asyncHandler(async (req, res) => {
    const comment = isId(req.params.id) ? await Comment.findOne({ _id: req.params.id, status: "active" }) : null;
    if (!comment) return sendError(req, res, 404, "COMMENT_NOT_FOUND");
    const post = await Post.findById(comment.postId).select("authorUid");
    if (comment.authorUid !== req.me.uid && post?.authorUid !== req.me.uid) return sendError(req, res, 403, "NOT_POST_AUTHOR");
    const result = await Comment.updateOne({ _id: comment._id, status: "active" }, { $set: { status: "deleted" } });
    if (result.modifiedCount) await Post.updateOne({ _id: comment.postId }, { $inc: { commentCount: -1 } });
    res.json({ deleted: true });
  })
);

// =============================================================================
// Feed, hashtags, saved
// =============================================================================

// Score for trending: engagement weighted by type, decaying with age.
const trendScore = (p) => {
  const hours = (Date.now() - p.createdAt.getTime()) / 3600000;
  const engagement = p.likeCount * 3 + p.commentCount * 4 + p.shareCount * 5 + p.saveCount * 2 + p.viewCount * 0.1;
  return engagement / Math.pow(hours + 2, 1.5);
};

// GET /api/space/feed?section=friends|trending|recent&cursor=...
// The page loads "friends" first (your friends' and your own recent posts),
// then "trending", then "recent" public posts from everyone else.
router.get(
  "/feed",
  asyncHandler(async (req, res) => {
    const section = ["friends", "trending", "recent"].includes(req.query.section) ? req.query.section : "friends";
    const circle = [...req.friends, req.me.uid];
    let posts = [];
    let nextCursor = null;

    if (section === "friends") {
      posts = await Post.find({
        authorUid: { $in: circle },
        status: "active",
        createdAt: { $gte: new Date(Date.now() - S.friendsFeedDays * 86400000) },
        ...cursorFilter(req.query.cursor),
      })
        .sort({ createdAt: -1, _id: -1 })
        .limit(PAGE);
      nextCursor = posts.length === PAGE ? encodeCursor(posts.at(-1)) : null;
    } else if (section === "trending") {
      const candidates = await Post.find({
        status: "active",
        privacy: "public",
        authorUid: { $nin: circle },
        createdAt: { $gte: new Date(Date.now() - S.trendingHours * 3600000) },
      })
        .sort({ createdAt: -1 })
        .limit(300);
      const ranked = candidates
        .map((p) => ({ p, score: trendScore(p) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.p);
      const offset = Math.max(0, parseInt(req.query.cursor, 10) || 0);
      posts = ranked.slice(offset, offset + PAGE);
      nextCursor = offset + PAGE < Math.min(ranked.length, 50) ? String(offset + PAGE) : null;
    } else {
      posts = await Post.find({ status: "active", privacy: "public", authorUid: { $nin: circle }, ...cursorFilter(req.query.cursor) })
        .sort({ createdAt: -1, _id: -1 })
        .limit(PAGE);
      nextCursor = posts.length === PAGE ? encodeCursor(posts.at(-1)) : null;
    }
    res.json({ section, posts: await space.serializePosts(posts, req.me.uid), nextCursor });
  })
);

router.get(
  "/hashtags/trending",
  asyncHandler(async (req, res) => {
    const tags = await Post.aggregate([
      { $match: { status: "active", privacy: "public", createdAt: { $gte: new Date(Date.now() - 7 * 86400000) } } },
      { $unwind: "$hashtags" },
      { $group: { _id: "$hashtags", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 10 },
    ]);
    res.json({ tags: tags.map((t) => ({ tag: t._id, count: t.count })) });
  })
);

router.get(
  "/hashtags/:tag",
  asyncHandler(async (req, res) => {
    const tag = String(req.params.tag).replace(/^#/, "").toLowerCase();
    const posts = await Post.find({ hashtags: tag, ...space.visibleFilter(req.me.uid, req.friends), ...cursorFilter(req.query.cursor) })
      .sort({ createdAt: -1, _id: -1 })
      .limit(PAGE);
    res.json({ tag, posts: await space.serializePosts(posts, req.me.uid), nextCursor: posts.length === PAGE ? encodeCursor(posts.at(-1)) : null });
  })
);

router.get(
  "/saved",
  asyncHandler(async (req, res) => {
    const saves = await Save.find({ uid: req.me.uid, ...cursorFilter(req.query.cursor) }).sort({ createdAt: -1, _id: -1 }).limit(PAGE);
    const posts = await Post.find({ _id: { $in: saves.map((s) => s.postId) } });
    const visible = saves.map((s) => posts.find((p) => p._id.equals(s.postId))).filter((p) => space.canView(p, req.me.uid, req.friendSet));
    res.json({ posts: await space.serializePosts(visible, req.me.uid), nextCursor: saves.length === PAGE ? encodeCursor(saves.at(-1)) : null });
  })
);

// =============================================================================
// Notifications
// =============================================================================

router.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const list = await Notification.find({ uid: req.me.uid, ...cursorFilter(req.query.cursor, "updatedAt") })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(20);
    res.json({
      notifications: list.map((n) => ({ id: n._id, type: n.type, actor: n.actor, postId: n.postId, preview: n.preview, read: n.read, at: n.updatedAt })),
      nextCursor: list.length === 20 ? encodeCursor(list.at(-1), "updatedAt") : null,
      unread: await Notification.countDocuments({ uid: req.me.uid, read: false }),
    });
  })
);

router.get(
  "/notifications/unread-count",
  asyncHandler(async (req, res) => {
    res.json({ unread: await Notification.countDocuments({ uid: req.me.uid, read: false }) });
  })
);

router.post(
  "/notifications/read",
  asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(isId) : [];
    const filter = req.body?.all ? { uid: req.me.uid, read: false } : { uid: req.me.uid, _id: { $in: ids } };
    await Notification.updateMany(filter, { $set: { read: true } }, { timestamps: false });
    res.json({ unread: await Notification.countDocuments({ uid: req.me.uid, read: false }) });
  })
);

module.exports = router;
