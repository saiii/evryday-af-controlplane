# evryday-af-controlplane

A dummy service that answers `GET /hello` on port 3000.

## Commands

```sh
npm install                        # install dependencies
npm run dev                        # run with tsx in watch mode
npm run build                      # compile to dist/
make build                         # build the container image and scan it with trivy
make test                          # run the container on port 3000
curl http://localhost:3000/hello   # call the service
```
