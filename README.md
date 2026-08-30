# E-commerce Report Downloader Lite

[简体中文](docs/README.zh-CN.md)

A local Chrome extension that downloads product-ranking reports from Alibaba's Business Advisor (`sycm.taobao.com`) using the user's existing authenticated browser session.

## Why this repository exists

Merchants often repeat the same report-export workflow every day. This Lite edition turns that workflow into a recoverable local task without storing passwords, cookies, verification codes, or store data in a remote service.

## Features

- Yesterday, recent 7 days, recent 30 days, and a custom historical day.
- Background-tab execution with task recovery after a page reload.
- Up to three retries for page or download failures.
- Download completion detection and report-date validation.
- Account-safe folder names for local report organization.
- Strict host allowlist limited to `https://sycm.taobao.com/*`.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose this repository.
5. Sign in to Business Advisor in the same Chrome profile.

The extension requires a legitimate account with permission to access the reports. It does not bypass login, CAPTCHA, subscription, or platform access controls.

## Test

```bash
npm test
```

## Lite and commercial editions

This public Lite edition supports one platform in one Chrome profile. Multi-store orchestration, additional platform adapters, scheduled queues, login preflight, historical batch backfill, and managed deployment are intentionally outside this repository.

Commercial support may include installation, configuration, maintenance, and private multi-platform deployments. See [COMMERCIAL.md](COMMERCIAL.md).

## Security and platform stability

The extension runs locally and requests only the permissions declared in `manifest.json`. Platform page structure can change without notice, so selectors and workflow behavior may require maintenance. Review [SECURITY.md](SECURITY.md) before installation.

## License

MIT. This license covers this Lite repository only; it does not grant access to any private or commercial edition.
