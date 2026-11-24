const mongoose = require("mongoose");
const { Schema } = mongoose;

// ---- Social graph ----------------------------------------------------------------

// A friend request. Once accepted, the two users are friends. pairKey (both
// uids, sorted) allows only one relationship per pair of users.
const FriendshipSchema = new Schema(
  {
    pairKey: { type: String, required: true, unique: true },
    requester: { type: String, required: true, index: true },
    recipient: { type: String, required: true, index: true },
    status: { type: String, enum: ["pending", "accepted"], required: true },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
FriendshipSchema.index({ requester: 1, status: 1 });
FriendshipSchema.index({ recipient: 1, status: 1 });

const FollowSchema = new Schema(
  {
    follower: { type: String, required: true },
    following: { type: String, required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
FollowSchema.index({ follower: 1, following: 1 }, { unique: true });

// ---- Posts -----------------------------------------------------------------------

const AuthorSchema = new Schema({ uid: String, name: String, username: String, photo: String }, { _id: false });

const MediaSchema = new Schema(
  {
    fileId: { type: Schema.Types.ObjectId, required: true }, // GridFS file
    kind: { type: String, enum: ["image", "video"], required: true },
    mime: String,
    size: Number,
    hash: String, // SHA-256 of the file, to block repeated uploads
  },
  { _id: false }
);

const PostSchema = new Schema(
  {
    author: { type: AuthorSchema, required: true },
    authorUid: { type: String, required: true, index: true },
    text: { type: String, default: "" },
    hashtags: { type: [String], default: [], index: true },
    mentions: { type: [String], default: [] }, // uids
    media: { type: [MediaSchema], default: [] },
    mediaType: { type: String, enum: ["text", "image", "video"], required: true },
    privacy: { type: String, enum: ["public", "friends"], default: "public" },
    // Snapshot of the author's accepted friends when the post was created.
    friendCountAtPost: { type: Number, required: true },
    likeCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    shareCount: { type: Number, default: 0 },
    saveCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
    reportCount: { type: Number, default: 0 },
    // "hidden" = removed from feeds after reports, pending review.
    status: { type: String, enum: ["active", "hidden", "deleted"], default: "active", index: true },
    // Normalised text + media hashes, to block duplicate posts.
    contentHash: { type: String, index: true },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
PostSchema.index({ status: 1, privacy: 1, createdAt: -1 });
PostSchema.index({ authorUid: 1, createdAt: -1 });

const CommentSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, ref: "Post", required: true, index: true },
    author: { type: AuthorSchema, required: true },
    authorUid: { type: String, required: true, index: true },
    text: { type: String, required: true },
    mentions: { type: [String], default: [] },
    status: { type: String, enum: ["active", "deleted"], default: "active" },
  },
  { timestamps: true }
);
CommentSchema.index({ postId: 1, createdAt: 1 });

// One row per user per post, so each can only like / save / report / view once.
const reaction = (extra = {}) => {
  const schema = new Schema(
    { postId: { type: Schema.Types.ObjectId, ref: "Post", required: true }, uid: { type: String, required: true }, ...extra },
    { timestamps: { createdAt: true, updatedAt: false } }
  );
  schema.index({ postId: 1, uid: 1 }, { unique: true });
  schema.index({ uid: 1, createdAt: -1 });
  return schema;
};

const ShareSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, ref: "Post", required: true, index: true },
    uid: { type: String, required: true },
    channel: { type: String, enum: ["link", "friend", "native"], default: "link" },
    toUid: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Posts made per user per day (counted even if later deleted, so deleting
// can't be used to get around the daily limit).
const PostQuotaSchema = new Schema({
  uid: { type: String, required: true },
  day: { type: String, required: true }, // YYYY-MM-DD in SPACE_SETTINGS.timeZone
  count: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 3 },
});
PostQuotaSchema.index({ uid: 1, day: 1 }, { unique: true });

// ---- Notifications ---------------------------------------------------------------

const NotificationSchema = new Schema(
  {
    uid: { type: String, required: true }, // recipient
    type: {
      type: String,
      enum: ["like", "comment", "share", "share_to_you", "friend_request", "friend_accept", "mention"],
      required: true,
    },
    actor: { type: AuthorSchema, required: true },
    postId: { type: Schema.Types.ObjectId, ref: "Post", default: null },
    preview: { type: String, default: "" },
    read: { type: Boolean, default: false },
    // Repeat actions (unlike + like again) update one notification instead of adding more.
    dedupeKey: { type: String, default: null },
  },
  { timestamps: true }
);
NotificationSchema.index({ uid: 1, createdAt: -1 });
NotificationSchema.index({ uid: 1, read: 1 });
NotificationSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } });

module.exports = {
  Friendship: mongoose.model("Friendship", FriendshipSchema),
  Follow: mongoose.model("Follow", FollowSchema),
  Post: mongoose.model("Post", PostSchema),
  Comment: mongoose.model("Comment", CommentSchema),
  Like: mongoose.model("PostLike", reaction()),
  Save: mongoose.model("PostSave", reaction()),
  Report: mongoose.model(
    "PostReport",
    reaction({ reason: { type: String, enum: ["spam", "inappropriate", "harassment", "violence", "misinformation", "other"], required: true }, details: String })
  ),
  View: mongoose.model("PostView", reaction()),
  Share: mongoose.model("PostShare", ShareSchema),
  PostQuota: mongoose.model("PostQuota", PostQuotaSchema),
  Notification: mongoose.model("Notification", NotificationSchema),
};
