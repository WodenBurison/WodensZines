# data/

`starforged-assets.json` — all 87 Ironsworn: Starforged assets (name, category, and the text of each of their 3 abilities), trimmed from the official [Datasworn](https://github.com/rsek/datasworn) dataset.

Source: *Ironsworn: Starforged Assets* by Shawn Tomkin, https://ironswornrpg.com — licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Keyed by `category/asset_id` (e.g. `path/augmented`), matching the id format Iron Vault stores in a character's `assets` frontmatter. `generate.js` reads this file directly at build time — no network access needed, and no manual updates required when a new asset gets equipped in play.

To refresh this file if Datasworn publishes updates, re-run the extraction against `https://raw.githubusercontent.com/rsek/datasworn/main/datasworn/starforged/starforged.json`.
