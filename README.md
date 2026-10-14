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
- `data` is git-ignored and docker-ignored.
- Only requests addressed to `localhost`, `127.0.0.1` or `[::1]` reach `/api`, and there is no login: this is for local use only.

## The .af format

A saved file such as `my-system.af` looks like this:

```yaml
schemaVersion: 1
components:
  agent-1:
    type: agent
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

- `schemaVersion: 1` comes first.
- Components are keyed by name; there are no generated ids.
- Positions are in `layout`, one per component.
- The designer always writes this standard form: keys in this order, names sorted, lines sorted by `from` then `to`, one position per line. Opening a file and saving it unchanged gives the same bytes.
- Comments and other formatting in a hand-edited file are not kept when it is saved again.
- The connection rules are not checked when a file is opened, so a hand-edited line the table above forbids still opens.
- Names such as `no`, `on` and `y` are allowed. A YAML 1.1 reader would read them as booleans.
