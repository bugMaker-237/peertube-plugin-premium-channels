# PeerTube Plugin: Premium Channels

Restrict videos to channel subscribers and optionally disable downloads. Designed for single-instance setups (no federation considerations).

## Features

- Mark videos as subscriber-only.
- Disable downloads per video.
- Global overrides to force subscriber-only and/or deny downloads for all videos.
- Optional removal of subscribe buttons on video, channel, and account pages.
- Defaults for new uploads/imports.

## Settings

All settings are available in the plugin admin page.

- Remove subscribe button: Removes subscribe buttons from video, channel, and account pages.
- Default: Subscribers only: Default value for new uploads/creations.
- Default: Deny downloads: Default value for new uploads/creations.
- Global: Subscribers only: Forces all videos to be subscribers-only (overrides per-video setting).
- Global: Deny downloads: Disables downloads for all videos (overrides per-video setting).

## Usage

1. Enable the plugin in PeerTube admin.
2. Optional: Configure defaults and global overrides in plugin settings.
3. For individual videos (when global overrides are off), set:
   - Subscribers only
   - Disable downloads

## Notes

- Root admins always retain access.
- Video access and download checks are enforced server-side.
- Plugin settings are stored in the PeerTube database plugin storage.

## Development

Build client bundle:

```bash
npm run build
```

## License

See [LICENSE](LICENSE).
