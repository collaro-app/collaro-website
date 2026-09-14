# App screenshots

These are web-sized copies of the **store listing artwork** (App Store / Google Play), one per
language. They are generated — don't edit them here. To refresh them after the store artwork
changes, point the optimizer at the folder holding the originals
(`map.png`, `map-HE.png`, `dogs.png`, `dogs-HE.png`, … `feature-banner.png`, `feature-banner-HE.png`):

```
powershell -ExecutionPolicy Bypass -File scripts/optimize-screenshots.ps1 -Source "C:\path\to\store-artwork"
```

It downscales each image (aspect ratio preserved — nothing is cropped or stretched), writes
`<name>.<lang>.jpg` here and the Open Graph card to `../og/og-image.jpg`.

| File | Where it appears |
| --- | --- |
| `feature-banner.<lang>.jpg` | Hero (and, downscaled, the social/OG card) |
| `map.<lang>.jpg` | "See Collaro in action" gallery |
| `booking-flow.<lang>.jpg` | Gallery |
| `booking-details.<lang>.jpg` | Gallery |
| `chat.<lang>.jpg` | Gallery |
| `dogs.<lang>.jpg` | Gallery + "For dog owners" |
| `services.<lang>.jpg` | Gallery + "For providers" |
| `dashboard.<lang>.jpg` | Gallery |

Pages reference `<name>.{{page.lang}}.jpg`, so a Hebrew page automatically shows the Hebrew
artwork. Captions and alt text live in `src/strings/<lang>.json` under `home.screens`,
`home.hero.bannerAlt`, `home.owners.screenshotAlt` and `home.providers.screenshotAlt`.
