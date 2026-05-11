# karyl-chan-plugins

[karyl-chan](https://github.com/0Miles/karyl-chan) Discord bot plugin 的
pnpm monorepo。  
提供共用的 **Plugin SDK**（`@karyl-chan/plugin-sdk`）

## 開發

```bash
pnpm install                    # workspace 安裝 —— sdk 自動 link（workspace:*）
pnpm build                      # tsc 編譯每個 package
pnpm test                       # 跑每個 package 的 test script
pnpm --filter @karyl-chan/plugin-radio dev   # tsx watch radio Plugin
```

bot 本體（`karyl-chan`）在另一個 repo；這個 monorepo 只透過文件化的 HMAC RPC
協定跟它溝通（見 `karyl-chan/docs/development/plugin-guide.md`）。要在本機把整
套疊起來，先跑 bot 自己的 `docker compose up`（它會建立 `karyl-chan-net`
網路），然後：

```bash
pnpm docker:up                  # docker compose up -d --build（COMPOSE_PROFILES 指定的Plugin）
pnpm docker:down
```

## 發布

| 產物                     | 觸發條件                 | 目的地                                     |
|--------------------------|--------------------------|--------------------------------------------|
| `@karyl-chan/plugin-sdk` | git tag `sdk-v<semver>`  | `npm.pkg.github.com`（GitHub Packages npm）|
| `@karyl-chan/plugin-sdk` `@edge` | 每次 push 到 `main` | `npm.pkg.github.com`                       |
| radio docker image       | git tag `radio-v<semver>`| `ghcr.io/<owner>/karyl-radio-plugin:<tag>` + `:latest` |
| radio docker `:edge`     | 每次 push 到 `main`      | `ghcr.io/<owner>/karyl-radio-plugin:edge`  |

`@karyl-chan/plugin-sdk` 在這個 monorepo 內部透過 `workspace:*` 引用，所以外
掛永遠對著 in-tree 的 SDK 編譯。外部使用者從 GitHub Packages 安裝它，`.npmrc`
裡已經配好 `@karyl-chan` registry scope。

## SDK 協定契約

SDK 和 bot 在不同 repo。為了防止漂移，SDK 的 HMAC v0 實作被
`packages/sdk/tests/hmac.test.ts` 裡的靜態 **golden fixtures** 鎖住 —— 那些
hex 字串是 bot 的 `signBodyV0()` 產出的，任何分歧都會讓 CI fail。同樣地，
`verifyPluginSession`（`plugin-session` token 的 EdDSA verifier）對齊 bot 的
`JwtService` token 形狀。

## 新增一個 Plugin

```
1. cp -r packages/radio packages/<key>            # radio 是參考用的多檔案 Plugin
2. 重寫 src/plugin.ts：definePlugin({ key: 'karyl-<key>', ..., pluginCommands: [ definePluginCommand({...}) ] })
   （把 src/* 其餘部分裁掉/換掉 —— radio 專屬的 resolver/library 等等）
3. 改 package.json：name → @karyl-chan/plugin-<key>，砍掉用不到的 deps
4. 在 docker-compose.yml 加一個 service 區塊（profile: [<key>]、dockerfile: Dockerfile.<key> 或一個通用的、
   KARYL_PLUGIN_SETUP_SECRET: ${KARYL_PLUGIN_SETUP_SECRET_<KEY>:-}）
5. 把 KARYL_PLUGIN_SETUP_SECRET_<KEY> 加到 .env.example（和 .env），把 <key> 加到 COMPOSE_PROFILES
6. pnpm install && pnpm --filter @karyl-chan/plugin-<key> build
7. 開通 secret：bot admin POST /api/plugins/setup-secret { pluginKey: 'karyl-<key>' } → 把明文放進 .env
```

對*既有* Plugin 加一個指令：在那個 package 的 `src/plugin.ts` 裡加一個
`definePluginCommand({...})` 項目（如果是多檔案 Plugin，再加一個 handler 模組）。
