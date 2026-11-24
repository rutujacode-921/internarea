# Public Space (Task 4)

A community area where students post text, photos and videos, interact with each other's posts, and connect as friends.

## Setup

Run `npm install` in `backend/` (this adds `multer` for uploads). No other services or keys are needed: photos and videos are stored in your MongoDB using GridFS. All limits can be changed through the variables in `backend/.env.example`.

## Pages

| Route | What it shows |
|---|---|
| `/space` | Composer and personalised feed |
| `/space/friends` | Friends, requests (incoming and sent), and people search |
| `/space/notifications` | Notifications. There's also a bell with an unread count in the navbar. |
| `/space/saved` | Saved posts |
| `/space/u/[username]` | A user's profile: follow, add friend, posts. You can edit your own username and bio. |
| `/space/tag/[tag]` | Posts with a hashtag |
| `/space/post/[id]` | A single post (shared links and notifications open here) |

## How it meets the task

| Requirement | Implementation |
|---|---|
| Posts with photos, videos or text | Text up to 2,000 characters, with up to 4 photos (JPG/PNG/WebP/GIF, up to 5 MB each) or 1 video (MP4/WebM/MOV, up to 50 MB). File types are checked from the file contents, not the name. |
| Like, comment, share, save, report | One like, save, report and view per user per post, enforced by unique database indexes. Share by copying the link, using the device share sheet, or sending to a friend. |
| Follow, friend requests, @mentions, #hashtags | Friend requests with accept, decline and cancel; unfriend; follow. Requests sent both ways are accepted automatically. `@username` and `#tag` become links, mentions notify the person, and hashtags have their own pages plus a trending list. |
| Posting limits by number of friends | 0 friends: no posting. 1 friend: 1 post a day. 2–5: 2 a day. 6–10: 5 a day. More than 10: no daily limit. "A day" resets at midnight in `SPACE_TIME_ZONE`. The count is claimed atomically, so posts sent at the same moment can't go over the limit, and deleting a post doesn't give the post back. |
| Complete post information | Author profile, friend count at the time of posting, timestamp, media type, privacy, and like, comment, share, save and view counts (`Model/Space.js`) |
| Privacy settings | Everyone, or friends only. Friends-only posts never appear in strangers' feeds, hashtag pages, search results or links. Their media is served through signed, expiring links. |
| Edit or delete within a time limit | Configurable with `POST_EDIT_WINDOW_MINUTES` and `POST_DELETE_WINDOW_MINUTES` (default 60). The post menu shows the deadline. |
| Duplicates, excessive posting, spam, repeated media, inappropriate content | Identical text and media can't be re-posted within 30 days. Media already used is refused (SHA-256 match). At least 60 seconds between posts. Limits on links (3), hashtags (10) and mentions (10). Repeated-character spam is blocked. A blocked-word filter catches common disguises like `f@ck` and `s.h.i.t`. Comments are limited per minute and can't repeat. Friend requests and reports have daily limits. Posts reported by 3 different users are hidden automatically. |
| Personalised feed | Friends' (and your own) posts from the last 7 days come first. Then trending public posts from the last 72 hours, scored by likes, comments, shares, saves and views with time decay. Then recent public posts. |
| Notifications | Likes, comments, shares (including "shared with you"), friend requests and acceptances, and mentions. Repeated likes don't produce repeated notifications. |

All screens and messages are translated into the six supported languages.

## Limitations

- **Moderation:** text is filtered automatically, but photos and videos aren't scanned by AI. Inappropriate media is caught by user reports, which hide it automatically. A moderator review screen for hidden posts isn't included, because the existing admin login isn't secure enough to protect it.
- **Notifications:** they appear in the app (the bell checks every minute) rather than by email or push.
- **Videos:** they play as uploaded. There's no compression or transcoding.
