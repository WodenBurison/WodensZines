# Woden's Adventures

Static site generator for Woden's tabletop playthroughs, published via GitHub Pages. The site is a hub of "verses" — one verse per game/campaign, each with its own content and theme — with a shared journal-themed homepage tying them together.

## How it works

`generate.js` builds the site in two layers:

- **Verses.** Each entry in the `VERSES` array (near the top of `generate.js`) points at a folder of markdown in the Obsidian vault. For each verse, the script resolves wikilinks, renders Iron Vault `iron-vault-mechanics` blocks as styled move/roll/track displays, and writes plain HTML/CSS/JS into `docs/<verse-id>/`. Right now there's one verse, `starforged`, and its look (dark sci-fi HUD theme) is unchanged from before.
- **Hub.** After all verses are built, `buildHub()` writes `docs/index.html` — the site's front door. It lists every verse as a handwritten index card (title, system, genre, status, session count) linking into `docs/<verse-id>/`. This page always uses the "pen and paper journal" theme in `themes/journal.css`, independent of whatever theme each verse uses.

GitHub Pages serves `docs/` directly — no build step runs on GitHub's end.

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
3. If the new game needs a different look than the Starforged sci-fi theme, give it its own `STYLE_CSS` inside `buildVerse` (or factor `STYLE_CSS` out into per-verse files in `themes/` once there's a second distinct look worth reusing).
4. Run `npm run build` — the new verse gets its own card on the hub homepage automatically.

## Structure

- `generate.js` — the whole build script: verse registry, per-verse build (markdown rendering, wikilink resolution, Iron Vault mechanics parser, nav tree, per-verse CSS/JS), and the hub homepage builder.
- `themes/journal.css` — the hub homepage's "pen and paper journal" theme. Verse-specific themes currently live inline in `generate.js` (see `STYLE_CSS` inside `buildVerse`) since there's only one verse so far.
- `docs/` — generated output, this is what's actually live on the web. Don't hand-edit files in here; they get overwritten on every build. `docs/index.html` is the hub; `docs/<verse-id>/` is each verse's own site.

## If you move the vault

Update `VAULT_ROOT` near the top of `generate.js` if `Woden_Starforged_Vault` ever moves relative to this folder.
