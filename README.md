# Woden's Adventures

Static site generator for the Ironsworn: Starforged playthrough blog/wiki, published via GitHub Pages.

## How it works

`generate.js` reads markdown directly from the Obsidian vault (`../Woden_Starforged_Vault/Woden_is_Starforged`), resolves wikilinks, renders Iron Vault `iron-vault-mechanics` blocks as styled move/roll/track displays, and writes plain HTML/CSS into `docs/`. GitHub Pages serves that folder directly — no build step runs on GitHub's end.

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

## Structure

- `generate.js` — the whole build script (markdown rendering, wikilink resolution, Iron Vault mechanics parser, nav tree, homepage feed, CSS/JS)
- `docs/` — generated output, this is what's actually live on the web. Don't hand-edit files in here; they get overwritten on every build.

## If you move the vault

Update `VAULT_ROOT` near the top of `generate.js` if `Woden_Starforged_Vault` ever moves relative to this folder.
