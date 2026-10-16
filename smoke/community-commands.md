# Community command coverage

`simply community publish` runs sequentially against the disposable shared org.
The runner requires a linked local `@simplysf/simply-community` and records its
revision and results in ignored `reports/community-*.json` files.

| Case | Proof |
| --- | --- |
| 01 publish completes | Exit 0, JSON status 0, success true, matching name, nonempty id and URL after plugin polling completes |
| 02 unchanged site publishes again | Same success contract on an immediate rerun |
| 03 retry flags accepted | Same contract with `--retry-attempts 2 --retry-backoff 1`; does not force a retry |
| 04 unknown site rejected | Exit 1 and lookup error naming No Such Site |
| 05 ignore lookup error with warning | Exit 0, success false, matching name/error, publish warning in JSON warnings |
| 06 zero wait times out | Exit 1 and CommunityPublishTimeoutError for `--wait 0` |

The plugin exposes no terminal status or last-published timestamp in its result;
its `success: true` means its BackgroundOperation poll completed without Error.
The timeout case runs last: it starts a real publish that can continue server-side.
Allow it to finish before rerunning the suite. It expects a fresh publish still
pending at the first status check; unusually fast jobs can make this case fail.
Each case has a 25-minute process timeout, above its maximum 20-minute `--wait`.
A process timeout is a harness failure, never an expected CLI failure.

`simply community url set` is intentionally not covered: a scratch org cannot
register a custom domain. Site content checks and forced transient retry failures
are outside this suite.

Setup first deploys the two Digital Experiences settings from
`sfdx-source/community` so existing orgs need no recreation. It uses
`sf community list template --json` to require Build Your Own (LWR),
then `sf community create --json`. It polls Network for up to ten minutes and
reuses an existing SSO Smoke Site. Query/auth/create failures abort setup.
Template availability, automatic scratch-org Digital Experiences domain creation,
and live publish behavior require operator validation on a fresh disposable org;
o live acceptance run has been recorded for this suite.
