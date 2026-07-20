# Palworld Connect

A simple, self-hosted, vibe-coded web console for every endpoint in the Palworld Dedicated Server REST API. It provides server health and metrics, online player moderation, announcements, settings, world actor snapshots, save/shutdown controls, and a raw endpoint console.

## Run with Docker

```sh
docker compose up --build -d
```

Open <http://localhost:3000>. Profile data persists in the `palworld-connect-data` Docker volume.

On the Palworld server, enable the REST API in `PalWorldSettings.ini`:

```ini
RESTAPIEnabled=True
RESTAPIPort=8212
AdminPassword="your-password"
```

Add a profile using `http://SERVER_IP:8212`; `/v1/api` is appended automatically. If Palworld is another container, place both containers on the same Docker network and use its service name. `host.docker.internal` can reach a server running on the Docker host on Docker Desktop.

> The Palworld REST API is intended for trusted LAN use. Do not expose either it or this management console publicly. Saved credentials are stored unencrypted in the private application data volume.

## Development

No third-party runtime packages are required. Node.js 20+ is sufficient:

```sh
npm start
npm test
```

Set `PORT` (default `3000`) and `DATA_DIR` (default `./data`) as needed.

## Supported API

The app supports the complete REST API documented in Palworld Server Guide 1.0.0: `GET /info`, `/players`, `/settings`, `/metrics`, `/game-data`; and `POST /announce`, `/kick`, `/ban`, `/unban`, `/save`, `/shutdown`, `/stop`.
