# Linking a folder

Right-click a project folder in the Explorer, choose **Codea: Link Folder to Project...**, and pick the project in Codea.

The link is saved in the workspace's `.vscode/settings.json`:

```json
{
    "codea-air-code.host": "192.168.1.10:18513",
    "codea-air-code.links": {
        "EmuTests.codea": "iPad Projects/EmuTests"
    }
}
```

The first sync copies files that exist on only one side. A file that differs on both sides is not overwritten: you are asked which version to keep.
