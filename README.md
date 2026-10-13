# evryday-af-controlplane

Serves the Agent Flow Designer at `/` (a palette of the six service types and a canvas for laying out named components; the canvas is in memory only, nothing is saved yet) and answers `GET /hello`, on port 3000.

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
