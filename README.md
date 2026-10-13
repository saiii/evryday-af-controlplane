# evryday-af-controlplane

Serves the Agent Flow Designer at `/` (a palette of the six service types and a canvas for laying out named components and drawing the lines that say which component may send messages to which; the canvas is in memory only, nothing is saved yet) and answers `GET /hello`, on port 3000.

## Commands

```sh
npm install                        # install dependencies
npm run dev                        # run Express on 3000 and the Vite dev server on 5173; open http://localhost:5173 (Ctrl-C stops both)
npm run build                      # compile the server to dist/src and build the page into dist/public
make build                         # build the container image and scan it with trivy
make test                          # run the container, published on 127.0.0.1:3000 only
open http://localhost:3000/        # open the designer page served by the container
curl http://localhost:3000/hello   # call the service
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
