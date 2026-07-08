# Woden's Zines

Static site generator for Woden's tabletop playthroughs, published via GitHub Pages. The site is a hub of "verses" — one verse per game/campaign, each with its own content and theme — with a shared "magazine rack" homepage (`themes/magazine-rack.css`) tying them together.

## How it works

`generate.js` builds the site in three layers:

- **Verses.** Each entry in the `VERSES` array (near the top of `generate.js`) points at a folder of markdown in the Obsidian vault. For each verse, the script resolves wikilinks and writes plain HTML/CSS/JS into `docs/<verse-id>/`.
- **System renderers.** Game-specific rendering — Iron Vault `iron-vault-mechanics` blocks (move/roll/track/clock/oracle) and character-sheet frontmatter — is pluggable per verse via `systemRenderer` (see `SYSTEM_RENDERER_FACTORIES`). Today there's one, `iron-vault-ironsworn`, covering Ironsworn-family games (edge/heart/iron/shadow/wits stats, momentum, asset rules text). A verse with no `systemRenderer` set (or one that isn't registered) still builds fine — mechanics fences fall back to a plain code block, and character pages fall back to a plain frontmatter table.
- **Themes.** Visual styling is split into `BASE_CSS` (universal chrome: topbar, sidebar, prose, and the mechanics/character-sheet widget *structure*, reusable by any verse) and `THEMES` (a per-verse palette + decoration layered on top — today just `starforged-hud`, the dark sci-fi HUD look with scanline map frames). A verse with no `theme` set gets `BASE_CSS`'s default palette instead.
- **Hub.** After all verses are built, `buildHub()` writes `docs/index.html` — the site's front door. It lists every verse as a magazine cover in a wire rack, linking into `docs/<verse-id>/`. This page always uses its own theme in `themes/magazine-rack.css`, independent of whatever theme each verse uses.

GitHub Pages serves `docs/` directly — no build step runs on GitHub's end.

A custom domain (`SITE_DOMAIN` near the top of `generate.js`) is off by default. Once a domain is bought and its DNS points at GitHub Pages, set `SITE_DOMAIN` to it — a `docs/CNAME` file then gets written on every build, which GitHub Pages needs to serve the custom domain. Don't hand-edit a CNAME file directly into `docs/`; it gets wiped on every build like everything else in that folder.

## Publishing an update

Whenever you've added new sessions or wiki content in Obsidian:

```
npm install   # first time only
npm run build
git add -A
git commit -m "Update site"
git push
```

The site updates within a minute or two of pushing (GitHub Pages picks up changes to `docs/` on `main` automatically).

## Adding a new verse

1. Add a folder of markdown content to the vault for the new game.
2. Add an entry to the `VERSES` array in `generate.js`: `id` (used as the URL segment, e.g. `docs/<id>/`), `title`, `tagline`, `system`, `genre`, `status`, `summary` (shown on its hub card), and `contentDir`/`graphicsDir` pointing at the vault folder.
3. If it's an Ironsworn-family game logged through Iron Vault, set `systemRenderer: "iron-vault-ironsworn"` and `assetsDataPath` (a JSON file of asset rules text, same shape as `data/starforged-assets.json`) to get mechanics blocks and a character sheet. If it's a different game or you're not tracking it through Iron Vault, just leave `systemRenderer` unset — the verse still builds, mechanics fences show as plain code and character pages show a plain frontmatter table.
4. Pick a `theme` (currently just `"starforged-hud"`) or leave it unset for the default look. A genuinely new visual identity gets its own entry in `THEMES` near the bottom of `generate.js`.
5. Run `npm run build` — the new verse gets its own card on the hub homepage automatically.

## Structure

- `generate.js` — the whole build script: system renderers (game-specific mechanics/character-sheet rendering, currently `iron-vault-ironsworn`), verse registry, per-verse build (markdown rendering, wikilink resolution, nav tree, per-verse CSS/JS), themes (`BASE_CSS` + per-verse `THEMES`), and the hub homepage builder.
- `themes/magazine-rack.css` — the hub homepage's own theme, always used regardless of verse themes.
- `docs/` — generated output, this is what's actually live on the web. Don't hand-edit files in here; they get overwritten on every build. `docs/index.html` is the hub; `docs/<verse-id>/` is each verse's own site.

## If you move the vault

Update `VAULT_ROOT` near the top of `generate.js` if `Woden_Starforged_Vault` ever moves relative to this folder.
