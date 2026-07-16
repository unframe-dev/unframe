# `@unframe/config`

ワークスペースで共有する TypeScript 設定と git hooks を置きます。
各アプリ・パッケージはここから設定を extends / import します。

## git hooks (`githooks/`)

commit message 先頭に gitmoji を強制する `prepare-commit-msg` フックを提供します。
conventional commit prefix を gitmoji に置換します。

| 入力                   | 結果                   |
| ---------------------- | ---------------------- |
| `feat: add feature`    | `✨ add feature`       |
| `fix(auth): bug`       | `🐛 auth: bug`         |
| `gm feat: add feature` | `feat: ✨ add feature` |
| `n feat: add feature`  | `feat: add feature`    |

- `gm ` プレフィックス: conventional prefix を残したまま emoji を挿入する。
- `n ` プレフィックス: gitmoji を付けずにコミットする (エスケープハッチ)。

対応 type: `feat ✨` / `fix 🐛` / `docs 📝` / `style 💄` / `refactor ♻️` /
`perf ⚡️` / `test ✅` / `build 👷` / `ci 🎡` / `chore 🔧` / `remove 🔥` / `deploy 🚀` / `init 🎉`

### 有効化

`nix develop` に入ると自動で有効化されます (`flake.nix` の shellHook → `scripts/dev/install-hooks.sh`)。
手動で有効化する場合:

```sh
./scripts/dev/install-hooks.sh   # core.hooksPath を packages/config/githooks に設定
# または
nix run .#setup                  # 依存インストールと合わせて有効化
```

`core.hooksPath` をリポジトリローカルで上書きするため、グローバルの
`core.hooksPath` (`~/.git_template/hooks` 等) が設定されていても、このリポジトリでは
共有 hook が優先されます。
