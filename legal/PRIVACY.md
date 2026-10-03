# CuteTube Privacy Policy

Effective: 3 October 2026 · Version 1

**In short: CuteTube has no servers and collects nothing about you.** Everything the app stores stays on your computer. The app only contacts the websites you use in it and a few public download sources, listed below.

## What we (the CuteTube project) collect

**Nothing.** CuteTube has no accounts, no analytics, no tracking, no crash reporting and no advertising. The developers never receive your data, your history or anything you download.

## What is stored on your computer

The app keeps these files in `%LOCALAPPDATA%\CuteTube` on your PC:

| What | Why |
|---|---|
| Settings | Your choices (download folder, quality, theme…) |
| Download history and a list of downloaded video and post IDs | To show your downloads, resume them, and mark what you've already saved |
| The built-in browser's data: cookies, sign-ins, cache, site storage | So sites keep you signed in, exactly like a normal web browser |
| Ad-blocking filter lists, ffmpeg and Deno | To block ads and to merge and process videos |
| Updated copies of the downloaders (yt-dlp, gallery-dl) | To keep downloads working when sites change |
| Temporary files | Partial downloads and short-lived cookie copies used by a download, deleted afterwards |

Downloaded videos and photos go to the folder you choose (by default `Downloads\CuteTube`).

## Your sign-ins and cookies

When you sign in to a site inside CuteTube, you type into that site's own page. CuteTube doesn't read or save your password. The site's sign-in cookies are kept in the built-in browser's data on your PC. When you download something, CuteTube passes the cookies for that site to the downloader running on your PC, so it can get the same content you can see. The cookies are only ever sent to the site they belong to.

## Who CuteTube connects to

| Connection | When | What they receive |
|---|---|---|
| The sites you open (YouTube, Instagram, Facebook, TikTok and the servers that host their media) | When you browse or download | The same as when you visit them in a web browser: your IP address, your requests, and your cookies for that site |
| github.com (ffmpeg and Deno downloads) | Once, at first start, if they're missing | Your IP address and an ordinary download request |
| easylist.to, ublockorigin.github.io (ad-blocking lists) | Now and then, to keep the lists current | Your IP address and an ordinary download request |
| pypi.org (downloader updates) | At most once a day; can be turned off in Settings | Your IP address and an ordinary download request |

None of these requests contains information about you beyond what any download needs. Each site's handling of your data falls under its own privacy policy.

The built-in browser is **Microsoft Edge WebView2**, which is part of Windows. Microsoft may collect diagnostic data from it according to your Windows privacy settings and Microsoft's privacy statement (https://privacy.microsoft.com/privacystatement).

## Local connections

The app's window talks to the rest of the app over a connection that only exists on your own computer (127.0.0.1), protected by a random key created each time the app starts. Other devices can't reach it.

## Deleting your data

- Sign out of a site inside the app, or
- Uninstall CuteTube. The uninstaller offers to delete all app data, including sign-ins. Or delete the folder `%LOCALAPPDATA%\CuteTube` yourself.

Your downloaded files are never deleted automatically.

## Children

CuteTube isn't aimed at children under 13, and it collects no data from anyone.

## Changes

If this policy changes, the app shows the new version and asks you to accept it. The version and date are at the top.

## Contact

Questions: open an issue at https://github.com/FzArnob/cutetube/issues.
