# Meta App Review pack — AffiliateOS

Meta App ID `1612067306883077` · Business portfolio **Affiliateos** (`2168971490379606`) · Login configuration `1599197921970843` (Facebook Login for Business, system-user token).

Meta requires **Advanced Access** for comment webhooks, even for your own account. Advanced Access needs **App Review**, and App Review needs **Business Verification**. Order:

1. Business Verification (Affiliateos portfolio)
2. App Review (3 permissions below)
3. Publish (Live)

---

## 0. Before you submit — checklist

| Item | Where | Value / file | Status |
|---|---|---|---|
| Instagram account in the Affiliateos portfolio | Business Settings → Accounts → Instagram accounts | @trendism.in | ☐ you |
| Facebook Page linked to @trendism.in, in Affiliateos | Page settings → Linked accounts; Business Settings → Pages | Trendism (Digital creator) | ☐ you |
| Business Verification | Business Settings → Security Center | legal name, address, phone, document (e.g. GST/registration or utility bill), plus a website or email you control | ☐ you |
| App icon 1024×1024 | App settings → Basic | `docs/meta/app-icon-1024.png` | ☐ upload |
| Category | App settings → Basic | Business and pages (or Shopping) | ☐ |
| Privacy Policy URL | App settings → Basic | https://affiliateos-api.rakshitdembla.workers.dev/privacy | ✅ live |
| Terms of Service URL | App settings → Basic | https://affiliateos-api.rakshitdembla.workers.dev/terms | ✅ live |
| User data deletion (callback URL) | App settings → Basic and FB Login for Business → Settings | https://affiliateos-api.rakshitdembla.workers.dev/oauth/instagram/data-deletion | ✅ returns `{url, confirmation_code}` for a valid signed request |
| Deauthorize callback | FB Login for Business → Settings | https://affiliateos-api.rakshitdembla.workers.dev/oauth/instagram/deauthorize | ✅ |
| App domain | App settings → Basic | affiliateos-api.rakshitdembla.workers.dev | ☐ |
| Webhook verified + `comments` subscribed | Webhooks (Instagram object) | https://affiliateos-api.rakshitdembla.workers.dev/webhooks/instagram | ☐ (token on your clipboard) |
| `META_APP_SECRET` on the server | Terminal | `pnpm exec wrangler secret put META_APP_SECRET` | ☐ you |

Request **only** these three permissions. Private replies need `instagram_manage_messages` as well as `instagram_manage_comments` (Meta's private-replies doc), so all three are required.

---

## 1. App description (paste into the review form)

> AffiliateOS is a private tool used by one Instagram creator (@trendism.in) and their own business. When a follower comments a keyword such as "LINK" on one of the creator's reels, AffiliateOS sends that person one private reply containing a link to the shopping collection shown in the reel. The person explicitly asked for the link by commenting. The app is not offered to other businesses or the public. Only the creator logs in, using Facebook Login for Business. Comment events arrive through Instagram webhooks and replies are sent with the Instagram private replies API. Each comment gets at most one reply, and only within Instagram's 7-day window.

## 2. Permission justifications

### instagram_basic
- **What it's used for:** reading the connected account's username and profile picture, and listing its recent posts and reels. The creator uses that list to choose which reel an automation applies to.
- **API calls:** `GET /{ig-user-id}?fields=id,username,profile_picture_url`, `GET /{ig-user-id}/media?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,timestamp`, `GET /me/assigned_instagram_accounts`.
- **Why it's needed:** without it, the creator would have to find internal media IDs by hand. The data is shown only to the account owner inside the private tool.

### instagram_manage_comments
- **What it's used for:** receiving `comments` webhook notifications for the creator's own reels, to detect when a follower asks for a link (e.g. comments "LINK"). It's also used to subscribe the account to those notifications (`POST /{ig-user-id}/subscribed_apps?subscribed_fields=comments`).
- **Data handling:** only the comment id, text, media id and the commenter's Instagram-scoped id and username are stored. They're used to decide whether to reply and to address the reply. Raw events are deleted after 90 days.
- **Why it's needed:** this is the trigger for the whole feature. The app never posts, edits, hides or deletes comments.

### instagram_manage_messages
- **What it's used for:** sending one private reply to a comment that asked for the link (`POST /{ig-user-id}/messages` with `recipient.comment_id`). It's also used to check delivery for a reply whose result was unknown (Conversations API, read-only, the 20 most recent messages).
- **Safeguards:**
  - at most one reply per comment, and one per person per post;
  - only within 7 days;
  - rate-limited well below Meta's limits (default 200 per hour, hard cap 700);
  - stops automatically on Meta errors that indicate a problem, such as the "bothersome or abusive" warning or disabled message access.
- **Why it's needed:** the follower asked for the link in a comment, and a private reply delivers it without posting links publicly.

## 3. Screencast script (one recording, English captions, about 3–4 minutes)

Record the Mac screen, plus a phone screen (QuickTime mirroring, or film the phone) for steps 5 and 7. Add a caption at each step naming the permission being shown.

1. **Login (all permissions).** Open AffiliateOS → **Instagram** → **Connect Instagram**. Show the Facebook Login for Business dialog:
   - choose the **Affiliateos** portfolio and **@trendism.in**;
   - show the permission screen listing instagram_basic, instagram_manage_comments and instagram_manage_messages, and approve;
   - back in AffiliateOS, show "Connected as @trendism.in".

   *Caption: "The creator connects their own Instagram professional account."*
2. **instagram_basic.** On the Instagram page, show the profile and the **Recent posts and reels** grid. *Caption: "instagram_basic: profile and media list, used to pick a reel."*
3. **Create an automation (instagram_basic).** Automations → **New automation**:
   - pick the reel from the grid;
   - choose a published collection;
   - keyword "LINK";
   - show the message preview with the collection link;
   - Save (Active).
4. **Webhook subscription (instagram_manage_comments).** On the Instagram page, show **Comment webhooks: Subscribed**.
5. **A follower asks.** On the phone, from a second Instagram account, comment **"LINK"** on that reel. *Caption: "A follower comments LINK to request the link."*
6. **Comment received (instagram_manage_comments).** In AffiliateOS → Instagram → **Webhook events**, show the comment (@username, "LINK", received). Then Message Queue shows the reply job.
7. **Private reply sent (instagram_manage_messages).**
   - Message Queue: the job goes from **pending** to **sent**. Open it to show the reply text and the attempt history.
   - On the phone (second account), show the private reply arriving in **Messages / Requests** with the link, and tap it to open the collection page.

   *Caption: "One private reply, sent only because the follower asked."*
8. **Safeguards.** Comment "LINK" again from the same account and show the second job marked **skipped — duplicate**. Show the **Logs** page entry for the send.

**If comment webhooks don't arrive before approval** (Meta says the app must be Live with Advanced Access):
- record steps 1–4 for real;
- for 5–7, use the App Dashboard's **Webhooks → Test** button for the `comments` field, show the event arriving in **Webhook events**, and explain this in the notes;
- don't fake the phone screenshots.

## 4. Notes for the reviewer (paste)

> AffiliateOS is a private desktop tool for one creator and isn't publicly accessible, so the screencast shows the complete flow. Login: Facebook Login for Business (configuration 1599197921970843) for the creator's own Instagram professional account @trendism.in, owned by the Affiliateos business portfolio. Trigger: a follower comments the keyword (e.g. "LINK") on the creator's reel; the comment arrives by the `comments` webhook. Action: exactly one private reply with the requested collection link (POST /{ig-user-id}/messages, recipient.comment_id). Limits: one reply per comment and per person per post, only within 7 days, rate-limited below Meta's limits, and processing pauses automatically on Meta warnings. Privacy policy: https://affiliateos-api.rakshitdembla.workers.dev/privacy · Terms: https://affiliateos-api.rakshitdembla.workers.dev/terms · Data deletion: https://affiliateos-api.rakshitdembla.workers.dev/oauth/instagram/data-deletion

## 5. Data handling answers (Data Use Checkup / questionnaire)

- **Data processors / service providers:** Cloudflare (hosting, database and storage for the Worker, D1 and R2). No other processors.
- **Data collected:**
  - the creator's Instagram account id, username and profile picture URL;
  - the access token, encrypted with AES-256-GCM;
  - comment events on the creator's own posts: comment id and text, media id, and the commenter's Instagram-scoped id and username;
  - reply records.
- **Purpose:** only to send the reply each person asked for, and to show the creator delivery status and aggregate click counts.
- **Sharing / selling:** none. No advertising use, no profiling.
- **Retention:** raw comment events 90 days, comment text on reply records 180 days, logs 90 days, backups 14 days.
- **Deletion:**
  - the Meta data-deletion callback deletes the stored account data and token, and returns a status URL and confirmation code;
  - removing the app in Instagram triggers the deauthorize callback, which does the same.
- **Security:**
  - HTTPS only;
  - the admin API sits behind a 256-bit token;
  - webhook payloads are verified with HMAC-SHA256;
  - tokens are encrypted at rest and never logged;
  - the Meta token is never sent to the creator's computer.
- **Responsible person:** the account owner.

## 6. About the never-expiring token

The login configuration issues a system-user token that doesn't expire. AffiliateOS stores it only on the Cloudflare Worker, encrypted with AES-256-GCM under a key held as a Worker secret. It never reaches the Mac app or the logs, and backups contain only the ciphertext. It's revoked by removing the app from the business portfolio, or with Disconnect in AffiliateOS. To rotate it, disconnect and connect again. If you'd rather have an expiring token, edit the login configuration; AffiliateOS then shows the expiry date and warns 7 days ahead, and you renew it by reconnecting.
