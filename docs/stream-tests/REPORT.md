# IPTV source smoke tests

## Scope and limits

Actual cloud network + ffmpeg decoding, not native app playback. Android APK, Expo Video, S25 Ultra hardware, sound output, on-screen rendering, fullscreen, rotation, and background/resume are NOT RUN. HTTP 200 alone is never labeled playable. A cloud failure does not prove failure on the user’s network. A 20-second decoder pass does not guarantee long-term stability or all adaptive variants.

Four bounded samples: three broadcaster/public streams selected from the requested current Chinese-language playlist, plus one official Apple developer control. No authentication, access-control bypass, geo workaround, proxy switching, pay channels, bulk probe, stream caching, or video redistribution. Requests are sequential per test and limited to manifests, a segment, and 20 media seconds. A separate control retest corrects byte-range handling. ffmpeg was already installed.

Sources:
- https://github.com/iptv-org/iptv (README: publicly submitted links; inclusion is not an independent rights certification)
- https://github.com/iptv-org/iptv/blob/master/FAQ.md (database listings are not equivalent to available streams)
- https://iptv-org.github.io/iptv/languages/zho.m3u (snapshot included for provenance, not a default subscription)
- https://developer.apple.com/streaming/examples/
- https://developer.apple.com/streaming/examples/advanced-stream-hevc.html (official video src verified)

## Results

### Apple Bip Bop official control
- UTC: 2026-10-17T14:46:25.856508+00:00 to 2026-10-17T14:47:05.095871+00:00
- Source: https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/master.m3u8
- Result: **CLOUD_DECODE_PASS**
- Manifest HTTP: 200; variant HTTP: 200; segment HTTP: 206
- First video frame decoded: True; decoded frames: 600; decoded media duration: 20.0 seconds
- Native Android/S25 Ultra: NOT RUN
- Tested selected variant: https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/v1/prog_index.m3u8
- Decoder codecs: Stream #0:0(eng): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 416x234 [SAR 1:1 DAR 16:9], 499 kb/s, 30 fps, 30 tbr, 6k tbn (default); Stream #0:0(eng): Video: wrapped_avframe, yuv420p(tv, bt709, progressive), 416x234 [SAR 1:1 DAR 16:9], q=2-31, 200 kb/s, 30 fps, 30 tbn (default)

### CCTV-4 America
- UTC: 2026-10-17T14:45:38.078926+00:00 to 2026-10-17T14:45:40.609826+00:00
- Source: https://global.cgtn.cicc.media.caton.cloud/master/cgtn-america.m3u8
- Result: **NETWORK_OR_MANIFEST_FAILED**
- Manifest HTTP: 502; variant HTTP: not applicable; segment HTTP: not reached
- First video frame decoded: False; decoded frames: 0; decoded media duration: 0 seconds
- Native Android/S25 Ultra: NOT RUN
- Failure detail: HTTP Error 502: Bad Gateway

### CGTN Global Biz
- UTC: 2026-10-17T14:45:42.610330+00:00 to 2026-10-17T14:46:20.986419+00:00
- Source: https://fastlive.cctvplus.com/out/v1/2b3d8a0c805d437f9dc85b764c2ac599/index.m3u8
- Result: **CLOUD_DECODE_PASS_WITH_WARNINGS**
- Manifest HTTP: 200; variant HTTP: 200; segment HTTP: 200
- First video frame decoded: True; decoded frames: 600; decoded media duration: 20.001229 seconds
- Native Android/S25 Ultra: NOT RUN
- Tested selected variant: https://fastlive.cctvplus.com/out/v1/2b3d8a0c805d437f9dc85b764c2ac599/index_4.m3u8
- Decoder codecs: Stream #0:0: Video: h264 (Main) ([27][0][0][0] / 0x001B), yuv420p(tv, bt709), 640x360 [SAR 1:1 DAR 16:9], 29.97 fps, 29.97 tbr, 90k tbn; Stream #0:1(eng): Audio: aac (LC) ([15][0][0][0] / 0x000F), 48000 Hz, stereo, fltp
- Decoder warnings: 1 non-monotonic DTS output warning(s); decode completed, but native A/V timing and smoothness need checking.

### DAAI TV
- UTC: 2026-10-17T14:46:22.986794+00:00 to 2026-10-17T14:47:08.902287+00:00
- Source: https://pull.daaiplus.com/live-DAAIPLUS/live-DAAIPLUS_HD.m3u8
- Result: **CLOUD_DECODE_PASS_WITH_WARNINGS**
- Manifest HTTP: 200; variant HTTP: not applicable; segment HTTP: 200
- First video frame decoded: True; decoded frames: 499; decoded media duration: 20.0 seconds
- Native Android/S25 Ultra: NOT RUN
- Tested selected variant: https://pull.daaiplus.com/live-DAAIPLUS/live-DAAIPLUS_HD.m3u8
- Decoder codecs: Stream #0:0: Video: h264 (Main) ([27][0][0][0] / 0x001B), yuv420p(tv, bt709), 1280x720, 47 tbr, 90k tbn; Stream #0:1: Audio: aac (LC) ([15][0][0][0] / 0x000F), 44100 Hz, stereo, fltp
- Decoder warnings: 24 non-monotonic DTS output warning(s); decode completed, but native A/V timing and smoothness need checking.

## Interpretation and test corrections

Apple uses HLS byte ranges within a single MP4. The initial generic full-segment fetch hit the 10 MB safety cap; this was a test-harness limitation, not an invalid stream. The corrected control test requested the exact first byte range. Original attempt remains in results.json, corrected evidence in control-retest.json; final-results.json uses the corrected run. The lowest-bandwidth AVC video variant is selected where possible; this does not exercise adaptive switching. Apple’s separate alternate audio rendition is not covered by the video-variant decode. First-frame result means decoded frames were counted, not a screen capture or measured first-frame latency.

## Required native acceptance matrix

Use these same master URLs in the finished APK, manually imported. On the actual S25 Ultra if available, record app/build identifier, Android version, UTC, network type and country, source ID, first visible frame, audible audio, 20 seconds continuous playback, buffering/errors, switching channels, portrait/landscape fullscreen, and background/resume. Check that a failed URL produces a useful error and allows retry or source switching. Start with the official control to distinguish basic player failure from source restrictions. Test each real source separately; never translate cloud HTTP or ffmpeg results into a native pass.

No sample should be embedded as an automatically fetched default subscription.
