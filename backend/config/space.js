// Public Space settings. Everything marked "env" can be changed in .env.

const intFromEnv = (name, fallback) => {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

// Daily posting allowance by number of accepted friends (from the task).
// null = no daily limit.
function postingLimitFor(friendCount) {
  if (friendCount <= 0) return { tier: "none", limit: 0 };
  if (friendCount === 1) return { tier: "one", limit: 1 };
  if (friendCount <= 5) return { tier: "few", limit: 2 };
  if (friendCount <= 10) return { tier: "many", limit: 5 };
  return { tier: "unlimited", limit: null };
}

const SPACE_SETTINGS = {
  // "Per day" means the calendar day in this time zone (resets at midnight).
  timeZone: process.env.SPACE_TIME_ZONE || "Asia/Kolkata",
  // Authors may edit / delete their posts for this long after posting (env).
  editWindowMinutes: intFromEnv("POST_EDIT_WINDOW_MINUTES", 60),
  deleteWindowMinutes: intFromEnv("POST_DELETE_WINDOW_MINUTES", 60),
  // Burst limit for everyone, including unlimited users (anti-spam).
  minSecondsBetweenPosts: intFromEnv("POST_MIN_SECONDS_BETWEEN", 60),
  // The same text/media can't be posted again by the same user within this time.
  duplicateWindowDays: intFromEnv("POST_DUPLICATE_WINDOW_DAYS", 30),
  // Posts are hidden automatically after this many distinct reports.
  autoHideReports: intFromEnv("POST_AUTO_HIDE_REPORTS", 3),

  maxTextLength: 2000,
  maxCommentLength: 500,
  maxHashtags: 10,
  maxMentions: 10,
  maxLinks: 3,
  maxImages: 4,
  maxImageBytes: intFromEnv("POST_MAX_IMAGE_MB", 5) * 1024 * 1024,
  maxVideoBytes: intFromEnv("POST_MAX_VIDEO_MB", 50) * 1024 * 1024,

  // Comments: at most this many per minute, and no identical comment on the same post.
  maxCommentsPerMinute: intFromEnv("COMMENTS_PER_MINUTE", 10),
  maxFriendRequestsPerDay: intFromEnv("FRIEND_REQUESTS_PER_DAY", 30),
  maxReportsPerDay: intFromEnv("REPORTS_PER_DAY", 20),

  // Feed: how far back each section looks.
  friendsFeedDays: 7,
  trendingHours: 72,
  // Signed media links stay valid for this long.
  mediaLinkHours: 12,
};

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

module.exports = { SPACE_SETTINGS, postingLimitFor, IMAGE_TYPES, VIDEO_TYPES };
