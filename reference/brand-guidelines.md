# 350 Seattle brand guidelines (extracted)

Pulled from `350-process-book.pdf` (page 23, "Brand Guidelines") and checked against
the vector artwork in that PDF and in `350-newsletter-workflow.pdf`. A render of the
original page is at `images/process-book-brand-guidelines.png`.

## Color palette

| Name | Hex | Role (per process book) |
|---|---|---|
| Clean Air | `#0081CC` | Links |
| No More Coal | `#000000` | Text |
| Clean Ocean | `#4254B0` | Buttons and logo |
| Foggy Seattle | `#E8E6E0` | Backgrounds |
| Reforestation Green | `#278C43` | 350 logo |
| Lichen | `#D6E4DA` | Podcast background / secondary panels |

**Correction:** the process book's text label for Reforestation Green says `Hex: 4254B0`,
which is a copy-paste of Clean Ocean. The actual swatch fill in the PDF is `#278C43`
(it matches the green in the 350 logo), so `#278C43` is used here.

### Supporting colors seen in the materials (not in the official palette)

| Hex | Where it appears |
|---|---|
| `#F7F6F2` | Off-white cards and panels throughout the workflow deck; light text on Clean Ocean |
| `#4B4F5A` | Muted grey for captions and footnotes in the workflow deck |
| `#DFE8FF`, `#CDEDFF`, `#D2E9F7`, `#B7E5FF`, `#91B0FF`, `#F0F7F2` | Pastel blue and green page and panel tints in the process book (presentation only) |

## Typography

| Role | Brand font | Font actually embedded in workflow deck | Notes |
|---|---|---|---|
| Header | Cal Sans | Cal Sans Regular | Free (SIL Open Font License) and can be self-hosted. |
| Subtitle / accent | New Kansas ExtraSwash (italic swash) | Fraunces Italic | New Kansas is commercial; Fraunces Italic is the stand-in. |
| Body | ITC Avant Garde Gothic Pro Medium | Montserrat Regular / Bold | Avant Garde is commercial; Montserrat is the stand-in. |

The process book PDF itself has outlined text with no embedded font names. The font
roles above come from its brand page text.

### Usage observed in the reference
- Headings: Cal Sans, black (or Clean Ocean for emphasis), tight letter spacing.
- An italic accent line in Fraunces/New Kansas sits above each heading as a kicker,
  often in Clean Ocean (e.g. *"Stage 3 · Build and publish"*).
- Body: Montserrat/Avant Garde in black, generous line height.
- Cards: rounded corners (~16px), off-white `#F7F6F2` on Foggy or Lichen backgrounds,
  or solid Clean Ocean with light text.
- Masthead pattern (news board): "350 Seattle" in Cal Sans, *"Newsletter"* in the swash
  italic underneath, then the issue date.

## Accessibility (WCAG AA contrast)

| Foreground on background | Ratio | AA normal text (4.5) | AA large text (3.0) |
|---|---|---|---|
| Black on Foggy `#E8E6E0` | 16.83 | Pass | Pass |
| Black on Lichen `#D6E4DA` | 15.97 | Pass | Pass |
| Clean Ocean on Foggy | 5.38 | Pass | Pass |
| Clean Ocean on Lichen | 5.11 | Pass | Pass |
| White on Clean Ocean | 6.72 | Pass | Pass |
| `#F7F6F2` on Clean Ocean | 6.21 | Pass | Pass |
| `#4B4F5A` on Foggy | 6.56 | Pass | Pass |
| **Clean Air on Foggy** | 3.36 | **Fail** | Pass |
| **Clean Air on Lichen** | 3.19 | **Fail** | Pass |
| **Clean Air on white** | 4.19 | **Fail** | Pass |
| **Reforestation Green on Foggy** | 3.42 | **Fail** | Pass |
| **White on Reforestation Green** | 4.27 | **Fail** | Pass |

**Recommendation:** keep the brand hexes as the reference values, but use an accessible
shade for small text:
- Link text: `#0068A5` (Clean Air darkened; 4.78 on Foggy, 4.53 on Lichen, 5.51 on `#F7F6F2`).
  Full Clean Air `#0081CC` is fine for large text, icons and decorative fills.
- Green text: `#217638` (4.53 on Foggy). White on `#217638` is 5.66.
