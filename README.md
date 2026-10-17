# evryday-af-controlplane

Serves the Agent Flow Designer at `/` (a palette of the six service types and a canvas for laying out named components and drawing the lines that say which component may send messages to which; the canvas can be saved as a YAML `.af` file and opened again) and answers `GET /hello`, on port 3000.

## Commands

```sh
npm install                        # install dependencies
npm run dev                        # run Express on 3000 and the Vite dev server on 5173; open http://localhost:5173 (Ctrl-C stops both)
npm run build                      # compile the server to dist/src and build the page into dist/public
make build                         # build the container image and scan it with trivy
make test                          # run the container, published on 127.0.0.1:3000 only
open http://localhost:3000/        # open the designer page served by the container
curl http://localhost:3000/hello   # call the service
ls data/                           # saved .af files (make test mounts ./data at /data)
```

## Lines and deleting

A line from A to B means that A is allowed to send messages to B. Lines are permissions, not a flow, so a flow router and an agent may be connected both ways.

- Drag from any of the four dots on a component and release anywhere on another component. The arrowhead is at the receiving end.
- A line the table below does not allow, or a second line between the same two components in the same direction, is not made. The reason shows at the top of the canvas for about five seconds.
- Releasing over empty canvas cancels the drag.
- Click a line or a component to select it. Shift-click adds to the selection, and Shift-drag on empty canvas draws a selection box.
- Delete or Backspace deletes the selection. Deleting a component that has lines asks first, because its lines go with it.

| From | May send to |
|------|-------------|
| Incoming gateway | Flow router |
| Scheduler | Flow router |
| Flow router | Agent, Outgoing gateway |
| Agent | Flow router, Memory MCP |
| Outgoing gateway | nothing |
| Memory MCP | nothing |

## Saving and opening

- Type a file name in the header and press Save (or Enter).
- The name uses lowercase letters, digits and hyphens, starts with a letter, and has 63 characters at most. Type it without `.af`.
- Save writes `<name>.af`. A file of the same name is written over without asking.
- Open lists the saved files, read afresh each time the list opens. Picking one replaces the canvas without asking, and its name goes into the name field.
- Zoom and pan are not saved; the view is fitted when a file is opened.
- A file that cannot be read is refused with the first problem found, and the canvas stays as it was.
- Each line of an opened file is attached to the sides of its two components that face each other.

## Where files are kept

- The server writes to the folder named by `AF_DATA_DIR` (default `./data`). The image sets it to `/data`.
- `make test` creates `./data` in the repo and mounts it at `/data`, so saved files outlive the container. `npm run dev` uses `./data` too.
- The server in the image runs as the `node` user (uid 1000), not root. Rootless podman maps that user to you, so `./data` works as is. Under rootful Docker, `./data` must be writable by uid 1000.
- `data` is git-ignored and docker-ignored.
- Only requests addressed to `localhost`, `127.0.0.1` or `[::1]` reach `/api`, and there is no login: this is for local use only.

## The .af format

A saved file such as `my-design.af` looks like this:

```yaml
schemaVersion: 2
components:
  agent-1:
    type: agent
    image: registry.example.com/team/agent
    tag: "1.0"
  flow-router-1:
    type: flow-router
connections:
  - from: agent-1
    to: flow-router-1
  - from: flow-router-1
    to: agent-1
layout:
  agent-1: { x: 400, y: 120 }
  flow-router-1: { x: 100, y: 120 }
```

- `schemaVersion: 2` comes first.
- Components are keyed by name; there are no generated ids.
- `image` and `tag` are the only settings kept in the file. The tag is always written in double quotes, so a tag such as `1.0` or `010` stays text. An empty image or tag is left out.
- The controlplane only checks the image and tag as text. It never pulls an image or reads anything from inside one.
- A version 1 file written by v1.1 still opens; it is shown as version 2 and saved as version 2. Opening never rewrites a file.
- Positions are in `layout`, one per component.
- The designer always writes this standard form: keys in this order, names sorted, lines sorted by `from` then `to`, one position per line. Opening a file and saving it unchanged gives the same bytes.
- Comments and other formatting in a hand-edited file are not kept when it is saved again.
- The connection rules are not checked when a file is opened, so a hand-edited line the table above forbids still opens.
- Names such as `no`, `on` and `y` are allowed. A YAML 1.1 reader would read them as booleans.

## Component folders

Each component has a folder `<design>.components/<component>/` next to `<design>.af` in the data folder, for example `my-design.components/agent-1/`.

- The folder holds a `SKILL.md` in the Agent Skills format (frontmatter with `name` and `description`, then Markdown) and optional extra files.
- The `description` is shown as the brief in the settings panel.
- A new component gets a starter `SKILL.md` when the design is saved. Opening a design writes nothing.
- Save renames and removes folders so they follow the components on the canvas. A removed folder can only be got back from your own git or backups.
- The controlplane runs no git. Keep the `.af`, the `SKILL.md` files and the extra files in your own repo.
- Limits: 1 MB per file, 5 MB and 100 files per folder, 8 MB per save.
- A file path is 1 to 4 parts joined by `/`, each part made of letters, digits, `_`, `.` and `-`, not starting with `.`. Paths that differ only in letter case are refused, because the disk may not tell them apart.
- Files and folders whose names start with `.` (such as `.git`) are not shown or changed.

### Keeping the files in another repo

To keep a design's files in another repo, bind-mount that repo's folder at `data/<design>.components`, for example with an extra `-v` on `podman run`:

```sh
podman run -v ./data:/data -v ~/src/my-skills:/data/my-design.components ...
```

Do not use a symlink to a host path instead: it does not resolve inside the container. Links below `<design>.components` are not followed.
