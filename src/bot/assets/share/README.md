Daily norm sharing card, approved design D6 (1080 × 216).

`daily-norm-template.png` contains only the fixed artwork, labels and branding.
It is rendered from `mobile/src/components/DailyNormCard.tsx` and the original
AI-generated cat in `mobile/assets/share/meme-cat.png`. No personal data is baked
into this template. The server draws the current heading and four target values.

Regeneration: `node docs/previews/social-share-cards/build-telegram-template.cjs`
(install mobile dependencies; provide `sharp` or set `SHARP_MODULE`).
If the mobile layout changes, update both this template and the coordinates in
`src/bot/services/share_cards.py`.

Bundled Liberation Sans fonts include Cyrillic and use the SIL Open Font License;
see `FONT-LICENSE.txt`. Assets ship with the Python package, so the bot does not
need mobile files, system fonts or a browser at runtime.
