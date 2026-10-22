# Rule reference

Drop `.md` or `.txt` files here and the Dungeon Master gets a `lookup_rule` tool
that searches them. With this folder empty, the tool tells the model to make a
ruling out loud rather than inventing rules — which is the correct fallback.

## What you may legally put here

- **D&D SRD 5.1 and SRD 5.2** — released by Wizards of the Coast under
  **CC-BY-4.0**. You may copy, redistribute, and adapt them, including
  commercially, as long as you attribute Wizards of the Coast.
- Your own session notes, house rules, and campaign documents.
- Other games' rules whose licences permit it.

## What you may not

- The core rulebooks (PHB, DMG, MM), published adventures, or setting material.
  Buying a book does not grant redistribution rights.
- Text copied from a wiki that itself reproduces non-SRD rules text.

Keeping this folder to SRD text costs you almost nothing — the SRD contains all
the mechanics: classes, spells, conditions, monsters, and combat rules.

## Suggested layout

```
rules/
  srd-5.1.md          full SRD text
  house-rules.md      your table's modifications
  campaign-notes.md   names and facts for consistency
```

`lookup_rule` returns up to six short matching excerpts, so a single large file
works as well as several small ones.
