# Managed profiles (enterprise policies)

Administrators can have floccus set up profiles for their users through the
browser's enterprise policies. floccus reads them from the extension's managed
storage (`storage.managed`) when the browser starts, whenever the policy
changes, and every 15 minutes.

Users don't have to enter anything: the profile is created, points at the
bookmarks bar (or another folder the policy names), and syncs on its own.

## What a policy can set

The policy holds a list `accounts`. Each entry describes one profile:

| Key | Type | Description |
| --- | --- | --- |
| `id` | string, **required** | Stable identifier. floccus recognizes the profile by it across policy updates. Changing it creates a new profile. |
| `type` | `webdav` \| `nextcloud-bookmarks` | Kind of server. Default: `webdav`. |
| `url` | string, **required** | Server URL. |
| `username` | string | Optional. |
| `serverRoot` | string | Server folder (Nextcloud Bookmarks). |
| `bookmark_file` | string | Bookmarks file, relative to `url` (WebDAV). |
| `bookmark_file_type` | `xbel` \| `html` | File format (WebDAV). |
| `includeCredentials` | boolean | Send client certificates and cookies to the server ("Send client credentials"). |
| `allowRedirects` | boolean | Follow redirects. |
| `label` | string | Profile name. |
| `localRootPreset` | `toolbar` \| `other` \| `menu` \| `root` | The local folder to sync: the bookmarks bar, other bookmarks, the bookmarks menu (Firefox only) or all bookmarks. Default: `toolbar`. |
| `strategy` | `default` \| `slave` \| `overwrite` | Sync strategy: merge, always download, always upload. |
| `enabled` | boolean | Sync on local changes. Default for new profiles: `true`. |
| `syncIntervalEnabled` | boolean | Sync periodically. Default for new profiles: `true`. |
| `syncInterval` | integer | Minutes between periodic syncs. |
| `syncOnStartupEnabled` | boolean | Sync when the browser starts. Default for new profiles: `true`. |
| `failsafe` | boolean | Failsafe against mass deletions and additions. |
| `nestedSync` | boolean | Include the folders of nested profiles. |
| `lockSettings` | boolean | Users can neither change nor remove the profile. Default: `false`. |

The full schema is [`managed_schema.json`](../managed_schema.json).

**Passwords and passphrases cannot be set by policy.** Policies are readable by
every user of the machine (on Windows they are stored in the registry). Use a
server that authenticates without a password, such as client certificates
together with `includeCredentials`, or let users enter the password themselves.
In that case don't set `lockSettings`.

### How floccus applies the policy

* No policy at all (managed storage empty or not available): floccus changes
  nothing.
* An entry with no matching profile: floccus creates one.
* An entry with a matching profile: the settings the policy sets are written
  over whatever the user changed. Settings the policy doesn't mention stay as
  the user set them. If the server, the file or the local folder changed, the
  profile starts over, like it does when a user changes them by hand: the next
  sync merges both sides and deletes nothing. While a profile is syncing, such
  changes wait for the next round.
* A changed `type`: floccus replaces the profile.
* A profile whose entry was removed from the policy becomes an ordinary profile.
  It is neither deleted nor stopped.
* An entry naming a folder this browser doesn't have (`menu` in Chromium) is
  skipped.

Managed profiles show a building icon in the overview and a notice in their
settings. Profiles exported from one and imported again are ordinary profiles.

## Chrome and Edge

Chromium-based browsers read extension policies from the `3rdparty` part of
their policy. The extension's ID depends on where it was installed from: the
Chrome Web Store, the Edge Add-ons store and a self-hosted CRX all have
different IDs. Below, `<extension-id>` stands for the one you deploy.

### Windows registry (GPO)

Chrome:

```
HKEY_LOCAL_MACHINE\Software\Policies\Google\Chrome\3rdparty\extensions\<extension-id>\policy
```

Edge:

```
HKEY_LOCAL_MACHINE\Software\Policies\Microsoft\Edge\3rdparty\extensions\<extension-id>\policy
```

Lists are subkeys with numbered entries, and objects are subkeys. A profile is
therefore a numbered subkey of `accounts`:

```
...\policy\accounts\1
    id                  REG_SZ     company-bookmarks
    type                REG_SZ     webdav
    url                 REG_SZ     https://dav.example.org/dav/
    bookmark_file       REG_SZ     bookmarks.xbel
    bookmark_file_type  REG_SZ     xbel
    includeCredentials  REG_DWORD  1
    localRootPreset     REG_SZ     toolbar
    lockSettings        REG_DWORD  1
```

As a `.reg` file:

```reg
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\Software\Policies\Microsoft\Edge\3rdparty\extensions\<extension-id>\policy\accounts\1]
"id"="company-bookmarks"
"type"="webdav"
"url"="https://dav.example.org/dav/"
"bookmark_file"="bookmarks.xbel"
"bookmark_file_type"="xbel"
"includeCredentials"=dword:00000001
"localRootPreset"="toolbar"
"lockSettings"=dword:00000001
```

In a GPO, use Group Policy Preferences (Computer Configuration → Preferences →
Windows Settings → Registry) to create these values.

### Linux

Put a JSON file into `/etc/opt/chrome/policies/managed/` (Chrome) or
`/etc/chromium/policies/managed/` (Chromium):

```json
{
  "3rdparty": {
    "extensions": {
      "<extension-id>": {
        "accounts": [
          {
            "id": "company-bookmarks",
            "type": "webdav",
            "url": "https://dav.example.org/dav/",
            "bookmark_file": "bookmarks.xbel",
            "bookmark_file_type": "xbel",
            "includeCredentials": true,
            "localRootPreset": "toolbar",
            "lockSettings": true
          }
        ]
      }
    }
  }
}
```

### Checking

`chrome://policy` and `edge://policy` list the values under the extension's
name once the extension is installed. "Reload policies" applies changes
immediately. floccus logs what it did with the policy (lines starting with
`Managed policy:`) in its debug logs.

## Firefox

Firefox does not use `managed_schema.json`. It takes extension policies from the
`3rdparty` part of its enterprise policies. The add-on ID of the floccus
release is `floccus@handmadeideas.org`. A build you sign yourself has your own
ID.

### policies.json

`policies.json` goes into the `distribution` folder of the Firefox installation
directory, for example `C:\Program Files\Mozilla Firefox\distribution\` or
`/etc/firefox/policies/`:

```json
{
  "policies": {
    "3rdparty": {
      "Extensions": {
        "floccus@handmadeideas.org": {
          "accounts": [
            {
              "id": "company-bookmarks",
              "type": "webdav",
              "url": "https://dav.example.org/dav/",
              "bookmark_file": "bookmarks.xbel",
              "bookmark_file_type": "xbel",
              "includeCredentials": true,
              "localRootPreset": "toolbar",
              "lockSettings": true
            }
          ]
        }
      }
    }
  }
}
```

### Windows registry (GPO)

Firefox reads its policies from
`HKEY_LOCAL_MACHINE\Software\Policies\Mozilla\Firefox`, where `3rdparty` follows
the same layout:

```
HKEY_LOCAL_MACHINE\Software\Policies\Mozilla\Firefox\3rdparty\Extensions\floccus@handmadeideas.org\accounts\1
```

The value names and types are the same as for Chrome above. Firefox has no
schema to convert the registry with, so the list comes out as an object with
the keys `1`, `2`, … and booleans as numbers. floccus accepts both. It also
accepts `accounts`, or a single entry, as a JSON string (`REG_SZ`).

`about:policies` shows what Firefox read.

## Things to keep in mind

* A policy doesn't install the extension. Use `ExtensionInstallForcelist` or
  `ExtensionSettings` (Chrome, Edge, Firefox) for that.
* With client certificates, have the browser pick the certificate without
  asking: `AutoSelectCertificateForUrls` in Chrome and Edge. In Firefox, see the
  `Certificates` policy and `security.default_personal_cert`.
* floccus syncs the folder; it doesn't back it up. Keep backups or versions of
  the server's files.
