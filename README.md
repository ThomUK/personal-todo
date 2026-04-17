# Personal Todo

A personal kanban and todo app that stores its data as a JSON file committed to a GitHub repository. No backend, no database — just a static web app and two GitHub repos.

## Architecture

| Repo | Purpose |
|---|---|
| `personal-todo` | App code (HTML/CSS/JS), served via GitHub Pages |
| `personal-todo-data` | Task data (`board.json`), read and written by the app via the GitHub API |

Your task data lives in its own private repo. The app repo can be public.

## Deploying the app

1. Fork or clone this repo into your GitHub account
2. Go to **Settings → Pages** and set the source to the `main` branch, root folder
3. GitHub Pages will publish the app at `https://<your-username>.github.io/personal-todo`

## Setting up your data repo

1. Create a new GitHub repository named `personal-todo-data` (can be private)
2. No files are needed — the app will create `board.json` on first save
3. Generate a **Personal Access Token** scoped to `personal-todo-data` only:
   - Classic token: `repo` scope
   - Fine-grained token: **Contents** → Read and write
4. Open the app, click **⚙** in the top right, and fill in:
   - **Token** — your PAT
   - **Owner** — your GitHub username
   - **Repository** — `personal-todo-data`
   - **Branch** — `main`

The app stores your token in `localStorage` in your browser. It is never sent anywhere other than the GitHub API.

## Using the app

### Views
| Control | Options |
|---|---|
| **View** | List · Board (kanban) |
| **Domain** | All · Home · Work · Apps |
| **Timings** | Show all · Due dated · Incomplete |

- Click the **Personal Todo** heading to reset all filters to their defaults (List / Incomplete / All)

### Adding and editing tasks
- Click **+ Add Task** or press `n` to open the task form
- Click any task to edit it
- On the board view, drag cards between columns to change status
- On the list view, click the circle on the left of a row to mark it done

### Task fields

| Field | Required | Notes |
|---|---|---|
| `title` | Yes | Short description of the task |
| `description` | No | Free text notes |
| `domain` | Yes | `home`, `work`, or `apps` |
| `status` | Yes | `todo`, `in-progress`, or `done` |
| `dueDate` | No | ISO date string `YYYY-MM-DD` |

## Data format

Tasks are stored in `board.json` at the root of your data repo. See [`example.board.json`](./example.board.json) for a fully populated example covering all fields, domains, statuses, and due date variants.

Each save creates a commit in your data repo, giving you a full history of changes.
