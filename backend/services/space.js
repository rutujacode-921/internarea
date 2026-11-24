const crypto = require("crypto");
const User = require("../Model/User");
const { Friendship, Follow, Like, Save, Report, PostQuota, Notification } = require("../Model/Space");
const { getOrCreateUser } = require("../utils/users");
const { SPACE_SETTINGS: S, postingLimitFor } = require("../config/space");
const { mediaUrl } = require("./media");

const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
const pairKey = (a, b) => [a, b].sort().join("|");

// ---- Profiles ----------------------------------------------------------------------

function baseUsername(user) {
  const source = (user.email && user.email.split("@")[0]) || user.name || "user";
  let base = source.toLowerCase().normalize("NFKD").replace(/[^a-z0-9_.]/g, "").replace(/^\.+|\.+$/g, "");
  if (base.length < 3) base = `user${base}`;
  return base.slice(0, 15);
}

// Makes sure the signed-in user has a Space profile (unique username, photo).
async function ensureProfile(authUser) {
  let user = await getOrCreateUser(authUser);
  const updates = {};
  if (authUser.photo && authUser.photo !== user.photo) updates.photo = authUser.photo;
  if (Object.keys(updates).length) user = await User.findOneAndUpdate({ _id: user._id }, { $set: updates }, { new: true });
  if (user.username) return user;

  const base = baseUsername(user);
  for (let i = 0; i < 8; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 15)}${crypto.randomInt(1000, 99999)}`;
    try {
      const updated = await User.findOneAndUpdate({ _id: user._id, username: null }, { $set: { username: candidate } }, { new: true });
      return updated || User.findById(user._id);
    } catch (error) {
      if (error?.code !== 11000) throw error; // taken: try another
    }
  }
  throw new Error("Could not assign a username");
}

const authorOf = (user) => ({ uid: user.uid, name: user.name || user.username, username: user.username, photo: user.photo || null });

// ---- Friends -------------------------------------------------------------------------

async function friendUids(uid) {
  const rows = await Friendship.find({ status: "accepted", $or: [{ requester: uid }, { recipient: uid }] }).select("requester recipient");
  return rows.map((r) => (r.requester === uid ? r.recipient : r.requester));
}

const friendCount = (uid) => Friendship.countDocuments({ status: "accepted", $or: [{ requester: uid }, { recipient: uid }] });

async function relationship(viewerUid, targetUid) {
  if (viewerUid === targetUid) return { self: true };
  const [link, following, followedBy] = await Promise.all([
    Friendship.findOne({ pairKey: pairKey(viewerUid, targetUid) }),
    Follow.exists({ follower: viewerUid, following: targetUid }),
    Follow.exists({ follower: targetUid, following: viewerUid }),
  ]);
  let friend = "none";
  if (link?.status === "accepted") friend = "friends";
  else if (link?.status === "pending") friend = link.requester === viewerUid ? "request_sent" : "request_received";
  return { self: false, friend, following: Boolean(following), followedBy: Boolean(followedBy) };
}

// ---- Daily posting allowance -----------------------------------------------------------

// Calendar day (YYYY-MM-DD) in the configured time zone.
const dayKey = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: S.timeZone }).format(date);

// The next local midnight, as a Date.
function nextMidnight(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: S.timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offsetMs = asUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(parts.year, parts.month - 1, Number(parts.day) + 1) - offsetMs);
}

async function allowance(uid) {
  const friends = await friendCount(uid);
  const { tier, limit } = postingLimitFor(friends);
  const quota = await PostQuota.findOne({ uid, day: dayKey() });
  const used = quota?.count || 0;
  return {
    friends,
    tier,
    limit, // null = unlimited
    usedToday: used,
    remaining: limit === null ? null : Math.max(0, limit - used),
    canPost: limit === null || used < limit,
    resetsAt: nextMidnight(),
  };
}

// Atomically uses one post from today's allowance. Two posts submitted at the
// same moment can't both squeeze past the limit.
async function claimPostSlot(uid, limit) {
  const day = dayKey();
  if (limit === null) {
    await PostQuota.updateOne({ uid, day }, { $inc: { count: 1 }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    return true;
  }
  try {
    const doc = await PostQuota.findOneAndUpdate(
      { uid, day, count: { $lt: limit } },
      { $inc: { count: 1 }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, new: true }
    );
    return Boolean(doc);
  } catch (error) {
    if (error?.code === 11000) return false; // today's quota exists and is full
    throw error;
  }
}

const releasePostSlot = (uid) => PostQuota.updateOne({ uid, day: dayKey(), count: { $gt: 0 } }, { $inc: { count: -1 } });

// ---- Visibility ---------------------------------------------------------------------------

function canView(post, viewerUid, friendSet) {
  if (!post || post.status === "deleted") return false;
  const own = post.authorUid === viewerUid;
  if (post.status === "hidden" && !own) return false;
  if (post.privacy === "friends" && !own && !friendSet.has(post.authorUid)) return false;
  return true;
}

// Mongo filter for posts a viewer may see (used by lists).
const visibleFilter = (viewerUid, friends) => ({
  $or: [
    { status: "active", privacy: "public" },
    { status: "active", privacy: "friends", authorUid: { $in: friends } },
    { status: { $in: ["active", "hidden"] }, authorUid: viewerUid },
  ],
});

// ---- Serialising posts -----------------------------------------------------------------------

const minutesSince = (date) => (Date.now() - new Date(date).getTime()) / 60000;

async function serializePosts(posts, viewerUid) {
  if (!posts.length) return [];
  const ids = posts.map((p) => p._id);
  const [likes, saves, reports] = await Promise.all([
    Like.find({ uid: viewerUid, postId: { $in: ids } }).select("postId"),
    Save.find({ uid: viewerUid, postId: { $in: ids } }).select("postId"),
    Report.find({ uid: viewerUid, postId: { $in: ids } }).select("postId"),
  ]);
  const has = (rows) => new Set(rows.map((r) => String(r.postId)));
  const liked = has(likes);
  const saved = has(saves);
  const reported = has(reports);

  return posts.map((p) => {
    const own = p.authorUid === viewerUid;
    const age = minutesSince(p.createdAt);
    return {
      id: p._id,
      author: p.author,
      text: p.text,
      hashtags: p.hashtags,
      media: p.media.map((m) => ({ kind: m.kind, mime: m.mime, url: mediaUrl(m.fileId) })),
      mediaType: p.mediaType,
      privacy: p.privacy,
      friendCountAtPost: p.friendCountAtPost,
      likeCount: p.likeCount,
      commentCount: p.commentCount,
      shareCount: p.shareCount,
      saveCount: p.saveCount,
      viewCount: p.viewCount,
      status: p.status,
      createdAt: p.createdAt,
      editedAt: p.editedAt,
      viewer: {
        isAuthor: own,
        liked: liked.has(String(p._id)),
        saved: saved.has(String(p._id)),
        reported: reported.has(String(p._id)),
        canEdit: own && age < S.editWindowMinutes,
        canDelete: own && age < S.deleteWindowMinutes,
        editableUntil: new Date(new Date(p.createdAt).getTime() + S.editWindowMinutes * 60000),
        deletableUntil: new Date(new Date(p.createdAt).getTime() + S.deleteWindowMinutes * 60000),
      },
    };
  });
}

const publicProfile = (user, counts = {}) => ({
  uid: user.uid,
  username: user.username,
  name: user.name || user.username,
  photo: user.photo || null,
  bio: user.bio || "",
  ...counts,
});

// ---- Notifications -------------------------------------------------------------------------

// Sends an in-app notification. Repeated actions with the same dedupeKey
// (e.g. like, unlike, like) refresh one notification instead of piling up.
async function notify({ to, type, actor, postId = null, preview = "", dedupeKey = null }) {
  if (!to || to === actor.uid) return;
  const doc = { uid: to, type, actor: authorOf(actor), postId, preview: String(preview).slice(0, 140), read: false };
  try {
    if (dedupeKey) {
      await Notification.findOneAndUpdate({ dedupeKey }, { $set: doc, $setOnInsert: { dedupeKey } }, { upsert: true });
    } else {
      await Notification.create(doc);
    }
  } catch (error) {
    // Notifications must never break the action that triggered them.
    if (error?.code !== 11000) console.error("Failed to create notification:", error.message);
  }
}

module.exports = {
  USERNAME_RE,
  pairKey,
  ensureProfile,
  authorOf,
  friendUids,
  friendCount,
  relationship,
  allowance,
  claimPostSlot,
  releasePostSlot,
  dayKey,
  canView,
  visibleFilter,
  serializePosts,
  publicProfile,
  notify,
};
