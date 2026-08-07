# Tour music

The tour plays one looping track per chapter and crossfades between them.
The player is already built and wired — it just needs these eight files.

Drop them in **this folder**, named exactly:

| File | Chapter | Rooms | Suggested feel |
| --- | --- | --- | --- |
| `arrival.mp3` | Arrival | gate, drive, door | Anticipation. Sparse, forward-moving, no percussion |
| `courtyard.mp3` | Courtyard | courtyard, machila chair | Open and airy. The signature track — heard longest |
| `living.mp3` | Living | living room, sitting area | Warm, low, unhurried |
| `bedrooms.mp3` | Bedrooms | 3 bedrooms, 2 baths | The quietest. Almost nothing — this is 9 rooms of stillness |
| `kitchen.mp3` | Kitchen | kitchen, dining, drinks | Lightest and most social. A little movement |
| `water.mp3` | Water | pool, gazebo, hammock | Slow, wide, weightless |
| `garden.mp3` | Garden | greenery, flowers, spring | Natural. Field-recording textures work well here |
| `night.mp3` | Night | poolside, whole house | Deepest and darkest. Ends the tour |

Anything the browser plays is fine — `.mp3` is the safest, `.m4a` and `.ogg`
also work if you change the extension in `AUDIO.EXT` in `exploreIkshaa.js`.

## Keep them small

These download while someone is looking at photographs, so they compete for
the same bandwidth. Aim for **under 2 MB each**:

- 96–128 kbps mono is plenty for ambient pads
- 60–120 seconds, seamlessly looped — the player loops them, so length only
  costs bandwidth
- trim silence from both ends or the loop will audibly gap

## Where to get them

All of these are free and clear for commercial use, but **check the licence
on each individual track** — every one of these sites mixes licences, and a
villa website is a commercial use.

- **[Pixabay Music](https://pixabay.com/music/search/ambient/)** — Pixabay
  Content Licence. Free commercially, no attribution. The simplest option.
- **[Chosic (CC0 filter)](https://www.chosic.com/free-music/all/?sort=&attribution=no)**
  — filtered to tracks needing no attribution.
- **[Free Music Archive — Ambient](https://freemusicarchive.org/genre/Ambient/)**
  — large, but licences vary per track. Filter to CC0 or CC-BY.
- **[Musopen](https://musopen.org/)** — public-domain classical recordings, if
  you would rather have piano or strings than pads.

Avoid Epidemic Sound and Soundstripe unless you hold a subscription — they
appear in search results for "royalty free" but are paid licences.

## If you leave this folder empty

Nothing breaks. The player checks each file and silently stays quiet if it is
missing, so the tour runs exactly as it does now.
