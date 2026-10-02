#!/usr/bin/env python3
"""Verify or reproduce the pinned managed DLLs used by Unity's v2 transport."""
import hashlib
import io
import json
from pathlib import Path
import sys
import urllib.request
import zipfile

plugin_root = Path(__file__).resolve().parents[1] / "Assets" / "Plugins"
mode = sys.argv[1] if len(sys.argv) == 2 else "check"
if mode not in ("check", "generate"):
    raise SystemExit("usage: sync-runtime-dependencies.py [check|generate]")
dependencies = json.loads((plugin_root / "runtime-dependencies.json").read_text())
for dependency in dependencies:
    identifier = dependency["id"]
    destination = plugin_root / f"{identifier}.dll"
    if mode == "generate":
        version = dependency["version"]
        name = identifier.lower()
        url = f"https://api.nuget.org/v3-flatcontainer/{name}/{version}/{name}.{version}.nupkg"
        with urllib.request.urlopen(url, timeout=60) as response:
            package = response.read(16 * 1024 * 1024 + 1)
        if hashlib.sha256(package).hexdigest() != dependency["packageSha256"]:
            raise SystemExit(f"{identifier}: NuGet package checksum mismatch")
        with zipfile.ZipFile(io.BytesIO(package)) as archive:
            payload = archive.read(f"lib/{dependency['framework']}/{identifier}.dll")
            if hashlib.sha256(payload).hexdigest() != dependency["sha256"]:
                raise SystemExit(f"{identifier}: assembly checksum mismatch")
            destination.write_bytes(payload)
            if "licenseUrl" in dependency:
                with urllib.request.urlopen(dependency["licenseUrl"], timeout=30) as response:
                    license_bytes = response.read(64 * 1024 + 1)
            else:
                license_bytes = archive.read(next(entry for entry in archive.namelist() if entry.lower() == "license.txt"))
            if hashlib.sha256(license_bytes).hexdigest() != dependency["licenseSha256"]:
                raise SystemExit(f"{identifier}: license checksum mismatch")
            (plugin_root / dependency["licenseFile"]).write_bytes(license_bytes)
    if hashlib.sha256(destination.read_bytes()).hexdigest() != dependency["sha256"]:
        raise SystemExit(f"{identifier}: assembly drift")
    if hashlib.sha256((plugin_root / dependency["licenseFile"]).read_bytes()).hexdigest() != dependency["licenseSha256"]:
        raise SystemExit(f"{identifier}: license drift")
print(f"Unity managed runtime dependencies: {len(dependencies)} verified")
