# Taskly

A lightweight, opinionated note-based task management plugin for [Obsidian](https://obsidian.md).

Inspired by [TaskNotes](https://github.com/callumalpass/tasknotes) by [@callumalpass](https://github.com/callumalpass). Taskly takes the core idea of one-note-per-task and rebuilds it into a streamlined, minimal workflow with sensible defaults.

## Features

- **Natural Language Parsing** — Create tasks with plain text like "Fix login bug by Friday #urgent"
- **Table View** — Database-style task views powered by Obsidian Bases
- **Advanced Filtering** — Build complex queries with conditions and logical groups
- **Recurring Tasks** — Full iCalendar recurrence rule support (daily, weekly, monthly, custom)
- **Reminders** — Relative and absolute reminders with in-app notifications
- **Custom Statuses** — Define your own statuses with colors and icons
- **Custom Fields** — Add text, number, date, boolean, or list properties to tasks
- **Tags** — Full tag support with filtering and grouping
- **Inline Widgets** — See task metadata directly in your notes while editing
- **Auto-Archive** — Automatically archive completed tasks after a configurable delay
- **REST API** — Local HTTP API for external integrations (desktop only)
- **Webhooks** — Event-driven notifications for task lifecycle events
- **Mobile Support** — Responsive UI optimized for mobile devices

## Installation

### From Obsidian Community Plugins

1. Open **Settings** → **Community Plugins** → **Browse**
2. Search for **Taskly**
3. Click **Install**, then **Enable**

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/bytes032/taskly/releases/latest)
2. Create a folder `your-vault/.obsidian/plugins/taskly/`
3. Copy the downloaded files into that folder
4. Restart Obsidian and enable the plugin in **Settings** → **Community Plugins**

## Usage

- Press `Ctrl+J` (or `Cmd+J` on Mac) to create a new task
- Type naturally — dates, tags, and statuses are extracted automatically
- Use the ribbon icon to open the task table view
- Right-click any task for quick actions

## License

[MIT](LICENSE)
