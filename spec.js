/* What Google actually publishes.
 *
 * Every number and rule below was researched from support.google.com and
 * adspolicy pages and then put through an adversarial verification pass.
 * Nothing here is a guess; where Google's own docs disagree, that is recorded
 * rather than smoothed over.
 */

/* ------------------------------------------------------------- canvases -- */
/* Recommended pixel sizes, not minimums. Minimums are kept so the UI can say
   how much headroom there is. */
const ASPECTS = [
  {
    key: '1x1', label: 'Square', ratio: 1, w: 1200, h: 1200,
    min: '300 × 300',
    used: 'Required for responsive display, Performance Max and Demand Gen.',
    note: 'Responsive display recommends 600 × 600 here; Performance Max and ' +
          'Demand Gen recommend 1200 × 1200. Rendering at 1200 satisfies all three.',
  },
  {
    key: '1.91x1', label: 'Landscape', ratio: 1200 / 628, w: 1200, h: 628,
    min: '600 × 314',
    used: 'Required for responsive display, Performance Max and Demand Gen.',
    note: 'This is the landscape image ratio across every Google surface.',
  },
  {
    key: '4x5', label: 'Portrait', ratio: 960 / 1200, w: 960, h: 1200,
    min: '480 × 600',
    used: 'Optional for Performance Max and Demand Gen.',
    note: 'Not supported on Search image assets.',
  },
  {
    key: '9x16', label: 'Vertical', ratio: 1080 / 1920, w: 1080, h: 1920,
    min: '600 × 1067',
    used: 'Optional for Demand Gen image assets.',
    note: 'Demand Gen is the only campaign type that takes 9:16 as an image.',
  },
  {
    key: '16x9', label: 'Widescreen', ratio: 1920 / 1080, w: 1920, h: 1080,
    min: '—',
    used: 'Video ratio: YouTube, Demand Gen video, Performance Max video.',
    note: 'Google does not take 16:9 as an image asset. Useful as a thumbnail ' +
          'or for non-Google placements; for a Google image asset use 1.91:1.',
    warn: true,
  },
];

/* 1.19:1 was asked for and does not exist. Recorded rather than silently
   dropped, because the next person will ask the same question. */
const ASPECT_NOTES = [
  {
    asked: '1.19:1',
    verdict: 'Not a Google Ads ratio.',
    detail: 'Searched and not found across 13 Google spec and policy pages. ' +
            'Two readings are defensible and this tool will not guess between ' +
            'them: 1.91:1, if the digits were transposed; or the 300 × 250 ' +
            'display banner, which is 1.2:1 and numerically closer to 1.19 than ' +
            '1.91 is. Say which you meant and it is a minute to add.',
  },
  {
    asked: '16:9',
    verdict: 'Real, but it is the video ratio.',
    detail: 'Google image assets take 1:1, 1.91:1, 4:5 and (Demand Gen only) 9:16. ' +
            '16:9 is what YouTube and Demand Gen video use. Generated here anyway ' +
            'because it is useful elsewhere, and flagged in the interface.',
  },
];

/* ----------------------------------------------------------- file rules -- */
const FILE_RULES = {
  formats: ['png', 'jpg'],
  maxBytes: 5 * 1024 * 1024,        // 5120 KB for image assets
  targetBytes: 3200 * 1024,         // well under 5 MB, and quality is the point
  note: 'Image assets are capped at 5 MB. The 150 KB limit belongs to uploaded ' +
        'display banners and to the Demand Gen logo, not to these ratios.',
};

/* -------------------------------------------------------- the CTA rule --- */
/* Settled: no drawn button.
 *
 * Stated precisely, because an adversarial check killed the looser version of
 * this: at POLICY level a button in an image ad is conditional, not banned
 * outright. Misleading ad design (adspolicy/answer/15937463) prohibits
 * "Standalone buttons in image ads that lack clear context explaining their
 * function, or whose prominence relative to the surrounding ad content is
 * disproportionate" — so a button can be a violation depending on how it reads.
 * Google's own responsive display guidance is the unconditional one:
 * "Don't add buttons to your image as they aren't a clickable element."
 *
 * A generated ad cannot judge its own context or proportionality, so the only
 * setting that is safe without a human looking at every image is: none.
 *
 * 'none'   — no call-to-action drawn at all (safest, and what Google asks for
 *            on image assets)
 * 'text'   — the words only, no shape, no border, nothing button-like
 * 'button' — deliberately unreachable. Left here so the checker can assert it
 *            never happens rather than the code merely not calling it.
 */
const CTA_MODE = 'none';

const CTA_POLICY = {
  ruling: 'No button is drawn.',
  why: [
    'Responsive display guidance, unconditional: "Don\'t add buttons to your ' +
    'image as they aren\'t a clickable element."',
    'Misleading ad design, conditional: "Standalone buttons in image ads that ' +
    'lack clear context explaining their function, or whose prominence relative ' +
    'to the surrounding ad content is disproportionate." A generated image ' +
    'cannot judge its own proportionality, so the condition cannot be relied on.',
    'Download or install buttons or icons in image ads are listed with no ' +
    'conditional attached.',
    'Also prohibited: "Misleading icons or arrows that imply a function the ad ' +
    'doesn\'t perform" — which is why no arrow is drawn either.',
  ],
  instead: 'The call to action belongs in the ad\'s own headline and description ' +
           'fields, where it is real and clickable.',
};

/* -------------------------------------------------------------- text ----- */
/* At policy level, "text or graphic overlay" is Not allowed on image assets —
 * and the same bullet covers a brand logo laid over the image. Performance Max
 * is the one carve-out ("allowed with limitations"), and even there Google
 * recommends supplying one clean image per aspect ratio.
 *
 * So text on the image is a choice with consequences, and the interface says
 * so instead of deciding silently.
 */
const TEXT_MODES = {
  clean: {
    label: 'No text',
    detail: 'Nothing drawn on the picture. The only version that is unambiguously ' +
            'within policy for responsive display and Demand Gen image assets.',
    brand: false, headline: false,
  },
  brand: {
    label: 'Brand name only',
    detail: 'Brand name and nothing else. An overlay, so Performance Max only — ' +
            'keep a clean version alongside it.',
    brand: true, headline: false,
  },
  full: {
    label: 'Brand + one line',
    detail: 'Brand name and a single short line from the site. Most text this ' +
            'tool will draw. Performance Max only.',
    brand: true, headline: true,
  },
};

const TEXT_LIMITS = {
  headlineMax: 42,      // one short line, not a paragraph
  shortMax: 30,
  ctaMax: 18,
  // "Text may cover no more than 20% of the image" — responsive display best
  // practice, verbatim on the Help page. It appears on no Advertising Policies
  // page, so it is a quality ceiling here, not an enforceable threshold.
  maxCoverage: 0.20,
  // "Images may be cropped horizontally up to 5% on each side" to fit some
  // placements, so nothing legible may sit in the outer 5%.
  safeMarginX: 0.05,
};

/* ------------------------------------------------------------ palette --- */
/* Sampled from the reference creatives: near-black grounds (#000–#131418) with
   a hot red (#d01820–#e5252c). Two reds because one cannot do both jobs —
   #ef3a41 clears AA on black at body size (5.06:1), #d01820 is dark enough that
   white clears AA on it (5.48:1). */
const RED_TEXT = '#ef3a41';
const RED_GLOW = 'rgba(232,28,38,0.62)';

/* ---------------------------------------------------- what is not known -- */
/* Recorded so nobody later mistakes silence for permission. */
const UNKNOWNS = [
  'Google does not publish whether it fingerprints or perceptually hashes ' +
  'creative images to link advertisers or accounts. Absence of documentation ' +
  'is not evidence either way.',
  'Circumventing systems carries account suspension, and the policy names ' +
  '"bypassing enforcement mechanisms and detection by creating variations of" ' +
  'content. The operative word is BYPASSING: fixing a disapproved ad and ' +
  'resubmitting it is Google\'s own documented remedy and is not the violation. ' +
  'What is prohibited is varying a creative in order to get past review. The ' +
  'variation in this tool exists so that a set of ads is a set of ads rather ' +
  'than one ad twelve times — it is not tuned against any detector, and no ' +
  'part of it tries to be.',
];
