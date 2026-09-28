/**
 * The landing page's product demo, hosted on Cloudinary (not in this app: every view of a large
 * file would otherwise come from our own server and grow each deploy).
 *
 * To replace the video: upload the new one to Cloudinary and change `PUBLIC_ID` and `VERSION` to
 * the new upload's (both are in its URL: .../video/upload/v<VERSION>/<PUBLIC_ID>.<ext>). Nothing
 * else changes. The upload can be any format; Cloudinary converts it.
 *
 * The sources ask Cloudinary for a converted copy rather than the original (59 MB HEVC `.mov`,
 * which Firefox and many Windows browsers can't play): VP9 WebM first for browsers that take it
 * (10.9 MB), H.264 MP4 as the one every browser plays (13.7 MB). Full 1920 width and
 * `q_auto:best`: this is a screen recording, and at 1280 with plain `q_auto` (under 1 Mbit/s) its
 * small text went visibly soft; at these settings a close-up matches the original. Nothing is
 * downloaded until play is pressed, so the size costs only those who watch. The poster is one
 * frame of it.
 */
const CLOUD = "https://res.cloudinary.com/dblgnibke/video/upload";
const VERSION = "1790590500";
const PUBLIC_ID = "0928";
/** The recording's own width: the frame is about 1000 CSS px, so 2x screens show every pixel. */
const WIDTH = 1920;
/** Cloudinary's highest automatic quality: small text survives it, plain `q_auto` blurred it. */
const QUALITY = "q_auto:best";

export const DEMO_VIDEO = {
  sources: [
    { src: `${CLOUD}/vc_vp9,${QUALITY},w_${WIDTH}/v${VERSION}/${PUBLIC_ID}.webm`, type: "video/webm" },
    { src: `${CLOUD}/vc_h264,${QUALITY},w_${WIDTH}/v${VERSION}/${PUBLIC_ID}.mp4`, type: "video/mp4" },
  ],
  poster: `${CLOUD}/so_2,w_${WIDTH},${QUALITY}/v${VERSION}/${PUBLIC_ID}.jpg`,
  /** What the video shows, for screen readers and as the play button's label. */
  label: "Watch a one-minute tour of Stay Funded 360",
} as const;
