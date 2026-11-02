"""
One-click updater for permanent HTTPS domain: https://hducduy2006-hub.github.io/transflow/
Rebuilds icons, syncs web runtime, updates transflow-extension.zip, and pushes to GitHub Pages.
"""

import os
import shutil
import subprocess
import tempfile
import build_release

GIT_EXE = r"C:\Users\Admin\AppData\Local\GitHubDesktop\app-3.6.10\resources\app\git\cmd\git.exe"
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(ROOT_DIR, "web")
REMOTE_URL = "https://github.com/hducduy2006-hub/transflow.git"


def run_git(args, cwd):
    res = subprocess.run([GIT_EXE] + args, cwd=cwd, text=True, capture_output=True)
    if res.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {res.stderr}")
    return res.stdout.strip()


def main():
    build_release.generate_icons()
    build_release.sync_web_runtime()
    build_release.package_extension_zip()
    build_release.package_web_deploy_zip()

    with tempfile.TemporaryDirectory() as tmpdir:
        for item in os.listdir(WEB_DIR):
            s = os.path.join(WEB_DIR, item)
            d = os.path.join(tmpdir, item)
            if os.path.isdir(s):
                shutil.copytree(s, d)
            else:
                shutil.copy2(s, d)

        run_git(["init", "-b", "gh-pages"], tmpdir)
        run_git(["add", "-A"], tmpdir)
        run_git(["commit", "-m", "chore: update TransFlow HTTPS web deployment"], tmpdir)
        run_git(["remote", "add", "origin", REMOTE_URL], tmpdir)
        run_git(["push", "-u", "origin", "gh-pages", "--force"], tmpdir)

    print("Da cap nhat thanh cong len: https://hducduy2006-hub.github.io/transflow/")


if __name__ == "__main__":
    main()
