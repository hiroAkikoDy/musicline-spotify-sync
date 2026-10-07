# musicline-spotify-sync

NHK-FM「ミュージックライン」の過去回の選曲を取得し、自分の Spotify に
プレイリストとして作成・追記する Node.js ツール（個人利用のみ）。

## 要件
- Node.js 20 以上（ESM・組み込み fetch）

## 設定
`.env.example` を `.env` にコピーして設定する。`.env` とトークン保存ファイルは `.gitignore` 済み。

```
SPOTIFY_CLIENT_ID=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
```

## 使い方（予定）
```
node src/index.js fetch   # NHKからエピソード取得 → data/episodes.json
node src/index.js sync    # マッチングしてSpotifyに追加（--dry-run / --since / --limit / --include-theme）
```

## フェーズ
- Phase 0: 雛形と NHK API 調査（`npm run survey`）
- Phase 1: fetch 実装・ユニットテスト
- Phase 2: Spotify 認証 (PKCE)
- Phase 3: 検索マッチング (dry-run)
- Phase 4: プレイリスト作成

## NHKへの配慮
リクエスト間に 1 秒以上の sleep、結果は `data/` にキャッシュ。
