Deploy Ghost Line Kit (only after Kiro's code exists and `/verify` passes).

1. Ask the user which target to use: AWS (App Runner for the API, S3 + CloudFront or Amplify for `phantom-handset`) or a faster fallback they already use (e.g. Railway; the user has the Railway CLI). Ask before creating any paid resource.
2. Write the infrastructure and config, plus deploy scripts in `infra/` or the package scripts. Keep secrets in the host's env settings, never in git.
3. Deploy and smoke-test: the Phantom Handset page loads; dialing the Oja Ghost USSD menu returns a menu; a Blackout Line ZIP query returns a response (or the clearly labelled simulation).
4. Put the live URLs into `README.md` and `docs/SUBMISSION-CHECKLIST.md`.
5. Log in `docs/claude-code-log.md`.
