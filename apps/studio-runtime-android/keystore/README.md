# M55 development update signing

`m55-update-debug.jks` is a development-only signing identity for the M55 Android test APK. It is intentionally stable so APK artifacts built by different CI runners can update one another during physical-device testing.

It must never be reused for a production/public release. Production signing requires a separate protected key outside the repository.
