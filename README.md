# Single File Calendar

An Obsidian plugin for managing dates, notes, tags, and date ranges in a single Markdown calendar file. It provides content navigation, upcoming items, statistics, heatmaps, and yearly views.

## Features

- Generate a continuous multi-year calendar in one `Calendar.md` file.
- Choose English or Chinese weekday names.
- Choose Monday or Sunday as the week start; week numbers use ISO weeks.
- Use the full-width separator ` ｜ ` between a date and its inline content.
- Add multiple tags to the same date record.
- Use the Chinese semicolon `；` to separate independent records on one date.
- Parse date ranges such as `07-20～07-25` and `07-20～07～25`.
- View Content, Upcoming, Stats, Heatmap, and Year tabs.
- Migrate legacy nested date structures to the current inline format while preserving text, quotes, and tags.
- Map tags to activity, event, monthly distribution, or date-range visualizations.
- Count date-range events separately from their deduplicated covered days.

## Installation

In Obsidian, open **Settings → Community plugins → Browse**, search for `Single File Calendar`, then install and enable it.

For development or beta testing, the plugin can be installed with BRAT or copied manually. The installed folder must contain:

```text
.obsidian/plugins/single-file-calendar/
├── manifest.json
├── main.js
└── styles.css
```

## Getting started

1. Enable the plugin.
2. Open the plugin settings and confirm that the calendar path is `Calendar.md`.
3. Set the start and end years.
4. Run **Generate calendar file** from the command palette.
5. Open the plugin view and switch between the available tabs.

Before migrating an existing file, make a backup of `Calendar.md`. Then run **Migrate to latest format**.

## Recommended format

```markdown
# 2026

## Jan

- 01-01 Thu ｜ #travel Beijing 07-20～07-25； #travel Shanghai 07-20～07-25
- 01-02 Fri ｜ #fitness Running； #live Concert
```

Multiple tags are allowed on the same date. Text following the tags is treated as the record content. Use the Chinese semicolon to clearly separate multiple records.

## Commands

- **Generate calendar file**: Create a calendar using the current settings.
- **Overwrite calendar file**: Rebuild the file after confirmation. Existing records may be replaced.
- **Append year**: Add the next year to the end of the calendar.
- **Jump to today**: Navigate to today's date.
- **Jump to specified date**: Navigate to an entered date.
- **Add item to specified date**: Insert a record on a selected date.
- **Add item to today**: Insert a record on today's date.
- **Migrate to latest format**: Convert legacy nested structures to the inline format.

## Development

```bash
npm install
npm run build
npm run lint
npm test
```

The build generates `main.js` in the repository root. For a GitHub release, upload `main.js`, `manifest.json`, and `styles.css` as release assets.

## Compatibility

- Minimum Obsidian version: `1.7.2`
- Desktop and mobile supported: `isDesktopOnly: false`

## Feedback

Please open an issue in the GitHub repository and include your Obsidian version, plugin version, a small `Calendar.md` example, and any console errors.

