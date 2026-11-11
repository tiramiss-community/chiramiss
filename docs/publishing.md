# 公開の準備（人がやる手順）

lib（`@tiramiss-community/chiramiss`）は npm に、サーバは Docker イメージ `ghcr.io/tiramiss-community/chiramiss` として公開する。
公開そのものは `.github/workflows/release.yml` が行うが、初回だけ次の手作業が要る。上から順に行う。

## 仕組みのおさらい

- 変更を入れる PR に changeset ファイル（`.changeset/*.md`）を添える。
- main に push されると、`release.yml` の `release` job で `changesets/action` が「Version Packages」PR を作る（または更新する）。
- その PR をマージすると、同じ job が `pnpm release`（`pnpm build && changeset publish`）を実行する。lib を npm に公開し、2 パッケージの git タグを作る。npm へは Trusted Publishing（OIDC、provenance 付き）で公開し、トークンは使わない。
- 公開が行われたら（`published == 'true'`）、`docker` job が `packages/server/package.json` の version でイメージを作り、ghcr に push する。タグは `X.Y.Z`、`X.Y`、`X`（1.0.0 以降のみ）、`latest`（プレリリースでは付けない）。
  - changesets が push するタグは `GITHUB_TOKEN` 由来なので、タグを契機に別の workflow は起動しない。そのため docker は同じ workflow の後続 job にしている。

## 0. 前提: GitHub リポジトリの設定

- リポジトリは `tiramiss-community/chiramiss` であること。npm の Trusted Publishing と provenance は、各 `package.json` の `repository.url`（`https://github.com/tiramiss-community/chiramiss.git`）と、実際に workflow が動いたリポジトリが一致しているかを見る。リポジトリ名を変えた場合は `repository.url` も合わせる。
- Settings → Actions → General → Workflow permissions で「Allow GitHub Actions to create and approve pull requests」を有効にする。これがないと `changesets/action` が Version Packages PR を作れない。

## 1. npm で organization `tiramiss-community` を作る

1. npmjs.com にログインし、Add Organization から `tiramiss-community` を作る（公開パッケージだけなら無料プランでよい）。
2. 公開作業をする人を organization のメンバー（Owner など publish できる権限）にする。アカウントの 2FA を有効にしておく。

## 2. 初回（0.0.0）を手動で公開する

Trusted Publisher は、npm 上にパッケージが存在しないと登録できない。そこで、中身のない仮版として `0.0.0` を手元から手動で公開する。本番の `0.1.0` は CI から Trusted Publishing で公開する。これが OIDC 経路の動作確認も兼ねる。changesets は公開済みのバージョンを飛ばすので、`0.0.0` とは衝突しない。

```sh
git switch main && git pull
pnpm install --frozen-lockfile
pnpm --filter @tiramiss-community/chiramiss build

npm login
cd packages/chiramiss
npm publish --access public --tag placeholder --provenance=false
```

- `packages/chiramiss/package.json` の `publishConfig` に `"provenance": true` があるため、手元で `npm publish` するとそのままでは「provenance は対応する CI でしか作れない」というエラーになる。手元からの初回だけ `--provenance=false` で打ち消す。
- `--tag placeholder` を付けても、最初の版ではレジストリが `latest` も `0.0.0` に向けることがある。`0.1.0` を公開すれば `latest` は `0.1.0` に移るので、そのままでよい。
- 必要なら、公開後に `npm deprecate @tiramiss-community/chiramiss@0.0.0 "placeholder; use 0.1.0 or later"` で仮版であることを示しておく。

サーバ（`@tiramiss-community/chiramiss-server`）は private なので npm には公開しない。

## 3. npm に Trusted Publisher を登録する

npmjs.com の `@tiramiss-community/chiramiss` のページで Settings → Trusted Publisher を開き、GitHub Actions を選んで次を登録する。

| 項目 | 値 |
|:--|:--|
| Organization or user | `tiramiss-community` |
| Repository | `chiramiss` |
| Workflow filename | `release.yml` |
| Environment | （空欄） |

登録後、同じ設定画面の Publishing access で「Require two-factor authentication and disallow tokens」を選ぶと、トークンでの公開を禁止できる（Trusted Publishing は影響を受けない）。最初の CI 公開が成功してから切り替えると安全。

## 4. ghcr のパッケージを Public にし、リポジトリとの紐付けを確認する

最初の `0.1.0` の公開で `docker` job が ghcr に push した後に行う。

1. organization の Packages タブ（`https://github.com/orgs/tiramiss-community/packages`）で `chiramiss` を開く。
2. Package settings → Danger Zone → Change visibility で Public にする。初回 push で作られたパッケージは Private になっているため。
3. パッケージのページに `tiramiss-community/chiramiss` リポジトリが表示されていることを確認する。イメージの `org.opencontainers.image.source` ラベルで自動的に紐付くはずだが、されていなければ Package settings → Connect repository で紐付ける。
4. Package settings → Manage Actions access で、`chiramiss` リポジトリに Write 権限があることを確認する（次回以降の push に必要）。

organization の設定（Settings → Packages）でパッケージの作成や Public 化が禁止されている場合は、先に許可しておく。

## 5. changesets と Trusted Publishing の組み合わせを確認する

`changeset publish` は内部で pnpm（`pnpm publish`）を呼び、さらに npm の publish が動く。OIDC による公開が通るかどうかは、使う pnpm / npm のバージョンに依存する（設計書 4.4）。そこで最初の本番公開で次を確認する。

1. `.changeset/initial-release.md` を含む main に対して作られた「Version Packages」PR をマージする。
2. `release.yml` の `release` job のログで、`@tiramiss-community/chiramiss@0.1.0` の publish が成功していること。
3. npm のパッケージページで、`0.1.0` に provenance（「Built and signed on GitHub Actions」の表示）が付いていること。
4. git タグ `@tiramiss-community/chiramiss@0.1.0` と `@tiramiss-community/chiramiss-server@0.1.0` が作られ、`docker` job が動いて ghcr に `0.1.0`、`0.1`、`latest` が push されていること。

publish が認証エラー（`ENEEDAUTH`、401、404 など）で失敗し、OIDC が使われていない場合は、root の `package.json` の `release` スクリプトを、npm を直接呼ぶ形に切り替える。

```json
"release": "pnpm build && pnpm -r --filter ./packages/chiramiss exec npm publish --provenance --access public && changeset tag"
```

切り替えた後も、`release` job の出力 `published` が `true` になり、`docker` job が動くことを確認する。`changesets/action` v2 は、changesets の CLI が `CHANGESETS_OUTPUT` に書き出す結果で「公開したか」を判定するため、独自の公開スクリプトではこの判定が `false` になることがある。その場合は、公開済みの version で `docker` job を動かす手段（`workflow_dispatch` など）を別途用意する。
